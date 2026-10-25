# scripts/spike/stages

One spike step per file. Each exports a `Stage` with `run(ctx)` and `rules(net)` keyed by row id. A net lists its stages in `../nets/<net>.ts`.

| Stage | Rows | Nets |
|-------|------|------|
| `config.ts` | `config` (live Global and fee config, drift) | devnet, fork |
| `create.ts` | `standin.create`, `child.create`, `child.create150.refused` (devnet only) | devnet, fork |
| `launch.ts` | `launch.table.burn`, `launch.burn`, `launch.table.sell`, `launch.sell` | devnet, fork |
| `prebond.ts` | `prebond.buyq`, `prebond.trade.1` to `4`, `prebond.collect`, `prebond.split` (v3 trades on the 150 bps C0, sweep + collect, 90/10 split) | fork |
| `bond.ts` | `bond.whale`, `bond.create`, `bond.topup` (TOP-UP), `bond.forced` (buy_exact_quote_in_v3 completes C2 + BurnChecked(simOut), one tx), `bond.exact.create`, `bond.exact.topup` (TOP-UP), `bond.exact` (buy_v3 + BurnChecked(amount)) | fork |
| `pool.ts` | `bond.migrate` (migrate_v2 called by the spike), `bond.pool.topup` (TOP-UP), `bond.pool.burn` (PumpSwap buy_v2 + BurnChecked(baseOut), one tx) | fork |
| `finalize.ts` | `finalize.trade.1` to `6` (sim PumpSwap v2 trades on C2's pool), `finalize.config`, `finalize.update` (sweeps, create_fee_sharing_config, the one 80/20 update on bonded C2), `finalize.distribute` (80:20 payout), `finalize.update2.rejected` | fork |
| `engine-bond.ts` | `engine.collect`, `engine.split`, `engine.forced` (E1: the worker's `forcedJob` after a TOP-UP to about 106% of the cost), `engine.collect.2`, `engine.split.2`, `engine.pool.burn` (E2: traders bond, the stage migrates, the worker's `bondedJob` burns W's whole budget on the pool); writes `E2`, `E2.W`, `E2.sig`, `E2.dev` to state for 05-08 | fork (after finalize) |
| `engine-final.ts` | `engine.finalize.config`, `engine.finalize.update`, `engine.finalize.sweep` (E2: two sim pool trades, then the worker's `finalizeJob`: the deployer pre-flight on E2's launch tx, sweeps + create_fee_sharing_config, the one 8000/2000 update to E2's dev and the treasury, and the closing sweep that leaves W at 0 BONDR and 0 child tokens) | fork (after engine) |
| `multihop.ts` | factory `multihopStage(coinKey, idPrefix)`: `<idPrefix>multihop.buy`, `<idPrefix>multihop.sell` on `state[coinKey]`. Devnet `("C0", "")` routes SOL -> Q curve -> C0; fork `("C2", "bonded.")` (after finalize) routes SOL -> Q curve -> C2 pool, `("C3", "migrated.")` routes SOL -> Q pool -> C3 curve, and `("C2", "pooled.")` (last) routes SOL -> Q pool -> C2 pool. Each leg records `pureQuote` (the worker's `routeQuote` on pre-trade state) and the live hop fee bps; the rule fails when `pureQuote` and `outAmount` differ by more than 1 base unit | devnet, fork |
| `sharing.ts` | `sharing.config`, `sharing.update`, `sharing.update2.rejected` | devnet (`finalize.ts` repeats it on the fork after bond) |
| `complete.ts` | `child.create.6107` (one tx: completing buy + child create on a fresh Q), `quote.complete` | devnet (last: it ends Q there), fork (after finalize) |
| `pool-launch.ts` | `awaitingStage`: `migrated.launch.awaiting` (the builder refuses complete, unmigrated Q). `poolLaunchStage`: `migrated.launch.table.burn`, `migrated.launch.burn`, `migrated.launch.table.sell`, `migrated.launch.sell` (D-18 pool-route launches, `maxFieldBytes`), and writes `packages/core/src/fixtures/pool-sell-launch.json` | fork (awaiting after complete, launches after migrated) |
| `migrated.ts` | `quote.migrate` (migrate_v2 of Q), `migrated.child.create` (C3 on the migrated Q, 150 bps), `migrated.trade` | fork (after complete, then `migrated.multihop`) |

Rows with the `aux.` prefix are helpers (funding, prefunds, tables) and have no rule of their own.
