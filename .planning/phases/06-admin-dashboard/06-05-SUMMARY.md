---
phase: 06-admin-dashboard
plan: 05
subsystem: worker
tags: [worker, security, intent, allowlist, tdd]
requires: [06-02]
provides:
  - admin-intent.ts Intent, putIntent, intentMessage, take, viewIntent, updateIntent, INTENT_TTL_MS, INTENT_KEEP_MS, INTENT_MAX
  - admin-dest.ts Allowed, allowFor, refusedDestination, passedLines (pure)
affects: [06-11, 06-13 simulate and execute routes, 06-18 sim dialog]
tech-stack:
  added: []
  patterns: [trade-store shape for a per-process intent map, synchronous check-then-set for single use, decode-by-program allowlist]
key-files:
  created:
    - apps/worker/src/admin-intent.ts
    - apps/worker/src/admin-intent.test.ts
    - apps/worker/src/admin-dest.ts
    - apps/worker/src/admin-dest.test.ts
  modified:
    - apps/worker/src/README.md
decisions:
  - "06-05: putIntent takes { action, mint, to, data } and writes the message itself; take sets used, state sending and the retention clock in the same synchronous step"
  - "06-05: viewIntent answers null for an unknown, expired or not-yet-executed intent; retention after execute is INTENT_KEEP_MS from the last update"
  - "06-05: admin-dest refuses every token-program instruction other than Transfer, TransferChecked, Burn, BurnChecked and CloseAccount (an Approve or SetAuthority hands the account away), plus ATA RecoverNested; System TransferWithSeed is checked like Transfer"
  - "06-05: passedLines derives its lines from the owner names (Deployer, Treasury, Buyback, in that order) and answers ['burn only'] when none apply; the coin's own W is not named"
metrics:
  duration: 10 min
  completed: 2026-10-25
  tasks: 2
  files: 5
---

# Phase 6 Plan 05: Intent store and destination allowlist Summary

The worker now holds the two pure money guards every admin transaction will go through. `admin-intent.ts` writes the text the owner signs ("BONDR admin action", the action, the coin or "platform", the intent id, the destinations and the ISO expiry). It keeps that text in a per-process map shaped like trade-store. `take` checks the owner's signature over the stored bytes against the admin address and marks the intent used in the same synchronous step. `admin-dest.ts` decodes each top-level instruction by program and returns the first recipient outside the allowlist. The allowlist is burn, the treasury, the buyback, the coin's deployer and the coin's own W, each with its ATAs under both token programs.

## What was built

- **Intent store (D-12, D-39):** 2 minute expiry while unused. Kept 10 minutes after execute for the browser poll. Capped at 200, oldest dropped, swept on insert. Error answers: unknown or expired gives `intent_expired` (410), a second take gives `intent_used` (409), a wrong key or tampered text gives `bad_intent_signature` (403). A bad signature does not burn the intent. Consent and admin sign-in signatures are refused because their first lines differ.
- **Destination lock (D-14):** System Transfer and TransferWithSeed recipients must be allowed owners. Token Transfer and TransferChecked destinations must be allowed ATAs. CloseAccount must close to `closeTo`. Burns always pass. ATA create, ComputeBudget and every other program pass here, because signTx's ALLOWED_PROGRAMS covers them; a `ponytail:` comment names the CPI ceiling and the upgrade path. `passedLines` feeds the "Destinations check passed:" copy.

## Commits

| Gate | Commit | Message |
| ---- | ------ | ------- |
| RED | 651ba64 | test(06-05): add failing tests for the admin intent store |
| GREEN | 0d4dd97 | feat(06-05): add the admin intent store with the single-use owner signature check |
| RED | 1c8282b | test(06-05): add failing table tests for the admin destination allowlist |
| GREEN | 1e7d3eb | feat(06-05): add the pure destination allowlist decoder for admin jobs |
| docs | 3a94e54 | docs(06-05): list the intent store and destination lock in the worker README |

No refactor commit was needed.

## Verification

- `pnpm vitest run apps/worker/src/admin-intent.test.ts`: 9 passed
- `pnpm vitest run apps/worker/src/admin-dest.test.ts`: 19 passed (17 table cases plus 2)
- `pnpm typecheck`, `pnpm lint`: clean
- `pnpm test`: 63 files, 488 passed, 2 skipped
- `rg await apps/worker/src/admin-intent.ts`: no match. `rg "getMultipleAccounts|getAccountInfo|process.env" apps/worker/src/admin-dest.ts`: no match. Files are 121 and 116 lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Stricter token and ATA decoding than the plan listed**
- **Found during:** Task 2
- **Issue:** The plan named only Transfer, TransferChecked, CloseAccount and Burn for the token programs. An Approve, SetAuthority or undecodable token instruction would have passed, and each of those can hand a W account away.
- **Fix:** Any other token-program instruction is refused, naming the account it touches (keys[0]). ATA RecoverNested is refused too. System TransferWithSeed is checked like Transfer. Jobs only build Transfer, TransferChecked, BurnChecked and ATA idempotent creates today (grep), so nothing existing is refused. An Approve test case covers the rule.
- **Files modified:** apps/worker/src/admin-dest.ts, apps/worker/src/admin-dest.test.ts
- **Commit:** 1e7d3eb

**2. [Rule 2 - Contract fit] Intent carries optional moved/failed and an `at` clock**
- **Found during:** Task 1
- **Issue:** AdminIntentView has optional `moved` and `failed` (EVACUATE counters), and retention after execute needs a timestamp.
- **Fix:** Added `moved?`, `failed?` and `at` to Intent. viewIntent passes them through only when set.
- **Commit:** 0d4dd97

## Notes for later plans

- 06-13: call `take` and then run the job. Write results with `updateIntent(id, { state, sigs, landed, total, code })`. `take` already sets state `sending`. Store the `Allowed` and the simulation summary in `data` at `putIntent`. Pass `passedLines(allowed)` as the destinations list for the message, or the owner names, whichever the dialog copy needs. The message `Destinations:` line is whatever `to` holds.
- `refusedDestination` must run on the job's instructions before `budget()` is prepended (budget ixs pass anyway).
- The intent test imports `consentMessage` from `apps/web/lib/terms.ts` (no imports there) for the domain separation check. The admin sign-in text is a literal there because session.ts imports server-only.

## Known Stubs

None.

## Self-Check: PASSED
