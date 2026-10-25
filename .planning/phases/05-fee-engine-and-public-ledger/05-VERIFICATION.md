---
phase: 05-fee-engine-and-public-ledger
verified: 2026-10-25T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "HV-05-01: after the staging 24h windows close (2026-10-25T19:15:52Z and 2026-10-26T04:29:47Z), open the two staging coin pages and confirm Collect, Split 90/10 and Sweep rows with Solscan links"
    expected: "Rows with amount, time and working tx links; coins with no fees (or under the 10,000 lamport collect minimum) show none, by design"
    why_human: "Needs real elapsed time on a deployed staging service"
  - test: "HV-05-02: first forced bond on mainnet, check the Helius Sender response and tip transfer on Solscan"
    expected: "Buy + burn lands via Sender with a tip"
    why_human: "Mainnet and real SOL; Phase 7, owner-gated. Non-blocking for Phase 5"
---

# Phase 5: Fee Engine and Public Ledger Verification Report

**Phase Goal:** As a holder, I want every fee movement shown with a transaction link, so that I can verify none went to the dev.
**Status:** human_needed (all automated checks pass; two owner-gated, non-blocking checks remain)
**Re-verification:** No, initial verification

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Worker collects, splits 90/10, ledger rows with amount, time, tx link | VERIFIED | fee-engine/fee-send/fee-ledger in apps/worker/src; web ledger.ts, token-ledger.tsx, /api/coin/[mint]/ledger; fork.json rows for collect and 90/10 split; real devnet run in 05-12 (collect, split, sweep with sigs) |
| 2 | 105% budget triggers one buy+burn via Sender; trader-bonded coin gets PumpSwap buy+burn | VERIFIED (Sender mainnet part deferred to HV-05-02) | fork.json: forced bond (buy + BurnChecked, one tx), exact bond, migrate_v2, pool buy+burn; fee-prebond.ts, fee-send.ts (Sender mainnet-only by design) |
| 3 | 24h sweep 90/10, buyback burn, scheduled distribution, ops pays, low-balance alert | VERIFIED | devnet e2e (05-12): sweep_buyback + sweep_treasury equal sweepSplit, buyback_burn supply drop exact; fork distribute row; fee-burns.ts, fee-batch.ts; ops floor in fee-send.ts |
| 4 | After bond: sweep, deployer pre-flight, single 8000/2000 update, deployer share shown | VERIFIED | fee-finalize.ts + test; fork rows for sweeps + create_fee_sharing_config and update_fee_shares_v2; held panel and bonded totals in web |
| 5 | Bond progress, budget vs cost, time left, totals; nightly reconcile records mismatches | VERIFIED | ledger-totals.tsx, token-ledger.tsx; fee-reconcile.ts called from fee-batch.ts; migration 0006 allows reconcile_diff; 05-12 reconcile 0 diffs; six UI states x three widths, axe 0 violations |

**Score:** 5/5

## Requirements Coverage

All 12 IDs (FEE-01..09, TOKEN-03..05) appear in PLAN frontmatter, are marked complete in REQUIREMENTS.md, and map to Phase 5 in its traceability table. No orphaned requirements.

| Requirement | Status |
|-------------|--------|
| FEE-01 | SATISFIED |
| FEE-02 | SATISFIED (Sender on mainnet: HV-05-02) |
| FEE-03 | SATISFIED (fork) |
| FEE-04 | SATISFIED (devnet real; staging window: HV-05-01) |
| FEE-05 | SATISFIED (fork) |
| FEE-06 | SATISFIED (devnet real) |
| FEE-07 | SATISFIED (fork) |
| FEE-08 | SATISFIED |
| FEE-09 | SATISFIED |
| TOKEN-03 | SATISFIED |
| TOKEN-04 | SATISFIED |
| TOKEN-05 | SATISFIED |

## Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| `pnpm vitest run` (full) | 58 files passed, 417 passed, 2 skipped |
| `rg TBD\|FIXME\|XXX` over phase fee files | none |
| deferred-items.md (reconcile_diff null-mint check) | resolved in 05-09 via migration 0006 |

No probes declared. Nothing spent, deployed or started by the verifier.

## Anti-Patterns

None blocking. Known Stubs sections in 05-12 and 05-13 report none.

## Notes

- Forced bond, PumpSwap fallback, finalize and distribute are proven on a Surfpool fork (devnet cannot bond a child coin); the unit tests and fork.json rows back them. This is a recorded limitation, not a gap.
- Staging currently shows no rows (no creator fees yet), which is why HV-05-01 remains open.

## Gaps Summary

No gaps. Remaining items are the owner's non-blocking checks above.

_Verifier: Claude (gsd-verifier)_
