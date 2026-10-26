---
phase: 07-go-live
plan: 02
subsystem: database, admin
tags: [migration, security, schema, tdd]
requires: []
provides:
  - "Migration 0008_go_live (journal idx 8, snapshot 0008) applied to the Neon dev branch"
  - "coins.create_slot (bigint, decimal string via big()), coins.sniped_bps (integer) with check coins_sniped_bps (null or 0..10000)"
  - "launches_symbol_live partial index on launches (symbol, landed_at) where state <> 'failed'"
  - "admin_audit_no_truncate statement trigger plus REVOKE TRUNCATE ON admin_audit FROM CURRENT_USER"
  - "putIntent evicts expired, then the oldest executed intent, else throws 429 rate_limited"
  - "admin-signin.e2e.ts replay case"
affects: [07-07 sniped, 07-13 ticker cooldown, staging and production migrations]
key-files:
  created:
    - packages/core/migrations/0008_go_live.sql
    - packages/core/migrations/meta/0008_snapshot.json
  modified:
    - packages/core/migrations/meta/_journal.json
    - packages/core/src/schema.ts
    - packages/core/src/db-admin.test.ts
    - apps/worker/src/admin-intent.ts
    - apps/worker/src/admin-intent.test.ts
    - apps/web/e2e/admin-signin.e2e.ts
key-decisions:
  - "07-02: 0008 stays in schema.ts (289 lines); no schema split needed"
  - "07-02: the app role loses TRUNCATE on admin_audit, so TRUNCATE answers 42501 first; the statement trigger answers P0001 when the owner re-grants (A4 confirmed on PG 18: the 0007 guard reaches RAISE for a statement-level TRUNCATE, no guard rewrite needed)"
  - "07-02: a full intent store of live unused intents answers 429 rate_limited and evicts nothing"
requirements-completed: []
duration: 25min
completed: 2026-10-26
---

# Phase 7 Plan 02: Migration 0008 and the Phase 6 Security Follow-ups Summary

**Migration 0008 adds the sniped columns with their database check, the ticker cooldown partial index and the audit TRUNCATE guard, and it is applied to the dev branch. Simulate spam can no longer evict an intent the owner is about to sign, and sign-in replay is covered by an automated test.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Migration 0008 with sniped columns, the ticker index and the audit TRUNCATE guard | c7c0643, 95a6a10, fb49481 |
| 2 | Intent eviction order (IN-W-04) and the sign-in replay test (T-06-03-03) | 4f83ccb |

## Evidence

- Red first: the three new db-admin cases failed (TRUNCATE went through inside the rollback, sniped_bps unknown, index missing). The truncate ran inside the rollback-sentinel transaction, so nothing was lost, and the afterAll count check passed.
- `drizzle-kit generate --name go_live` wrote 0008 (2 ADD COLUMN, 1 CREATE INDEX, 1 ADD CONSTRAINT). The trigger and revoke are appended by hand after `--> statement-breakpoint`. `drizzle-kit check`: "Everything's fine".
- `pnpm db:migrate` printed `migrations applied`.
- db-admin.test.ts and db.test.ts: 23 passed. The afterAll check (admin_audit, blocked_deployers and coins counts equal before and after) held.
- `git diff --quiet HEAD -- packages/core/migrations/0007_admin.sql`: unchanged.
- admin-intent.test.ts: 11 passed. The 429 case and the "executed evicted before an older unused one" case both failed against the old code.
- admin-signin.e2e.ts (chromium, local, MASTER_SEED_FILE present): 6 passed, including the replay case. Nothing was skipped.
- `pnpm lint` and `pnpm typecheck` clean. schema.ts 289 lines, admin-intent.ts 141, db-admin.test.ts 234.

## Deviations from Plan

1. **[Rule 1 - Test correctness] The TRUNCATE case asserts both layers.** After `REVOKE TRUNCATE ... FROM CURRENT_USER`, the app role (the table owner, not a superuser on Neon) is refused with 42501 before any trigger runs, so a plain `expect P0001` could never pass. The case asserts 42501, then runs `GRANT TRUNCATE ON admin_audit TO current_user` inside the same rollback transaction (the owner can re-grant, which is what the revoke comment already says) and asserts P0001 from admin_audit_guard. The grant is rolled back with everything else.
2. **The replay e2e signs its own nonce instead of calling adminSignIn.** An APIResponse cannot return the body that was posted, so the test requests a nonce, signs it, and posts the same verify body twice, each time with a fresh x-real-ip.
3. **The new snapshot, the journal and db-admin.test.ts needed `biome format`.** drizzle-kit output does not match Biome's formatting, so two style commits followed. Later migrations: run `pnpm exec biome format --write` on the meta files after generate.

## Notes for later plans

- 0008 reaches staging and production with the next web deploy (the pre-deploy step runs migrations). The REVOKE applies to whichever role runs it.
- sniped_bps and create_slot are nullable and nothing writes them yet (07-07 does). They are not stubs that reach the UI.

## Self-Check: PASSED

- FOUND packages/core/migrations/0008_go_live.sql, packages/core/migrations/meta/0008_snapshot.json
- FOUND commits c7c0643, 95a6a10, fb49481, 4f83ccb
