---
phase: 04-trading
plan: 05
subsystem: trading
tags: [trade-panel, presets, slippage, fees, refresh, balances]
requires:
  - "04-03 TradeProvider, useTrade, TradePanel, /api/trade/quote"
  - "04-02 worker POST /trade/balance"
  - "04-01 trade-stubs.ts, TradeQuote and TradeBalance contracts"
provides:
  - "components/trade-amount.tsx: TradeAmount (balance hint, D-14 presets, devnet cap error) and Chips"
  - "components/trade-quote.tsx: TradeQuote (impact colors, slippage chips and custom row, Fees details)"
  - "Seg tone prop (mint | danger)"
  - "web POST /api/trade/balance: session wallet only, 30/min per IP and wallet"
  - "useTrade: balance, refreshBalance, paused, resume, panelRef, setVisible, pickAmount"
  - "lib/use-route-quote.ts: useRouteQuote (split out of use-trade.ts)"
affects: [04-08, 04-10, 04-11, 04-12]
tech-stack:
  added: []
  patterns:
    - "refresh tick in the quote effect: a tick change quotes at once with no loading dim"
    - "balances on events only: connect, visibilitychange, refreshBalance; a sequence number drops stale answers"
key-files:
  created:
    - apps/web/components/trade-amount.tsx
    - apps/web/components/trade-quote.tsx
    - apps/web/app/api/trade/balance/route.ts
    - apps/web/lib/use-route-quote.ts
  modified:
    - apps/web/components/ui-seg.tsx
    - apps/web/components/trade-panel.tsx
    - apps/web/components/README.md
    - apps/web/lib/use-trade.ts
    - apps/web/lib/README.md
    - apps/web/e2e/trade.e2e.ts
    - apps/web/e2e/trade-stubs.ts
decisions:
  - "Stored slippage is read in a mount effect, not the useState initializer, so the server render and first client render match"
  - "Fee sub-rows are generic per hop (creator, LP, protocol, each only when non-zero); masking comes from the quote alone"
  - "Network fee cap rounds up to 4 decimals (up to 0.0006 SOL for 505,000 lamports), so the cap never under-reads"
  - "Zero is not a field error, only no amount; unparseable text or too many decimals is"
metrics:
  duration: 20 min
  completed: 2026-10-24
  tasks: 3
  files: 11
---

# Phase 4 Plan 05: Trade panel controls Summary

The trade panel now has the full UI-SPEC controls: amount presets with live session-wallet balances (Max keeps 0.01 SOL, 100% is the exact raw coin balance), slippage chips plus a 0.1% to 50% custom value remembered in `bondr:slippage`, a closed-by-default Fees breakdown with masked per-hop rows from the live quote, impact colors, the Sell seg tone, and a 2 s quote refresh that runs only while useful and pauses after 60 s idle.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Amount field, presets and the sell tone | c84d705 | trade-amount.tsx, ui-seg.tsx, trade-panel.tsx, use-trade.ts, README |
| 2 | Quote list, slippage and the fee breakdown | c4ca8da | trade-quote.tsx, trade-panel.tsx, use-trade.ts, README |
| 3 | Refresh loop, balances and their specs | d916bc7 | use-trade.ts, use-route-quote.ts, balance/route.ts, trade.e2e.ts, trade-stubs.ts, lib README |

## Verification

- `playwright test apps/web/e2e/trade.e2e.ts`: 8 passed, 1 skipped (devnet group without E2E_DEVNET). New: presets and Max, sell 100% is the raw balance, slippage persists, fees rows are masked, price impact over 15% reads destructive, refresh every 2 s and pause after 60 s (page.clock), devnet cap
- coin, responsive (axe at 390/768/1440), live and wallet specs: 69 passed, 1 skipped
- `pnpm vitest run apps/web`: 64 passed, 1 skipped
- `pnpm typecheck`, `pnpm lint`: pass
- Acceptance greps: `tone` in ui-seg.tsx (3 lines); `aria-pressed` in trade-amount.tsx; `10_000_000` and "0.01 SOL" in trade-amount.tsx; one `<details` in trade-quote.tsx; no `95|30|25|150` outside comments in trade-quote.tsx; `bondr:slippage` only inside the try blocks; one `sessionWallet(req)` and no `.wallet` in the balance route; one `setInterval` (the quote loop) and `visibilitychange` in use-trade.ts
- Sizes: trade-quote.tsx 226, trade-panel.tsx 34, trade-amount.tsx 142, use-trade.ts 256, use-route-quote.ts 61 lines
- The 1440 coin screenshot showed the panel with the presets, slippage chips and Fees summary. Regenerated Phase 2 screenshots were restored before committing

## Deviations from Plan

1. **[Rule 3 - Blocking] useRouteQuote moved to lib/use-route-quote.ts.** With the loop, visibility and balance hooks, use-trade.ts hit 305 lines and TradeProvider broke the 40-line function rule. The quote fetch moved out unchanged apart from the refresh tick; the slippage state became `useSlippage()` and the debounce delay moved into the loop hook. use-trade.ts is 256 lines.
2. **Extra spec "price impact over 15% reads destructive"** uses the planned QUOTE_IMPACT_HIGH fixture, which no listed test used.
3. **The refresh spec advances the fake clock 1 ms per poll.** A refresh quotes from a 0 ms timer set after React renders, so under a paused page.clock it fires only when the clock moves.
4. **Paused dims the quote values to 60%** (UI-SPEC Quote refresh). The paused submit label and the "Quote paused." announcement belong to the submit states in 04-10, which call `resume()`.

## Known Stubs

- `phase` is still always "idle"; 04-10 drives it, and the refresh loop already checks it.
- The UI-SPEC sr-only quote live region (announce once per user change, not on refresh) is not built yet. The refresh is already silent (no loading state), so 04-10 can add the region without re-announcing.
- A 403 consent_required from /api/trade/balance shows "Balance unavailable"; reopening consent belongs with the 04-10 consent-required result.

## Threat Flags

None. The balance route reads the wallet from the session only (T-04-05-01), allows 30 a minute per IP and wallet and is never polled (T-04-05-02). Stored slippage is range-checked to 10..5000 bps on read (T-04-05-03), and the worker checks it again. Above 5% the warn hint states the worst fill (T-04-05-04). Fee rows come only from quote values and the platform fee row is the quote's structural "0" (T-04-05-05).

## Self-Check: PASSED
