# apps/worker

The private worker. It is the only Phase 2 service that touches the chain (D-15). The web server calls it over Railway private networking with a bearer token.

## src

- `main.ts`: boot (env, one devnet connection, routes, vanity refill, `resumeLaunches`, then the index boot: `seedBondrPrice`, `loadCoins`, `startEngine`, `backfillLaunches`, `startStream`) and SIGTERM shutdown. No standing polling loop (Pitfall 6).
- `env.ts`: `loadEnv` and `launchNet` (refuses mainnet in Phase 2, D-02); `ops` and `treasury` keys with the Phase 1 ids.
- `http.ts`: node:http server, `authorized` (timingSafeEqual), `readJson` (16 KB cap), `Fail` for contract errors; `Streams` are long-lived handlers behind the same bearer check.
- `prepare.ts`: `POST /prepare`. Guards (pause, consent, rules, hourly table cap, balance) run before any spend, then reserve, W, table, build, simulate, store `prepared`. `prepareGuard`, `parseRequest`, `signBy` and `sellFloor` are pure.
- `submit.ts`: `POST /submit`. Pause and expiry re-checked, then `cosign` (core) against the stored message, exit and mint; only then `signed` is stored and the wire is sent.
- `settle.ts`: the state machine. Pure `nextState` and `resumeAction`; `settleLaunch` polls the signature, marks `landed` at confirmation (then facts), rechecks with history 3 times past expiry before `failed expired`; `resumeLaunches` on boot.
- `build.ts`: `unionTableKeys` (both exits in one table), `ensureTable` (reuse or ops-paid create), `compileLaunch` and `buildMessage` (v0, dev pays, mint second signer, allowlist, exit present, 1232 bytes), `simulateLaunch`, pure `simError` and `previewCosts`.
- `launches.ts`: launch rows. `insertPrepared`, `insertFailed`, `advance` (guarded `UPDATE ... WHERE state = from`), `getLaunch`, `unsettled`, `tableFor`, `newTablesLastHour`, `newTablesToday` (the per-wallet daily table cap), `consented`.
- `ingest.ts`: the one write path for the indexer. `writeParsed` writes a `parseTx` result in the caller's transaction: the new coin (on conflict do nothing), trades with `on conflict (signature, ix) do nothing returning`, and coin patches only for a mint that got a new trade. `ingestTx(conn, sig)` fetches, parses and writes one tx; `ingestLaunch(conn, row, tx)` writes a landed launch's coin and Launch rows, adds it to `knownCoins` and gap fills it; `gapFill`/`gapFillAll` ingest every signature after a coin's `last_sig`; `loadCoins` fills `knownCoins` at boot; `backfillLaunches` indexes every landed launch without a coin row, once per boot, paced.
- `stream.ts`: the live indexer. One websocket, one log subscription on the BONDR mint; pure `isPumpInvoke`, `shouldIngest`, `backoff`.
- `holders.ts`: `countHolders` (pure) and `touch`, the holder recount on a trade when the last one is 5 min old (no timer); publishes a `holders` event after each recount write.
- `events-route.ts`: `GET /events`, the live NDJSON stream web's hub holds (one per web process). `publish` stamps ids `<epoch>-<seq>` (epoch is boot time); a `{"type":"ping","id":<current id>}` line opens the stream and repeats every 15 s, so a reconnecting hub knows whether it missed anything. `ingest.ts` publishes `launch`, `trade` (with the coin's `coinRow` numbers from `@bondr/core/coin-row`, one read per coin per write and none when nobody listens) and `bond` (a venue move) after each commit that inserted rows.
- `bondr-price.ts`: BONDR's SOL price in memory only (never stored, D-04). `seedBondrPrice` reads BONDR's curve, or its BONDR/SOL pool once migrated; BONDR events the ingest sees move it, only forward in slots. A failed seed fails the index boot, which retries with backoff.
- `status.ts`: `liveStatus` (`GET /status`, cached 5 s) and `quote` (`POST /quote`); `pauseReason` and `networkFee` are pure.
- `vanity.ts`: the bndr mint pool. `mintKey`, `isBndr` (grinder fast path), `mintKeyFor` (re-derives and checks before signing), `reserve`, `release` (only when `canRelease`), `markUsed`, `vanityRow`, `poolSize`.
- `grind.ts`: worker_threads grinder, `startRefill` and the pre-fill CLI.
- `*.test.ts`: vitest checks. The vanity reservation test runs against DATABASE_URL inside a rolled-back transaction and skips without it.

## Routes

| Route | Auth |
|-------|------|
| `GET /healthz` | none |
| `GET /status` | bearer WORKER_TOKEN |
| `POST /quote` | bearer WORKER_TOKEN |
| `POST /prepare` | bearer WORKER_TOKEN |
| `POST /submit` | bearer WORKER_TOKEN |
| `GET /events` | bearer WORKER_TOKEN |
| `POST /trade/quote`, `/trade/balance`, `/trade/prepare`, `/trade/submit`, `/trade/view` | bearer WORKER_TOKEN |
| `POST /fee/release` | bearer WORKER_TOKEN |
| `POST /fee/batch` | bearer WORKER_TOKEN |
| `POST /admin/health`, `/admin/switch`, `/admin/act` | bearer WORKER_TOKEN and `actor` equal to ADMIN_WALLET |

`POST /prepare` takes a `PrepareRequest` and returns a `PrepareResult` (see `@bondr/core/api`). Errors: 409 `paused`, 403 `consent_required`, 400 `invalid_input`, 503 `pool_empty`, 429 `rate_limited` (30 new tables an hour, worker-wide), 402 `insufficient_balance`, 500 `build_failed`. One prepare runs at a time.

`POST /fee/release` takes `{ mint, deployer }` for a coin whose finalize is held (D-18) and returns `{ ok: true }` once one finalize with that deployer is queued. The deployer must be base58 and on curve; the engine re-checks that it differs from the treasury and W. Errors: 400 `invalid_input` (bad keys, off curve, or the coin is not held).

`POST /fee/batch` takes no body and runs the daily batch now; it returns the run's summary (`opsLow`, `burn`, `distribute`, `finalize`, `accounts`, `diffs`). A call during a run gets that run. Errors: 409 `paused` when the engine is off (never wired).

`POST /submit` takes a `SubmitRequest` (`launchId`, base64 dev-signed wire) and returns a `SubmitResult` (`state`, `signature`). A launch that is no longer `prepared` returns its current state (a double submit is a no-op). Errors: 400 `invalid_input`, 404 `not_found`, 409 `paused` and 410 `expired` (the row turns `failed` and the mint is released), 422 `cosign_refused` (the row turns `failed`, the mint stays reserved for Try again), 500 `build_failed`.

## Launch states

`prepared -> signed -> sent -> landed | failed | unknown`, and `unknown -> landed | failed`. `prepared -> failed` on pause, expiry or a refused co-sign. Every change is one guarded UPDATE. `signed` holds the fully signed wire before the send, so a restart resends it while the blockhash is valid (same signature, Solana dedupes). `sent` and `unknown` are never resent (D-16): past the blockhash they are rechecked with history, 3 times 10 s apart, then `failed` with `expired`. `landed` marks the mint used; `failed` releases it. Facts on a landed row: `tokens` (bought), `devChildAfter` (expected "0"), and for sell `solBack`.

## Index tables

`coins` holds one row per landed launch: curve reserves, `venue` (`curve`, `complete`, `pool`), `mcap_sol`, `launch_mcap_sol`, `progress`, `bondr_at_bond`, `bond_sol`, `last_sig`, `last_trade_at`, holders and bond facts. `trades` holds every trade of a known coin, keyed by `(signature, ix)`, with `seq` ordering trades inside a slot. A launch writes its dev buy and its exit (`sell`, or a synthetic `burn` row at ix 1000), both `launch = true`. Postgres enforces the venue and side enums, `sol is null` exactly for burns, `bonded_at` set exactly off the curve, and `progress` in 0..1.

`coins.last_slot` is the slot of the trade that set the coin's state. A trade from an older slot (a gap fill landing after the stream) inserts its row but leaves the coin alone; same-slot txs have no known order, so the later write wins. The venue only advances (curve, complete, pool).

`settle.ts` calls `ingestLaunch` with the tx it already fetched for the facts; a failure there is logged and never undoes `landed`, and the next boot's backfill picks the launch up.

## Indexer

- **One subscription.** `startStream` opens one websocket (`wsUrl`, key never logged) and sends one `logsSubscribe { mentions: [BONDR mint] }` at `confirmed` (D-05). Every BONDR coin trade, on the curve or on PumpSwap, names the BONDR mint. A notification with an error, or without a pump or PumpSwap invoke (a plain BONDR transfer), is dropped before any fetch. The rest are queued by signature, de-duplicated and ingested one at a time.
- **Keepalive and reconnect.** A JSON-RPC ping every 30 s. On close: reconnect after 1 s doubling to 30 s with 20 percent jitter; a connection healthy for 60 s resets the backoff.
- **Gap fill.** Every open subscribes first, then runs `gapFillAll`: one read of `coins`, then `getSignaturesForAddress(mint, until: last_sig)` per coin, oldest first. Each new coin is gap filled at registration too, so a sniper trade the stream saw before the coin was known is caught (Pitfall 3).
- **Holders.** Each inserted trade calls `touch(coin)`. A recount runs at most once per coin every 5 min, only for coins that traded. It counts Token-2022 accounts of the mint with a positive balance, one per owner, excluding the curve, the pool and the incinerator.
- **Helius credits.** One websocket. Gap fill and the stream fetch one `getTransaction` per tx, paced at 10 a second in gap fill. A recount is one `getProgramAccounts` (10 credits). Switch to `getProgramAccountsV2` if credits pass 80 percent.
- **Neon.** Nothing reads Postgres on a timer: the database is touched only when a trade lands, on a websocket open, or by a recount a trade armed. A quiet devnet lets Neon scale to zero. A local worker indexes only while it runs; on its next start the gap fill catches up.
- **Reorgs.** Not handled: `confirmed` blocks are not expected to roll back, and the `(signature, ix)` key keeps any re-ingest safe.

## Env

`SOLANA_NET` (devnet only), `ALLOW_MAINNET`, `helius_api_key`, `MASTER_SEED` or `MASTER_SEED_FILE`, `VANITY_LANE`, `VANITY_THREADS`, `BONDR_QUOTE_MINT`, `WORKER_TOKEN`, `PRIORITY_FEE_MICROLAMPORTS`, `DATABASE_URL`, `WORKER_PORT` or `PORT`, `FEE_ENGINE` (`off` default, `dry`, `on`; anything else refuses to boot), `FEE_WINDOW_MS` (default 86400000, at least 60000), `FEE_BATCH_HOUR_UTC` (0-23, default 4). See the repo-root `.env.example`.

## Owner console

Web forwards the session wallet as `actor`; the worker answers 403 `forbidden` unless it equals ADMIN_WALLET (unset means closed). `POST /admin/switch` takes `{ job, enabled }` and returns the five switches. `POST /admin/act` takes `{ action: "hold" | "release_hold" | "recheck_launch", mint, reason? }` (reason 1 to 120 characters, hold only) and returns `{ outcome }`. Re-check is one signature status read: a confirmed launch runs the normal landed path, anything else answers `not_on_chain` and changes nothing; no in-flight launch is 409 `not_applicable`. Release hold on a finalize-held coin also sets finalize back to `none`, so the next batch re-runs the full pre-flight.

The console's switch, hold, release and re-check actions are audited: one `admin_audit` row each, written before the change. The bearer `POST /kill-switch` and `POST /fee/release` stay for the runbook and are not audited (OQ6).

## Fee engine

Behind `FEE_ENGINE`. Off, the worker behaves as in Phase 4 plus `cost_to_complete` on every curve patch. Dry builds and simulates every job and writes nothing. On sends. At boot (`startEngine`, after `loadCoins`): one read of every coin with its launch's W, one ops balance read for the floor, then `recover` settles every pending fee row from its signature (never a resend) and splits every landed collect with no split, and only then are window timers armed. A coin whose W does not derive from this seed is skipped. Each unbonded coin has one in-memory timer for its current window's end, counted from launch; at the end it collects, splits and sweeps (`windowJob`) through a per-coin serial queue. Trade hooks keep the fee numbers in memory and enqueue nothing before the engine is ready. Run one worker replica only (D-07): a second would send every window twice. Local and staging share the devnet ops wallet, so keep `FEE_ENGINE=off` locally except for the e2e (Pitfall 11).

### Runbook

- **Flag.** `FEE_ENGINE=off` (default), `dry` (build and simulate, write nothing) or `on` (send). Set `on` only on staging and for the local devnet e2e; stop that local worker after the run, because both sign with the one devnet ops wallet (Pitfall 11). To pause the engine, set it back to `off` and redeploy. Staging runs `FEE_ENGINE=on` since 2026-10-25 (24 h window, `FEE_WINDOW_MS` unset); local stays `off` (Pitfall 11). With nothing pending, recovery logs nothing; the `coins armed` line prints only after it finishes.
- **Window.** `FEE_WINDOW_MS`, default 24 h, counted from each coin's launch. Shorten it only locally (the e2e uses 600000); give web the same value, it draws the Bond and burn countdown from it.
- **Batch.** `FEE_BATCH_HOUR_UTC`, default 4: the buyback burn, the distribution crank, the bond and finalize retries, then the reconciliation. Run it now with `curl -X POST -H "Authorization: Bearer $WORKER_TOKEN" "$WORKER_URL/fee/batch"` (both read from your shell; never paste the token into a file or a log).
- **Release a held finalize.** `curl -X POST -H "Authorization: Bearer $WORKER_TOKEN" -H "content-type: application/json" -d '{"mint":"<mint>","deployer":"<address>"}' "$WORKER_URL/fee/release"`, after a manual check of the deployer. A held finalize is never retried by itself, the batch included; Phase 6 adds a UI.
- **Floors and minimums.** Per network in `src/fee-config.ts`: the ops floor (0.05 SOL; below it non-urgent sends pause and the batch only reconciles), the collect minimum (10,000 lamports on devnet, 0.001 SOL elsewhere), the Sender tip and the send pace. Top ops up by hand when the floor alert logs.
- **Boot order.** Load every coin, recover pending rows, mark ready, then arm the window timers and the batch timer. Nothing sends before ready.
- **One replica** (D-07). Two workers would send every window and every batch twice.
- **Spend.** Ops pays every fee; the devnet e2e (`E2E_DEVNET=1 FEE_WINDOW_MS=600000 pnpm exec playwright test apps/web/e2e/fee-devnet.e2e.ts`) prints ops and the sim wallet before and after and fails above 0.05 SOL a run.
- **New migrations, 0005 and 0006.** On staging deploy web first: its pre-deploy applies them, and the Phase 4 worker runs fine on the additive schema. Then deploy the worker with `FEE_ENGINE=off`, then set it to `on`. Done that way on 2026-10-25 (05-13): web's pre-deploy applied 0005 and 0006 while the Phase 4 worker kept running, then the worker booted with `fee engine off`.

## Vanity lanes

A mint key is `derive(seed, "mint", net, lane + "." + idx)`. The database stores only `(idx, pubkey)`, never a secret (D-21). Local and staging share the devnet seed (D-20), so the lane in the id keeps their pools disjoint. Each lane has its own database: `local` fills the Neon dev branch, `staging` fills main. Never point a lane at the other lane's database: `mintKeyFor` would refuse every row.

The pool targets 20 ready mints. The worker refills it in the background when it drops below 10, checking on boot and after each reservation. It warns below 3. `VANITY_THREADS=0` turns off background grinding.

## Commands

From the repo root:

- Run locally: `pnpm --filter @bondr/worker dev` (reads the repo-root .env; set WORKER_PORT to move off 8080).
- Pre-fill the local pool from the Mac: `node --env-file=.env apps/worker/src/grind.ts --count 6 --threads 4`. Use 4 threads, one per performance core: past that, OpenSSL lock contention lowers the total rate.
- Pre-fill staging: run the same command with `DATABASE_URL` (the staging URL from `DATABASE_URL_STAGING`) and `VANITY_LANE=staging` set in the shell. `--env-file` never overrides variables that are already set.
- Same via pnpm: `pnpm --filter @bondr/worker grind --count 6 --threads 4`.
- Devnet prepare driver: `node --env-file=.env scripts/devnet-launch.ts [--size-only | --fund | --prepare-only | --tamper]` (no flag: a signed burn and sell launch through submit) (refuses below the ops floor, enforces a per-run budget; see the script header).
- Check a pool: `node --env-file=.env apps/worker/src/grind.ts --check 6` exits 1 below 6 ready mints, or when any row does not end in bndr or does not derive from this seed and lane.

## Staging deploy

Railway project `bondr`, environment `staging`, services `web` (public: https://web-staging-72bad.up.railway.app) and `worker` (no public domain; web reaches it at `http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:${{worker.PORT}}`). Build, start, pre-deploy (web runs `node packages/core/src/migrate.ts`) and healthchecks live in the service settings, not in a file: Railway no longer reads railway.json for new services. Both run in US East, next to Neon.

- Redeploy from the local checkout, worker first: `railway up --service worker --environment staging --detach`, then the same with `--service web`. When a migration is new, deploy web first: its pre-deploy migrates, and the worker's backfill and indexer need the new tables. `.railwayignore` keeps `.planning` out of the upload.
- Set a secret: `printf %s "$V" | railway variable set NAME --stdin --service worker --environment staging --skip-deploys`. One name per call. The seed and the Helius key go on the worker only; web refuses to boot holding them.
- Deleting a variable does not redeploy: run `railway service redeploy --service <name> --environment staging --yes`.
- Trade routes (Phase 4) need no new variable (`PRIORITY_FEE_MICROLAMPORTS` keeps its default) and no migration. Prepared and in-flight trades live in the worker's memory (D-07, no Postgres in the trade path), so run exactly one worker replica: a second one would 404 a submit or poll its sibling prepared.
- Staging coins are all devnet test coins. The lists show every coins row and filter none of them (RESEARCH Open Question 4).
