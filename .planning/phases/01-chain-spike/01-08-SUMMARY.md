---
phase: 01-chain-spike
plan: 08
subsystem: core
tags: [fork, fee-sharing, finalize, distribute, pumpswap]
requires: [01-07, 01-05]
provides:
  - "packages/core/src/sharing.ts: distributeIxs (OnlinePumpSdk.buildDistributeCreatorFeesInstructions, order untouched), configSweeps"
  - "packages/core/src/trade.ts: poolBuy, poolSell (PumpSwap v2) and poolState, the one pool state fetch with the pinned buyback wallet"
  - "scripts/spike/stages/finalize.ts on the fork: finalize.trade.1-6, finalize.config, finalize.update, finalize.distribute, finalize.update2.rejected"
affects: [01-09, 01-10]
tech-stack:
  added: []
  patterns:
    - "A bonded finalize is two txs: [float W, curve sweep, pool sweep, create config] then [pool sweep under the config PDA, vault ATA, update]"
    - "After finalize on a complete curve, later sweeps are the pool sweep only (no v3 trade can refill the curve bucket)"
key-files:
  created:
    - scripts/spike/stages/finalize.ts
  modified:
    - packages/core/src/sharing.ts
    - packages/core/src/trade.ts
    - packages/core/src/bond.ts
    - packages/core/src/README.md
    - scripts/spike/stages/sharing.ts
    - scripts/spike/stages/README.md
    - scripts/spike/nets/fork.ts
    - scripts/spike/results/fork.json
decisions:
  - "The bonded finalize is always split: one tx measured 1,351 bytes. Config 1,076 bytes / 244k CU, update 1,126 bytes / 134k CU"
  - "configSweeps drops the curve sweep on a complete curve; with it the bonded second update was 1,270 bytes, without it 1,214"
  - "The bonded second update is rejected with pump-fees 6009 SharingConfigAdminRevoked, the same code as devnet"
  - "Distribution after bond pays exactly 80:20 (deployer 138,264,336,404 Q, treasury 34,566,084,101 Q, total 172,830,420,505)"
metrics:
  duration: "about 12 min"
  completed: 2026-10-19
  tasks: 2
  files: 9
---

# Phase 1 Plan 08: Fork fee sharing after bond Summary

On the bonded, migrated child C2 on the mainnet fork, a sim trader ran four PumpSwap v2 trades. W2 then finalized the fee sharing in two transactions: the sweeps plus create_fee_sharing_config, then the one update_fee_shares_v2 to deployer 8000 / treasury 2000. The decoded SharingConfig shows shares [8000, 2000], holders [deployer, treasury] and admin revoked. After two more trades, a permissionless distribution paid the deployer 138,264,336,404 Q and the treasury 34,566,084,101 Q. That is exactly 20.000% of the 172,830,420,505 total. A second update was rejected on chain with pump-fees 6009 SharingConfigAdminRevoked, the same code devnet gave in 01-05.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | distributeIxs and the PumpSwap trade builders, with one shared pool state fetch | c4fe65f |
| 2 | Fork finalize stage: pool trades, finalize, distribution, rejected second update | 237b53a |

## Fork evidence (results/fork.json, final run, C2 DaRy16Mu...)

| Row | Signature | Bytes | CU / limit | Facts |
|-----|-----------|-------|------------|-------|
| finalize.trade.1 (buy_v2) | 4S172CJjfjTA... | 796 | 78,459 | base 8,007,618,534,084; Q -5,899,991,125,290 |
| finalize.trade.2 (sell_v2) | Mcfj3xt1Fmpp... | 786 | 57,585 | Q +5,697,525,467,298 |
| finalize.trade.3 (buy_v2) | 3NYaAeww72SR... | 786 | 58,362 | Q -5,880,756,887,781 |
| finalize.trade.4 (sell_v2) | 434d4pZgND39... | 786 | 57,585 | Q +5,678,949,696,030 |
| **finalize.config** | spGNX72g88nL... | **1,076** | **244,231 / 600,000** | split true; oneTxBytes 1,351; **wFloatLamports 18,017,920** |
| **finalize.update** | 5HMPQL314kRt... | **1,126** | **133,935 / 600,000** | shares "8000,2000"; holders deployer 7kNdRQrS..., treasury HSRgAnRH...; adminRevoked true |
| finalize.trade.5 (buy_v2) | 3Dk4NUpxhs9U... | 786 | 58,362 | Q -5,861,585,204,565 |
| finalize.trade.6 (sell_v2) | 2FbuZ1xkzGow... | 786 | 57,585 | Q +5,660,434,347,938 |
| **finalize.distribute** | 3k3NocV2KmqL... | 966 | 127,829 / 600,000 | deployerDelta 138,264,336,404; treasuryDelta 34,566,084,101; total 172,830,420,505 |
| **finalize.update2.rejected** | 56rd8n3659h4... | 1,214 | 58,927 | landed failure, **pump-fees 6009 sharingConfigAdminRevoked** at ix 3; devnetCode 6009; matchesDevnet true |

Notes on the evidence:
- **Tx A was split.** The whole finalize measured 1,351 bytes, 119 over the packet limit, so the stage always splits. The config tx is [ops floats W2, curve sweep (creator W2), pool sweep, create_fee_sharing_config with the pool]. The update tx is [pool sweep (creator = the config PDA), config vault Q ATA, update_fee_shares_v2]. Both stay far under the CU limit.
- **W2's lamport float** is 18,017,920 lamports: the rent for the 1,024-byte SharingConfig plus a 0.01 SOL buffer, sent by ops in the config tx (Pitfall 3).
- **The distributed total is the post-update pool creator fee.** 172,830,420,505 Q is about 1.5% of trades 5 and 6's Q volume. The fees from trades 1 to 4 went to W2 through the update's inner distribution, to the shareholder list before the update.
- **The second-update code is 6009 on both nets.** devnet's code is read from devnet.json at run time, not typed into the stage.
- The trader still held its prebond Q, so the whale top-up (aux.finalize.trader.topup) did not run.

## Verification

- `SPIKE_NET=fork pnpm spike` gave "fork: 40 ok, 0 failed" (about 30 s for the whole fork list).
- `SPIKE_NET=fork pnpm spike:check` gave 41 passed, 0 failed, including the secret scan. `SPIKE_NET=devnet pnpm spike:check` still gives 22 passed (the devnet rules are now exported for reuse, and nothing else changed).
- `pnpm spike:page` gave PASS 57, FAIL 0, EXPECTED FAIL 4, NOT RUN 0.
- `pnpm vitest run` passed 25 tests. `pnpm lint` and `pnpm typecheck` exit 0. `pnpm biome lint scripts/spike/stages/finalize.ts` exits 0, so no function there is over 40 lines. The file has 7 helper functions (traderQ, tradeIxs, poolTrades, finalizeTx, readShares, distribute, secondUpdate), plus distributeRule.
- `rg -n buildDistributeCreatorFeesInstructions packages/core/src/sharing.ts` matches once (line 127; the comment does not name it). `rg -c canonicalPumpPoolPdaWithQuote packages/core/src/bond.ts` finds 0.
- File sizes: finalize.ts 213 lines, sharing.ts 129, trade.ts 91, bond.ts 156. prebond.ts is unchanged at 298.
- `api-key` appears 0 times in fork.json. The fork was stopped with `pnpm spike:fork-down`. No devnet sends were made.

## Deviations from Plan

1. **[Rule 1 - Bug] The bonded second update was 1,270 bytes.** updateIxs repeated the curve sweep and the pool sweep, and with two current shareholders plus their Q ATAs and the pool, the tx did not fit. A complete curve takes no v3 trades, so after the finalize's curve sweep the bucket stays empty. The new `configSweeps` (the sweeps under the config PDA) keeps only the pool sweep when bondingCurveComplete is true. updateIxs and the split finalize both use it. The second update is now 1,214 bytes. The devnet (unbonded) path is unchanged. Commit 237b53a.
2. **The finalize always splits, with no one-tx path and no CU fallback.** The plan asked for one tx when it fits, and a split on size or CU. On a bonded coin the one tx is 1,351 bytes without a lookup table, so the one-tx branch could never run. The stage records `oneTxBytes`, and it throws if a future SDK ever makes the whole finalize fit, so that case is seen and not silently split. Both halves use under 41% of the 600k limit, so the CU fallback was not needed. Commit 237b53a.
3. **[Rule 3] Shared rules and pool state.**
   - stages/sharing.ts exports `updateRule` and `rejectedRule`, which finalize.ts reuses. The rejected rule includes the IDL-name match from 01-05.
   - trade.ts `poolState({ amm, mint, quoteMint, user })` returns the pinned state and the buyback wallet, and each caller creates the buyback ATA with its own payer (the trader for its trades, ops for W's pool burn).
   - Commits c4fe65f, 237b53a.
4. **Trade sizing.** A buy takes 10% of the trader's Q, sized from 95% of it through `poolBaseOut`, so maxQuoteIn always covers the fees. A sell returns the whole C2 balance with a 90% floor on the Q the last buy spent. No new SDK export was needed.

## Known Stubs

None.

## Requirements

SPIKE-04 is complete. On devnet (01-05, unbonded): create config, the one 80/20 update, and the rejected second update. On the mainnet fork (this plan, bonded and migrated): the same three steps, plus a distribution that pays both shareholders 80:20 within 0 units.

## Notes for later plans

- **Phase 5 (fee engine).** The bonded finalize needs two txs, or one v0 tx with the coin's lookup table: 1,351 bytes, 119 over the limit. Between the two txs a pool trade can land, and that is why the update tx repeats the pool sweep. The float W needs for the config is the 1,024-byte rent (8,017,920 lamports on the fork) plus a buffer.
- **Phase 5 (distribution).** distributeIxs is 966 bytes and 128k CU with two shareholders and needs no W signature: ops can crank it.
- **01-09.** Q is still about 90% complete and unmigrated. The fork's finalize leaves C2 with a revoked admin, and nothing later depends on it.

## Self-Check: PASSED

- scripts/spike/stages/finalize.ts is present.
- Commits c4fe65f and 237b53a are on phase-01-chain-spike.
