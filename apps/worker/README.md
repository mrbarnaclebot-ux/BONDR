# apps/worker

The private worker. It is the only Phase 2 service that touches the chain (D-15). The web server calls it over Railway private networking with a bearer token.

## src

- `main.ts`: boot (env, one devnet connection, routes, vanity refill, `resumeLaunches`) and SIGTERM shutdown. No standing polling loop (Pitfall 6).
- `env.ts`: `loadEnv` and `launchNet` (refuses mainnet in Phase 2, D-02); `ops` and `treasury` keys with the Phase 1 ids.
- `http.ts`: node:http server, `authorized` (timingSafeEqual), `readJson` (16 KB cap), `Fail` for contract errors.
- `prepare.ts`: `POST /prepare`. Guards (pause, consent, rules, hourly table cap, balance) run before any spend, then reserve, W, table, build, simulate, store `prepared`. `prepareGuard`, `parseRequest`, `signBy` and `sellFloor` are pure.
- `submit.ts`: `POST /submit`. Pause and expiry re-checked, then `cosign` (core) against the stored message, exit and mint; only then `signed` is stored and the wire is sent.
- `settle.ts`: the state machine. Pure `nextState` and `resumeAction`; `settleLaunch` polls the signature, marks `landed` at confirmation (then facts), rechecks with history 3 times past expiry before `failed expired`; `resumeLaunches` on boot.
- `build.ts`: `unionTableKeys` (both exits in one table), `ensureTable` (reuse or ops-paid create), `compileLaunch` and `buildMessage` (v0, dev pays, mint second signer, allowlist, exit present, 1232 bytes), `simulateLaunch`, pure `simError` and `previewCosts`.
- `launches.ts`: launch rows. `insertPrepared`, `insertFailed`, `advance` (guarded `UPDATE ... WHERE state = from`), `getLaunch`, `unsettled`, `tableFor`, `newTablesLastHour`, `newTablesToday` (the per-wallet daily table cap), `consented`.
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

`POST /prepare` takes a `PrepareRequest` and returns a `PrepareResult` (see `@bondr/core/api`). Errors: 409 `paused`, 403 `consent_required`, 400 `invalid_input`, 503 `pool_empty`, 429 `rate_limited` (30 new tables an hour, worker-wide), 402 `insufficient_balance`, 500 `build_failed`. One prepare runs at a time.

`POST /submit` takes a `SubmitRequest` (`launchId`, base64 dev-signed wire) and returns a `SubmitResult` (`state`, `signature`). A launch that is no longer `prepared` returns its current state (a double submit is a no-op). Errors: 400 `invalid_input`, 404 `not_found`, 409 `paused` and 410 `expired` (the row turns `failed` and the mint is released), 422 `cosign_refused` (the row turns `failed`, the mint stays reserved for Try again), 500 `build_failed`.

## Launch states

`prepared -> signed -> sent -> landed | failed | unknown`, and `unknown -> landed | failed`. `prepared -> failed` on pause, expiry or a refused co-sign. Every change is one guarded UPDATE. `signed` holds the fully signed wire before the send, so a restart resends it while the blockhash is valid (same signature, Solana dedupes). `sent` and `unknown` are never resent (D-16): past the blockhash they are rechecked with history, 3 times 10 s apart, then `failed` with `expired`. `landed` marks the mint used; `failed` releases it. Facts on a landed row: `tokens` (bought), `devChildAfter` (expected "0"), and for sell `solBack`.

## Env

`SOLANA_NET` (devnet only), `ALLOW_MAINNET`, `helius_api_key`, `MASTER_SEED` or `MASTER_SEED_FILE`, `VANITY_LANE`, `VANITY_THREADS`, `BONDR_QUOTE_MINT`, `WORKER_TOKEN`, `PRIORITY_FEE_MICROLAMPORTS`, `DATABASE_URL`, `WORKER_PORT` or `PORT`. See the repo-root `.env.example`.

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
