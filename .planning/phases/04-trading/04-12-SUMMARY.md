---
phase: 04-trading
plan: 12
subsystem: ui-gate
tags: [responsive, axe, screenshots, design-review]
requires:
  - phase: 04-11
    provides: "TradeCallouts, the live region, QUOTE_IMPACT and the trade-stubs helpers"
provides:
  - "apps/web/e2e/responsive-trade.e2e.ts: the Phase 4 matrix, 7 trade states x 3 widths plus the closed bar at 390 and 768"
  - "gate(page, name, width, dir?) and PHASE4_SHOTS in apps/web/e2e/shoot.ts"
  - "23 local screenshots in .planning/phases/04-trading/screenshots/"
affects: [04-13]
tech-stack:
  added: []
  patterns:
    - "A panel-scoped layout shift check: a PerformanceObserver over a 2.5 s refresh window, CLS rules (input-driven shifts excluded), only sources inside the panel"
key-files:
  created:
    - apps/web/e2e/responsive-trade.e2e.ts
    - .planning/phases/04-trading/screenshots/ (23 png)
  modified:
    - apps/web/e2e/shoot.ts
    - apps/web/e2e/README.md
    - apps/web/components/trade-sheet.tsx
    - .planning/phases/03-indexer-lists-and-token-page/screenshots/coin-curve-{390,768,1440}.png
    - .planning/phases/03-indexer-lists-and-token-page/screenshots/coin-bonded-{390,768,1440}.png
key-decisions:
  - "04-12 (owner-delegated): the trade sheet takes the column panel's fill and leaf 10% top glow and drops the consent dialog's leaf 18% ring; leaf stays reserved to Color items 16-19"
  - "04-12 (owner-delegated): the sheet's side seg keeps its pr-12 inset (04-08) so the 44px close never sits over it; accepted as a departure from 'seg full width'"
  - "04-12: gate shoots the viewport, not the full page, while a dialog is open, since a fixed sheet in a full-page shot is drawn mid-page over unblurred content"
  - "04-12: the migration pause state is reached with a quote stub of 409 paused (the BONDR copy), so it needs no complete coin and runs on staging too"
requirements-completed: [TRADE-01, TRADE-02, TRADE-03, TRADE-04]
duration: 50min
completed: 2026-10-24
---

# Phase 4 Plan 12: Responsive, Axe and Designer Critique Summary

**Every Phase 4 trade surface passes at 390, 768 and 1440: no horizontal scroll, 0 axe violations, and a screenshot of each (23 in total). The Designer critique found one blocker: the sheet was styled like the consent dialog, with a leaf ring. It now uses the column panel's fill. There are no open blockers.**

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Phase 4 responsive and axe matrix with screenshots | f93e492 |
| 2 | Designer critique and audit, blocker fixed | f2eb44d |

## What was built

- **`shoot.ts`**: `gate` takes an optional fourth argument, the screenshot folder. It defaults to the Phase 3 folder, so the Phase 3 specs did not change. `PHASE4_SHOTS` points at `.planning/phases/04-trading/screenshots/`. While a `<dialog>` is open, the shot covers the viewport instead of the full page.
- **`responsive-trade.e2e.ts`** (seeded curve coin locally, the first curve coin of `/api/coins?sort=top` on staging, `/api/trade/*` stubbed, reduced motion). The surface is the sheet opened from the bar's Buy at 390 and 768, and the column panel at 1440:
  - trade-disconnected: Phantom present but not connected, 0.5 SOL, full quote, "Connect Phantom to trade"
  - trade-buy: ready buy with the fee breakdown open, plus the layout shift check over one refresh
  - trade-sell: Sell, 100%, "Sell 17,234,567 {SYMBOL}"
  - trade-impact: the 10% warn callout
  - trade-impact-high: the 20% alert and "Buy anyway, 20.00% price impact"
  - trade-paused: a quote stub of 409 paused, which shows the BONDR migration callout and "Trading paused"
  - trade-result: a landed buy with the success line
  - trade-bar: the closed Quick trade bar, at 390 and 768 only
- Each test waits for its state and for the chart canvas, then runs `gate(page, name, width, PHASE4_SHOTS)`.

## Designer critique (against token.html, the token mockup screenshots and the UI-SPEC)

**Score: 8/10.** The panel matches the token.html trade panel in structure, order and copy, and applies the spec's normalizations: 8px chip gap, 44px chips in the sheet and 40px in the column, 16px route rules, 44px close, 88px bar buttons, 12/16 bar padding plus safe area. The fee rows follow the 04-03 Note. Leaf is used only for the Buy fill, the top glow, the fee "0" and the result Check. Impact color goes foreground under 5%, warn from 5% to 15%, destructive above 15%. Under reduced motion the sheet appears in place, the result line has no rise, and the spinner is motion-safe. All copy matches the Copywriting Contract.

**Audit: pass.**
- Accessibility: axe reports 0 violations on all 23 surface-width pairs. That includes color-contrast for ink on the destructive seg and danger button, and for warn text on surface.
- Tap targets, measured in the sheet at 390: close 44x44, seg 150x44, preset and slippage chips 84x44 and 69x44, submit 52px. Column chips are 40px.
- The 2 s refresh: a new check in trade-buy measures the panel's layout shift over 2.5 s and requires 0. It counts shifts by CLS rules (input-driven ones excluded) and only from nodes inside the panel.
- Bundle: the token page client chunk that holds the trade panel, chart wrapper and trades is 46.1 KB raw, 15.8 KB gzip. `check:bundle` returns 0.

**Blocker fixed**
1. **Sheet fill and leaf ring** (Shape and Color contracts). The sheet used the consent dialog's fill: a leaf 12% glow at 90% width, plus a 1px leaf 18% ring on every side. The UI-SPEC asks for "Same fill and glow" as the column panel with "1px line-strong top border only", and leaf is reserved to items 16-19. Fix: the sheet now uses the column's `radial-gradient(100% 50% at 50% 0%, leaf 10%)` fill and `shadow-elev-2`. File: `apps/web/components/trade-sheet.tsx`. The responsive-trade, trade and trade-sheet specs passed again, and the 390 and 768 shots were refreshed.

**Accepted as built (owner-delegated)**
- In the sheet, the side seg is inset with pr-12 so the absolute 44px close never covers it (04-08). In the mockup the full-width seg sits under the X.

**Polish for the owner (not fixed)**
- The fees `<summary>` is 35px tall in the sheet. Every other control is 44px. It is outside the UI-SPEC tap-target list and above the WCAG 24px minimum, but `min-h-11` in the sheet would make it consistent.
- The sell amount input shows the raw "17234567" while the button label reads "17,234,567". This follows the spec (inputs are raw), but a reader may notice the mismatch.
- Bond and burn at 768 still shows its Phase 3 tablet layout, with the subtitle right-aligned on the title row. This is unchanged from Phase 3, where it was already listed as polish.
- The trade-bar full-page shots draw the fixed bar partway down the page, because Playwright stitches full-page shots. Only the shots are affected; the real page is fine.

## Deviations from Plan

1. **[Rule 1 - Bug] The not-connected state needs Phantom present.** Without the fake Phantom, the button is "Get Phantom", which is a link. Every state now injects Phantom and consent, and only the connect press differs. Commit f93e492.
2. **[Rule 2] Additions to the matrix beyond the plan's list:** the open fee breakdown in trade-buy, a layout shift assertion for the audit's "2 s refresh causes no layout shift", and a wait for the chart canvas, because one shot caught "Loading chart…". The first version of the shift check failed under load because of chart price-scale redraws. It is now scoped to the panel and excludes input-driven shifts, and it passed 69 of 69 times with `--repeat-each 3`. Commit f2eb44d.
3. **gate viewport shots for open dialogs.** This makes the sheet shots honest. Phase 3 has no open dialogs, so its shots are unchanged.
4. **The Phase 3 coin-curve and coin-bonded screenshots (6) were committed.** The Phase 4 token page layout intentionally changed them: there is a trade panel in the right column and a bar below 1100px. The other regenerated Phase 2 and Phase 3 shots were restored.
5. **The fix went into `trade-sheet.tsx`, not `globals.css`.** The plan allows "the named component".

## Verification

- `pnpm exec playwright test apps/web/e2e` (full suite, once, the phase gate): **244 passed, 4 skipped** (the devnet groups, E2E_DEVNET unset), 0 failed.
- `pnpm test`: 282 passed, 2 skipped (42 files). `pnpm lint` clean. `pnpm typecheck` clean. `pnpm --filter @bondr/web build` ok. `pnpm check:bundle` rc 0.
- 23 non-staging PNGs in `.planning/phases/04-trading/screenshots/`. Screenshots that the full run regenerated were restored before the docs commit.
- No deploy and no Railway changes (04-13 does that). Nothing is left listening on 3000 or 8080.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/web/e2e/responsive-trade.e2e.ts, 23 screenshots
- FOUND: f93e492, f2eb44d
