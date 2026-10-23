---
phase: 02-launch-flow
plan: 04
subsystem: database
tags: [neon, drizzle, postgres, sentry, accounts]
requires: [02-01, 02-02, 02-03]
provides:
  - Neon project "bondr" (royal-waterfall-05278863, aws-us-east-1, Postgres 18) with branches main (staging) and dev (local)
  - DATABASE_URL (dev, direct) and DATABASE_URL_STAGING (main, direct) in the repo-root .env only
  - "@bondr/core/schema: wallets, settings, vanity_mints, launches with CHECK constraints and the landed-mint partial unique index"
  - "@bondr/core/db: db() lazy drizzle singleton (snake_case casing, idle_timeout 20) and close()"
  - "packages/core/src/migrate.ts: the only migration runner, under pg_advisory_lock(7242002)"
  - packages/core/migrations/0000_init.sql with the settings (1, true) seed, applied to dev
  - Root scripts db:generate and db:migrate
  - .env.example listing every Phase 2 name by service
affects: [02-05, 02-07, 02-08, 02-09, 02-14, 02-16]
tech-stack:
  added: ["drizzle-orm@0.45.3", "postgres@3.4.9", "drizzle-kit@0.31.11 (dev)"]
  patterns:
    - "Integrity in the database: CHECK lists for state and exit, settings CHECK id = 1, partial unique index on launches(mint) WHERE state = 'landed'"
    - "drizzle casing snake_case in both db() and drizzle.config.ts: camelCase keys in TS, snake_case columns in SQL"
    - "Secrets go from CLI output to .env inside one node process; nothing is echoed"
key-files:
  created:
    - packages/core/src/schema.ts
    - packages/core/src/db.ts
    - packages/core/src/migrate.ts
    - packages/core/src/db.test.ts
    - packages/core/drizzle.config.ts
    - packages/core/migrations/0000_init.sql
    - packages/core/migrations/meta/_journal.json
    - packages/core/migrations/meta/0000_snapshot.json
  modified:
    - .env.example
    - package.json
    - packages/core/package.json
    - packages/core/src/README.md
    - pnpm-lock.yaml
decisions:
  - "Neon project created in the existing Launch-plan org (pay as you go), approved by the owner (option A)"
  - "Both Neon computes fixed at 0.25 CU with the default suspend (scale to zero after 5 min idle)"
  - "Column names are snake_case through drizzle casing, not per-column names"
  - "db.test.ts loads the root .env itself (vitest does not) and skips when DATABASE_URL is unset, so CI stays offline"
  - "OPS-01 Sentry project creation is pending: sentry_auth_token is not in .env yet"
metrics:
  duration: ~2.5 h wall clock, including two owner checkpoints
  completed: 2026-10-19
  tasks: 3
  files: 13
---

# Phase 2 Plan 04: Neon, schema and migration Summary

The Neon project "bondr" exists with a main (staging) branch and a dev branch. Its direct URLs are only in .env. The shared Drizzle schema, the `db()` client and the advisory-locked migration runner are in core, and the first migration is applied to dev. The database itself refuses unknown states and exits, a second landed launch of the same mint, and a second settings row. The Sentry projects are not created yet because `sentry_auth_token` is still missing (pending-token).

## Approvals

- Task 1, as relayed by the orchestrator: on 2026-10-19 the owner chose **"Approve both"**. That covers (1) the Neon project "bondr" (free tier, US East region, branches main=staging and dev=local) and (2) the two Sentry projects "bondr-web" (javascript-nextjs) and "bondr-worker" (node).
- Billing, as relayed by the coordinator on 2026-10-19: the only Neon org that can create projects is on the Launch plan, not Free, so I stopped and asked. The owner chose **option A**: create "bondr" in the existing Launch-plan org ("mrbarnaclebot@gmail.com"). The owner **accepts pay-as-you-go billing and understood the estimate (about $0.106 per compute hour, scale to zero)**.

## Accounts created (no secrets)

| Item | Value |
|------|-------|
| Neon org | org-patient-pine-24176162 (Launch plan) |
| Neon project | bondr, id royal-waterfall-05278863, aws-us-east-1, Postgres 18 |
| Branch main (staging, default) | br-solitary-sunset-b7z1fmwh, 0.25 CU fixed, suspend default (5 min) |
| Branch dev (local and tests) | br-nameless-river-b7psslne, parent main, 0.25 CU fixed, suspend default (5 min) |
| Connection strings | direct (non-pooled) for both, checked against `-pooler`; in .env as DATABASE_URL (dev) and DATABASE_URL_STAGING (main) |
| Sentry org / projects | not created yet: pending-token |

I applied migrations to dev only. Staging gets them from the Railway pre-deploy in 02-16.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Owner approval checkpoint | resolved by the owner, no commit |
| 2 | .env.example by service | 5079be2 |
| 2 | Neon project and branches, .env URLs | no repo change (.env is gitignored) |
| 3 | Schema, client, runner, init migration | 9eb8764 |
| 3 | Seed in beforeAll, cold-start timeout | e0a3214 |

## Verification

- `pnpm db:migrate`: "migrations applied", twice (the second run is a no-op).
- `pnpm vitest run packages/core/src/db.test.ts`: 3 passed, run against the dev branch, none skipped. The constraint tests check SQLSTATE 23514 (check violation) and 23505 (unique violation) exactly, not just "some error".
- After the tests, the dev branch has 0 wallets, 0 vanity_mints and 0 launches, one settings row and one recorded migration.
- `pnpm test` (30 passed), `pnpm lint` and `pnpm typecheck` all exit 0.
- .env check: DATABASE_URL and DATABASE_URL_STAGING are set, NEXT_PUBLIC_SENTRY_DSN and SENTRY_DSN are not (pending-token). `git status --porcelain .env` is empty, and the .env.example diff contains no URL or DSN. The 8-name acceptance grep matches 8 lines.
- Migration SQL contains: CHECK constraints `launches_state`, `launches_exit` and `settings_single_row`; `CREATE UNIQUE INDEX "launches_landed_mint" ... WHERE state = 'landed'`; and the seed `INSERT INTO "settings" ... ON CONFLICT DO NOTHING`.
- Freshness, against the 14-day cutoff of 2026-10-05: drizzle-orm 0.45.3 and drizzle-kit 0.31.11 were published 2026-09-21, postgres 3.4.9 on 2026-04-05.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used neonctl instead of the Neon MCP**
- **Found during:** Task 2
- **Issue:** The executor had no way to load the Neon MCP tools (no tool search).
- **Fix:** Used `neonctl` 8.8.0, which was already logged in, with `--no-secrets` on project creation. Connection strings went from `neonctl connection-string` straight into .env inside one node process. I read endpoint settings from the Neon API with the CLI's stored token, without printing it.

**2. [Rule 4 - Asked] Neon org is on the paid Launch plan**
- **Found during:** Task 2
- **Issue:** The approval said "free tier", but the only org that can create projects is on the Launch plan, and the personal account has `projects_limit: 0`.
- **Outcome:** I stopped at a decision checkpoint. The owner chose option A, quoted above.

**3. [Rule 1 - Bug] db test seed timed out on a Neon cold start**
- **Found during:** Task 3, first run against dev
- **Issue:** The first insert, which woke the compute and opened TLS to us-east-1, took longer than vitest's 5 s default.
- **Fix:** The seed rows moved into `beforeAll`, and the suite timeout is 30 s. afterAll cleaned up after the failed run, which I confirmed by the row counts.
- **Commit:** e0a3214

**4. [Rule 2] Extra settings check in the test**
- The test also checks that inserting settings id 2 fails with 23514, so the single-row constraint has a runnable check.

### Not done

- **OPS-01 Sentry (pending-token):** `sentry_auth_token` was missing every time I checked, including right before the plan ended. Once the owner adds it, the remaining step is a scratchpad node script run with `node --env-file=.env`. It finds the org and a team, creates bondr-web (javascript-nextjs) and bondr-worker (node), and appends NEXT_PUBLIC_SENTRY_DSN and SENTRY_DSN to .env. 02-14 needs these DSNs.

- **Requirements left Pending:** PLAT-02 (consent prompt) and LAUNCH-06 (paused state the dev sees) are user-facing. This plan adds only their storage, and plans 05, 06, 08, 17 and 18 finish them. I reverted the automatic mark-complete in REQUIREMENTS.md. OPS-01 stays Pending.

## TDD Gate Compliance

There is no separate RED commit, as the orchestrator instructed. Without a database the db test skips, so RED was not observable locally before Neon existed. The test and the implementation landed together in 9eb8764, and the test first ran for real against dev in e0a3214. No failing test was ever committed.

## Threat Flags

None beyond the plan's threat model. No URL, token or DSN was printed or committed.

## Self-Check: PASSED

- Files: schema.ts, db.ts, migrate.ts, db.test.ts, drizzle.config.ts, migrations/0000_init.sql and both meta files are present.
- Commits: 5079be2, 9eb8764 and e0a3214 are present on phase-02-launch-flow.
