# apps/worker

The private worker. It is the only Phase 2 service that touches the chain (D-15). The web server calls it over Railway private networking with a bearer token.

## src

- `main.ts`: boot (env, one devnet connection, routes, vanity refill) and SIGTERM shutdown. No polling loop (Pitfall 6).
- `env.ts`: `loadEnv` and `launchNet` (refuses mainnet in Phase 2, D-02); `ops` and `treasury` keys with the Phase 1 ids.
- `http.ts`: node:http server, `authorized` (timingSafeEqual), `readJson` (16 KB cap), `Fail` for contract errors.
- `prepare.ts`: `POST /prepare`. Guards (pause, consent, rules, hourly table cap, balance) run before any spend, then reserve, W, table, build, simulate, store `prepared`. `prepareGuard`, `parseRequest`, `signBy` and `sellFloor` are pure.
- `build.ts`: `unionTableKeys` (both exits in one table), `ensureTable` (reuse or ops-paid create), `compileLaunch` and `buildMessage` (v0, dev pays, mint second signer, allowlist, 1232 bytes), `simulateLaunch`, pure `simError` and `previewCosts`.
- `launches.ts`: launch rows. `insertPrepared`, `insertFailed`, `advance` (guarded `UPDATE ... WHERE state = from`), `getLaunch`, `tableFor`, `newTablesLastHour`, `consented`.
- `status.ts`: `liveStatus` (`GET /status`, cached 5 s) and `quote` (`POST /quote`); `pauseReason` and `networkFee` are pure.
- `vanity.ts`: the bndr mint pool. `mintKey`, `isBndr` (grinder fast path), `mintKeyFor` (re-derives and checks before signing), `reserve`, `release`, `markUsed`, `poolSize`.
- `grind.ts`: worker_threads grinder, `startRefill` and the pre-fill CLI.
- `*.test.ts`: vitest checks. The vanity reservation test runs against DATABASE_URL inside a rolled-back transaction and skips without it.

## Routes

| Route | Auth |
|-------|------|
| `GET /healthz` | none |
| `GET /status` | bearer WORKER_TOKEN |
| `POST /quote` | bearer WORKER_TOKEN |
| `POST /prepare` | bearer WORKER_TOKEN |

`POST /prepare` takes a `PrepareRequest` and returns a `PrepareResult` (see `@bondr/core/api`). Errors: 409 `paused`, 403 `consent_required`, 400 `invalid_input`, 503 `pool_empty`, 429 `rate_limited` (30 new tables an hour, worker-wide), 402 `insufficient_balance`, 500 `build_failed`. One prepare runs at a time.

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
- Devnet prepare driver: `node --env-file=.env scripts/devnet-launch.ts --size-only | --fund | --prepare-only` (refuses below the ops floor, enforces a per-run budget; see the script header).
- Check a pool: `node --env-file=.env apps/worker/src/grind.ts --check 6` exits 1 below 6 ready mints, or when any row does not end in bndr or does not derive from this seed and lane.
