---
phase: 01-chain-spike
plan: 09
subsystem: core
tags: [fork, quote-migration, 6107, multi-hop, pumpswap]
requires: [01-08, 01-05]
provides:
  - "scripts/spike/stages/migrated.ts: quote.migrate, migrated.child.create (C3 on the migrated Q, 150 bps), migrated.trade"
  - "scripts/spike/stages/multihop.ts: multihopStage(coinKey, idPrefix) factory, devnet (\"C0\", \"\") and fork (\"C3\", \"migrated.\")"
  - "packages/core/src/route.ts: Route.venues (each hop's venue, e.g. \"pool,curve\")"
  - "nets/fork.ts order: ... finalize, complete, migrated, migrated.multihop"
affects: [01-10]
tech-stack:
  added: []
  patterns:
    - "One multihop stage factory per routed coin; an empty idPrefix keeps devnet ids so passed devnet rows still skip"
    - "The Pitfall 1 Q-completion guard runs only while Q is on its curve"
key-files:
  created:
    - scripts/spike/stages/migrated.ts
  modified:
    - scripts/spike/stages/multihop.ts
    - scripts/spike/stages/README.md
    - scripts/spike/nets/fork.ts
    - scripts/spike/nets/devnet.ts
    - packages/core/src/route.ts
    - packages/core/src/README.md
    - scripts/spike/results/fork.json
decisions:
  - "The fork 6107 proof uses the devnet pattern: one tx [completing buy, child create], reverted with 6107, then the real completing buy. Evidence is comparable across nets"
  - "A child create on a migrated Q carries 8 remaining accounts (5 + 3 pool accounts) and is 1,163 bytes, 99 more than the 1,064-byte create on an unmigrated Q"
  - "resolveMultiHopRoute picks the pool venue for a migrated Q by itself: buy venues pool,curve and sell venues curve,pool. route.ts needed no routing change"
metrics:
  duration: "about 15 min"
  completed: 2026-10-19
  tasks: 2
  files: 8
---

# Phase 1 Plan 09: Fork 6107, quote migration and the pool multi-hop route Summary

On the mainnet fork the stand-in Q went through the last two D-05 states. First, one tx made of a completing buy and a child create reverted with 6107 QuoteCurveAwaitingMigration, and the whale then completed Q for real. Next, migrate_v2 moved Q to its PumpSwap pool. A child C3 was created on the migrated Q with creator W3 and 150 bps, a trader bought it with Q, and multi_hop_swap routed SOL through Q's pool into C3 and back.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Fork states 2 and 3: 6107 on a complete Q, migrate Q, child create on the migrated Q | 3f22101 |
| 2 | multi_hop_swap through the migrated Q pool, via a reusable multihop stage | 371b699 |

## Fork evidence (results/fork.json, final run, Q GFsYGcXQ..., C3 8NzhMaHa...)

| Row | Signature | Bytes | CU / limit | Facts |
|-----|-----------|-------|------------|-------|
| aux.6107.table | 4n4nQqC6Jyfp... | 1,072 | 23,639 | lookup table for the 6107 tx (1 tx) |
| **child.create.6107** | 3WR7PsWzi5g5... | 666 (with table) | 162,327 / 600,000 | landed failure, **6107 QuoteCurveAwaitingMigration** at ix 4 (the create, right after the completing buy); cost 8,380,454,856, spend 8,883,282,147 lamports; no skipped fact |
| quote.complete | 5ic5wnq4fTx8... | 787 | 73,088 / 600,000 | complete true |
| **quote.migrate** | 2H6wp1diLedS... | 1,092 | 347,225 / 600,000 | pool pUuA4aDE..., poolExists true |
| **migrated.child.create** | 4xgnMAb7oJm3... | **1,163** | 162,685 / 600,000 | creator = W3 5JDMdUBY..., quoteMint = Q, creatorFeeBps 150, depth 1, remainingAccounts 8 |
| migrated.trade | PSxEsYqegsC4... | 797 | 98,551 / 600,000 | spend 5,253,558,763,365 Q (5% of C3's raise), C3 out 133,153,338,235,925 |
| **migrated.multihop.buy** (SOL -> Q pool -> C3) | 3Ud2HiDUMNFB... | **1,132** | **162,017** / 600,000 | venues pool,curve; amountIn 1 SOL; outAmount = expectedOut 49,999,487,020,451; minAmountOut 47,499,512,669,428 |
| **migrated.multihop.sell** (C3 -> Q pool -> SOL) | 44WycpbXMuVA... | **1,100** | **150,068** / 600,000 | venues curve,pool; amountIn 183,152,825,256,376; outAmount = expectedOut 3,010,552,264 lamports; minAmountOut 2,860,024,650 |

Notes on the evidence:
- **6107 pattern.** The fork used the same pattern as devnet: one tx with the completing buy and then the child create. The fork has no keeper, so a separate create would also have worked. The same pattern keeps the two nets' evidence comparable, and complete.ts needed no change. The tx reverted, so the whale's spend paid for the real completing buy (quote.complete) right after.
- **Migrated-quote create size.** 1,163 bytes against 1,064 for bond.create on the unmigrated 90% Q: +99 bytes, which is 3 accounts (3 x 32 bytes plus 3 index bytes). The decoded instruction has 8 remaining accounts, as CREATE_WITH_PUMP_COIN_QUOTE.md requires for a migrated Q. Devnet's state-3 create (aux.child.create.migratedQ, 01-05) was also 1,163 bytes.
- **Pool route sizes.** The buy is 1,132 bytes (22 more than the devnet curve route), which leaves 100 bytes of headroom without a lookup table. The sell is 1,100, the same as on devnet.
- **The sell amount includes migrated.trade's C3.** The sell returns the trader's whole C3 balance (the 50.0T from the multihop buy plus the 133.2T from migrated.trade). That is why it pays out about 3 SOL for a 1 SOL buy. The route is the same either way.

## Verification

- `SPIKE_NET=fork pnpm spike`: "fork: 50 ok, 0 failed". The earlier run on a fresh fork hit one transient Surfpool "Failed to fetch accounts from remote" on finalize.update2.rejected (Pitfall 8). The next run on a fresh fork passed, and so did the final run.
- `SPIKE_NET=devnet pnpm spike`: all six stages logged skip, including "stage multihop: skip". devnet.json is byte-identical, so no devnet SOL was spent.
- `SPIKE_NET=all pnpm spike:check`: 73 passed, 0 failed, including the secret scan.
- `pnpm spike:page`: PASS 66, FAIL 0, EXPECTED FAIL 5, NOT RUN 0.
- `pnpm vitest run` (25 tests), `pnpm lint` and `pnpm typecheck` pass after each commit.
- File sizes: migrated.ts 108 lines, multihop.ts 119, complete.ts 192 (unchanged). prebond.ts stays at 298.
- `api-key` appears 0 times in fork.json. The fork was stopped with `pnpm spike:fork-down`.

## Deviations from Plan

1. **[Rule 2] route.ts returns each hop's venue.** Without it, nothing in the rows showed that the SOL hop actually ran on Q's pool. Pool and curve hops pass the same number of accounts, so the size alone does not tell them apart. `Route.venues` is the SDK's resolved venue list. The multihop rows record it as `facts.venues`. This is the only route.ts change, and routing itself is unchanged. Commit 371b699.
2. **Task 1 ran the fork before its commit.** The plan left the chain run to Task 2. One local fork run (48 ok) checked the new rows before the commit, so the committed fork.json in 3f22101 is from that run. Task 2's commit holds the final run. No devnet sends.
3. **complete.ts needed no fork tweak.** The whale funding already uses airdrops on the fork, and the stage already uses the one-tx 6107 pattern. It is only appended to nets/fork.ts.

## Known Stubs

None.

## Requirements

SPIKE-05 now holds before the stand-in migrates (devnet, 01-05, SOL -> Q curve -> C0) and after it (fork, this plan, SOL -> Q pool -> C3). D-05 states 2 and 3 are proven on the fork as well as devnet.

## Notes for later plans

- **01-10 (devnet refresh).** The devnet list and row ids did not change. multihopStage("C0", "") keeps the stage name "multihop".
- **Phase 2 (launch).** A launch against a migrated BONDR coin has a create that is 99 bytes larger. Size the launch lookup table for the 8-account quote group.
- **Phase 5 (auto-pause, PROJECT.md default 5).** On the fork, the window between completion and migration is open until someone calls migrate_v2. Every child create in that window fails with 6107.

## Self-Check: PASSED

- scripts/spike/stages/migrated.ts is present.
- Commits 3f22101 and 371b699 are on phase-01-chain-spike.
