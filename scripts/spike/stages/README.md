# scripts/spike/stages

One spike step per file. Each exports a `Stage` with `run(ctx)` and `rules(net)` keyed by row id. A net lists its stages in `../nets/<net>.ts`.

| Stage | Rows | Nets |
|-------|------|------|
| `config.ts` | `config` (live Global and fee config, drift) | devnet, fork |
| `create.ts` | `standin.create`, `child.create`, `child.create150.refused` (devnet only) | devnet, fork |
| `launch.ts` | `launch.table.burn`, `launch.burn`, `launch.table.sell`, `launch.sell` | devnet, fork |
| `multihop.ts` | `multihop.buy`, `multihop.sell` | devnet |
| `sharing.ts` | `sharing.config`, `sharing.update`, `sharing.update2.rejected` | devnet (fork repeats it after bond in 01-08) |
| `complete.ts` | `quote.complete`, `child.create.6107` | devnet (last: it ends Q there); fork in 01-09 |

Rows with the `aux.` prefix are helpers (funding, prefunds, tables) and have no rule of their own.
