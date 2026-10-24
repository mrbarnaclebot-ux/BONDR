---
phase: 04-trading
plan: 03
subsystem: trading
tags: [quote, token-page, trade-panel, vertical-slice]
requires:
  - "04-02 worker POST /trade/quote"
  - "04-01 TradeQuote contract, trade.e2e.ts quote preview spec, trade-stubs.ts"
provides:
  - "web POST /api/trade/quote: same-origin, 120/min per IP, forwards side, mint, amount, slippageBps only"
  - "lib/use-trade.ts: TradeProvider, useTrade, toUnits"
  - "components/trade-panel.tsx: TradePanel (side Seg, amount, quote rows, fees line, fine print)"
  - "token page grid: chart and Trades left, Trade above Bond and burn in the 380px right column"
affects: [04-05, 04-08, 04-10, 04-11, 04-12]
tech-stack:
  added: []
  patterns: ["one client context for trade state above every placement", "delay ref read by the quote effect: typing debounced, side and slippage at once"]
key-files:
  created:
    - apps/web/app/api/trade/quote/route.ts
    - apps/web/lib/use-trade.ts
    - apps/web/components/trade-panel.tsx
  modified:
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/e2e/trade.e2e.ts
    - apps/web/e2e/coin.e2e.ts
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - .planning/phases/04-trading/04-UI-SPEC.md
decisions:
  - "At 1100px the grid uses rows auto 1fr, so a right column taller than the chart never opens a gap between chart and Trades"
  - "Route text is visible steps with an aria-hidden rule and an sr-only ' to ' between them, so textContent and the accessible name both read 'SOL to BONDR curve to X curve'"
  - "A quote for the other side is never shown: rows read '–' unless quote.side equals the panel side"
metrics:
  duration: 25 min
  completed: 2026-10-24
  tasks: 2
  files: 9
---

# Phase 4 Plan 03: Quote slice on the token page Summary

A visitor with no wallet opens a token page, types a SOL amount and sees the worker's live route quote: You receive about, Route, Price impact, Minimum received and the fees total. The quote goes through a guarded same-origin web route that forwards only the four quote fields.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Web quote route, shared trade state, UI-SPEC note | ef57c35 | route.ts, use-trade.ts, lib README, 04-UI-SPEC.md |
| 2 | First trade panel on the token page | 1509057 | trade-panel.tsx, components README, page.tsx, trade.e2e.ts, coin.e2e.ts |

## Verification

- `trade.e2e.ts -g "quote preview"`: passed, assertions unchanged from 04-01
- `E2E_DEVNET=1 trade.e2e.ts -g "devnet quote"`: passed against the local worker on devnet (real curve coin, 0.01 SOL, route "SOL to BONDR curve to {SYMBOL} curve"). Nothing signed or spent
- coin, responsive (axe at 390/768/1440), live and trade specs: 63 passed, 2 skipped (devnet groups)
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @bondr/web build`, `pnpm check:bundle`: pass
- Acceptance greps: one `rateLimited(req, "trade-quote", 120, 60_000)`, no `wallet` in the route, no `@bondr/core/(quote|pump|quote-read)` in apps/web, `TradeProvider` in page.tsx; trade-panel.tsx 126 lines, use-trade.ts 145 lines
- The 1440 coin screenshot shows the UI-SPEC grid. Regenerated Phase 2 screenshots were restored before committing

## Deviations from Plan

1. **[Rule 1 - Bug] coin.e2e.ts asserted the old note line.** The note copy change was planned, so the spec now expects "The public fee ledger for {SYMBOL} arrives in a later BONDR update." (commit 1509057)
2. **The fees summary sits after the `<dl>`, not inside it.** A `<dl>` may only hold dt/dd groups (axe definition-list), so the dim wrapper holds both the list and the fees line, and `aria-busy` stays on the `<dl>`.

## Known Stubs

- `phase` is always "idle". 04-10 drives it when the panel runs trades.
- The fine print says "Quote refreshes every 2 seconds", but the 2 s refresh loop arrives in 04-05. The copy is the UI-SPEC's, so it stays.
- There are no presets, slippage chips, fee breakdown, Seg danger tone or impact colors yet. 04-05 adds them. The panel also shows at every width until 04-08 moves it into the sheet below 1100px.

## Notes

- During the e2e runs the local worker logs "index boot failed: failed to get transaction: Invalid param: WrongSize". This plan did not touch the worker; it looks like the seeded E2E coins' fake signatures in the shared dev database. Out of scope, and no test failed.

## Threat Flags

None. The route reads and forwards no wallet (T-04-03-03). Only the four fields are forwarded (T-04-03-02). It allows 120 a minute per IP (T-04-03-01). The panel holds no rate constant (T-04-03-04).

## Self-Check: PASSED
