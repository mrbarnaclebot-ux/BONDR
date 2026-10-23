---
phase: 02-launch-flow
plan: 02
subsystem: web-terms-e2e
tags: [terms, playwright, e2e]
requires: [02-01]
provides:
  - Root playwright.config.ts (testDir apps/web/e2e, *.e2e.ts, chromium Desktop Chrome UA, web dev server with WEB_ENV only)
  - Root "e2e" script (playwright test)
  - /terms static page, D-07 draft sections 01-08, sticky "On this page" nav at 768 and up
  - apps/web/e2e/terms.e2e.ts (footer link, sections, skip link, no horizontal scroll at 390/768/1440, DEVNET badge)
affects: [02-05, 02-07, 02-14, 02-15, 02-16, 02-17, 02-18]
tech-stack:
  added: ["@playwright/test@1.63.0", "@axe-core/playwright@4.13.0"]
  patterns:
    - "playwright.config.ts imports WEB_ENV from apps/web/next.config.ts; that import runs the allowlist loader, so the runner and the server it spawns see only the web names"
    - "Static copy as a data array rendered by one small section component"
key-files:
  created:
    - playwright.config.ts
    - apps/web/app/terms/page.tsx
    - apps/web/e2e/terms.e2e.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - tsconfig.json
    - apps/web/next.config.ts
decisions:
  - "WEB_ENV is imported, not duplicated: one list for the web process and the e2e harness"
  - "next.config.ts resolves the root .env from its own file (import.meta.url), not process.cwd(), so importing it from the repo root reads the right file"
  - "agentRules: false in next.config.ts: Next 16 dev otherwise writes apps/web/AGENTS.md and CLAUDE.md on every run"
metrics:
  duration: ~20 min
  completed: 2026-10-19
  tasks: 2
  files: 7
---

# Phase 2 Plan 02: Playwright harness and terms page Summary

This plan adds a Playwright harness whose web server gets only the WEB_ENV names, and a static /terms page with the D-07 draft verbatim. The terms e2e passes at 390, 768 and 1440, both with and without devnet.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Playwright harness without root secrets | 8234bd3 |
| 2 | Terms e2e (RED) | 58d1732 |
| 2 | Terms page (GREEN) | 4114584 |

## Verification

- `pnpm vitest run` (27 passed), `pnpm lint`, `pnpm typecheck` and `pnpm --filter @bondr/web build` all exit 0.
- `pnpm exec playwright test apps/web/e2e/terms.e2e.ts`: 6 passed. The suite also passes with `SOLANA_NET=devnet` (badge-visible branch).
- RED: before the page existed the run failed, because the server never reported ready (`/terms` returned 404).
- Env scope: importing playwright.config.ts with the real root .env adds only `pinata_jwt` to process.env. `helius_api_key`, `pinata_api_key` and `pinata_secret_api_key` stay out. There is no `loadEnvFile` in the config. Playwright 1.63 builds the server env as `{...process.env, ...webServer.env}`, so keeping the runner's own env clean is what protects the server.
- Ad-hoc axe scan (temporary spec, not committed): 0 violations on /terms at 390, 768 and 1440.
- Screenshots at 1440 and 390 match consent.html's terms half. They are not committed; designer sign-off is at 02-18.
- Freshness (14-day cutoff 2026-10-05): @playwright/test 1.63.0 was published 2026-09-04, @axe-core/playwright 4.13.0 on 2026-08-11, and the transitive deps playwright and playwright-core 1.63.0 on 2026-09-04 and axe-core 4.13.0 on 2026-08-05. Chromium headless shell 153.0.8010.12 is installed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Root .env path in next.config.ts was cwd-relative**
- **Found during:** Task 1
- **Issue:** `join(process.cwd(), "../../.env")` points outside the repo when next.config.ts is imported from the root, as the Playwright config does. It would have read `<repo>/../../.env`.
- **Fix:** `fileURLToPath(new URL("../../.env", import.meta.url))`. A probe confirmed that `next dev` resolves the repo .env, and `next build` passes.
- **Commit:** 8234bd3

**2. [Rule 3 - Blocking] Next 16 dev writes agent files into apps/web**
- **Found during:** Task 1
- **Issue:** `next dev`, which the e2e server runs, creates `apps/web/AGENTS.md` and `CLAUDE.md` whenever it detects an agent. Every e2e run would leave untracked files that shadow the root AGENTS.md.
- **Fix:** `agentRules: false` in next.config.ts. This is the documented opt-out, typed in NextConfig. I deleted the two generated files.
- **Commit:** 8234bd3

**3. [Rule 3 - Blocking] playwright.config.ts added to the root tsconfig include**
- The root typecheck would not otherwise cover the config.
- **Commit:** 8234bd3

## Notes for later plans

- The webServer readiness URL is `/terms`, so it waits for a 2xx response. Start dev yourself and set `reuseExistingServer`, or set `E2E_BASE_URL` to skip the server.
- Specs read `process.env.SOLANA_NET` and the other WEB_ENV names because the config import loads them into the runner. Values outside the allowlist (seed path, DATABASE_URL for direct DB checks if not on the list) still need the 02-05 helper.
- Section anchors are `#t01` to `#t08`. The consent checkbox link in 02-05 targets `/terms`.
- `@axe-core/playwright` is installed but no committed spec uses it yet. The responsive and a11y spec in a later plan owns the axe gate.

## Requirements

PLAT-03 and PLAT-04 are not ticked. 02-05 adds the consent-prompt link to /terms, and the full-site responsive and axe gate comes later (02-18 sign-off).

## Known Stubs

None. The terms copy is the D-07 draft and is intentionally pending owner review at 02-18. The contact is "@BONDR on X (handle to be confirmed before go-live)".

## Self-Check: PASSED

- playwright.config.ts, apps/web/app/terms/page.tsx and apps/web/e2e/terms.e2e.ts are present.
- Commits 8234bd3, 58d1732 and 4114584 are on phase-02-launch-flow.
