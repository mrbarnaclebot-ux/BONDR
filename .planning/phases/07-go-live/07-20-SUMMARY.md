---
phase: 07-go-live
plan: 20
subsystem: ops scripts (setup, dev, verify, deploy) and the env-diff check
tags: [scripts, deploy, railway, env-diff]
requires: [07-19]
provides:
  - "scripts/setup.sh (pnpm setup:local), scripts/dev.sh (pnpm dev:all), scripts/test.sh (pnpm verify [--full]), scripts/deploy.sh (pnpm run deploy -- <env> [--yes] [--only web|worker] [--dry-run])"
  - "scripts/env-diff.ts: diffEnv, hashAll, policyFor(service, phase), report; CLI --from --to --service --phase g1|g3|g5"
affects: [07-22 PRODUCTION.md, 07-24 staging deploy, 07-26..07-35 gate plans (deploy.sh and env-diff)]
key-files:
  created:
    - scripts/setup.sh
    - scripts/dev.sh
    - scripts/test.sh
    - scripts/deploy.sh
    - scripts/env-diff.ts
    - scripts/env-diff.test.ts
  modified:
    - package.json
    - scripts/README.md
    - apps/web/e2e/shoot.ts
key-decisions:
  - "07-20: deploy.sh compares migrations against the working tree (untracked files included), since railway up uploads the working tree, and moves deployed-<env> only on a full deploy from a clean tree"
  - "07-20: env-diff applies ALLOW_MAINNET=1, FEE_ENGINE/ADMIN_EVACUATE present and the seed/quote-mint phase rules to the worker only; web gets the D-12 must-differ list alone"
  - "07-20: pnpm verify runs the smoke set against next start on port 3100 with E2E_NO_SHOTS=1, so a local run writes no -staging screenshots into .planning"
requirements-completed: []  # OPS-04 is ticked in 07-24, after the first real deploy.sh run on staging
duration: 50min
completed: 2026-10-26
---

# Phase 7 Plan 20: Scripts and env-diff Summary

**Four one-command scripts and a hash-only Railway variable check. deploy.sh orders web first when a migration changed since the local `deployed-<env>` tag, waits for each deployment to reach SUCCESS, and guards production (clean tree, `main`, typed "Type production to deploy to trybondr.fun" or `--yes`). env-diff hashes every value on read and prints only names, states and 8-character hashes.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | env-diff policy test (RED) | f6df5e4 |
| 1 | env-diff.ts (GREEN) | 0872655 |
| 2 | setup, dev, test and deploy scripts with package wiring | cbe358d |

## Evidence

- `pnpm exec vitest run scripts/env-diff.test.ts`: 9 passed. The test covers must-differ, pinata_jwt equal (D-12), a name the service lacks is skipped, must-be-absent, must-equal ALLOW_MAINNET, the g3/g5 rules, web without the worker rules, and a report that contains no raw value (every value of 6 or more characters is checked).
- Real CLI run, `node scripts/env-diff.ts --from staging --to staging --service web`: it read both sides through `railway variable list --json` and printed names, `same` and short hashes. It failed 6 must-differ checks, as expected when comparing staging with itself. No value was printed.
- `sh -n` passes on all four scripts.
- deploy.sh dry runs:
  - With no tag: web goes first.
  - With the tag set before 0008: "migrations changed", web goes first.
  - With the tag at HEAD: worker goes first.
  - With `--only worker`: the tag is not moved.
  - `production --dry-run --yes` off main refuses with exit 1. On a clean tree it says "production deploys only from main".
  - Bad arguments print the usage and exit 1.
- dev.sh: run for 30 s in its own session, it produced prefixed `[worker]` and `[web]` lines. A SIGINT stopped the whole group, with nothing left on ports 3000 or 8091.
- `sh scripts/test.sh` exited 0:
  - lint and typecheck: 0
  - Vitest: 106 files, 827 passed, 2 skipped
  - web build and check:bundle: 0
  - @smoke against next start: 32 passed
  - No screenshot changed.
- package.json `test` is still `vitest run`.

## Deviations from Plan

1. **[Rule 3 - Blocking] shoot.ts honours E2E_NO_SHOTS.** Any run with E2E_BASE_URL set writes `-staging` screenshots into the phase 6 and 7 dirs. A local `pnpm verify` would have dirtied `.planning` every time. The gates still run, but the shot is skipped. It is one line, and CI is unaffected.
2. **dev.sh prefixes with a `while read` loop, not sed.** sed block-buffers when its output is not a terminal, and the first check got an empty log. The read loop is plain sh.
3. **test.sh uses port 3100, not 3000.** A dev server may already be on 3000. It refuses to start if the port answers.

## Notes for later plans

- Run deploy as `pnpm run deploy -- ...` or `sh scripts/deploy.sh ...`. Plain `pnpm deploy` is pnpm's own command.
- The `deployed-<env>` tags are local and are not pushed. 07-24 creates `deployed-staging` on its first full staging deploy.
- deploy.sh needs `node` and the Railway CLI. It parses `railway deployment list --json` with node, not jq.

## Self-Check: PASSED

- All six created files exist.
- Commits f6df5e4, 0872655 and cbe358d are in `git log`.
