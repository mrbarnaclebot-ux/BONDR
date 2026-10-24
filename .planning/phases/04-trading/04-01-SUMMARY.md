---
phase: 04-trading
plan: 01
subsystem: trading
tags: [contracts, quote, tdd, e2e-red]
requires: []
provides:
  - "api.ts trade contracts: TradeSide, HopVenue, TradeQuoteRequest, HopFee, TradeQuote, TradeBalance, TradePrepareResult, TradeSubmitRequest, TradeView, TradeErrorCode"
  - "quote.ts: CurveState, HopInput, RouteArgs, RouteQuote, curveHop, curveRates, routeQuote"
  - "trade-stubs.ts: stubTrade, QUOTE_BUY, QUOTE_SELL, BALANCE, PREPARED, tradeView"
  - "red trade.e2e.ts quote preview spec"
affects: [04-02, 04-03, 04-05, 04-09, 04-10, 04-11, 04-12]
tech-stack:
  added: []
  patterns: ["SDK legs masks in quote and breakdown", "float impact without integer rounding"]
key-files:
  created:
    - packages/core/src/quote.ts
    - packages/core/src/quote.test.ts
    - apps/web/e2e/trade-stubs.ts
    - apps/web/e2e/trade.e2e.ts
  modified:
    - packages/core/src/api.ts
    - packages/core/src/pump.ts
    - packages/core/src/README.md
    - apps/worker/src/http.ts
    - apps/web/components/launch-sign.tsx
    - apps/web/e2e/launch-stubs.ts
decisions:
  - "Price impact is RESEARCH's 1 - out/spotOut computed per hop in floats (reserveIn / (reserveIn + netIn), curve buys capped at real tokens), because integer outputs make a 1 lamport trade read 100% impact"
  - "Hop fee SOL: buy x*total/(10000+total) on the hop input, sell x*total/(10000-total) on the hop output; coin hop BONDR fee valued at BONDR spot from the same state"
  - "Curve HopInput carries no mints: routeQuote derives them (BONDR curve quoted in NATIVE_MINT, coin curve in BONDR)"
metrics:
  duration: 12 min
  completed: 2026-10-24
  tasks: 2
  files: 10
---

# Phase 4 Plan 01: Trade contracts and masked route quote Summary

Trade contracts in api.ts, a red Playwright quote-preview spec, and a pure `routeQuote` over pump-swap-sdk `multiHopSwapQuote` that reproduces both devnet multihop fixtures to the base unit and charges protocol only on the BONDR hop, creator and LP only on the coin hop.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Trade contracts and the failing quote preview spec | 195914b | api.ts, http.ts, trade-stubs.ts, trade.e2e.ts, launch-sign.tsx, launch-stubs.ts |
| 2 | Masked route quote, test first | 982fd5f (RED), fbe5f24 (GREEN) | quote.ts, quote.test.ts, pump.ts, README.md |

## Verification

- `pnpm vitest run packages/core/src/quote.test.ts`: 14 passed (buy fixture, sell fixture, 8 venue-pair mask tests, impact, floor, supply cap, curveRates)
- `pnpm test`: 35 files, 219 passed, 1 skipped
- `pnpm typecheck` and `pnpm lint`: pass
- `playwright test trade.e2e.ts -g "quote preview"`: fails as intended, on `locator.fill` waiting for region "Trade {SYMBOL}" (not a compile error)
- Acceptance greps: no SDK package import in quote.ts, no fee rate literal outside comments, quote.ts 230 lines, api.ts has no imports

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] launch-sign.tsx FAULTS table missing the new codes**
- Found during: Task 1 typecheck. `Record<Code, Fault>` became incomplete once LaunchErrorCode gained `slippage` and `message_changed`.
- Fix: both map to the existing BUILD_FAILED fault (a launch never gets them).
- Commit: 195914b

**2. [Rule 3 - Reuse] `fulfill` exported from launch-stubs.ts**
- trade-stubs.ts reuses it instead of copying it (one-word change to a file outside files_modified).

**3. Trade stub TX has one signature slot, not the launch TX's two**
- A trade has one signer; `signWire` signs slot 0 of either. ID and SIG still come from launch-stubs.ts.

**4. Price impact formula** (see decisions): float per-hop form of RESEARCH's definition, so "impact below 1e-6 for 1 lamport" holds; the capped buy reads above 0.99.

**5. pump.ts also exports `pumpPoolAuthorityPda`** (the test builds canonical pools with it; 04-02's pool reads can use it) and the AMM types `AmmFeeConfig`, `GlobalConfig`, `Pool`, `MultiHopLegFees`, `MultiHopQuoteHop`.

Acceptance note: the `rg "export type TradeQuote|..."` grep prints 5 lines, not 4, because `TradeQuoteRequest` also matches `export type TradeQuote`.

## TDD Gate Compliance

RED `test(04-01)` 982fd5f (suite failed to load: quote.ts absent), then GREEN `feat(04-01)` fbe5f24. No refactor commit needed.

## Known Stubs

None. trade-stubs.ts fixtures are test-only by design.

## Self-Check: PASSED
