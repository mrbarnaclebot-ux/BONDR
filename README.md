# BONDR

A pump.fun launchpad where every coin is quoted in BONDR and the dev holds no launch supply. The plan and decisions live in `.planning/` (PROJECT.md, ROADMAP.md).

## Commands

From the repo root (node 24, pnpm 10):

- `pnpm setup:local`: install, create `.env` from `.env.example`, create the local seed files, migrate when `DATABASE_URL` is set.
- `pnpm dev:all`: worker and web together with prefixed logs; Ctrl-C stops both.
- `pnpm verify`: the CI steps locally (lint, typecheck, Vitest, web build, bundle check, the `@smoke` Playwright set); `pnpm verify --full` adds every Playwright spec. `pnpm test` is Vitest alone.
- `pnpm run deploy -- <staging|production> [--dry-run]`: deploy to Railway in migration-safe order. Production needs a clean `main` and a typed confirmation.

Details for each script: [scripts/README.md](scripts/README.md).

## Layout

- `apps/web`: the Next.js site (reads Postgres, calls the worker).
- `apps/worker`: the only process that holds keys and touches the chain. Staging: [apps/worker/README.md](apps/worker/README.md). Production runbook: [apps/worker/PRODUCTION.md](apps/worker/PRODUCTION.md).
- `packages/core`: shared chain, math, rules and database code.
- `scripts`: one-command tools and the Phase 1 chain spike.
