# apps/worker/src

The worker: the only process that holds the seed, signs, and reads the chain. Web calls it over a private bearer-token HTTP API.

- `main.ts`: entry; config, one RPC connection, the route table, index boot and the stream.
- `env.ts`: `loadEnv` (fails at boot on bad config, devnet only; `FEE_ENGINE`, `FEE_WINDOW_MS`, `FEE_BATCH_HOUR_UTC`), `ops`, `treasury` and the per-lane `buyback` keys.
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
- `announce.ts`: after each commit, `arm` (holder recount, launch, trade and bond events, the engine hook) and `publishFee` (landed public fee rows as `fee` events).
- `stream.ts`: the live log subscription on the BONDR mint and the gap fill.
- `events-route.ts`: GET /events, every indexed change as NDJSON to web.
- `holders.ts`: holder recounts, at most once per coin every 5 min.
- `bondr-price.ts`: BONDR's SOL price in memory, seeded at boot and moved by ingest.
- `trade-state.ts`: quote state caches, one chain read per mint per 2 s and the fee configs per 60 s.
- `trade-quote.ts`: POST /trade/quote (`parseTrade`, `quoteTrade`, devnet `maxSolIn`) and POST /trade/balance (`tradeBalance`).
- `trade-store.ts`: prepared trades in memory (exact message bytes, state), 120 s TTL, 5,000 cap.
- `trade-prepare.ts`: `prepareTrade`, the unsigned simulated and budgeted trade tx (`cuLimitFor`, `priorityMicroLamports`, devnet buy cap).
- `trade-submit.ts`: POST /trade/submit (`submitTrade`: byte compare against the stored message, one paced send, background settle with the landed amount) and POST /trade/view (`viewTrade`).
- `fee-config.ts`: per-network fee engine settings (`feeConfig`: collect minimum, pacing, creator bps), `OPS_FLOOR_LAMPORTS`, the Helius Sender URL and tip accounts.
- `fee-ledger.ts`: `LedgerStore` (with `implied` for the reconcile), `pgLedger` (fee_ledger rows; landing moves the coin fee columns in the same transaction) and `memoryLedger` (same unique rules, for units and the fork stage).
- `fee-send.ts`: `land`, the one fee send path (sign, record pending, broadcast, settle), the ops floor (`opsLow`, `noteOps`) and the mainnet-only Sender path (`tipIxs`, `urgentBroadcast`); `FeeDeps`, `Job`, `FeeCoin`.
- `fee-prebond.ts`: `collectJob`, `splitJob` and `sweepJob` (collect, 90/10 split, sweep), `wBondr`.
- `fee-guard.ts`: `spend`, the guard every balance-sized send passes (settles the coin's pending collect, split and bond burn rows from chain, splits open collects, defers while any stays pending), and `windowJob`.
- `fee-burns.ts`: `forcedJob` (urgent collect and split, fresh cost re-check, forced bond at 105%), `poolBurnJob` (PumpSwap burn of W's whole budget, buy_v2 fallback) and `bondedJob` (on the migration event, then `finalizeJob`).
- `fee-finalize.ts`: `preflight` (the launch tx's CreateEvent user must be the launch wallet, distinct from treasury and W, on curve; any doubt holds) and `finalizeJob` (finalize state from chain, sweeps + create_fee_sharing_config, the one 8000/2000 update, 6009 final, then the closing sweep that empties W).
- `fee-batch.ts`: the daily batch at FEE_BATCH_HOUR_UTC (`scheduleBatch`, one in-memory timer; `batchNow`, single-flight): `buybackBurnJob` (BurnChecked of the buyback's whole BONDR), `distributeJob` (post-bond payout above `distributeMin`, 80/20 deltas in the row), bonded and finalize retries, then the reconcile; `runBatch`, `nextBatchAt`.
- `fee-reconcile.ts`: `reconcile` (each W's and the buyback's ledger-implied BONDR against the chain, 100 accounts per read; a difference writes a reconcile_diff row and a Sentry error, never moves funds), `impliedOf`, `pgImplied`.
- `fee-routes.ts`: `feeRoutes`, the bearer POST /fee/release (the owner names a held coin's deployer; one finalize runs with it) and POST /fee/batch (runs the batch now).
- `fee-recover.ts`: `recover`, the boot settle of every pending fee row from chain status (never a resend) and the split of every open collect; `settleRows` (the same settle at runtime), `recoverAction`.
- `fee-engine.ts`: `startEngine` (one boot read, recover, then arm), the `Engine` (per-coin serial queue, window timers from launch, ready gate), `onIngest` (forced bond trigger per curve patch, bonded job on venue pool) and `withCost` (cost to complete on every curve patch). One worker replica only (D-07).
- `*.test.ts`: vitest checks; DB-backed ones skip without DATABASE_URL.
