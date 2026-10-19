---
phase: 01-chain-spike
plan: 06
subsystem: core
tags: [fork, creator-fees, collect, split]
requires: [01-04, 01-05]
provides:
  - "packages/core/src/trade.ts: buyExactIn, buyExactOut, sellExactIn (v3, Token-2022 base, live buyback recipient, idempotent ATAs)"
  - "packages/core/src/collect.ts: collectIxs (W quote ATA + sweep + collect_creator_fee_v2), splitIxs (treasury ATA + transferChecked)"
  - "packages/core/src/math.ts: split90_10"
  - "scripts/spike/stages/prebond.ts on the fork: prebond.buyq, prebond.trade.1-4, prebond.collect, prebond.split"
affects: [01-07, 01-08, 01-09]
tech-stack:
  added: []
  patterns:
    - "collected is the creator's quote delta in the collect tx's own meta, never the creator's balance"
    - "The split rule cross-checks the split's input against the collect row and checks both deltas in the split tx meta"
key-files:
  created:
    - packages/core/src/trade.ts
    - packages/core/src/collect.ts
    - scripts/spike/stages/prebond.ts
  modified:
    - packages/core/src/math.ts
    - packages/core/src/math.test.ts
    - packages/core/src/launch.ts
    - packages/core/src/pump.ts
    - packages/core/src/README.md
    - scripts/spike/stages/launch.ts
    - scripts/spike/stages/multihop.ts
    - scripts/spike/stages/README.md
    - scripts/spike/nets/fork.ts
    - scripts/spike/results/fork.json
decisions:
  - "The effective creator fee on the fork is 150.00 bps of the trader's gross Q volume, so the PROJECT.md 1.5% claim holds exactly"
  - "split90_10 sizes the treasury transfer from the collect tx's meta delta, never from W's balance, so a rerun cannot skim the accumulated burn budget"
  - "Buys prepend the base ATA and the buyback quote ATA; sells prepend the seller's quote ATA and the buyback quote ATA. Launch instruction order is unchanged"
metrics:
  duration: "about 20 min"
  completed: 2026-10-19
  tasks: 2
  files: 13
---

# Phase 1 Plan 06: Fork pre-bond fee path (trades, collect, 90/10 split) Summary

A sim trader ran v3 trades on the 150 bps child C0 on the mainnet fork: a buy, a sell, a buy and a sell, each with a signature. A permissionless sweep plus collect_creator_fee_v2 moved 1,885,978,742,080 Q (raw units) into W0's Q ATA. That is exactly 150.00 bps of the trader's 125,731,916,138,464 Q gross volume. W0 then sent floor(collected / 10) = 188,597,874,208 Q to the treasury's Q ATA, and kept 1,697,380,867,872 Q as the burn budget for the 01-07 forced bond.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (RED) | Failing split90_10 tests | 943bc26 |
| 1 (GREEN) | v3 trade, collect and split builders; launch.ts uses them | ca7036f |
| 2 | Fork prebond stage: trades, collect, 90/10 split | eb2aa72 |

## Fork evidence (results/fork.json, final run)

| Row | Signature | Bytes | CU | Facts |
|-----|-----------|-------|----|-------|
| prebond.buyq | 5xcn5ExZ9VR9... | 787 | 66,454 | 2 SOL into Q, 1% floor from getBuyV3TokenAmountFromQuoteAmount |
| prebond.trade.1 (buy) | 4nXyWJjuhVW9... | 797 | 97,159 | half the trader's Q into C0 |
| prebond.trade.2 (sell) | 2Tj17NFwMSt9... | 796 | 79,914 | the full C0 balance back to Q |
| prebond.trade.3 (buy) | 2B955UTuYQo4... | 797 | 84,408 | half the trader's Q into C0 |
| prebond.trade.4 (sell) | tSzUY77Yw2Z5... | 796 | 79,915 | the full C0 balance back to Q |
| prebond.collect | 5GoR51vbQXu6... | 691 | 113,850 / 300,000 | collected 1,885,978,742,080; volumeQ 125,731,916,138,464; **effectiveCreatorBps 150** |
| prebond.split | 2voxSGZPjBPX... | 552 | 21,696 / 300,000 | treasuryDelta 188,597,874,208 = floor(collected / 10); wDelta -188,597,874,208; wAfter 1,697,380,867,872; **wFloatLamports 890,880** |

- W0 does not sign the collect, and ops pays its fee and ATA rent.
- W lamport float: W0 held 0 lamports, so ops sent 890,880 lamports in the split tx. That is the fork's rent-exempt minimum for a 0-byte account (`getMinimumBalanceForRentExemption(0)`). The transfer itself charges W nothing. The float covers the later W txs in 01-07, which charge rent to W (Pitfall 3).
- Before the Q buy, Q's realQuoteReserves plus the 2 SOL spend stayed below 50% of Q's completion raise (Pitfall 1). Each C0 buy is also checked against C0's costToComplete.
- The launch rows still pass after the refactor, at the same sizes (burn 780 bytes, sell 881 bytes).

## Fork vs mainnet timing

The fork runs no pump keeper, so a completed curve stays unmigrated until we call migrate_v2. On devnet (01-05) the keeper migrated a completed curve about 10 slots later, and mainnet very likely does the same. This plan never completes a curve, so the difference does not affect these rows. 01-07 has to put anything that must run between completion and migration inside the completing tx. No devnet SOL was spent: all SOL here was airdropped on the fork. The fork was stopped with `pnpm spike:fork-down`.

## Verification

- `SPIKE_NET=fork pnpm spike` gave "fork: 18 ok, 0 failed".
- `SPIKE_NET=fork pnpm spike:check` gave 19 passed, 0 failed, including the secret scan.
- `pnpm vitest run` passed 16 tests, including the split90_10 cases. `pnpm lint` and `pnpm typecheck` exit 0.
- `rg -c` for the v3 raw builders in launch.ts finds 0 matches. In collect.ts the `sweepCreatorFeeInstruction` call (line 26) comes before `collectCoinCreatorFeeV2Instructions` (line 27).
- `pnpm biome lint scripts/spike/stages/prebond.ts` exits 0, so no function there is over 40 lines. The file has 10 helper functions and is 298 lines long.
- `api-key` appears 0 times in fork.json.

## Deviations from Plan

1. **[Coordinator / code review] collected comes from the collect tx meta.** The first version read W0's balance before and after the collect. It now uses `tokenDelta(meta, Q, W)` on the landed collect tx, so the 10% is always sized off that one collect, never off W's whole balance. The split rule is stricter than planned:
   - The split's `collected` must equal the collect row's delta.
   - treasuryAmount must equal floor(collected / 10).
   - The treasury's delta in the split tx meta and its before/after balance difference must both equal treasuryAmount.
   - W's delta in the split meta must be -treasuryAmount.
   - wAfter must equal wBeforeCollect + collected - treasuryAmount, so the rule still holds when W already had a balance.
   Confirmed by the final run. Commit eb2aa72.
2. **[Rule 3] Small exports for reuse.** pump.ts exports `getSellSolAmountFromTokenAmount`, which sets the sell floor. stages/launch.ts exports `tokenAmount`, and stages/multihop.ts exports `tokenDelta`. These avoid duplicate helpers. Commit eb2aa72.
3. **Sell floor is 95%.** `getSellSolAmountFromTokenAmount` is the SDK's sell quote and is named for SOL. A 5% floor absorbs any fee schedule difference on a Q-quoted curve. Buys keep the 1% floor. Commit eb2aa72.
4. **`ataIx` moved into trade.ts and is exported.** launch.ts and collect.ts share it. Commit ca7036f.
5. **The sellq launch fallback** now goes through `sellExactIn`, which adds two idempotent ATA instructions. It is the evidence fallback only, and it did not run.

## Known Stubs

None.

## Requirements

SPIKE-03 stays **Pending**. Its wording is the forced-bond buy and burn that completes a curve, which is plan 01-07. This plan proves that path's funding: real 150 bps creator fees from trades, collected to W, with 90% kept as the burn budget.

## Self-Check: PASSED

- trade.ts, collect.ts and prebond.ts are present.
- Commits 943bc26, ca7036f and eb2aa72 are on phase-01-chain-spike.
