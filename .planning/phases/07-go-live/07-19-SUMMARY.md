---
phase: 07-go-live
plan: 19
subsystem: ci (GitHub Actions) and the e2e smoke set
tags: [ci, github-actions, postgres, smoke, playwright]
requires: [07-03, 07-18]
provides:
  - ".github/workflows/ci.yml: on push and pull_request, postgres:18.6 service, a non-superuser bondr role, migrate, lint, typecheck, pnpm test, web build, check:bundle, @smoke against next start, artifact on failure"
  - "@smoke tag on 32 worker-free tests in six specs"
affects: [G-1 merge to main (needs a green CI run), 07-20 scripts (test.sh mirrors the CI steps)]
key-files:
  created:
    - .github/workflows/ci.yml
  modified:
    - apps/web/e2e/terms.e2e.ts
    - apps/web/e2e/wallet.e2e.ts
    - apps/web/e2e/admin-locked.e2e.ts
    - apps/web/e2e/launch-form.e2e.ts
    - apps/web/e2e/home.e2e.ts
    - apps/web/e2e/launch-paused.e2e.ts
    - apps/web/e2e/fee-devnet.e2e.ts
    - apps/web/e2e/README.md
key-decisions:
  - "07-19: CI runs the DB suites as a plain owner role (bondr), not the container superuser, because a superuser bypasses the admin_audit TRUNCATE revoke the way Neon's app role never does"
  - "07-19: no dummy SESSION_SECRET or WORKER_TOKEN in CI; the smoke set passes with every web variable unset"
requirements-completed: []  # OPS-03 closes when the GitHub run is green (blocked on account billing)
duration: 35min
completed: 2026-10-26
status: blocked-owner (GitHub Actions billing)
---

# Phase 7 Plan 19: CI Summary

**The CI workflow is written and every step passes in a local emulation: a fresh clone with no .env, on a throwaway PostgreSQL 18 cluster. GitHub has not run it. Both pushes to `phase-07-go-live` were refused before the job started: "The job was not started because recent account payments have failed or your spending limit needs to be increased." This is an owner billing action, and I did not touch billing. OPS-03 stays unticked until a run is green.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tag the smoke set and prove it locally against next start | 4f56961 |
| 2 | ci.yml with the Postgres service (first push) | 185c2cf |
| 2 | Non-superuser DB role, fee-devnet lazy seed (fixes from the emulation) | 9839ce9 |

## Evidence

The smoke set:
- 32 tests tagged:
  - terms: 7
  - wallet: 7
  - admin-locked: 5
  - launch-form step 1: 7
  - home hero without the pulse line: 4
  - launch-paused genesis and contract_check: 2
- `rg -c @smoke` is non-zero in all six files.
- Against `next start` with no worker, an unreachable DB and every WEB_ENV name empty: 32 passed in about 10 s.

The CI emulation, run in a `git clone --local` copy with no .env, with CI=true and DATABASE_URL on local PostgreSQL 18.1:
- `pnpm install --frozen-lockfile` passed, `node packages/core/src/migrate.ts` printed "migrations applied", and `pnpm lint` and `pnpm typecheck` exited 0.
- First `pnpm test`, as the superuser: 1 failed. db-admin.test.ts expected 42501 on `truncate admin_audit` and got P0001, because a superuser bypasses the revoke. RESEARCH Pattern 11 predicted this.
- As a plain owner role `bondr`: 105 files, 818 passed, 2 skipped, in about 17 s. This is now the ci.yml setup.
- `pnpm --filter @bondr/web build` and `pnpm check:bundle` exited 0.
- First smoke run: the whole run errored at load. fee-devnet.e2e.ts called `seedAccount` at module top level, and Playwright loads every file even under `--grep`. After the fix: 32 passed in about 7 s.
- Static plan checks pass: the file has postgres:18.6 and check:bundle, and contains no `env-file` and no `secrets.`.
- The `docker exec ... psql` role step itself only runs on GitHub, so it is untested here.

GitHub: runs 40331597503 and 40332148354 both concluded failure in 3 to 4 s, with the billing annotation above. No step ran.

## Deviations from Plan

1. **[Rule 1 - Bug] fee-devnet.e2e.ts read MASTER_SEED_FILE at module load.** Without a seed, that broke every Playwright run. The keys are now derived only when `E2E_DEVNET=1` and a DB are present. admin-devnet.e2e.ts has the same pattern, but chromium ignores that file, so I left it alone.
2. **[Rule 3 - Blocking] CI's DB role.** The container's `postgres` superuser made db-admin fail, and only because of the superuser. ci.yml now creates a non-superuser `bondr` role and database, which matches Neon's app role, and runs migrate and the tests as that role. I did not weaken any assertion.
3. **actions/upload-artifact@v7** is the current major (v7.0.2), checked with `gh api`.

## Owner Action Needed

Fix GitHub billing for mrbarnaclebot-ux. The repo is private, so Actions minutes are billed: either clear the failed payment or raise the spending limit. Then re-run:
- `gh run rerun 40332148354`, or push again.
- `gh run watch --exit-status` on the newest run.

The plan's verify command (`gh run list ... conclusion == success`) passes only after that.

## Known Stubs

None.

## Self-Check: PASSED (code and local proof); GitHub green run BLOCKED (billing)
