---
phase: 04-trading
plan: 10
subsystem: web
tags: [buy, sell, phantom, sign, submit, poll, devnet]
requires:
  - phase: 04-07
    provides: "web trade routes (prepare, submit, view) and the worker trade submit and settle"
  - phase: 04-08
    provides: "the trade sheet with its in-flight close lock"
provides:
  - "runTrade: prepare, one signTransaction within signBy, switch check, submit, 1 s poll"
  - "buttonState: the pure UI-SPEC submit state table"
  - "TradeResult: success line, sent-unknown warning, failure fallback"
  - "use-trade phase, result, submit and clearResult"
affects: [04-11, 04-12, 04-13]
tech-stack:
  added: []
  patterns:
    - "Account switch detected through wallet.onAccountChange for the run's lifetime, since the WalletApi object is a render snapshot"
    - "Only a submit-ready button is type submit, so Enter in the amount field never connects or refreshes"
key-files:
  created:
    - apps/web/lib/trade-run.ts
    - apps/web/lib/trade-button.ts
    - apps/web/lib/trade-button.test.ts
    - apps/web/lib/use-balance.ts
    - apps/web/components/trade-result.tsx
    - apps/web/e2e/trade-run.e2e.ts
  modified:
    - apps/web/lib/use-trade.ts
    - apps/web/components/trade-panel.tsx
    - apps/web/components/trade-sheet.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/e2e/trade.e2e.ts
    - apps/web/e2e/trade-sheet.e2e.ts
key-decisions:
  - "A trade the worker no longer knows (404 after a restart) becomes unknown with the last seen signature, not a failure, because it may still land (T8)"
  - "TradeProvider takes net from the page, so the result's Solscan link carries the devnet cluster"
  - "The devnet sell accepts the anyway label: selling the whole sim balance through two curves quoted 22% impact"
requirements-completed: [TRADE-01, TRADE-02, TRADE-04]
duration: 17min
completed: 2026-10-24
---

# Phase 4 Plan 10: Trade run, submit states and result Summary

**The trade panel now runs real trades. A trader presses Buy or Sell and signs once in Phantom (signTransaction only). The panel then submits the trade, polls the worker and shows "Bought {tokens} {SYMBOL}." or "Sold for {sol} SOL." with a Solscan link. This was proven on devnet with a 0.01 SOL buy and a 100% sell through the panel.**

## Performance

- **Duration:** about 17 min
- **Completed:** 2026-10-24
- **Tasks:** 3
- **Files:** 6 created, 6 modified (plus 3 READMEs)

## Accomplishments

- `trade-run.ts` follows `launch-run.ts` closely. It prepares with no wallet in the body. Phantom's signature is raced against signBy: a timeout gives Stop("expired") and a refusal gives Stop("rejected"). If the account changed, the run throws Stop("switched") before submit. If the worker is unreachable at submit, the poll decides the outcome. A row still `prepared` gets the same wire resent, and polling continues every 1 s until the trade is landed, failed or unknown. The browser loads no Solana library.
- `use-trade.ts` now sets the phase (preparing, signing, confirming) and holds the result. After every run it refetches the balance. On success it clears the amount. A `consent_required` result calls `forgetConsent()`. The result clears on panel input, a side change, or the sheet closing.
- `trade-button.ts` holds the whole UI-SPEC state table, and 17 unit tests cover every row. The panel is one `noValidate` form. While a trade is in flight the inputs sit in a disabled fieldset, and the button uses `aria-disabled` so focus stays on it. The paused label calls `resume()`.
- `trade-result.tsx` holds the success line (`role="status"`, leaf Check, rise animation), the sent-unknown warning with its link, and the fallback copy for every failure code.

## Devnet run (owner pre-approved, sim dev wallet 9Hm1...wQM6, coin BSELL GoJK...bndr)

| Trade | Signature | Landed | CU | Feed row after blockTime |
|-------|-----------|--------|----|--------------------------|
| Buy 0.01 SOL (run 1) | 5kPDWXxAVtfDRSjbQCf1UNnMvuP6Zr7HXc5roZBzqn7k8gfRa4vCyNjacNtF6z7q9yyncKwcrrEX2hA1jz7dt4iK | Bought 76,235,018 BSELL | 158,235 | 3.7 s |
| Buy 0.01 SOL (run 2) | 3fdXMTv7ySP2iYpJkEXsax2RsksqQrbk7VVfsnPFDdCww9pKSkHjzLeMRvRgorCJbbLjMCdJUUyPtHacg7mrUcdf | Bought 61,818,427 BSELL | 158,234 | 8.1 s |
| Sell 100% (run 2) | 4YUeoUEXw4XDMYLfvsbWgmQhboHXPaJRuhS2pWJcS4uji3v9qHbYmzQFAHeMnxzoxVfuz1DohQZtK8TKtn4HY6Ss | Sold for 0.0305 SOL | 150,388 | 3.8 s |

- Run 1 failed after its buy landed. The 100% sell quoted 22.12% impact, so the button correctly showed "Sell anyway, 22.12% price impact" and the test was waiting for a different label. The test now accepts either label, and run 2 passed.
- Spend: the sim dev wallet went from 0.059252 to 0.069693 SOL, a net gain of 0.010441 SOL. It paid 2 × 0.010005175 SOL for the buys. The sell returned 0.030452 SOL because it also sold an earlier 109.8M BSELL from the 03 live.e2e devnet buy. Run 2's spend assertion measured -0.020 SOL against the 0.05 cap. No top-up was needed: the sim held at least 0.03 SOL, and ops is unchanged at 2.750788 SOL.

## Task Commits

1. **Task 1: trade run and its state in use-trade** - `d99b86c` (feat)
2. **Task 2 RED: button state table test** - `739e5ef` (test)
3. **Task 2 GREEN: buttonState, panel form, result slot** - `b98ad49` (feat)
4. **Task 3: stubbed run, sheet lock, devnet buy and sell** - `a522d0f` (test)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved useBalance into use-balance.ts**
- **Found during:** Task 1
- **Issue:** use-trade.ts was 252 lines, and adding the run would take it past the AGENTS.md 300-line limit.
- **Fix:** Moved the balance hook unchanged into `apps/web/lib/use-balance.ts`. `BalanceState` is re-exported from use-trade.
- **Commit:** d99b86c

**2. [Rule 3 - Blocking] Put the stubbed run tests in a new trade-run.e2e.ts**
- **Found during:** Task 3
- **Issue:** Adding the stubbed buy, sell and states tests plus the devnet group to trade.e2e.ts (215 lines) would pass 300 lines.
- **Fix:** The devnet group stays in trade.e2e.ts (293 lines), so the plan's `-g devnet` verify and the `0.05` grep still hold. The stubbed run tests are in `apps/web/e2e/trade-run.e2e.ts`.
- **Commit:** a522d0f

**3. [Rule 1 - Bug] Account switch detection through onAccountChange**
- **Found during:** Task 1
- **Issue:** The plan said to check whether wallet.address changed. But `useWallet()` returns a snapshot taken at render time, so `wallet.address` inside the async run never changes.
- **Fix:** `runTrade` subscribes to `wallet.onAccountChange` for the length of the run and throws Stop("switched") after signing if it fired.
- **Commit:** d99b86c

**4. [Rule 1 - Bug] Wallets row cleanup guarded by the launches FK**
- **Found during:** Task 3
- **Issue:** The sim dev's launches reference its wallets row, so a plain delete fails. launch-live.e2e.ts does not actually delete that row.
- **Fix:** afterAll deletes the row only when no launch references it.
- **Commit:** a522d0f

**5. [Rule 1 - Bug] The devnet sell accepts the anyway label**
- **Found during:** Task 3, devnet run 1
- **Fix:** The test accepts `Sell {tokens} {SYMBOL}` or `Sell anyway, {pct}% price impact`. Both are valid UI-SPEC rows.
- **Commit:** a522d0f

## Known Stubs

- Every failure code shows the fallback "Could not build your trade. Nothing was sent. Try again." This includes rejected, which should read "Signature declined.". Per the plan, 04-11 adds the copy for each code.
- The sr-only quote and phase live region is not built. 04-11 Task 1 owns it.
- The callout slot shows only the trade result. 04-11 adds the impact, migration and quote-failed callouts.

## Notes for the orchestrator

- "Sold for" comes from the worker's `lamportDelta`, which is the wallet's net SOL change. A 100% sell that closes a token account includes the rent refund in it. The 0.0305 SOL shown compares with 0.028 SOL in the feed row. This is accurate as wallet SOL received, but it reads slightly high against the trade's SOL value. That is 04-07 worker territory, so it was not changed here.
- I restored the Phase 2 screenshots that Playwright regenerated before committing.
- Regression check: coin, responsive, live, coin-chart and all trade specs pass (81 passed, 3 skipped), and the web unit tests pass (80 passed).

## Self-Check: PASSED

- Files: apps/web/lib/trade-run.ts, trade-button.ts, trade-button.test.ts, use-balance.ts, apps/web/components/trade-result.tsx and apps/web/e2e/trade-run.e2e.ts all exist.
- Commits d99b86c, 739e5ef, b98ad49 and a522d0f are all in git log.
