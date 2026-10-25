---
phase: 05-fee-engine-and-public-ledger
plan: 06
subsystem: web-token-page
tags: [web, ui, bond-panel, totals, tdd]
requires:
  - 05-02 token-ledger.tsx, the ledger read and the fee-ledger e2e seeding
provides:
  - format.ts ratioPct, windowLeft, burnedPct
  - ready-bar.tsx ReadyBar (0-120% track, 100% and 105% marks)
  - bond-budget.tsx BondBudget (budget gauge, window clock, four-step fee flow)
  - token-ledger.tsx pre-bond totals block; token-stats.tsx Supply burned stat
affects: [05-10, 05-11]
tech-stack:
  added: []
  patterns:
    - ratio floored from base-unit bigints, so it never rounds up to 105.0%
    - the window clock is display only, from launchedAt and FEE_WINDOW_MS passed as a prop
key-files:
  created:
    - apps/web/components/ready-bar.tsx
    - apps/web/components/bond-budget.tsx
  modified:
    - apps/web/lib/format.ts
    - apps/web/lib/format.test.ts
    - apps/web/components/token-bond.tsx
    - apps/web/components/token-ledger.tsx
    - apps/web/components/token-stats.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/next.config.ts
    - apps/web/e2e/fee-ledger.e2e.ts
    - apps/web/e2e/coin.e2e.ts
    - apps/web/components/README.md
    - biome.json
decisions:
  - "fixtures.ts was left unchanged: seedCoin already takes coin column overrides, so a seedFees helper was not needed"
  - "@bondr/core/price was added to the web's allowed pure core imports in biome.json"
  - "The spec stays in fee-ledger.e2e.ts (202 lines, under 300), so it was not split into fee-panel.e2e.ts"
metrics:
  completed: 2026-10-25
  tasks: 3
  files: 13
---

# Phase 5 Plan 06: Burn budget, window and totals on the token page Summary

On an unbonded coin, the Bond and burn panel now shows:
- the burn budget against the cost to complete, with the ratio floored to 1 decimal
- the 0-120% ReadyBar with its 100% and 105% marks
- the open 24h window and its countdown
- the four-step fee flow, with the current step marked

The ledger shows the pre-bond totals, and the stats row shows Supply burned. Bonded variants come in 05-10.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Ratio, window and burned formatters, ReadyBar | ce98d39 (RED), be29894 (GREEN) | format.ts, format.test.ts, ready-bar.tsx, biome.json |
| 2 | BondBudget in the Bond and burn shell | 4012393 | bond-budget.tsx, token-bond.tsx, page.tsx, next.config.ts, coin.e2e.ts |
| 3 | Totals, Supply burned stat, seeded panel spec | 15bd18d | token-ledger.tsx, token-stats.tsx, fee-ledger.e2e.ts, README.md |

## Verification

- `pnpm vitest run apps/web/lib/format.test.ts`: 15 passed.
- `pnpm exec playwright test apps/web/e2e/fee-ledger.e2e.ts apps/web/e2e/coin.e2e.ts`: 26 passed. This covers the 5 new Bond and burn cases plus the 05-02 ledger and paging cases.
- `pnpm typecheck` exit 0. `pnpm lint` (biome ci) clean.
- File sizes: bond-budget.tsx 182, token-ledger.tsx 222, token-bond.tsx 176, fee-ledger.e2e.ts 202, format.ts 133, ready-bar.tsx 65.

## Deviations from Plan

**1. [Rule 3 - Blocking] Leaked test rows broke coin.e2e "found"**
- **Found during:** Final verification, after the usage-limit stop
- **Issue:** The run of `packages/core/src/db.test.ts` that the stop cut off never reached its `afterAll`. It left one `test-` wallet and its landed launches in the Neon dev branch. coin.e2e's `newest()` then picked a `test-` mint, which 404s, so 5 "found" cases failed.
- **Fix:** Deleted exactly those rows (2 coins, 7 launches, 3 vanity mints, 1 wallet), in the test's own cleanup order. No code change: the cleanup works on a run that completes.

## Known Stubs

None.

## Requirements

TOKEN-03 is done. TOKEN-05 is done for unbonded coins; 05-10 adds the bonded totals.

## Threat Flags

None. As planned:
- T-05-06-01: only FEE_WINDOW_MS is added, and the web boot guard is unchanged.
- T-05-06-02: the ratio is floored from bigints and unit-tested.
- T-05-06-03: client clock skew is accepted, because the countdown is display only.

## Self-Check: PASSED

- FOUND: ready-bar.tsx, bond-budget.tsx
- FOUND commits: ce98d39, be29894, 4012393, 15bd18d
