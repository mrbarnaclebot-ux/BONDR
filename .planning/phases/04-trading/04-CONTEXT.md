# Phase 4: Trading - Context

**Gathered:** 2026-10-24
**Status:** Ready for planning
**Mode:** Auto. The owner delegated every gray area on 2026-10-24 ("keep going and dont stop... only stop if human intervention is needed in regards to real money"). Each decision below is the recommended option, logged in 04-DISCUSSION-LOG.md.

<domain>
## Phase Boundary

As a trader, I want to buy and sell BONDR coins with SOL in one signature, so that I never leave the page.

Phase 4 delivers:
- A trade panel on the token page:
  - Buy and Sell tabs, an amount field with preset chips, and slippage chips.
  - A quote preview: tokens out, route, price impact, minimum received, and a fee breakdown with "no BONDR platform fee".
  - One Phantom signature per trade.
- The route: SOL to BONDR to coin through `multi_hop_swap` (`packages/core/src/route.ts`, proven in Phase 1). It works when the coin is on its curve and after it has migrated to PumpSwap. It also works for BONDR on its curve or in its pool.
- Fees shown and charged come from pump's live FeeConfig, never hardcoded, and BONDR adds no platform fee (TRADE-04).
- A landed trade shows in the feed and the chart through the Phase 3 live stream; nothing new is needed there.

Not in Phase 4:
- the burn budget, ledger and fee engine (Phase 5)
- admin trading controls (Phase 6)
- mainnet (Phase 7)
- limit orders, charts of the user's own trades, a portfolio page

</domain>

<decisions>
## Implementation Decisions

### Carried forward (locked earlier)
- **D-01:** No platform trading fee (PROJECT.md decision; TRADE-04). Fee tiers are read from the live FeeConfig and Global, never hardcoded (PROJECT.md Pump coupling). Pinned to `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0.
- **D-02:** The worker owns chain access and the Helius key. The web calls the worker over private HTTP with a token. Phantom signs with `solana:signTransaction` only, never signAndSend (the Phase 2 wallet.tsx pattern). The CSP `connect-src 'self'` stays, so the browser never calls RPC directly.
- **D-03:** SOL-equivalent values everywhere (Phase 3 D-01). Devnet only until Phase 7.
- **D-04:** Neon budget (Phase 3 D-04): quotes, builds and balance reads touch the chain through the worker, never Postgres. No new periodic DB reads.
- **D-05:** Layout follows the approved `token.html` mockup trade panel and Phase 3 D-11a. On wide screens the trade panel takes the 380px right column above Bond and burn. Below the wide breakpoint it is a bottom sheet opened from a sticky Buy / Sell bar. gsd-ui-phase writes the UI-SPEC before planning.

### Transaction flow
- **D-06:** Mirror the Phase 2 launch flow, with no co-sign:
  1. The browser posts the side, amount and wallet to `/api/trade/prepare`.
  2. The worker resolves the route, simulates it and builds an unsigned v0 transaction with the user as fee payer.
  3. Phantom signs (`signTransaction`).
  4. `/api/trade/submit` hands the signed transaction to the worker, which checks it is byte-for-byte what it built (message unchanged), sends it through Helius and confirms it.
  5. The browser shows confirmed, failed or expired.
- **D-07:** The worker stores the transactions it built (keyed by id) in memory for 2 minutes, not in Postgres (D-04), so submit can compare the signed message against what was prepared. ponytail: per-process, single replica.
- **D-08:** Compute budget: the CU limit comes from the simulation plus 10%. The priority fee is Helius `getPriorityFeeEstimate` (Medium), capped at 0.0005 SOL a trade. The user pays it.
- **D-09:** Consent: trading sends the wallet address to the server, so it requires the existing Phase 2 consent, reusing the session and consent prompt.

### Quote preview
- **D-10:** Quotes come from the worker via `/api/trade/quote`. The research picks the method. Quotes must work before a wallet connects, so the buy preview cannot depend on simulating as the user. Exact `minAmountOut` is always set from a fresh simulation at prepare time.
- **D-11:** The quote shows:
  - the amount you receive
  - the route (for example "SOL > BONDR curve > GRUB curve")
  - price impact
  - minimum received
  - total fees in SOL, broken down as in the mockup: pump protocol, creator, LP when on a pool, and the SOL to BONDR hop fee
  - "BONDR platform fee 0"
- **D-12:** The quote refreshes every 2 s (the mockup's fine print) while the panel is visible, the tab is in the foreground and an amount is set. It pauses after 60 s without input, showing "Quote paused, tap to refresh". Typing is debounced at 400 ms, the Phase 2 quote pattern.
- **D-13:** A price impact over 5% shows a warning. Over 15%, the button asks to confirm the impact.

### Amounts and slippage
- **D-14:** Buy presets: 0.1, 0.5, 1 SOL and Max. Max is the balance minus a 0.01 SOL reserve for fees and rent. Sell presets: 25%, 50%, 75% and 100% of the coin balance. Amounts can also be typed.
- **D-15:** Slippage chips are 0.5%, 1% and 3%, plus Custom (0.1% to 50%). The default is 1%, remembered per browser in localStorage.
- **D-16:** Balances (SOL and the coin) come from the worker via `/api/trade/balance`. They are fetched when the wallet connects, after each trade, and when the tab returns to the foreground; never on a timer.

### Results and errors
- **D-17:** On success the panel shows "Bought X GRUB" or "Sold for X SOL" with a Solscan link, refreshes the balances, and the trade appears in the feed through SSE. On failure it shows plain messages:
  - "Price moved more than your slippage. Try again or raise slippage."
  - "Not enough SOL for this trade and fees."
  - "Trading pauses for a few seconds while BONDR moves to PumpSwap." This is the pump 6107 and complete-but-unmigrated window.
  - "Signature declined."
  - "Transaction expired. Try again."
- **D-18:** No trading kill switch in Phase 4. Phase 6 owns the kill switches; trading never moves platform funds.

### Testing
- **D-19:** Unit tests (Vitest) cover the quote math, fee breakdown and message-unchanged check. E2E (Playwright) uses the existing Phantom mock for UI states. One real devnet buy and sell runs on a curve coin through the e2e devnet group, paid by the sim wallet with a 0.05 SOL cap. The PumpSwap path is proven against the Phase 1 fork fixtures and the Surfpool fork, because devnet cannot bond a child (Phase 3 A8).

### Claude's Discretion
- The quote method: pure SDK math on fetched curve and pool state, or a simulation from a funded worker-side account. It must meet D-10 and the Helius budget (D-05 of Phase 3).
- Whether the worker caches curve and pool state per coin for a second or two so the 2 s refresh from many viewers costs one read.
- Exact rate limits for `/api/trade/*`, following the guard.ts style.
- How the sell side quotes "you receive about X SOL" through two hops.
- How "Max" accounts for ATA rent on a first buy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` (Phase 4 section): goal and the 4 success criteria
- `.planning/REQUIREMENTS.md`: TRADE-01..04
- `.planning/PROJECT.md`: Fee Mechanic item 3 (fees per trade), the no-platform-fee decision, Pump coupling

### Design
- `.planning/mockups/token.html`: trade panel (lines 282-312) and mobile sheet behavior
- `.planning/mockups/tokens.css`, `.planning/design/DESIGN-BRIEF.md`
- `.planning/phases/03-indexer-lists-and-token-page/03-UI-SPEC.md`: the token page contract this phase extends

### Prior evidence and code
- `packages/core/src/route.ts`: routeBuy and routeSell over multi_hop_swap
- `scripts/devnet-trades.ts`: working devnet multi-hop buy and sell
- `.planning/phases/01-chain-spike/01-10-SUMMARY.md`: multihop.buy and sell rows (devnet), migrated.multihop rows (fork)
- `.planning/research/FINDINGS.md`: pump fee tiers and Helius limits
- `.planning/phases/02-launch-flow/02-CONTEXT.md`: the prepare, sign and submit flow, consent and the web/core boundary
- `.planning/phases/03-indexer-lists-and-token-page/03-CONTEXT.md`: D-01, D-04, D-11a

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/route.ts`: `routeBuy` and `routeSell` resolve each hop's venue, simulate, apply the slippage floor and build the ixs.
- `packages/core/src/pump.ts`: the SDK exports, including `computeAmmFeesBps` and `buyQuoteInput`.
- `apps/worker/src/prepare.ts`, `submit.ts` and `http.ts`: the Phase 2 build, store, submit and confirm pattern, and the private routes.
- `apps/web/app/api/quote/route.ts` and `lib/guard.ts`: sameOrigin, rateLimited and json body caps.
- `apps/web/components/wallet.tsx`: Phantom connect and `signTransaction`.
- `apps/web/lib/launch-run.ts`: the browser flow of sign, submit and poll.
- `apps/web/components/ui-seg.tsx`, `ui-button.tsx` and `coin-live.tsx`: segmented control, buttons and the live coin context (venue changes).

### Established Patterns
- Pure `@bondr/core` modules only in web; chain access in the worker.
- One runnable check per non-trivial change; `ponytail:` comments for shortcuts.

### Integration Points
- `apps/web/app/coin/[mint]/page.tsx`: the Panels grid gains the trade panel in the right column.
- The worker http routes gain `/trade/quote`, `/trade/prepare`, `/trade/submit` and `/trade/balance`.

</code_context>

<specifics>
## Specific Ideas

- The mockup's button copy: "Buy GRUB with 1.00 SOL" and "Sell 1,234 GRUB". Disabled states: "Enter an amount" and "Not enough SOL".
- The fee fine print: "One Phantom signature. Quote refreshes every 2 seconds."

</specifics>

<deferred>
## Deferred Ideas

- Trading kill switch: Phase 6, if needed.
- Limit orders and a portfolio page: out of scope for v1.
- Priority-fee user setting: later, if traders ask.

</deferred>

---

*Phase: 04-trading*
*Context gathered: 2026-10-24 (auto mode, owner-delegated)*
