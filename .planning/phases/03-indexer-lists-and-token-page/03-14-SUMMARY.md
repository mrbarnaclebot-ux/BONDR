---
phase: 03-indexer-lists-and-token-page
plan: 14
subsystem: ui-gate
tags: [responsive, axe, screenshots, design-review]
requires:
  - 03-10 token chart, 03-11 home grid and header link, 03-12 search and Trending, 03-13 live home lists
  - e2e fixtures.ts seedCoin and dropCoin
provides:
  - apps/web/e2e/responsive-lists.e2e.ts, the Phase 3 matrix (8 surfaces x 3 widths)
  - apps/web/e2e/shoot.ts gate(page, name, width), shared scroll, axe and screenshot check
  - the home paused surface in paused.e2e.ts (3 widths)
  - 27 local screenshots in .planning/phases/03-indexer-lists-and-token-page/screenshots/
affects: [03-15]
tech-stack:
  added: []
  patterns: [one shared gate helper for the per-surface UI check, per-worker seeded curve and bonded coins]
key-files:
  created:
    - apps/web/e2e/responsive-lists.e2e.ts
    - apps/web/e2e/shoot.ts
    - .planning/phases/03-indexer-lists-and-token-page/screenshots/ (27 png)
  modified:
    - apps/web/e2e/paused.e2e.ts
    - apps/web/e2e/README.md
    - apps/web/e2e/coin.e2e.ts
    - apps/web/components/home-search.tsx
    - apps/web/components/token-chart-draw.ts
    - apps/web/components/token-chart.tsx
    - .planning/phases/03-indexer-lists-and-token-page/03-UI-SPEC.md
key-decisions:
  - "03-14: the chart's attributionLogo is off; the footer 'Charts by TradingView' link meets the lightweight-charts license link requirement, which the library's own option docs allow, so the chart carries no third-party link"
  - "03-14: the header Launch link stays a rocket icon with the accessible name below 360px; the label does not fit beside the badge and Connect at 320"
  - "03-14: Top and Oldest pick up a new launch on reload or a resync catch-up, not on the re-rank tick; a new coin ranks near the end of both, past the first 50 cards once the list is longer. Latest stays live (D-14)"
  - "03-14: the no-match heading keeps the query's case, because the display face uppercases headings and a mint prefix is case-sensitive"
  - "03-14: paused.e2e.ts runs its tests in order (mode default) since both flip the one kill switch"
duration: 35min
completed: 2026-10-24
---

# Phase 3 Plan 14: Responsive, Axe and Designer Critique Summary

All 9 Phase 3 surfaces were checked at 390, 768 and 1440. None has horizontal scroll, axe reports 0 violations on every one, and there is a full-page screenshot of each (27 in total). The Designer critique found one copy blocker, which is fixed. It also settled the three open design questions: the chart now carries no in-chart TradingView link, and the other two behaviours stay as built, with the UI-SPEC updated to match.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Phase 3 responsive and axe matrix with screenshots | ec58846 |
| 2 | Designer critique and audit, blockers fixed | 43ab3c7 |

## What was built

- **`shoot.ts`**: `gate(page, name, width)` runs the Phase 2 matrix check for one surface at one width:
  - waits for fonts, hides the dev indicator and scrolls to the top
  - asserts `scrollWidth` equals `clientWidth`, and names any element past the edge if not
  - runs AxeBuilder and expects 0 violations
  - saves a full-page shot as `{name}-{width}[-staging].png`
- **`responsive-lists.e2e.ts`**: each worker seeds a curve coin (64.2%, 60 trades) and a bonded coin (venue pool, bond_sig, 60 trades), and drops them in afterAll. It covers 8 surfaces: home, home-latest, home-search (the curve coin's symbol), home-nomatch (`?q=zzzzqq`), home-mint (a random valid mint typed into search), coin-curve, coin-bonded and coin-404. Token pages wait for the chart's `role="img"` summary, its canvas and the first trade row. The list surfaces retry through the 10 s list cache, like `home.e2e.ts`.
- **`paused.e2e.ts`**: a second test flips the kill switch, then reloads `/` at each width until the "Launches paused." banner shows. It checks the body copy and the disabled "Launches paused" button, runs `gate` with the name home-paused, and re-enables in `finally`.

## Designer critique (against home.html, token.html and the UI-SPEC)

**Scores**
- Critique: **8/10**. Layout, type, color, spacing and copy follow the UI-SPEC. Differences from the mockups are all deliberate, owner-approved removals: no Next to bond rail (D-08), no USD sub-lines (D-01), no ticker strip, no trade panel and no ledger (D-11, Phase 4 and 5), the header Launch link instead of the nav pill, and the D-11a column swap (Trades wide on the left, Bond and burn in the 380px right column), which is applied correctly at 1440.
- Audit: **pass**.
  - Accessibility: axe 0 violations on 27 of 27 surface-width pairs.
  - Images: coin images use `loading="lazy" decoding="async"`.
  - Chart bundle: lightweight-charts is in its own chunk, loaded by dynamic import on the token page only (192.6 KB raw, 61.5 KB gzip), plus a 25 KB (9 KB gzip) chart module.
  - CLS: live inserts only add to the top of Latest and the feed, and rows already loaded are never removed.
  - Client bundle gate: clean.

**Blockers fixed**

1. **Copy mismatch: the no-match heading showed the query uppercased** ("ZZZZQQ"), because the display face uppercases headings. The UI-SPEC renders `{q}` as typed, and a mint prefix is case-sensitive. Fix: the query sits in a `normal-case` span. File: `apps/web/components/home-search.tsx`. Check: home-nomatch asserts `text-transform: none` on the query.

**Design questions**

1. **Header Launch icon below 360px (03-11): accepted.** The header has 288px of content width at 320. The brand mark, DEVNET badge, the word "Launch" and Connect would overflow it. The icon has the accessible name "Launch a coin", and widths below 360 are a very small share of phones. The UI-SPEC header row now says so.
2. **In-chart TradingView logo (03-10): turned off.** The 5.2.1 typings for `attributionLogo` say the logo satisfies the license link requirement, and "if you already fulfill this requirement then you can disable this attribution logo". The footer credit links to https://www.tradingview.com/ on every page. The in-chart logo also sat over the volume bars and sent the page path as `utm_source`.
   - Files: `token-chart-draw.ts` (`attributionLogo: false`), the comment in `token-chart.tsx`, and the UI-SPEC options table and footer note.
   - Check: `coin.e2e.ts` asserts the chart panel has no links.
3. **New launch in Top and Oldest (03-13): accepted as built.** A new coin starts at about 28 SOL, near the bottom of Top, and is the last coin in Oldest. With more than 50 coins it would fall past the first page in both, so inserting it on the tick would rarely change what anyone sees. Latest, which D-14 requires, is live. The UI-SPEC live-behaviour row now says "on reload or a resync catch-up".

Left for the owner, unchanged: whether Trending should show up to 10 coins that had 0 volume, or only coins that traded.

**Polish for the owner (not fixed)**
- **Chart:** at 390 the "Bonded" marker text is clipped by the price scale when the bond candle is the last bar ("Bonde"). A larger `rightOffset` on narrow widths would clear it.
- **Chart:** the last-value label (87.00) sits over the nearest axis tick label (90.00). This is default lightweight-charts behaviour.
- **Bond panel at 768:** the bond glyph is full width per the UI-SPEC (viewBox 560x52), so at tablet width the nodes are about 36px across and look heavy. Capping it at `max-w-[560px]` would match the 1440 weight.
- **Identity bar (Phase 2 layout):** the avatar is centered beside the name, meta and stats block. In token.html it is top-aligned with the name, and the stats run under it from the left edge.
- **Trending and grid chips:** the volume and age chips render in the UI font. In the mockup they are mono.

## Deviations from Plan

1. **[Rule 3 - Blocking] `paused.e2e.ts` now runs in `mode: "default"` (in order, one worker).** Under `fullyParallel` the new home paused test ran alongside the existing form test. Its `finally` re-enabled launches while the form test was still waiting for the pause, and the form test failed. Fixed in ec58846.
2. **[Rule 2] Added `apps/web/e2e/shoot.ts`, which is not in the plan's file list.** `paused.e2e.ts` and `responsive-lists.e2e.ts` both need the gate, and one spec file cannot import another. `responsive.e2e.ts` (Phase 2) keeps its inline copy, which I left alone.
3. **Fixes went into components, not globals.css or tokens.css.** Every blocker was in a component, as the plan's "or the named component" allows.
4. **03-UI-SPEC.md was edited.** Four rows record the 03-14 decisions so the contract matches the code.

## Verification

- `pnpm exec playwright test` (full suite, once at the end): **177 passed, 2 skipped** (the devnet-only groups), 0 failed. Both paused tests passed.
- `pnpm test`: 197 passed, 1 skipped (34 files). `pnpm lint`: clean. `pnpm typecheck`: clean. `pnpm --filter @bondr/web build`: ok. `sh scripts/check-client-bundle.sh`: rc 0.
- Screenshots: 27 non-staging PNGs. The regenerated Phase 2 screenshots were discarded before each commit.
- The dev servers Playwright started stopped with the run, and nothing is left listening on 3000 or 8080.
- No deploy and no Railway changes (03-15). REQUIREMENTS.md is untouched: this plan verifies LIST-01..05 and TOKEN-01..02 but does not deliver them alone.

## Self-Check: PASSED

- FOUND: apps/web/e2e/responsive-lists.e2e.ts, apps/web/e2e/shoot.ts, 27 screenshots
- FOUND: ec58846, 43ab3c7
