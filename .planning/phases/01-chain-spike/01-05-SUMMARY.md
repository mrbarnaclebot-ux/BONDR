---
phase: 01-chain-spike
plan: 05
subsystem: core
tags: [devnet, multi-hop, fee-sharing, quote-migration]
requires: [01-03]
provides:
  - "packages/core/src/route.ts: routeBuy / routeSell (resolveMultiHopRoute + simulateMultiHopSwap + multiHopSwapInstructions)"
  - "packages/core/src/sharing.ts: FINAL_SHARES, SHARING_CONFIG_SIZE, finalizeIxs, updateIxs, readSharing"
  - "packages/core/src/curve.ts: readCurve, costToComplete (SDK v3 quote)"
  - "packages/core/src/send.ts: fetchMeta exported (full ConfirmedTransactionMeta)"
  - "scripts/spike/stages/multihop.ts, sharing.ts, complete.ts on devnet; state keys Q.complete, Q2"
  - "scripts/spike/stages/README.md"
affects: [01-06, 01-07, 01-08, 01-09, 01-10]
tech-stack:
  added: []
  patterns:
    - "Out amounts come from landed tx meta (token or lamport deltas), not from the simulation"
    - "The migration-window proof is one tx [completing buy, child create]: the create always sees the window and the tx reverts"
    - "run.ts skips a devnet stage only when every row is ok AND passes its rule"
key-files:
  created:
    - packages/core/src/route.ts
    - packages/core/src/sharing.ts
    - packages/core/src/curve.ts
    - scripts/spike/stages/multihop.ts
    - scripts/spike/stages/sharing.ts
    - scripts/spike/stages/complete.ts
    - scripts/spike/stages/README.md
  modified:
    - packages/core/src/send.ts
    - packages/core/src/pump.ts
    - packages/core/src/README.md
    - scripts/spike/run.ts
    - scripts/spike/nets/devnet.ts
    - scripts/spike/results/devnet.json
decisions:
  - "finalizeIxs creates the SharingConfig PDA's creator-vault quote ATA between create_fee_sharing_config and update_fee_shares_v2; without it the inner distribute_creator_fees_v2 fails with InvalidAccountData on a Q-quoted coin"
  - "The second update_fee_shares_v2 is rejected with pump-fees 6009 SharingConfigAdminRevoked (A1 resolved; not 6024)"
  - "Pump runs a migration crank on devnet that migrated the completed stand-in 10 slots later, so 6107 is proven in one tx [buy that completes a stand-in, child create on it]; the tx reverts and costs only the fee"
  - "readSharing takes a Connection: OnlinePumpSdk has no SharingConfig fetcher and keeps its connection private"
  - "The completion markup (106%) is plain BN math; applyBps keeps its 0..10000 guard as the slippage-floor helper"
metrics:
  duration: "about 15 min"
  completed: 2026-10-19
  tasks: 3
  files: 13
---

# Phase 1 Plan 05: Devnet multi-hop, fee sharing and the 6107 window Summary

The devnet list from D-01 is complete. multi_hop_swap landed SOL to Q to C0 and back, one signature each. On unbonded C0 the single update_fee_shares_v2 set deployer 8000 / treasury 2000 and revoked the admin, and a second update was rejected on chain with pump-fees 6009 `SharingConfigAdminRevoked`. A whale completed the devnet stand-in Q. A child create on a complete, unmigrated stand-in failed with 6107 `QuoteCurveAwaitingMigration`.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | multi_hop_swap buy and sell on devnet | 1e44746 |
| 2 | Fee sharing on unbonded C0: config, 80/20 update, rejected second update | 55cbf86 |
| 3 | Complete the devnet stand-in and prove 6107 | 5660d70 |

## Devnet evidence (results/devnet.json)

| Row | Signature | Bytes | CU | Result |
|-----|-----------|-------|----|--------|
| multihop.buy (SOL -> Q -> C0) | vcDU66LfvBQR... | 1,110 | 183,841 / 600,000 | amountIn 1,500,000 lamports, expectedOut = outAmount 19,509,427,302,151, minAmountOut 18,533,955,937,043 |
| multihop.sell (C0 -> Q -> SOL) | 4AR18KJLgVmF... | 1,100 | 153,289 / 600,000 | amountIn 19,509,427,302,151, expectedOut = outAmount 1,463,005 lamports, minAmountOut 1,389,854 |
| sharing.config + sharing.update (one tx) | 67XyaXMAK8xV... | 1,167 | 266,751 / 400,000 | shares "8000,2000", holders deployer 9Hm1YEfX..., treasury 4J9kCp2Q..., adminRevoked true |
| sharing.update2.rejected | 3yp5BinX23o4... | 1,150 | 73,401 | landed failure, pump-fees **6009 SharingConfigAdminRevoked** at ix 3 |
| quote.complete (whale buy_exact_quote_in_v3 on Q 5xUbg681...) | 5vvjbPLsvxBi... | 787 | 84,709 / 400,000 | cost 858,065,148, spend 909,549,056 (106%), complete true |
| child.create.6107 (one tx on fresh stand-in Q2 HZaBE3kb...) | 5PXPtHkY6rLQ... | 666 (with table) | 170,819 / 600,000 | landed failure, **6107 QuoteCurveAwaitingMigration** at ix 4 (the create, right after the completing buy at ix 3) |
| aux.child.create.migratedQ | 4xGS5AMsa78p... | 1,163 | 178,797 | a child create_v2 landed on Q after pump's crank migrated it (state 3, pool group included) |
| aux.standin2.create, aux.6107.table, aux.fund x2 | - | - | - | helpers |

- The multihop sizes run without a lookup table: 1,110 and 1,100 bytes, which leaves only 122 to 132 bytes of headroom.
- Q2 still reads complete false, with 0 quote reserves, after the 6107 tx. The revert left it untouched.

## Devnet SOL

| Wallet | Before | After |
|--------|--------|-------|
| ops 5d9ABC... | 4.89934476 | **2.978331927** |
| sim whale 4LpEeqRC... | 0 | 0.957305697 (parked: the spend for the reverted 6107 tx) |
| sim dev 9Hm1YEfX... | 0.05006225 | 0.04266549 |
| sim trader 37MRDH4h... | 0 | 0.018591765 |

- About 0.95 SOL was spent, mostly the 0.9095 SOL whale buy that completed Q.
- Ops keeps 2.98 SOL, well above the 1 SOL reserve plan 01-10 needs, and the whale holds 0.96 SOL more that can be sent back to ops if needed.
- A full `SPIKE_NET=devnet pnpm spike` rerun skipped all six stages, and the ops balance was unchanged (2.978331927 before and after).

## Verification

- `SPIKE_NET=devnet pnpm spike:check`: 22 passed, 0 failed.
- `pnpm spike:page`: PASS 29, FAIL 0, EXPECTED FAIL 3, NOT RUN 0.
- `pnpm lint`, `pnpm typecheck` and `pnpm vitest run` (15 tests) pass.
- `rg "venue:" packages/core/src/route.ts` finds nothing. `rg 8000 packages/core/src/sharing.ts` finds only the FINAL_SHARES line.
- `ls scripts/spike/stages | wc -l` is 7, and stages/README.md exists.
- The rent grep finds nothing in source, and `api-key` appears 0 times in the results.
- The largest new file is complete.ts at 191 lines.

## Deviations from Plan

1. **[Rule 1 - Bug] The fee-sharing finalize failed with InvalidAccountData.** After `create_fee_sharing_config`, the curve's creator is the SharingConfig PDA. The update's inner `distribute_creator_fees_v2` then reads that PDA's creator-vault Q ATA, which did not exist yet. A sweep only creates it when it moves fees, so a second sweep did not help. Fix: `finalizeIxs` adds an idempotent ATA create for `creatorVaultPda(feeSharingConfigPda(mint))` before the update. Preflight caught the failure, so nothing landed until the fix. Commit 55cbf86.
2. **[Rule 1 - Bug] The 6107 test raced pump's devnet migration crank.** The whale completed Q at slot 512,704,051. Pump's migrator (`7qhZTHxJ...`) ran MigrateV2 at slot 512,704,061, and the separate child create landed at slot 512,704,066. That create used the pre-completion accounts the planned fallback called for, and it returned 6101 `QuotePoolAccountsRequired` (sig 384uvX2SsUZE...), not 6107. Fix: the 6107 proof is now one tx, [buy that completes the stand-in, child create on it], sent with expectFail. On this rerun Q was already complete, so the stage made a fresh stand-in Q2 (about 0.02 SOL rent) and a lookup table (one 1,072-byte tx). The tx reverted with 6107, so the 0.91 SOL buy was not spent. On a fresh Q (the fork in 01-09) the stage runs the atomic 6107 tx first and then the real completing buy, with the same whale and the same SOL. The planned "SDK refuses, send pre-completion accounts" path was removed, since nothing uses it. Commit 5660d70.
3. **[Rule 1 - Bug] run.ts skipped a stage whose rows were ok but failed their rule.** sendTx marks any coded failure as ok on an expectFail row, so the wrong 6101 code made the complete stage look done. `done()` now also requires each row to pass its rule. Commit 5660d70.
4. **Kept evidence.** The child create that landed on the migrated Q was first recorded under `child.create.6107`, as a not-ok row. It is now `aux.child.create.migratedQ`, with a note on how it happened. The id and notes were edited by hand; the sig, bytes, CU and mint are the on-chain values. It is the first devnet proof of state 3 (a child on a migrated Q). Commit 5660d70.
5. **Interface changes.**
   - `readSharing(conn, mint)` takes a Connection instead of OnlinePumpSdk.
   - send.ts exports `fetchMeta`, so the multihop stage reads balance deltas without a second polling loop.
   - pump.ts exports `getPumpFeeProgram`, so the rejected row is named from the IDL, and `creatorVaultPda`.
   - curve.ts was written in Task 1, because the multihop Q-completion guard uses `costToComplete`.
   Commits 1e44746, 55cbf86.
6. **[Rule 2] The rejected-update rule is stricter.** Beyond a code in 6000..6999, the rule requires the program-logged error name to match the name the pump-fees IDL gives for that code. The comparison is case-insensitive, because the Anchor TS IDL uses camelCase. A pump-program 6xxx error cannot pass as the rejection. Commit 55cbf86.
7. **[Orchestrator] The devnet budget guard keeps a 1 SOL reserve.** The complete stage skips (D-01) when ops holds less than spend + 0.05 SOL + 1 SOL. The guard did not trigger.
8. **updateIxs puts a curve sweep first,** with creator = the SharingConfig PDA, as the SDK docs require. This means the rejection comes from the admin check, not from 6095 un-swept fees.

## Notes for later plans

- **Phase 5 / Risk.** Pump migrates completed curves on devnet within about 10 slots, and the mainnet crank very likely does the same. BONDR's forced bond cannot count on running `migrate_v2` itself, and anything that must happen between completion and migration has to go in the completing tx.
- **01-08 (fork, bonded fee sharing).** `finalizeIxs({ pool })` adds the pool sweep, and passes `bondingCurveComplete` true. The config-vault ATA create is already in place.
- **01-09 (fork 6107).** Add `completeStage` to nets/fork.ts. With no crank on the fork, Q stays complete and unmigrated after the stage, ready for the migrate_v2 step (state 3).
- **01-10 (devnet refresh).** Devnet Q 5xUbg681... is now migrated (pool G3Yqjx1U...), and pump's crank runs BoostBuyAndBurn on it. Devnet stages that route through Q's curve will no longer work on Q. Q2 HZaBE3kb... is a fresh, unbought SOL-paired stand-in.
- The whale's 0.957 SOL and Q tokens can be reclaimed if devnet SOL gets tight. The Q tokens can be sold into the pool.

## Known Stubs

None.

## Requirements

- SPIKE-05 is complete: multi_hop_swap buy and sell, SOL to stand-in to coin, on devnet's mainnet-identical pump and pump-amm bytecode.
- SPIKE-04 stays **Pending**. Its wording needs the update after migration plus a distribution paying both, and plan 01-08 covers that on the fork. This plan proves only the unbonded devnet part.

## Self-Check: PASSED

- All 7 created files and 6 modified files are present.
- Commits 1e44746, 55cbf86 and 5660d70 are on phase-01-chain-spike.
