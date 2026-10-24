---
phase: 04-trading
plan: 08
subsystem: trading
tags: [mobile, bottom-sheet, sticky-bar, dialog, a11y]
requires:
  - "04-05 TradePanel, TradeAmount Chips size sheet, useTrade setVisible"
  - "consent-dialog.tsx bottom sheet pattern (native dialog, showModal, backdrop click)"
provides:
  - "TradeSheet: Quick trade bar (live Mcap, Buy, Sell) and the native dialog sheet hosting TradePanel"
  - "TradePanel placement prop (column or sheet) and labelId"
  - "html:has(dialog[open]) scroll lock for every modal"
  - "apps/web/e2e/trade-sheet.e2e.ts"
affects: [04-10, 04-13]
tech-stack:
  added: []
  patterns:
    - "A fixed bottom bar clears the page's last content by padding the footer through body:has([data-trade-bar]) below 1100px"
key-files:
  created:
    - apps/web/components/trade-sheet.tsx
    - apps/web/e2e/trade-sheet.e2e.ts
  modified:
    - apps/web/components/trade-panel.tsx
    - apps/web/components/trade-quote.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/app/globals.css
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "The bar's bottom clearance pads the footer, not the token page content: the layout footer is the page's last content, so padding the page alone would leave the footer under the bar (the mockup pads .site-footer too)"
  - "The sheet panel uses setVisible, never panelRef, so one IntersectionObserver (the column's) drives the in-view state"
  - "The dialog's onClose also sets open false, so a close the cancel event cannot stop (Chrome's repeated-Escape close watcher) keeps the React state in step"
metrics:
  duration: 25 min
  completed: 2026-10-24
  tasks: 2
  files: 8
---

# Phase 4 Plan 08: Trade sheet Summary

Below 1100px the token page now has a sticky Quick trade bar (live Mcap with the trade flash, Buy and Sell). Tapping Buy or Sell opens the trade panel in a native dialog bottom sheet with that side selected and focus in the amount field. The sheet and the column panel share one useTrade state. From 1100px only the inline column panel renders.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Sticky bar and bottom sheet | 0dc9be3 | trade-sheet.tsx, trade-panel.tsx, trade-quote.tsx, globals.css, components README |
| 2 | Placement on the token page and the sheet spec | 384f957, a66cf43 | coin/[mint]/page.tsx, globals.css, trade-sheet.e2e.ts, e2e README |

## Verification

- `pnpm exec playwright test trade-sheet.e2e.ts trade.e2e.ts`: 13 passed, 1 skipped. The skip is trade.e2e.ts's existing E2E_DEVNET-gated devnet quote. trade-sheet.e2e.ts has no skips.
- Neighbor specs (coin, responsive, consent, coin-chart, live): 74 passed, 1 skipped.
- `pnpm typecheck` and `pnpm lint` are clean. trade-sheet.tsx is 151 lines.
- I checked screenshots by eye at 390 (sheet open, and the bar at the page end) and at 768 (the centered 560px sheet). The Phase 2 screenshots that the run regenerated were restored before committing.

## Deviations from Plan

**1. [Rule 1 - Bug] Bottom clearance on the footer instead of the page content**
- **Found during:** Task 2
- **Issue:** The plan put `calc(80px + env(safe-area-inset-bottom))` on the token page's bottom padding. The layout footer comes after the page, so at the end of the scroll the footer sat under the bar.
- **Fix:** The page keeps pb-12. In globals.css, `@media (width < 1100px) { body:has([data-trade-bar]) footer { padding-bottom: calc(80px + env(safe-area-inset-bottom)); } }`. The spec asserts that the footer's Terms link ends above the bar's top.
- **Commit:** 384f957

**2. [Rule 2 - Missing] Slippage chips at 44px in the sheet**
- **Found during:** Task 1
- **Issue:** UI-SPEC wants every chip in the sheet at 44px. Only TradeAmount took the size.
- **Fix:** TradeQuote takes a `size` prop and passes it to the slippage Chips (trade-quote.tsx was not in the plan's files).
- **Commit:** 0dc9be3

**3. [Rule 1 - Bug] The side seg clears the close button**
- **Found during:** Task 1
- **Issue:** The full-width seg would sit under the absolute 44px close button in the top right corner, as it does in the mockup.
- **Fix:** In the sheet, the seg wrapper gets pr-12.
- **Commit:** 0dc9be3

Other small choices:
- TradeSheet takes no `symbol` prop because useTrade already carries it.
- The bar is a `<section aria-label="Quick trade">`. That is a region role, and Biome's useSemanticElements rejects `role="region"` on a div.
- The backdrop uses Tailwind `backdrop:` classes on the dialog, the same way the consent dialog does, so globals.css needed no `::backdrop` rule.
- Reduced motion is already covered by the global 1 ms animation override.

## Known Stubs

- `phase` in use-trade.ts is still always "idle", so the in-flight close lock (aria-disabled close, ignored Escape and backdrop) is wired but cannot be exercised yet. Per the plan, 04-10 drives the phase and adds that test.

## Requirements

TRADE-01 and TRADE-02 stay Pending, because the panel cannot sign or submit a trade until 04-10. TRADE-03 was already Complete. This plan marks no requirement complete.

## Self-Check: PASSED
