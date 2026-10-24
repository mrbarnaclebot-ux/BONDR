---
phase: 04-trading
plan: 11
subsystem: web
tags: [errors, callouts, results, a11y, live-region]
requires:
  - phase: 04-10
    provides: "runTrade, buttonState, the result slot and use-trade phase and result"
provides:
  - "TradeCallouts: the D-17 copy for every trade code with a fallback, then the migration, impact and quote-failed callouts"
  - "useAnnounce: the panel's one polite live region text"
  - "impactPct, impactBand, outText in lib/format.ts"
  - "panel, button, openPanel and QUOTE_IMPACT in e2e/trade-stubs.ts"
affects: [04-12, 04-13]
tech-stack:
  added: []
  patterns:
    - "A user's quote is detected as the quote that ends a loading state; the 2 s refresh never sets loading, so it stays silent"
    - "A non-submit press calls preventDefault, because the re-render can turn the same button into type submit before the click's default action"
key-files:
  created:
    - apps/web/lib/use-announce.ts
    - apps/web/e2e/trade-results.e2e.ts
    - apps/web/e2e/trade-callouts.e2e.ts
  modified:
    - apps/web/components/trade-result.tsx
    - apps/web/components/trade-panel.tsx
    - apps/web/components/trade-quote.tsx
    - apps/web/lib/format.ts
    - apps/web/lib/use-trade.ts
    - apps/web/e2e/trade-stubs.ts
    - apps/web/e2e/trade-run.e2e.ts
    - apps/web/e2e/trade-sheet.e2e.ts
key-decisions:
  - "A quote error of paused with the coin not complete shows the BONDR migration copy. The trade quote only pauses for awaiting_migration, so no pause reason check is needed"
  - "The callout slot shows at most one callout, in this order: result, migration, impact, quote failed. Consent required has no copy and falls through to the next callout"
requirements-completed: [TRADE-01, TRADE-02, TRADE-03]
duration: 17min
completed: 2026-10-24
---

# Phase 4 Plan 11: Trade results, callouts and the live region Summary

**Every trade outcome now shows its locked D-17 copy, and so does every pre-sign risk: price impact 5% to 15% and over 15%, the BONDR or {SYMBOL} migration pause, and a failed quote. A screen reader hears the quote once per user change, "Quote paused.", and each in-flight step through one polite region. 20 new stubbed browser tests cover these states, and they caught a bug where tapping the refresh button started a trade.**

## Performance

- **Duration:** about 17 min
- **Completed:** 2026-10-24
- **Tasks:** 2
- **Files:** 3 created, 8 modified (plus 3 READMEs)

## Accomplishments

- `trade-result.tsx` now exports `TradeCallouts`. A switch maps each code to its fixed copy: slippage, insufficient_balance, paused (BONDR, or {SYMBOL} when the coin's venue is complete), rejected (info), expired, rate_limited, switched, message_changed and onchain. consent_required maps to nothing. Any other code shows "Could not build your trade. Nothing was sent. Try again.". Raw worker text never renders (T9).
- The slot then shows the migration callout, then the impact callout, then "Could not get a quote. Trying again.". The impact callout is keyed by band, so a refresh inside the band updates it in place and never remounts it.
- `use-announce.ts` drives one `aria-live="polite"` sr-only region in the panel. It reads "You receive about {value}. Price impact {pct}." when a user-initiated quote lands, "Quote paused." on the pause, and "Preparing trade", "Waiting for Phantom", "Confirming" for the steps.
- `impactPct` and `outText` moved from trade-quote.tsx to `lib/format.ts`, with a new `impactBand`, so the quote list, the callouts and the live region share one set of D-13 thresholds.

## Task Commits

1. **Task 1: result copy, callouts and the live region** - `ecf24b8` (feat)
2. **Task 2: stubbed e2e for every callout and result, plus the refresh-press fix** - `4779f26` (test)

## Tests

- All trade specs ran twice (`--repeat-each 2`): trade, trade-sheet, trade-run, trade-results and trade-callouts. 74 passed and 4 skipped (devnet group, E2E_DEVNET unset).
- Regression: coin, responsive, live and trade-routes: 66 passed, 1 skipped. The web unit tests: 81 passed, 1 skipped. `pnpm typecheck` and `pnpm lint` are clean.
- Trade spec test count: 33 across the five files (trade.e2e.ts 10, trade-run 3, trade-results 14, trade-callouts 6).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tapping "Quote paused, tap to refresh" started a trade**
- **Found during:** Task 2, the quote pause test
- **Issue:** The refresh press calls `resume()`. React flushes that update during the click dispatch, so the same button becomes `type="submit"` before the browser runs the click's default action. The form then submitted, and the stub trade went on to "Confirming…" and landed. With a real wallet, Phantom's signature prompt would still have stopped it, but no trade should start from a refresh press.
- **Fix:** Every non-submit press (connect, consent, refresh) now calls `e.preventDefault()`. The test also asserts that no prepare call is made.
- **Files modified:** apps/web/components/trade-panel.tsx
- **Commit:** 4779f26

**2. [Rule 3 - Blocking] New specs in new files instead of trade.e2e.ts**
- **Issue:** trade.e2e.ts was already 294 lines, and the plan wanted 20 or more more tests in it. That would break the AGENTS.md limit of 300 lines per file.
- **Fix:** The results rows are in `trade-results.e2e.ts`, written as one table-driven loop plus four special cases. The callouts, the pause and the live region are in `trade-callouts.e2e.ts`. The helpers `panel`, `button` and `openPanel` moved into trade-stubs.ts, and trade-run.e2e.ts now imports them. Because of this, the plan's `rg -c "test\("` check on trade.e2e.ts does not apply. The count above covers the five trade specs together.
- **Commit:** 4779f26

**3. [Rule 3 - Blocking] use-trade.ts reached 300 lines**
- **Fix:** The announce hook lives in `lib/use-announce.ts`, which brings use-trade.ts back to 271 lines.
- **Commit:** ecf24b8

**4. [Rule 3 - Blocking] trade-sheet 768 test was flaky**
- **Issue:** The test measured the sheet one frame into its reduced-motion keyframe, which starts at translateY(100%). It failed 2 of 3 times under load (bottom 1405 instead of 844). This was a pre-existing race, not caused by this plan's changes.
- **Fix:** The test now polls until the bottom edge reaches 844, then checks the width and x.
- **Commit:** 4779f26

### States reached a different way than written

- **Account switched:** `emitChange` fires while a delayed prepare (1.5 s) is in flight. The plan said to fire it during a delayed sign, but the fake Phantom has no sign delay. runTrade watches for account changes for the whole run, so the outcome is the same: Stop("switched") after signing and before submit, and the test asserts that no submit happens.
- **Coin waiting for PumpSwap:** seeded directly with `seedCoin(..., { coin: { venue: "complete", progress: 1, bonded_at } })`, so no coin API stub was needed.
- **Live region steps:** a fake refusal returns too fast to observe "Waiting for Phantom", because React batches it with idle. The tests instead check "Preparing trade" (delayed prepare) and "Confirming" (delayed submit), which use the same mechanism.
- **Live region silence:** the refresh test changes the amount on the refresh, which is a stronger check than "same values". The row updates, the region stays the same, and the next user change is announced.
- **Extra row:** a code with no copy (`pin_failed`) proves the fallback.

## Known Stubs

None.

## Notes for the orchestrator

- The Phase 2 screenshots that Playwright regenerated were restored before each commit.
- The axe run over the impact, migration and result states (UI-SPEC Accessibility Contract) is not part of this plan. If 04-12 or 04-13 owns the a11y audit, it can use `openPanel` and the fixtures added here.

## Self-Check: PASSED

- Files: apps/web/lib/use-announce.ts, apps/web/e2e/trade-results.e2e.ts and apps/web/e2e/trade-callouts.e2e.ts exist.
- Commits ecf24b8 and 4779f26 are in git log.
