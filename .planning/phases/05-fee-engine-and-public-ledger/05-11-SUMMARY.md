---
phase: 05-fee-engine-and-public-ledger
plan: 11
subsystem: web-home
tags: [web, home, rail, hero, tdd]
requires:
  - 05-06 ReadyBar, ratioPct, ratio1000, windowLeft
  - 05-10 the `fee` SSE event on the live stream
provides:
  - lib/coins.ts nextToBond, heroCounts.forced, feeWindowMs
  - lib/live-list.ts railRank (tick re-sort and prune)
  - components/home-next.tsx NextToBond
  - e2e/responsive-fee.e2e.ts (home part of the Phase 5 matrix), shoot.ts PHASE5_SHOTS
affects: [05-12]
tech-stack:
  added: []
  patterns:
    - the rail rides the existing kept read set and the provider's one 60 s tick; no new reads or timers
    - the rail countdown reads a clock held in provider state (server time first), so hydration text matches
key-files:
  created:
    - apps/web/components/home-next.tsx
    - apps/web/e2e/responsive-fee.e2e.ts
  modified:
    - apps/web/lib/coins.ts
    - apps/web/lib/coins.test.ts
    - apps/web/lib/live-list.ts
    - apps/web/lib/live-list.test.ts
    - apps/web/components/home-hero.tsx
    - apps/web/components/home-live.tsx
    - apps/web/components/ready-bar.tsx
    - apps/web/components/README.md
    - apps/web/app/page.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/e2e/shoot.ts
    - apps/web/e2e/home.e2e.ts
decisions:
  - "The SQL rank uses the exact budgetOf (fee_budget + fees_unclaimed - fees_unclaimed / 10), not fees_unclaimed * 9 / 10, so the rail and the token page show the same budget"
  - "The rail's order, its countdown clock and its removals change only on the provider's 60 s tick (railRank). Live trades and fee events move a bar at once"
  - "feeWindowMs moved from the token page into lib/coins.ts, so both pages read one window length"
  - "Rail links carry an explicit aria-label (name, symbol, sweep time, ready percent), so the bar's own label is not read twice"
metrics:
  duration: 35 min
  completed: 2026-10-25
  tasks: 3
  files: 14
---

# Phase 5 Plan 11: Home Next to bond rail and the bonded-by-their-own-fees hero line Summary

Home now has the two pieces deferred from Phase 3:
- **The Next to bond rail.** Up to 4 curve coins, ranked by burn budget against cost. The top coin shows its sweep countdown and a 16px ready bar, and the rest are 8px rows.
- **The hero line.** It reads "{F} coins bonded by their own fees." with an optional " Next up: {SYMBOL}, {ready}% ready." Before the first forced bond it keeps the Phase 3 wording.

The second CTA becomes "Watch a coin bond" to the top coin whenever the rail shows.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | nextToBond read and the forced-bond count | af9bc78 (RED), 306145d (GREEN) | coins.ts, coins.test.ts |
| 2 | The rail, the hero line and the CTA | 43a2d64, 8758b8f (underline fix) | home-next.tsx, home-hero.tsx, home-live.tsx, ready-bar.tsx, page.tsx, coin page, live-list.ts (+test), README.md |
| 3 | Home part of the Phase 5 responsive matrix | 74aa849, e5a89b5 (hero spec) | responsive-fee.e2e.ts, shoot.ts, home.e2e.ts, screenshots |

## Verification

- `pnpm vitest run apps/web/lib/coins.test.ts`: 12 passed. This covers:
  - the order [newer tie, A, B, fifth] with at most 4 rows
  - zero-budget, pool and null-cost coins left out
  - the budget counting 90% of the unclaimed fees
  - forced counting only a landed forced_bond (not a pending one, not a pool_burn)
- `pnpm vitest run apps/web/lib/live-list.test.ts apps/web/lib/format.test.ts`: 27 passed, including the railRank check.
- `pnpm exec playwright test` on home, home-live, fee-ledger and responsive-fee with `--workers=3`: 37 passed. The 3 skipped are the staging-only tests.
- responsive-fee: home-rail and home-norail at 390, 768 and 1440. All had 0 axe violations and no horizontal scroll, and 3 `home-rail-*.png` shots were written.
- `pnpm typecheck` and `pnpm lint` are clean. home-next.tsx is 121 lines and home-live.tsx is 227. No emoji.
- The leaked-row check (`launches where w = 'e2e'`) is 0 after every run.

## Deviations from Plan

**1. [Rule 1 - Bug] Budget expression**
- The plan's `fees_unclaimed * 9 / 10` rounds differently from core's budgetOf, which floors the treasury share.
- The SQL now uses `fee_budget + fees_unclaimed - fees_unclaimed / 10`, the same number the token page shows (T-05-11-02).

**2. [Rule 1 - Bug] coins.test afterAll timeout raised from 30 s to 120 s**
- The first RED run left 13 seeded coins behind. With the extra seeds, cleanup ran past the 30 s afterAll limit.
- The leaked rows were deleted in dropCoin order.

**3. [Rule 3 - Blocking] railRank was added to live-list.ts with a unit check**
- This file was not in the plan, but the tick needs a pure re-sort and prune that matches the server's order.

**4. [Rule 3 - Blocking] feeWindowMs was moved into lib/coins.ts**
- Home needs the same window length as the token page, so the token page now imports it too.

**5. [Rule 1 - Bug] Rail links underlined**
- The global `a` rule underlined the rail links and colored them mint, as the first screenshots showed.
- They now use `text-foreground no-underline`, the same as the coin cards.

**6. [Rule 1 - Bug] home.e2e hero test asserted D-08 "no rail"**
- That test fails whenever any curve coin has a budget, for example while fee-ledger.e2e seeds one in parallel.
- It now accepts either state (CTA and pulse wording follow the rail), and responsive-fee.e2e.ts covers both states.

**7. role="region" was dropped from the rail's section**
- Biome flags it as redundant (noRedundantRoles). A `<section>` with aria-labelledby already exposes the region role, and the specs find it by role.

## Known Stubs

None.

## Notes

- The hidden-rail case ran in this session because the dev branch holds no budgets. It skips with the reason "a curve coin on the dev branch has a burn budget, so the rail shows" when one exists.
- The parallel home specs flake under full worker load (Next dev compile and Neon latency), and a different test fails each time. With `--workers=3` they pass every time.
- One responsive-fee run hit a Neon CONNECT_TIMEOUT in beforeAll (cold start). It passed on rerun and left no rows.
- When the top coin changes on a re-sort, the new top bar mounts and grows in once more. This is accepted: membership only changes on page load.

## Requirements

TOKEN-03 is complete (home part delivered here).

## Threat Flags

None. As planned:
- T-05-11-01: nextToBond is one more kept read in the existing Promise.all, and the tick only re-sorts in memory.
- T-05-11-02: the rail uses ratioPct and ratio1000 floored from base units.

## Self-Check: PASSED

- FOUND: apps/web/components/home-next.tsx, apps/web/e2e/responsive-fee.e2e.ts, 3 home-rail screenshots
- FOUND commits: af9bc78, 306145d, 43a2d64, 8758b8f, 74aa849, e5a89b5
