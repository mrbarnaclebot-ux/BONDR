---
phase: 07-go-live
plan: 13
subsystem: worker prepare, core rules
tags: [anti-vamp, ticker, prepare, db, tdd]
requires: [07-02, 07-12]
provides:
  - "@bondr/core/rules RESERVED_TICKERS and reservedTicker(symbol), separate from checkSymbol"
  - "apps/worker/src/ticker.ts tickerLock(exec, symbol, wallet) -> { held, until, lastLanded } and tickerRefusal(lock, now) -> ApiError | null"
  - "admit refuses ticker_reserved then ticker_locked right after blocked, before prepareGuard, getBalance, reserveMint and ensureTable"
affects: [07-14 step 1 field errors and search, 07-16 genesis prepare (must not call reservedTicker)]
key-files:
  created:
    - apps/worker/src/ticker.ts
    - apps/worker/src/ticker.test.ts
  modified:
    - packages/core/src/rules.ts
    - packages/core/src/rules.test.ts
    - apps/worker/src/prepare.ts
    - apps/worker/src/prepare.test.ts
    - apps/worker/src/prepare-flow.test.ts
    - vitest.config.ts
    - apps/worker/src/README.md
    - packages/core/src/README.md
key-decisions:
  - "07-13: tickerLock counts holding rows (held) and tickerRefusal refuses whenever held > 0; retryAfter is clamped at 0, so a stale signed/sent/unknown row still holds"
  - "07-13: the reserved check runs in admit even without a wallet; a body with no wallet and a reserved symbol gets ticker_reserved instead of invalid_input"
requirements-completed: []  # LAUNCH-09 also needs the 07-14 search marker and later plans
duration: 12min
completed: 2026-10-26
---

# Phase 7 Plan 13: Ticker Cooldown and Reserved List in the Worker Summary

**The worker now enforces the D-40..D-44 anti-vamp rules. It makes one indexed read per prepare (`tickerLock`, using Pattern 12's query plus `count(*)`), and a separate pure reserved guard (`reservedTicker`) refuses BONDR, SOL, USDC, USDT and WSOL. Both refusals run in admit right after the blocked check. That is before prepareGuard's table caps, the balance RPC, the vanity reservation and any table spend.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Reserved guard and ticker.ts with the D-42 lock matrix | dda0adf |
| 2 | Refuse in admit before anything is spent | de0d481 |
| docs | Worker and core README entries | fc883a1 |

## Evidence

- rules.test.ts checks the reserved cases, and that checkSymbol("BONDR") is still ok. RED came first (reservedTicker missing). The `git diff` of rules.ts shows additions only.
- ticker.test.ts runs 5 tests against the Neon dev branch. Rows are inserted inside always-rolled-back transactions, with a fresh random ticker per case:
  - landed 1h ago: locked, landed, retryAfter within 82800 plus or minus 60
  - landed 25h ago, failed, and a 4-minute-old prepared row: all null
  - signed, sent and unknown: pending
  - an unknown row 10 minutes old: `{ ticker_locked, retryAfter: 0, pending }`
  - another wallet's 1-minute prepared row: pending, with retryAfter in (60, 120]; the asker's own row: null
  - a hidden landed coin: still landed
  - `checkSymbol(" <lower>")` finds the stored upper symbol
  - pg_indexes has launches_symbol_live
- prepare.test.ts adds 4 tests, run against committed rows that are always deleted:
  - "sol": 409 ticker_reserved, zero chain calls (recording Proxy) and zero vanity rows reserved by the wallet
  - a ticker landed 1h ago: 409 ticker_locked, lock landed, retryAfter about 82800, with the same no-spend checks
  - "BND-R": 400 invalid_input, and the tickerLock spy was not called
  - a fresh ticker: passes admit, calls tickerLock once, and the first chain call is getBalance
  RED came first: the reserved and locked cases got past admit.
- prepare.test.ts and prepare-flow.test.ts: 17 passed. prepare.ts is 231 lines and admit is 39 lines. ticker.ts is 53 lines and carries the ponytail comment. `pnpm typecheck` and `pnpm lint` are clean.

## Deviations from Plan

1. **[Rule 3] prepare-flow.test.ts gained one vi.mock for ./ticker.ts.** The plan wanted it unchanged. But it stubs every DB read (`db: () => ({})`), so the new read crashed with `exec.select is not a function`. The mock answers `held: 0`. The test's assertions are untouched.
2. Expired prepared rows are checked as "prepared, older than 3 minutes", because no launch state is named "expired".

## Notes for later plans

- 07-16 genesis prepare must not call `reservedTicker` (the genesis ticker is BONDR). The tickerLock read is harmless there.
- The race safety is prepare's single-flight queue (the ponytail comment in ticker.ts names the ticker_locks upsert upgrade).

## Threat Flags

None. T-07-13-01..07 are mitigated as planned.

## Self-Check: PASSED

- FOUND apps/worker/src/ticker.ts, apps/worker/src/ticker.test.ts
- FOUND commits dda0adf, de0d481, fc883a1
