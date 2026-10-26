---
phase: 07-go-live
plan: 22
subsystem: docs (production runbook, READMEs)
tags: [docs, runbook, production, incident]
requires: [07-20, 07-21]
provides:
  - "apps/worker/PRODUCTION.md (173 lines): sections 1 Environment, 1b Creating the environment, 2 Variables, 3 Neon, 4 Deploy, 5 Dark boot checklist, 6 Genesis and leaving genesis, 7 Owner gates G-1..G-11 plus Contract check mismatch, 8 Load measurement (D-14), 9 HV-05-02, 10 Seed leak: mainnet incident runbook"
  - "Root README.md (new): the four pnpm scripts and links to scripts/README.md and PRODUCTION.md"
affects: [07-24 (staging deploy section now names deploy.sh), 07-26..07-36 (each gate plan cites its PRODUCTION.md section)]
key-files:
  created:
    - apps/worker/PRODUCTION.md
    - README.md
  modified:
    - apps/worker/README.md
    - apps/worker/src/README.md
key-decisions:
  - "07-22: rollback is the Railway dashboard redeploy of the previous successful deployment, then a git revert on main; deploy.sh never deploys an old detached revision"
  - "07-22: the EVACUATE steps in the runbook name the typed phrase EVACUATE ALL W TO TREASURY and the Sign and evacuate N wallets button, as the console shows them"
requirements-completed: []  # ADMIN-11 was already complete (Phase 6); OPS-04 is ticked in 07-24; OPS-05 needs the mainnet genesis launch (G-5)
duration: 25min
completed: 2026-10-26
---

# Phase 7 Plan 22: Production runbook Summary

**apps/worker/PRODUCTION.md is the one production runbook. It covers:**
- the empty production environment, with no repo source and no auto-deploy
- every variable per service, by name only, with how to set secrets without echo
- the Neon branch plus a fresh database
- deploy.sh and env-diff per gate
- the dark boot log lines
- leaving genesis
- G-1 to G-11, each with its default, the owner action, Claude's commands and the verification
- the contract-check mismatch steps
- the D-14 thresholds and HV-05-02
- the five-step D-38 seed leak runbook

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | PRODUCTION.md with the gate checklist and the incident runbook | 32b5f04 |
| 2 | README links and src README lines | 3a38fc5 |

## Evidence

- The Task 1 verify passes. The file is 173 lines and contains every token the check looks for: G-1 to G-11, "Seed leak", env-diff, deploy.sh, HV-05-02, "Run check now passes", phase-07-gates and auto-deploy.
- `rg "base64|api-key=[A-Za-z0-9]"` matches only `openssl rand -base64` command text (3 lines: two for generated secrets, one in the owner's G-3 step). No value appears anywhere.
- The Task 2 verify passes:
  - Both READMEs link PRODUCTION.md.
  - Every new worker source file since main has a src README line. sniped.ts was the one missing; it is added.
  - apps/worker/README.md is 145 lines.
- `pnpm lint` exits 0.

## Deviations from Plan

1. **The root README.md did not exist.** I created a short one: the commands, the layout, and links to the runbooks. The plan assumed it existed.
2. **Staging deploy step in apps/worker/README.md.** It now names `sh scripts/deploy.sh staging` instead of the manual `railway up` pair. The env.ts line no longer says "refuses mainnet in Phase 2", and the env paragraph names the production values (ALLOW_MAINNET, TREASURY_PUBKEY, VANITY_LANE production, unset BONDR_QUOTE_MINT = genesis).

## Self-Check: PASSED

- apps/worker/PRODUCTION.md and README.md exist.
- Commits 32b5f04 and 3a38fc5 are in `git log`.
