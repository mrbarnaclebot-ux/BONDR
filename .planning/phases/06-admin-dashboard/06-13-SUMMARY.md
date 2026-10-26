---
phase: 06-admin-dashboard
plan: 13
subsystem: worker
tags: [worker, money-actions, fresh-signature, audit, destination-lock, tdd]
requires: [06-10, 06-11]
provides:
  - "admin-money.ts: MoneyCtx, simulateAction, executeAction, intentView, adminBase, gatedDeps"
  - "POST /admin/simulate, /admin/execute (202), /admin/intent behind gated()"
  - "http.ts Reply (a handler's non-200 success status)"
  - "ApiError.reason (optional; not_applicable reason code)"
affects: [06-15, 06-18, 06-22]
tech-stack:
  added: []
  patterns: [recording land wrapped by the gated land, background send after a synchronous 202, audit insert before applies re-check]
key-files:
  created:
    - apps/worker/src/admin-money.ts
    - apps/worker/src/admin-money.test.ts
  modified:
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/http.ts
    - apps/worker/src/http.test.ts
    - apps/worker/src/README.md
    - packages/core/src/api.ts
decisions:
  - "06-13: A1 taken as Claude's discretion (owner may override): admin money actions build on adminBase (feeDeps mode on, pg ledger) in every engine mode; the engine flag governs automation only"
  - "06-13: execute inserts the pending audit row, then re-checks applies(); a changed state settles that row refused (not_applicable) and answers 409 not_applicable with the reason, nothing sent"
  - "06-13: the background run records every base land; outcome order is refused (destination_refused) > unknown (audit failed 'unconfirmed', intent unknown) > failed/skipped (send_failed, code N, ops_low) > thrown (build_failed) > nothing sent (nothing_sent) > landed"
  - "06-13: the intent message names each non-W allowlisted owner with its full address (Treasury <addr>, Deployer <addr>); the gated run uses the allowlist stored at simulate, i.e. exactly what the owner signed"
  - "06-13: route ids are 32 hex chars (admin-intent ids), not UUIDs; bad bodies answer 400 invalid_input (there is no bad_request code)"
metrics:
  duration: 12 min
  completed: 2026-10-25
  tasks: 2
  files: 8
---

# Phase 6 Plan 13: Worker simulate, execute and intent routes Summary

The money path now exists end to end in the worker. Simulate runs the action's real job through the capture deps and checks every captured tx against the action's allowlist. It stores a 2-minute single-use intent only when the simulation passed, there was something to send, and every destination was allowed. Execute verifies the owner's ed25519 signature over the stored message against ADMIN_WALLET in the worker, writes the pending audit row, re-checks the coin, and answers 202. It then runs the job once, on the coin's engine queue when the engine runs, through deps whose land re-checks each tx's destinations before the base land. The audit row is settled exactly once, and nothing is resent.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | Simulate, execute and the intent view | 27cfe33 (RED), 6af8e58 (GREEN) |
| 2 | Money routes and worker README | 698ba4a |

## What was built

- `admin-money.ts` (205 lines):
  - `simulateAction`: does actionView first, answering 404 when a named mint has no coin. Then it calls applies() and answers 409 `{ error: "not_applicable", reason }` if that fails. Then allow and watch, then the capture run on a shallow coin copy, then `refusedDestination` on each step, then `simSummary`. The first step's error goes through `tradeError`, so the browser gets a contract code and never RPC text. `putIntent` stores `{ allowed, summary }`.
  - `executeAction`: `take`, with the signature verified against `ctx.admin`. Then `begin`, which reads a fresh view, inserts the pending audit row (params `{ intent: id }`, simulation trimmed to ok/cu/feeLamports/balances/destinations, intentSig base64), and re-checks applies. It returns `{ id }`, and `send` runs in the background.
  - `send`: wraps `ctx.deps.land` in a recorder that updates the intent's sigs and landed/total after each tx. It then wraps that in `gatedDeps` and runs `runOn(engine, mint, run)`. At the end it updates the intent and settles the audit once.
  - `gatedDeps(base, allowed, onRefused)`: `allowed: () => true`. A refused tx calls onRefused and returns `{ state: "skipped" }`, and base land is never reached.
  - `intentView`: answers 404 not_found for an unknown id.
- `admin-routes.ts` (102 lines): three new routes, all inside the one `gated()` pass. Bodies are validated at the boundary:
  - action must be one of the nine names (evacuate is refused);
  - mint must be a base58 key, and must be absent or null exactly when the action is burn_buyback;
  - id must be 32 hex characters;
  - signature must be exactly 64 bytes of base64.
  
  Execute returns `new Reply(202, { id })`. The `MoneyCtx` is built lazily on first use (adminBase plus pgAudit, both cached) and reads the engine getter on every call. `AdminOpts.money` is a test seam.
- `http.ts`: `Reply` lets a handler answer with a status other than 200.
- `api.ts`: `ApiError.reason?: string`.

## Verification

- `pnpm vitest run apps/worker/src/admin-money.test.ts`: 10 passed. The RED run failed first because the module did not exist. Every behavior bullet is covered, including the call-order assertion `["audit", "land", "land"]`.
- `pnpm vitest run apps/worker/src/admin-routes.test.ts apps/worker/src/admin-money.test.ts apps/worker/src/http.test.ts`: 30 passed. This covers the 403 for a wrong actor, a missing body and a null adminWallet on all eight routes, 8 malformed bodies answering 400, a simulate-execute round trip answering 202 with the intent reading landed, and an unknown intent answering 404.
- `pnpm typecheck`: pass. `pnpm lint`: clean (372 files).
- Full `pnpm test`: 80 files passed, 605 passed, 2 skipped (607).
- Acceptance greps: the console-log grep and the `FEE_ENGINE|feeEngine` grep on admin-money*.ts both find nothing. All three POST routes are present and gated, and README lists admin-money. Every file is under 300 lines and every function under 40.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] http.ts could only answer 200**
- **Found during:** Task 2
- **Issue:** the contract says execute answers 202, but `handle` always sent 200.
- **Fix:** added the `Reply` class and a one-line branch in `handle`, plus a test in http.test.ts. Both files were outside the plan's files_modified.
- **Commit:** 698ba4a

**2. [Rule 3 - Blocking] ApiError had no `reason` field**
- **Found during:** Task 1
- **Issue:** the contract's `{ error: "not_applicable", reason }` did not typecheck against `Fail`'s `ApiError` body.
- **Fix:** added optional `reason?: string` to `ApiError` in packages/core/src/api.ts.
- **Commit:** 6af8e58

**3. Contract adjustments**
- Malformed bodies answer `invalid_input` (400). The plan's "bad_request" is not a contract code.
- Ids are validated as 32 hex characters, the format admin-intent actually generates, not UUIDs.
- `adminBase(env, conn)` drops the plan's `keys` parameter, because feeDeps derives every key from env.seed.
- No admin-money-run.ts split was needed (205 lines).

## Threat mitigations

| Threat | How it is mitigated |
|--------|---------------------|
| T-06-13-01 | `take` checks the owner's signature against `ctx.admin`. A test shows a stranger's signature gets 403 and writes no audit row. Expired intents get 410 and reused ones 409. |
| T-06-13-02 | The allowlist is checked at simulate and again inside the gated land before every tx. A test shows a stranger's address never reaches base land. |
| T-06-13-03 | The audit row is written before any send. A call-order test covers this. |
| T-06-13-04 | Params hold `{ intent }` only, and no signature or message is ever logged. Grep acceptance confirms both. |
| T-06-13-05 | applies() is re-checked at execute. A test shows a changed state settles refused. |
| T-06-13-06 | An unknown result is never resent. A test shows one land call, with the audit failed "unconfirmed". |

## Requirements

None are ticked. ADMIN-01 still needs the web signing flow (06-15/06-18), ADMIN-03/04 need the dialog (06-18), and ADMIN-10 needs the audit panel (06-14). The worker halves of all four are done.

## Known Stubs

None.

## For the next plans

- Web `workerPost` rebuilds error bodies from `{ error, paused }` only, so the worker's `reason` on 409 not_applicable is dropped before it reaches the browser. If 06-15/06-18 need the reason, add `reason` to the rebuild in apps/web/lib/worker.ts.
- The execute route takes `{ id, signature }`, where signature is base64 of the raw 64-byte ed25519 signature over the UTF-8 message bytes. It answers 202 `{ id }`. The browser then polls POST /admin/intent `{ id }` until the state is no longer `sending`. Possible intent codes are destination_refused, unconfirmed, send_failed, `code N`, ops_low, build_failed, nothing_sent and not_applicable.
- For evacuate (06-22), `defOf` refuses any action that has no ACTIONS entry (409 not_applicable reason unknown_action), and the route's `TX` list excludes evacuate. Add both together.

## TDD Gate Compliance

Task 1 has `test(06-13)` 27cfe33 followed by `feat(06-13)` 6af8e58. Task 2 is `type="auto"`.

## Self-Check: PASSED
