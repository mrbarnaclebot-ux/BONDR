---
phase: 06-admin-dashboard
plan: 01
subsystem: database, e2e harness
tags: [schema, migration, e2e-red, harness, tdd]
requires: []
provides:
  - apps/web/e2e/keys.ts (accountFromSeed, seedAccount, rootEnv without @playwright/test)
  - phantom.ts adminAccount and adminSignIn
  - playwright.config.ts ADMIN_WALLET injection and the admin-serial project
  - PHASE6_SHOTS
  - red admin-signin.e2e.ts (turns green in 06-03)
  - migration 0007 (settings switches, coins hide and hold, blocked_deployers, admin_audit with guard trigger, fee_ledger leftover_burn and evacuate kinds, per-mint sig_kind)
affects: [06-02, 06-03, every plan that writes admin_audit, fee_ledger evacuate or leftover_burn rows]
tech-stack:
  added: []
  patterns: [rolled-back transaction per DB case with savepoint attempts, hand-written trigger appended to a generated migration]
key-files:
  created:
    - apps/web/e2e/keys.ts
    - apps/web/e2e/admin-signin.e2e.ts
    - packages/core/src/schema-admin.ts
    - packages/core/src/db-admin.test.ts
    - packages/core/migrations/0007_admin.sql
    - packages/core/migrations/meta/0007_snapshot.json
  modified:
    - apps/web/e2e/phantom.ts
    - apps/web/e2e/shoot.ts
    - apps/web/e2e/README.md
    - playwright.config.ts
    - apps/web/next.config.ts
    - .env.example
    - packages/core/src/schema.ts
    - packages/core/src/db.test.ts
    - packages/core/src/README.md
    - packages/core/migrations/meta/_journal.json
decisions:
  - "06-01: admin_audit.mint has no foreign key, so dropping a coin never touches the log"
  - "06-01: hide, hold and block reasons are capped at 1 to 120 characters by CHECK"
  - "06-01: the D-33 transition guard is the admin_audit_guard trigger (no DELETE; one UPDATE from pending to a final result with actor, action, at, mint, params, simulation and intent_sig unchanged), hand-written in 0007"
  - "06-01: the manual hold is coins.held_at and held_reason, separate from finalize = 'held' (A4)"
  - "06-01: schema-admin.ts defines its own tstz instead of importing from schema.ts; schema.ts re-exports it, so an import back would be an ESM cycle evaluated before schema.ts runs"
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 2
  files: 16
---

# Phase 6 Plan 01: Admin harness, red sign-in spec and migration 0007 Summary

The owner sign-in path is pinned by a 5-test red Playwright spec with a seed-derived admin key injected into both local servers, and migration 0007 (applied to the Neon dev branch) makes Postgres enforce every Phase 6 integrity rule: job switches, hide and hold pairs, blocked deployers, an append-only audit log guarded by a trigger, and the per-mint fee_ledger signature index EVACUATE needs.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Admin e2e harness and the failing sign-in spec | dd44368 |
| 2 | Migration 0007 with the admin tables, switch, hide and hold columns and the ledger widening | 6afd0c4 |

## Task 1 notes

- `keys.ts` holds `accountFromSeed`, `seedAccount`, `rootEnv` and `TestAccount`; `phantom.ts` re-exports them, so every existing import still works. `pnpm exec playwright test --list` lists 304 tests in 29 files (the previous 299 plus the 5 new ones).
- `playwright.config.ts` derives `seedAccount("admin:devnet:e2e").address` in a try (undefined without MASTER_SEED_FILE) and sets it as ADMIN_WALLET on webEnv and on the worker webServer env. Only the public address leaves the seed file. `admin-serial` runs `admin-switch.e2e.ts` and `admin-moderation.e2e.ts` after `paused`; both are in chromium's testIgnore.
- Red run (`pnpm exec playwright test apps/web/e2e/admin-signin.e2e.ts --project=chromium`): exit 1, 5 failed, for the right reason:
  - tests 1, 2, 3: `expect(locator).toBeVisible() failed ... element(s) not found` for h1 "Owner console" (no /admin route)
  - test 4: `Expected: 401, Received: 404` on POST /api/admin/health
  - test 5: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` (the admin session route returns the 404 page)
- Every test sits inside `test.describe("admin-signin")`, so Playwright runs before 06-03 use `--grep-invert admin-signin`.

## Task 2 notes

- RED: `db-admin.test.ts` failed before the schema existed (`select count(*) as count from ;`, the admin tables were undefined).
- `pnpm db:migrate` output: `migrations applied` (0007 on the dev branch; `admin_audit_guard` present in pg_trigger).
- GREEN: `pnpm vitest run packages/core/src/db-admin.test.ts packages/core/src/db.test.ts`: 2 files, 19 tests passed. Every behavior bullet asserts its SQLSTATE (23514, 23505, P0001).
- Row counts before and after the run: admin_audit 0 and 0, blocked_deployers 0 and 0 (asserted in the file's afterAll too). No `test-` wallets, coins or vanity_mints left.
- `rg -c "admin_audit_guard|fee_ledger_sig_kind|blocked_deployers|evacuated_at" 0007_admin.sql` = 8; coins_held and 'evacuate' present.

## Verification

- `pnpm lint`: clean (319 files)
- `pnpm typecheck`: pass
- `pnpm test`: 60 files passed, 438 tests passed, 2 skipped, 0 failed (no flakes, no reruns)
- `pnpm exec playwright test --list`: 304 tests in 29 files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] db.test.ts settings assertion broke on the new columns**
- **Found during:** Task 2
- **Issue:** the plan says db.test.ts is not edited, but its settings test did `select()` of every column and `toEqual([{ id: 1, launchesEnabled: true }])`, which fails once settings has the switch columns.
- **Fix:** select only `id` and `launchesEnabled` there (4 lines). The new columns are asserted in db-admin.test.ts.
- **Commit:** 6afd0c4

**2. [Rule 3 - Blocking] schema-admin.ts cannot import tstz from schema.ts**
- **Found during:** Task 2
- **Issue:** schema.ts ends with `export * from "./schema-admin.ts"`, so ESM evaluates schema-admin.ts first; importing `tstz` back from schema.ts would throw (TDZ) at load.
- **Fix:** schema-admin.ts defines its own one-line `tstz` and imports nothing from schema.ts (no FK is needed from either new table).
- **Commit:** 6afd0c4

**3. [Rule 3 - Blocking] drizzle-kit snapshot formatting**
- **Issue:** the generated `0007_snapshot.json` and `_journal.json` failed `biome ci`; the earlier snapshots are biome-formatted.
- **Fix:** `biome format --write packages/core/migrations/meta`.

### Process note

- TDD RED for Task 2 was run and observed but not committed as a separate red commit, per the project precedent (01-01) that AGENTS.md forbids red commits that break `pnpm test`. Task 1's red spec is committed because the plan requires it and `pnpm test` never collects `*.e2e.ts`.

## For the next plans

- `memoryLedger.keysOf` in the worker (`fee-ledger.ts`) still mirrors the old `(signature, kind)` key; Pitfall 3 says it must mirror `(signature, kind, mint)`. Not in this plan's files.
- `leftover_burn` and `evacuate` exist only in the DB check so far: `PUBLIC_KINDS`, `totalsFor`, reconcile and `ledger-copy.ts` still need them (D-17, D-36).
- The admin_audit action list must stay identical to `AdminAuditAction` in api-admin.ts (06-02).
- Until 06-03 lands, add `--grep-invert admin-signin` to any Playwright run.

## Self-Check: PASSED

- FOUND: apps/web/e2e/keys.ts, apps/web/e2e/admin-signin.e2e.ts, packages/core/src/schema-admin.ts, packages/core/src/db-admin.test.ts, packages/core/migrations/0007_admin.sql
- FOUND: commits dd44368, 6afd0c4
