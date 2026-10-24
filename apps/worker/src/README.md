# apps/worker/src

The worker: the only process that holds the seed, signs, and reads the chain. Web calls it over a private bearer-token HTTP API.

- `main.ts`: entry; config, one RPC connection, the route table, index boot and the stream.
- `env.ts`: `loadEnv` (fails at boot on bad config, devnet only), `ops` and `treasury` keys.
- `http.ts`: `start` (node:http, bearer check, JSON), `Fail` / `fail` for contract errors, `Routes` keyed "METHOD /path".
- `sentry.ts`: OPS-01 Sentry init with the shared scrub; imported first by main.ts.
- `status.ts`: GET /status and POST /quote for the launch form (5 s single-flight cache), the in-memory kill switch, `Ctx`, `MAX_SOL_IN`.
- `prepare.ts`: POST /prepare, the unsigned launch tx behind every cheap guard; `walletOf`.
- `build.ts`: prepare's chain steps (table keys, per-coin table, compiled message, simulation).
- `submit.ts`: POST /submit, co-sign after the byte compare, then send.
- `settle.ts`: settles a sent launch and resumes in-flight launches on boot.
- `launches.ts`: launch row reads and guarded state updates.
- `vanity.ts`: the bndr mint pool (seed-derived mint keys, reserve and release).
- `grind.ts`: the bndr grinder threads, refill on demand, and its CLI.
- `ingest.ts`: the one write path for launches and trades, `knownCoins`, the boot backfill.
- `stream.ts`: the live log subscription on the BONDR mint and the gap fill.
- `events-route.ts`: GET /events, every indexed change as NDJSON to web.
- `holders.ts`: holder recounts, at most once per coin every 5 min.
- `bondr-price.ts`: BONDR's SOL price in memory, seeded at boot and moved by ingest.
- `trade-state.ts`: quote state caches, one chain read per mint per 2 s and the fee configs per 60 s.
- `trade-quote.ts`: POST /trade/quote (`parseTrade`, `quoteTrade`, devnet `maxSolIn`) and POST /trade/balance (`tradeBalance`).
- `trade-store.ts`: prepared trades in memory (exact message bytes, state), 120 s TTL, 5,000 cap.
- `trade-prepare.ts`: `prepareTrade`, the unsigned simulated and budgeted trade tx (`cuLimitFor`, `priorityMicroLamports`, devnet buy cap).
- `*.test.ts`: vitest checks; DB-backed ones skip without DATABASE_URL.
