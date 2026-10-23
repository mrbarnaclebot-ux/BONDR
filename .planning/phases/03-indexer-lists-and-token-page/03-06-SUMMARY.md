---
phase: 03-indexer-lists-and-token-page
plan: 06
subsystem: token-page
tags: [token-page, stats, holders, bond-progress]
requires:
  - 03-04 coins and trades tables, CoinRow and CoinLive
  - 03-05 format helpers, seedCoin fixture, token page grid
  - 03-07 coins.holders written by the recount
provides:
  - lib/coins.ts coinByMint(mint) with vol1h, vol24h, change1h computed at read
  - components/tag.tsx Tag (mint, leaf, warn, live dot)
  - components/token-stats.tsx TokenStats (takes CoinLive | null, ready for 03-08 live values)
  - components/bond-glyph.tsx BondGlyph (also for 03-08 coin cards)
  - components/token-bond.tsx BondPanel (three venue states)
  - CoinIdentity venue and stats props
  - seedCoin coins column overrides and zero-trade seeds
affects: [03-08]
tech-stack:
  added: []
  patterns: [correlated subqueries for one-mint windowed values, generic kept() 10 s per-process cache in the page]
key-files:
  created:
    - apps/web/lib/coins.ts
    - apps/web/lib/coins.test.ts
    - apps/web/components/tag.tsx
    - apps/web/components/token-stats.tsx
    - apps/web/components/bond-glyph.tsx
    - apps/web/components/token-bond.tsx
  modified:
    - apps/web/e2e/fixtures.ts
    - apps/web/e2e/coin.e2e.ts
    - apps/web/components/coin-identity.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/app/globals.css
    - apps/web/components/README.md
    - apps/web/lib/README.md
decisions:
  - "03-06: change1h is null only when the base price is 0; a coin with no trades reads 0.0%"
  - "03-06: one column puts Bond and burn above Trades (UI-SPEC order); at 1100px grid placement moves it to the sticky right column, DOM order unchanged"
  - "03-06: the bond glyph animates only under motion-safe, so reduced motion gets the final width, no pulse and no ring"
  - "03-06: a complete curve shows the glyph bonded without the ring, labelled Curve 100 percent filled; only venue pool reads Bonded"
metrics:
  duration: 9 min
  completed: 2026-10-23
  tasks: 2
  files: 13
---

# Phase 3 Plan 06: Token Page Stats and Bond Panel Summary

The token page now shows Mcap, 1h change, 1h volume and Holders under the coin name, a venue tag (On curve, Curve complete, Bonded, PumpSwap), and a curve-only Bond and burn panel with the bond glyph, all from one `coinByMint` read held 10 s per process.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Stats and bond e2e (failing), coinByMint with windowed values | a926330 (RED), cad0cb3 (GREEN) |
| 2 | Tag, TokenStats, BondGlyph and BondPanel on the page | 6268062 |

## Verification

- `pnpm vitest run apps/web/lib`: 7 files, 36 passed, 1 skipped (pinata live). `coins.test.ts` against Neon dev: change1h 0.2 from the last pre-hour trade with a later burn at mcap 99 ignored, vol1h 0.5 and vol24h 1.5, launch-price fallback, no-trade coin 0 and 0, unknown mint null.
- `playwright test apps/web/e2e/coin.e2e.ts`: 17 passed (404, found, links with the unindexed 0.0% panel and "–" holders, trades, stats and bond: curve, bonded, complete).
- `responsive.e2e.ts -g coin`: 6 passed (axe and no horizontal scroll at 390, 768, 1440); the regenerated Phase 2 screenshots were discarded.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build`, `scripts/check-client-bundle.sh`: all pass.
- Screenshots checked by eye at 1440 and 390 (real devnet coin, seeded 93.2% coin, seeded bonded coin): stats row, sticky right panel, gradient fill, Bonded tag and bond tx link.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] seedCoin split to stay under the 40-line function limit**
- **Found during:** Task 1
- **Issue:** adding the coins overrides pushed `seedCoin` past Biome's 40-line limit.
- **Fix:** the fixed curve columns moved to a module constant `CURVE`; the coins row is inserted as an object so overrides spread over it.
- **Commit:** cad0cb3

**2. [Rule 1 - Bug] Bond and burn order below 1100px**
- **Found during:** Task 2
- **Issue:** the 03-05 grid put the right-column slot after Trades, so one column would show Trades first, against the UI-SPEC order (Bond and burn, then Trades).
- **Fix:** the panel comes first in the DOM and takes `col-start-2 row-start-1` at 1100px.
- **Commit:** 6268062

None of the planned behaviour was narrowed.

## Known Stubs

None. Stats and panel are static per page load until 03-08 feeds live values (TokenStats takes CoinLive for that).

## Notes for 03-08

- `TokenStats` and `BondPanel` are server-compatible components; live updates need a client wrapper that passes the stream's `CoinLive` and bond event.
- `BondGlyph` takes `p` 0..1 and `label`; cards can reuse it at 160x18.

## TDD Gate Compliance

RED `test(03-06)` a926330 precedes GREEN `feat(03-06)` cad0cb3.

## Self-Check: PASSED
