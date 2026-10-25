---
phase: 06-admin-dashboard
plan: 19
subsystem: worker, core
tags: [moderation, hide, block, worker, core]
requires: [06-10, 06-13]
provides:
  - "apps/worker/src/admin-moderate.ts: moderate, modReq, blocked, pgMod, memoryMod, ModStore, ModInput"
  - "POST /admin/moderate (gated): {op, query?, mint?, wallet?, reason?} -> ModerationResult (refusals answer 200 {ok:false, reason, count?})"
  - "core coinRows excludes hidden coins; coinRow unchanged"
  - "prepare admit refuses a blocked wallet with 403 blocked before prepareGuard"
affects: [06-20, 06-26]
tech-stack:
  added: []
  patterns: [audit row after validation and before the change, as admin-act; reason-code refusals as 200 answers]
key-files:
  created:
    - apps/worker/src/admin-moderate.ts
    - apps/worker/src/admin-moderate.test.ts
  modified:
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/prepare.ts
    - apps/worker/src/prepare.test.ts
    - apps/worker/src/prepare-flow.test.ts
    - apps/worker/src/README.md
    - packages/core/src/coin-row.ts
    - packages/core/src/db-admin.test.ts
    - vitest.config.ts
decisions:
  - "06-19: moderation audits before the change (project rule), so block and unblock read isBlocked first; block still inserts on conflict do nothing returning, so a racing second block answers already_blocked"
  - "06-19: unhide and unblock of something not hidden or not blocked answer no_match (ModerationResult has no not_hidden code)"
  - "06-19: an exact mint match wins over symbol matches; hide counts every symbol match for ambiguous, unhide counts only hidden ones"
  - "06-19: the route caps every string field at 200 characters (400 above); reasons of 121 to 200 characters answer no_reason from moderate"
  - "06-19: AdminOpts.mod is a test seam like money; modReq runs before mod() so a bad body never builds a store"
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 2
  files: 11
---

# Phase 6 Plan 19: Moderation worker and core Summary

The worker can now hide and unhide a coin by symbol or mint, and block and unblock a deployer wallet, through the gated POST /admin/moderate. Each change writes one landed audit row. Core `coinRows` drops hidden coins from every public list. Launch prepare refuses a blocked wallet with 403 `blocked` before any other guard.

## What was built

- `admin-moderate.ts` (174 lines):
  - `moderate(store, audit, input)` runs the four ops.
  - `modReq(body)` validates the route body.
  - `pgMod(exec)` uses drizzle on `coins` joined to `launches.symbol` (case-insensitive) and `blocked_deployers`.
  - `memoryMod(seed)` backs the unit tests.
  - `blocked(exec, wallet)` is prepare's single indexed read.
- Refusal codes: `no_reason` (empty, whitespace or over 120), `no_match`, `ambiguous` with `count`, `already_hidden`, `invalid_wallet`, `already_blocked`. None of them writes anything.
- Audit params:
  - hide: `{mint, reason}`
  - unhide: `{mint}`
  - block: `{wallet, reason}` with mint null
  - unblock: `{wallet}` with mint null
- These match the `params.wallet` key that 06-14's audit copy reads.
- `admin-routes.ts`: `"POST /admin/moderate"` is in the gated route map, so the table test now lists nine routes.
- `prepare.ts` (293 lines): `blocked(db(), wallet)` joins the existing `Promise.all` of admission reads, and `if (isBlocked) throw fail({ error: "blocked" })` comes before `prepareGuard`. No extra round trip, and wallets that are not blocked see no change.
- `coin-row.ts`: `coinRows` uses `and(isNull(coins.hiddenAt), where)`. `coinRow` (token page, proof, ledger, announce) is untouched. The web admin W table has its own query and still lists hidden coins.

## Verification

- `pnpm vitest run apps/worker/src/admin-moderate.test.ts apps/worker/src/admin-routes.test.ts`: 12 passed. This includes one rolled-back Neon case covering pgMod and pgAudit: symbol hide, already_hidden, unhide, block, a second block returning false, and unblock.
- `pnpm vitest run apps/worker/src/prepare.test.ts packages/core/src/db-admin.test.ts packages/core/src/db.test.ts`: 29 passed. db.test.ts is unchanged.
- `pnpm lint` and `pnpm typecheck`: clean.
- Full `pnpm test`: 82 files, 620 passed, 2 skipped.
- Leak check after the run: 0 rows in blocked_deployers, 0 `test-actor` audit rows, 0 `test-%` coins.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] prepare-flow.test.ts stubs the new blocked read**
- **Found during:** Task 2 (full suite)
- **Issue:** prepare-flow.test.ts mocks `db()` as `{}`, so the new `blocked(db(), wallet)` call threw `exec.select is not a function` in 4 tests.
- **Fix:** Added a `vi.mock("./admin-moderate.ts")` with `blocked: async () => false`, the same way that file stubs the other admission reads.
- **Commit:** 5768012

**2. [Project rule] Audit before the change for block and unblock**
- **Issue:** The plan says already_blocked needs no read because block uses insert on conflict. The project rule says moderation is audited first.
- **Fix:** block and unblock read `isBlocked` first, then write the audit row, then make the change. The insert still uses on conflict do nothing returning, as a race guard. This is one small indexed read on an admin-only action.
- **Commit:** c85286d

**3. [Rule 2] admin-moderate.test.ts added to the DB list in vitest.config.ts**
- **Issue:** The file has a rolled-back Neon case for the real SQL (lower(symbol), on conflict, delete returning), which is not in the plan.
- **Fix:** Added the file to the DB list.
- **Commit:** c85286d

## Known Stubs

None.

## Next plan (06-20) must know

- Contract as built:
  - `moderate(store, audit, { actor, op, query?, mint?, wallet?, reason? })`
  - `ModStore` has `coinsBy`, `setHidden`, `block`, `unblock` and `isBlocked`.
  - POST /admin/moderate answers 200 `{ok:true}` or `{ok:false, reason, count?}`, and 400 `invalid_input` for a bad op or a string field over 200 characters.
- `FORWARD` in `apps/web/app/api/admin/[op]/route.ts` already maps `moderate` to `/admin/moderate`, so the web side needs no route change.
- Unhide and unblock answer `no_match` when nothing is hidden or blocked.
- The launch UI still needs the copy for `blocked` ("This wallet cannot launch coins on BONDR."). The worker answers 403 with `{ error: "blocked" }`.

## Self-Check: PASSED

- FOUND: apps/worker/src/admin-moderate.ts, apps/worker/src/admin-moderate.test.ts
- FOUND commits: c85286d, 6cd320b, 5768012
