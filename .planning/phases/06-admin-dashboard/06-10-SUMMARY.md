---
phase: 06-admin-dashboard
plan: 10
subsystem: worker
tags: [worker, audit, switches, hold, recheck, overview, tdd]
requires: [06-08]
provides:
  - admin-audit.ts AuditStore (insertPending, settle, insertLanded), pgAudit, memoryAudit
  - admin-act.ts switchRoute, act (hold, release_hold, recheck_launch), ActDeps
  - admin-overview.ts overview, coinLive, LiveOpts
  - POST /admin/switch, /admin/act, /admin/overview, /admin/coin-live behind gated
  - settle.ts observe and landed exported; fee-routes.ts key exported; switches.ts isJob
affects: [06-12 top row, 06-13 money actions (audit writer), 06-16 W table, 06-17 timeline, 06-19, 06-24 devnet re-check]
tech-stack:
  added: []
  patterns: [one audit writer with a guarded pending-to-final update, injected deps for chain and DB in admin actions]
key-files:
  created:
    - apps/worker/src/admin-audit.ts
    - apps/worker/src/admin-audit.test.ts
    - apps/worker/src/admin-act.ts
    - apps/worker/src/admin-act.test.ts
    - apps/worker/src/admin-overview.ts
    - apps/worker/src/admin-overview.test.ts
  modified:
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/settle.ts
    - apps/worker/src/fee-routes.ts
    - apps/worker/src/switches.ts
    - apps/worker/src/health.test.ts
    - apps/worker/src/README.md
    - apps/worker/README.md
    - vitest.config.ts
decisions:
  - "06-10: session-only actions validate, then do read-only checks (coin exists, in-flight launch, one status read), then write the landed audit row, then change state; a failed audit write stops the action"
  - "06-10: re-check with no in-flight launch writes a landed audit row { outcome: not_applicable } and answers 409 not_applicable, so every re-check the owner makes is recorded"
  - "06-10: hold params are { reason }, release params are { resetFinalize }, switch params { job, enabled }, re-check params { outcome }"
  - "06-10: coinLive with the engine on uses only engine memory (an unknown mint is not_found, no DB read); with the engine off it loads the one coin and reports its hold from the row"
metrics:
  duration: 22 min
  completed: 2026-10-25
  tasks: 3
  files: 15
---

# Phase 6 Plan 10: Audit writer and session-only admin routes Summary

The worker now has its single audit writer and the admin routes that need no fresh signature. `pgAudit` inserts a pending row for money actions and settles it once with `update ... where id = $1 and result = 'pending' returning`, so the 0007 trigger never fires in normal use. Session-only actions write one landed row. POST /admin/switch, /admin/act (hold, release hold, re-check launch), /admin/overview and /admin/coin-live all sit behind 06-08's `gated`.

## What was built

- `admin-audit.ts`: `AuditStore` per the contract. `pgAudit(exec = db())` has no delete. A failed insert or settle logs `admin audit write failed: <SQLSTATE>` and rethrows. The params never reach the log. `memoryAudit()` follows the same pending-to-final rule and exposes `rows`.
- `admin-act.ts`: `switchRoute` (validates the job with `isJob` and checks `enabled` is a boolean, audits, then `setJob`) and `act`. Hold checks the reason (trimmed, 1 to 120 chars), then the coin, writes the audit row, sets `held_at`/`held_reason` and calls `engine.setHold(mint, reason)`. Release clears both columns and, on a finalize-held coin, also sets `finalize = 'none'` and calls `setHold(mint, null, true)` (A5). Re-check finds the mint's in-flight launch (signed, sent or unknown; the unique index allows only one) and makes one `observe(conn, sig, true, 0)` call. A height of 0 skips the block-height read. A confirmed launch with no error runs settle's `landed(conn, row)`. Anything else answers `not_on_chain` and changes nothing. With the engine null, hold and release still update the DB.
- `admin-overview.ts`: `overview` makes one `getMultipleAccountsInfo` call for [treasury, buyback, ops, treasury BONDR ATA, buyback BONDR ATA] (Token-2022 ATAs, `AccountLayout` decode, a missing account reads "0"). It adds `OPS_FLOOR_LAMPORTS`, `bondrPrice.get()`, `nextBatchAt` and `engine.memory()`. `coinLive` makes one call for [W, W BONDR ATA, W child ATA] and returns the coin's memory entry and its current window.
- `admin-routes.ts`: four new keys in the gated map. The act deps are built per call, so building the route table needs no DATABASE_URL.
- READMEs: `apps/worker/README.md` lists the routes and has an "Owner console" section: console actions are audited, while the bearer `/kill-switch` and `/fee/release` are not (OQ6). `src/README.md` lines cover the three new files.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 RED | d1ff0b1 | test(06-10): add failing tests for the admin audit writer |
| 1 GREEN | 339a0bd | feat(06-10): write every admin action intent-first and settle it once |
| 2 RED | b9d3355 | test(06-10): add failing tests for the switch, hold, release and re-check actions |
| 2 GREEN | 695dbe1 | feat(06-10): audit switch flips, hold, release hold and one-shot launch re-checks |
| 3 RED | 27dfc72 | test(06-10): add failing tests for the overview balances and the live coin read |
| 3 GREEN | 9acc364 | feat(06-10): read platform balances and the selected coin's W in one RPC call each |

## Verification

- admin-audit.test.ts: 4 passed (pg cases ran against the Neon dev branch inside rolled-back transactions).
- admin-act.test.ts: 8 passed (DB cases inside rolled-back transactions; chain and landed stubbed).
- admin-overview.test.ts: 3 passed, including the one-call counts and the exact key order.
- admin-routes.test.ts lists health, switch, act, overview and coin-live, and each answers 403 for a wrong actor.
- settle.test.ts and settle-flow.test.ts pass unchanged.
- `pnpm vitest run apps/worker`: 42 files, 287 passed, 1 skipped.
- `pnpm lint` and `pnpm typecheck`: clean.
- Full `pnpm test`: 76 files passed, 553 passed, 2 skipped (555).
- Acceptance greps: no `.delete(` in admin-audit.ts, no `console.error(...params`. `observe` and `landed` are exported from settle.ts. "not audited" is in apps/worker/README.md.
- admin-act.test.ts and admin-audit.test.ts are in the `DB` list in vitest.config.ts. Every DB case rolls back, so no test rows are left.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] health.test.ts mocked @bondr/core/db as an empty module**
- **Found during:** Task 3
- **Issue:** admin-routes now imports admin-overview, which imports fee-boot and then fee-ledger. That module builds `inArray(feeLedger.state, ...)` at import, so the empty mock failed the suite at load.
- **Fix:** the mock keeps the real table objects and replaces `db()` with a function that throws. Any query still fails the test, so the memory-only proof holds.
- **Files modified:** apps/worker/src/health.test.ts
- **Commit:** 9acc364

**2. Exported `key` from fee-routes.ts and added `isJob` to switches.ts** (neither file is in files_modified). The plan names `key(v)` as the validator to reuse, and `isJob` reuses switches' column map instead of keeping a second job list. `isJob` uses `Object.hasOwn`, so `__proto__` is refused (tested).

## Notes for later plans

- Money actions (06-13, 06-19): `const id = await audit.insertPending({ actor, action, mint, params, simulation, intentSig })` before any send. Then `audit.settle(id, "landed" | "failed" | "refused", { sigs, error })` once. `simulation` and `intentSig` must both be set (DB CHECK). `pgAudit(tx)` works inside a transaction. `memoryAudit()` is for tests and the fork stage.
- A failed audit write throws after logging the SQLSTATE. Callers must let it stop the action.
- `ActDeps` = `{ audit, engine, conn, exec, observe, landed, setJob }`. `LiveOpts` = `{ env, engine, conn }`, and `AdminOpts` satisfies it.
- Answers: switch returns `AdminSwitches`. Act returns `{ outcome: "held" | "released" | "landed" | "not_on_chain" }`, with errors 400 invalid_input, 404 not_found (no such coin) and 409 not_applicable (re-check with no in-flight launch). Coin-live returns 404 not_found for a coin the engine does not hold, or that has no row when the engine is off.
- Release hold does not touch `fee_ledger` held rows. They stay as history, as in `pgLedger.release`.
- `overview` reads `bondrPrice.get()` (lamports per BONDR base unit, null before the boot seed).

## Requirements

ADMIN-02, 03, 05, 08 and 10 are not ticked. This plan delivers only the worker side of each; the console UI and the money actions come in later plans.

## Known Stubs

None.

## TDD Gate Compliance

Each task has a `test(...)` commit followed by a `feat(...)` commit. Every RED run failed because the module under test did not exist yet.

## Self-Check: PASSED
