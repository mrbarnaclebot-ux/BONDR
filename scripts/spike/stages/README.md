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
| `multihop.ts` | `multihop.buy`, `multihop.sell` | devnet |
| `sharing.ts` | `sharing.config`, `sharing.update`, `sharing.update2.rejected` | devnet (fork repeats it after bond in 01-08) |
| `complete.ts` | `quote.complete`, `child.create.6107` | devnet (last: it ends Q there); fork in 01-09 |

Rows with the `aux.` prefix are helpers (funding, prefunds, tables) and have no rule of their own.
