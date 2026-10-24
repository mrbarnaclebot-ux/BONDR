---
phase: 04-trading
verified: 2026-10-24T20:08:36Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "HV-04-01: one devnet buy (0.01 SOL) and a 100% sell on staging through the real Phantom extension"
    expected: "One Phantom prompt per trade; worker accepts the wire (no 'did not match' copy); both rows appear in the feed; Solscan link works"
    why_human: "Only the real extension proves Phantom leaves the message bytes unchanged (research A5); the Playwright mock cannot"
  - test: "Post-review redeploy of staging at HEAD, then the devnet buy and 100% sell recheck (orchestrator)"
    expected: "Both land; 'Sold for X SOL' now equals the feed row's SOL (S-CR-01), not the wallet delta with rent"
    why_human: "All staging and 04-10 real trades predate the review fixes (soldLamports, routeOnly, devnet cap, poll deadline); deploy and real-money runs are out of verifier scope"
    result: "Done 2026-10-24 20:12 UTC: worker 87b5236a and web c5853294 deployed at d2659a9 (SUCCESS). Staging matrix 29 passed. Devnet buy 45vswFkK...mJfDN (Bought 79,081,112 EX8EUJ, feed row 2.5 s) and 100% sell 5FevuVM1...wo8be (Sold for 0.0195 SOL, feed row 2.1 s). 'Sold for' is the SOL received from the BONDR leg, rent excluded; the feed row shows 0.0186 SOL because it values the BONDR at BONDR's post-trade spot price on the thin devnet curve, so the two are not expected to match exactly. A first run right after the 29-test matrix saw the page's live stream refused (per-IP connect limit from the same runner IP, 'Reconnecting'); the buy landed and was indexed, and the standalone rerun passed. Ops unchanged at 2.750788 SOL. Neon: both computes idle by 20:18 UTC, staging last active 20:12 UTC with the new worker running."
  - test: "Type quickly in the amount field on staging and press Enter / click while the quote refreshes"
    expected: "Button reads 'Getting quote…' and does nothing until the quote for the typed amount arrives; the over-15% 'anyway' gate always reflects the current amount"
    why_human: "Fix log marks C-CR-01 and C-WR-05 'logic, requires human verification'; unit and e2e stubs cover the logic, not real network timing"
---

# Phase 4: Trading Verification Report

**Phase Goal:** As a trader, I want to buy and sell BONDR coins with SOL in one signature, so that I never leave the page.
**Verified:** 2026-10-24T20:08:36Z
**Status:** human_needed
**Re-verification:** No, initial verification (branch phase-04-trading, HEAD d2659a9)

## User Flow Coverage (MVP mode)

| Step | Expected | Evidence in codebase | Status |
|------|----------|----------------------|--------|
| Open a coin page | Trade panel in the right column, sheet below 1100px | `apps/web/app/coin/[mint]/page.tsx` imports `TradeProvider`, `TradePanel`, `TradeSheet` | VERIFIED |
| Enter amount, see quote | Tokens out, route, impact, minimum, fees, "no BONDR platform fee" | `components/trade-quote.tsx:244-252`, `:101`, `:137`; worker `quoteTrade` -> core `routeQuote` | VERIFIED |
| Set slippage | 0.5/1/3% + Custom 0.1-50%, persisted | `trade-quote.tsx:13,149-215`; `use-trade.ts:32-50` (localStorage `bondr:slippage`); worker bounds 10..5000 bps | VERIFIED |
| Sign once | One `signTransaction`, no signAndSend | `lib/trade-run.ts` `signWithin`; `wallet.tsx:35` | VERIFIED |
| Trade lands and shows | Result line + Solscan; feed row via Phase 3 SSE | `trade-submit.ts` settle; `trade-result.tsx`; feed rows observed in 04-10/04-13 real runs (pre-fix) | VERIFIED (re-run pending) |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: buy routed SOL > BONDR > coin through multi_hop_swap in one Phantom signature, shown in the feed | VERIFIED | `trade-prepare.ts` path `[NATIVE_MINT, Q, mint]` -> `routeBuy` (core `route.ts`, SDK `multiHopSwapInstructions`); one v0 tx, user fee payer; `routeOnly` requires exactly one multi_hop_swap; real devnet buys 04-10 and staging 04-13 with feed rows 2.3-8.1 s |
| 2 | SC2: sell coin back to SOL the same way | VERIFIED | path `[mint, Q, NATIVE_MINT]` -> `routeSell`; real devnet sells 04-10, 04-13 |
| 3 | SC3: quote preview (tokens out, impact, fees) and slippage before signing | VERIFIED | `routeQuote` returns amountOut, minAmountOut, impact, per-hop fee rows, `platformFee: "0"`; UI rows in `trade-quote.tsx`; wallet-free (D-10); slippage chips + Custom |
| 4 | SC4: curve and PumpSwap venues, fees from live FeeConfig, no platform fee | VERIFIED | `readConfigs` reads pump Global, FeeConfig, AMM GlobalConfig, AMM FeeConfig on chain (60 s cache); `curveRates`/`poolRates` call SDK `computeFeesBps`/`computeAmmFeesBps`; no hardcoded bps; `readMintState` picks curve or canonical pool; 04-09 fork rows: pureQuote == landed for curve/pool and pool/pool, buy and sell; `routeOnly` refuses any System transfer except into the user's own WSOL ATA |
| 5 | Submit sends only the exact prepared bytes signed by the session wallet (byte compare) | VERIFIED | `trade-submit.ts:100` `sameMessage(e.message, wire, 1)` (raw slice compare, length check) + `signatureOk` on slot 0 vs stored wallet; wallet from `sessionWallet`, body wallet dropped (`FIELDS`); re-read after await (double-send), test S-WR-05 |
| 6 | Instruction allowlist: message holds only the budget and the route | VERIFIED | `routeOnly` run after `checkMessage` at `trade-prepare.ts:190`; shape matches SDK 4.1.0 `multiHopSwapInstructions` + `buybackAtaInstructions` (read in node_modules); venue-independent, so the pool route passes too; unit tests for 5 refusal shapes; TRADE_LIVE devnet prepare passed |
| 7 | Devnet caps protect BONDR's curve and the coin's curve | VERIFIED | `maxSolIn` = min(BONDR cap, coin cost-to-complete priced on BONDR) x 0.9; enforced server-side in `capDevnetBuy` before routing; client `devnetCap` disables the button (C-WR-02) |
| 8 | Only a quote matching side and amount (and not loading) arms the trade | VERIFIED | `currentQuote` in `trade-button.ts`; used by `idleState` and by `use-trade.ts:235` submit guard |
| 9 | The poll ends at a deadline and aborts on unmount | VERIFIED | `trade-run.ts` `DEADLINE_MS = 150_000`; prepared-at-deadline -> expired, else unknown with slot-0 signature; every fetch takes the run's `AbortSignal`; `trade-run.test.ts` covers deadline and abort |
| 10 | "Sold for" is the sell leg's SOL, not the wallet delta | VERIFIED | `soldLamports` (TradeEvent curve, SellEvent pool), `lamportDelta` fallback only; test on `multihop-sell.json` with rent injected |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/core/src/quote.ts`, `quote-read.ts` | VERIFIED | Substantive, wired into `trade-quote.ts` and the spike fork stage |
| `apps/worker/src/trade-quote.ts`, `trade-state.ts`, `trade-prepare.ts`, `trade-submit.ts`, `trade-store.ts` | VERIFIED | Registered in `main.ts` as `/trade/quote|balance|prepare|submit|view` |
| `apps/web/app/api/trade/{quote,prepare,submit,balance,[id]}/route.ts` | VERIFIED | sameOrigin, rate limits, session wallet, body caps |
| `apps/web/lib/trade-run.ts`, `trade-button.ts`, `use-trade.ts`, `use-run.ts`, `use-route-quote.ts`, `use-balance.ts` | VERIFIED | Wired through `TradeProvider` on the coin page |
| `apps/web/components/trade-panel.tsx`, `trade-quote.tsx`, `trade-amount.tsx`, `trade-result.tsx`, `trade-sheet.tsx` | VERIFIED | Rendered by the page; all under 300 lines |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| trade panel | `/api/trade/quote` | `use-route-quote.ts` fetch, 400 ms debounce, 2 s tick | WIRED |
| `/api/trade/*` | worker `/trade/*` | `workerPost` with session wallet | WIRED |
| worker quote | chain FeeConfig | `readConfigs` getMultipleAccountsInfo | WIRED |
| worker prepare | `routeBuy`/`routeSell` -> SDK multi_hop_swap | `routeFor` | WIRED |
| worker submit | stored message | `getTrade` + `sameMessage` | WIRED |
| landed trade | feed | Phase 3 indexer + SSE (unchanged) | WIRED (observed live, pre-fix) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| trade-quote.tsx | quote | worker `routeQuote` over live curve/pool + configs | Yes (staging smoke 200, platformFee "0") | FLOWING |
| trade-amount.tsx | balance | worker `tradeBalance` getMultipleAccountsInfo | Yes | FLOWING |
| trade-result.tsx | amountOut, signature | worker settle via `fetchTx` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck | `pnpm -s typecheck` | clean | PASS |
| Unit tests | `pnpm -s test` | 44 files, 297 passed, 2 skipped (TRADE_LIVE, devnet) | PASS |
| Playwright, deploy, devnet | not run (out of scope) | orchestrator evidence: 247 passed, 4 skipped | SKIP |

### Probe Execution

Not applicable: no probe scripts declared for this phase.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| TRADE-01 | Buy via multi_hop_swap, one signature | SATISFIED | Truths 1, 5, 6 |
| TRADE-02 | Sell the same way | SATISFIED | Truths 2, 10 |
| TRADE-03 | Quote preview and slippage | SATISFIED | Truth 3, 8 |
| TRADE-04 | Curve and PumpSwap, no platform fee | SATISFIED | Truths 4, 6 |

No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (phase trade files) | - | TBD/FIXME/XXX/TODO | none found | - |
| `packages/core/src/trade.ts` | soldLamports | SellEvent (pool) branch has no test and no fork run since the fix (fork.json last regenerated in 04-09, before 9e133a6) | Warning | Display only; falls back to `lamportDelta` if it misses. Decoder normalizes keys to base58, so the comparison shape is right |
| `apps/worker/src/trade-prepare.ts` | prepare | Never run end to end on a PumpSwap route (devnet cannot bond, D-19); route and quote proven on the fork, `routeOnly` by SDK shape | Info | Accepted by D-19; first mainnet-fork or Phase 7 trade confirms |
| `.planning/phases/04-trading/04-UI-SPEC.md` | 268 | Still says the result clears on "the sheet closing"; C-WR-01 changed that and the fix log calls it updated | Info | Doc drift only |
| `apps/web/app/globals.css` | - | 406 lines (C-IN-01, pre-existing, skipped) | Info | AGENTS.md 300-line rule |
| review leftovers | - | S-IN-01, 03, 04, 06 out of fix scope (unreachable devnet Helius path by design, dust -> build_failed, fee display rounds down, cache key) | Info | No money impact |

### Human Verification Required

1. **HV-04-01 real Phantom extension trade on staging.** Open https://web-staging-72bad.up.railway.app with Phantom on devnet, open a curve coin, buy 0.01 SOL, sell 100%. Expected: one prompt each, no "did not match" copy, both rows in the feed. Why human: only the real extension proves the bytes stay unchanged.
2. **Post-fix staging recheck.** Redeploy HEAD, rerun the devnet buy and 100% sell. Expected: both land and "Sold for" equals the feed's SOL value. Why human: every real trade so far predates the review fixes.
3. **Stale quote never arms.** Type fast and press Enter during refresh on staging. Expected: "Getting quote…" until the matching quote arrives. Why human: real network timing.

### Gaps Summary

No blocking gaps. All four roadmap criteria and the six review money-safety guards are in the code at HEAD, wired, and covered by unit tests that pass. What is left is human or deploy evidence: the real Phantom extension (HV-04-01), a staging re-run after the review fixes, and the pool branch of "Sold for", which no test covers. The economics flag from 04-13 (routed trades pay BONDR no creator fee) belongs to Phase 7 and is not a Phase 4 gap.

---

_Verified: 2026-10-24T20:08:36Z_
_Verifier: Claude (gsd-verifier)_
