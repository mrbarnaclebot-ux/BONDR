---
phase: 07-go-live
plan: 12
subsystem: launch error contract, web forwarder, step 4 copy
tags: [anti-vamp, ticker, error-contract, copy, tdd]
requires: [07-10]
provides:
  - "LaunchErrorCode ticker_locked and ticker_reserved (both 409 in worker http.ts)"
  - "ApiError.retryAfter?: number (seconds) and ApiError.lock?: 'landed' | 'pending'"
  - "apps/web/lib/worker.ts passes a finite retryAfter and a two-value lock through, nothing else new"
  - "apps/web/lib/launch-faults.ts: FAULTS, Fault, NOT_FOUND, BUILD_FAILED"
  - "apps/web/lib/ticker-copy.ts: tickerFault(code, symbol, refusal), tickerFieldError(symbol, refusal), reservedFieldError(symbol)"
  - "launch-run.ts Stop(code, refusal?) and Progress.refusal"
affects: [07-13 worker cooldown and reserved guard (throws these codes with retryAfter and lock), step 1 field errors plan]
key-files:
  created:
    - apps/web/lib/launch-faults.ts
    - apps/web/lib/ticker-copy.ts
    - apps/web/lib/ticker-copy.test.ts
    - apps/web/e2e/launch-ticker.e2e.ts
  modified:
    - packages/core/src/api.ts
    - apps/worker/src/http.ts
    - apps/web/lib/worker.ts
    - apps/web/lib/worker.test.ts
    - apps/web/lib/launch-run.ts
    - apps/web/components/launch-sign.tsx
    - apps/web/components/launch-flow.tsx
    - apps/web/lib/README.md
    - apps/web/components/README.md
key-decisions:
  - "07-12: the lock word is 'landed' | 'pending'; a pending lock gets the in-flight line even with a retryAfter, and a missing retryAfter gets the 'last 24 hours' line"
  - "07-12: the refusal fields ride on Stop into Progress.refusal, so step 4 renders the ticker line from the body and the step 1 symbol (uppercased)"
  - "07-12: an age under one minute reads 'less than a minute', not '0 minutes'"
requirements-completed: []
duration: 25min
completed: 2026-10-26
---

# Phase 7 Plan 12: Ticker Refusal Contract and Copy Summary

**The ticker cooldown's error contract now works end to end, before the worker enforces it. It has two 409 codes (`ticker_locked`, `ticker_reserved`), plus `retryAfter` and `lock` on ApiError. The web forwarder passes those two fields through after validating them and still drops every other worker field. The exact A1 and A2 copy lives in a pure, tested `ticker-copy.ts`. Step 4 shows it from the refusal body and the step 1 symbol, with no retry button. The failure table moved into `lib/launch-faults.ts`, so launch-sign.tsx shrank from 278 to 220 lines.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Codes, fields and the forwarder pass-through | 791a6d4 |
| 2 | FAULTS moved to a lib file, ticker-copy.ts and the step 4 wiring | 151dfec |
| docs | Web lib and components README | 843dda8 |

## Evidence

- worker.test.ts adds two tests. A 409 `{ error: ticker_locked, retryAfter: 75600, lock: landed, reason, raw }` reaches the caller as exactly `{ error, retryAfter, lock }`. A string, Infinity or null retryAfter, or a lock outside landed|pending, is dropped (3 rows). RED was checked first.
- ticker-copy.test.ts has 6 tests covering every A1 and A2 row:
  - wait boundaries: 3600 is "1h", 3599 "60 minutes", 60 and 59 "1 minute", 0 "1 minute"
  - age boundaries: 82800 is "1h", 82801 "59 minutes", 86400 "less than a minute", 0 "24h"
  - the pending and missing-retryAfter lines, both reserved lines, and the two-sentence field error
  RED was checked first (module missing).
- launch-ticker.e2e.ts: 2 passed. Stubbed prepare refusals render the exact step 4 lines on row 2 with no Try again or Build again.
- The existing launch-live.e2e.ts stubbed failure table: 13 passed after the FAULTS move.
- apps/web/app/api/launch/prepare/route.ts returns the forwarded body unchanged (`Response.json(out, { status })`). Confirmed by reading it.
- `pnpm typecheck` and `pnpm lint` are clean. launch-sign.tsx is 220 lines (under 260). launch-faults.ts is 76 lines with no React import. ticker-copy.ts is 47 lines.

## Deviations from Plan

1. **[Rule 3] launch-run.ts was edited (not in the plan's file list).** `Stop` now carries the refusal's retryAfter and lock, and `Progress` has `refusal`. Without that, step 4 could not see the wait. The change is three small additions.
2. **[Rule 3] launch-flow.tsx now imports NOT_FOUND from lib/launch-faults.ts**, because the constant moved.
3. **[Rule 2] An added e2e, launch-ticker.e2e.ts.** It tests the Stop -> Progress -> Outcome wiring, which the unit copy test cannot reach.
4. **Task 1 was committed with the web typecheck failing on the FAULTS total record**, as the plan's acceptance criteria allow. The next commit (151dfec) restores it. Every other commit in the batch typechecks.

## Notes for later plans

- The worker throws `fail({ error: "ticker_locked", retryAfter, lock })` (or `ticker_reserved`). The forwarder already passes the fields, and step 4 already renders them.
- The step 1 field errors are ready but not wired: `tickerFieldError(symbol, refusal)` after a refusal, and `reservedFieldError(symbol)` live in step 1. The plan that adds RESERVED_TICKERS to the step 1 form wires them.

## Threat Flags

None. T-07-12-01..03 are mitigated as planned: the rebuilt body allows only validated fields, malformed values are dropped (the copy falls back), and neither ticker fault has an action.

## Self-Check: PASSED

- FOUND apps/web/lib/launch-faults.ts, apps/web/lib/ticker-copy.ts, apps/web/lib/ticker-copy.test.ts, apps/web/e2e/launch-ticker.e2e.ts
- FOUND commits 791a6d4, 151dfec
