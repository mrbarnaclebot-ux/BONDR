---
phase: 07-go-live
plan: 24
subsystem: staging deploy and regression (devnet)
tags: [staging, deploy, railway, devnet, regression]
requires: [07-22, 07-23, 07-20]
provides:
  - "Staging (devnet) runs the Phase 7 build at 5b26c35; local tag deployed-staging = 5b26c35"
  - "First real deploy.sh run: web b499d4c9 then worker 53181acd, both SUCCESS"
affects: [07-25 (evidence map, merge), 07-26 G-1 (deploy.sh proven before production)]
key-files:
  created:
    - .planning/phases/07-go-live/screenshots/admin-locked-{390,768,1440}-staging.png
    - .planning/phases/07-go-live/screenshots/launch-genesis-banner-{390,768,1440}-staging.png
  modified:
    - apps/web/e2e/README.md
key-decisions:
  - "07-24: the staging cooldown proof uses a real landed staging launch (devnet-launch.ts against the staging DB and lane) and a throwaway consented wallet through the real pin and prepare routes; the test wallet row is deleted afterwards"
requirements-completed: [OPS-04]
duration: 45min
completed: 2026-10-26
---

# Phase 7 Plan 24: Staging redeploy and regression Summary

**Staging runs the Phase 7 build on devnet. It was deployed by `scripts/deploy.sh staging`, web first because the `deployed-staging` tag did not exist yet (0008 was also new on staging). Web's pre-deploy applied 0008, including the TRUNCATE revoke. The worker then booted with the devnet contract check passing, every switch unchanged and the fee engine on, and it shows no `Transaction version (1)` line. Every matrix passes as it did in 06-26. The cooldown check refuses a ticker that landed in the last 24h with 409 `ticker_locked`. Neon went idle afterwards, and the phase's devnet spend is about 0.054 SOL.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Deploy staging with deploy.sh and check the boot | 3e5279d |
| 2 | Regression matrices, the cooldown check, Neon idle and spend | ed86067 |

## Evidence

Pre-checks, booleans only (no value printed):
- Staging worker: SOLANA_NET is devnet, BONDR_QUOTE_MINT is set, ALLOW_MAINNET, ADMIN_WALLET and ADMIN_EVACUATE are absent, FEE_ENGINE is on, VANITY_LANE is staging.
- Staging web: no BONDR_QUOTE_MINT.

Deploy:
- The dry run printed `order: web worker (no deployed-staging tag)` and `tag deployed-staging: moves to 5b26c35`.
- `sh scripts/deploy.sh staging --yes`: web b499d4c9 SUCCESS, then worker 53181acd SUCCESS, then `deployed-staging -> 5b26c35`.

Web:
- The pre-deploy log shows `migrations applied`.
- A read-only check of the staging DB:
  - 9 journal rows, the last stamped 1793011326363 (0008_go_live in the journal)
  - `has_table_privilege(current_user, 'admin_audit', 'TRUNCATE')` is false
  - the trigger `admin_audit_no_truncate` exists
  - `coins.create_slot` and `sniped_bps` exist
  - 19 free staging vanity mints
  - launches on, not evacuated

Worker log since the deploy:
- `worker listening on devnet`
- `contract check passed: pump=510657843 pump AMM=508659436 pump fees=508659783` (the devnet profile, same slots as 07-08)
- `switches: launches=on forcedBond=on sweeps=on finalize=on buybackBurn=on` (unchanged)
- `fee engine on: 2 coins armed`
- `backfilled 0 launches`
- `stream subscribed`
- 0 `Transaction version (1)` lines.
- There is no vanity refill line: 19 ready is at least the staging low mark of 10, so nothing ground.

Indexing:
- `devnet-trades.ts --mint CyR56...bndr (EX8EUJ) --buy 0.01 --expect-indexed 60`, with DATABASE_URL pointed at staging in the process env.
- Signature 4zCFMC...8Zwn was indexed by the staging worker 4.5 s after landing.
- The plan's Task 1 verify command passes.

Matrices against https://web-staging-72bad.up.railway.app:
- @smoke: 32 passed. This is the Task 2 verify command.
- admin-locked, responsive-fee, responsive-trade and trade-sheet: 40 passed, 24 skipped. The skips are the seeded-only states, the same counts as 06-26.
- Screenshots: launch-genesis-banner and admin-locked at 390, 768 and 1440 (-staging) are in the phase 7 dir. The admin-locked files are copies of this run's output, which spec writes to the phase 6 dir; this run rewrote those byte-identical.
- I restored the earlier phases' screenshots that the run rewrote.

Cooldown:
- `devnet-launch.ts` ran against the staging DB and the staging lane. BBURN landed (YdHnV3...9ndc, mint 9Khuo...bndr) and so did BSELL (4sczwr...BCm6, mint Gbot...bndr). Each passed its landed assertions.
- A throwaway consented wallet went through the staging web: consent 204, pin 200, then prepare for BBURN answered **409 `{"error":"ticker_locked","retryAfter":86349,"lock":"landed"}` with no tx**.
- Nothing was signed. The test wallet row was deleted.

Neon (`neonctl api /projects/royal-waterfall-05278863/endpoints`, read at 14:48Z):
- main (staging): idle, last active 14:36:32Z, suspended 14:42:46Z.
- dev: idle, suspended 14:25:32Z.
- Both are at 0.25 CU.

Devnet spend (balances read over RPC, SOL amounts only):

| | Ops | Sim dev |
|---|---|---|
| This plan, before (14:22Z) | 2.732402 | 0.082446 |
| This plan, after (14:37Z) | 2.720109 | 0.052078 |
| Phase 6 end (06-26) | 2.741621 | 0.084227 |

- This plan spent 0.042661 SOL. Of that, ops spent 0.012293 on launch tables and fees. The sim spent 0.030368: the 0.01 buy, now held as coin, plus the burned dev buy and create rent.
- Phase 7 total since the Phase 6 end: ops 0.021512 (this includes staging fee-engine activity on the shared ops wallet) plus sim 0.032149, so **about 0.054 SOL, under 0.1 SOL**.

CI: GitHub Actions is still blocked on the owner's billing (07-19). This plan needed no CI run.

## Deviations from Plan

1. **The BBURN and BSELL coin rows are not on staging lists yet.** The in-process settle in devnet-launch.ts logged `BONDR price not seeded`, because the script process does not seed the BONDR price. So it wrote only the landed launch rows, and those are what the cooldown reads. The staging worker's next boot backfill indexes both coins and arms them in the engine. I did not restart the staging worker for this.
2. **Copied screenshots.** The phase 7 admin-locked shots are copies of the phase 6 output files from this run (above).

## Owner hand-over (non-blocking)

- **HV-06-01:** set ADMIN_WALLET on the staging web and worker together, to the same address (SITE_URL is already on both). Open https://web-staging-72bad.up.railway.app/admin, sign in with Phantom, check that the Pump contract check cell reads Passed and that Run check now works. After this, admin-locked.e2e.ts skips with "staging admin is configured".
- **HV-06-02:** set SENTRY_READ_TOKEN on the staging worker and confirm the Health panel's Sentry cell shows counts.
- GitHub billing (07-19) blocks CI and therefore the 07-25 merge.

## Self-Check: PASSED

- All six phase 7 -staging screenshots exist.
- The `deployed-staging` tag exists.
- Commits 3e5279d and ed86067 are in `git log`.
