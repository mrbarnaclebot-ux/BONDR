---
phase: 06-admin-dashboard
plan: 26
subsystem: ops
tags: [staging, deploy, railway, devnet, sign-off]
requires:
  - phase: 06-25
    provides: "the responsive and axe matrix, the last console change before staging"
  - phase: 06-24
    provides: "the devnet money path and EVACUATE proof, Phase 6 devnet spend 0.004855 SOL"
provides:
  - "Staging runs the Phase 6 build dark: web 9a7f2884 (migration 0007), worker 1a9b6aa9 with every switch on and FEE_ENGINE=on"
  - "apps/web/e2e/admin-locked.e2e.ts and 3 admin-locked -staging screenshots"
  - "HV-05-01 checked on staging (no-fee path)"
affects: [phase-6 sign-off, phase-7]
key-files:
  created:
    - apps/web/e2e/admin-locked.e2e.ts
    - .planning/phases/06-admin-dashboard/screenshots/admin-locked-{390,768,1440}-staging.png
  modified:
    - apps/worker/README.md
    - apps/web/e2e/README.md
    - .planning/phases/06-admin-dashboard/deferred-items.md
    - .planning/phases/05-fee-engine-and-public-ledger/05-HUMAN-UAT.md
    - .planning/phases/05-fee-engine-and-public-ledger/screenshots/ (6 -staging.png refreshed)
key-decisions:
  - "06-26: staging admin ships closed: ADMIN_WALLET, ADMIN_EVACUATE and SENTRY_READ_TOKEN stay unset; the owner opens it under HV-06-01 by setting ADMIN_WALLET on web and worker together"
  - "06-26: HV-05-01 recorded as passed on the no-fee path: both staging windows ran unattended and correctly sent nothing, because neither coin had creator fees"
  - "06-26: staging ingest cannot read devnet version 1 transactions (pre-existing Phase 4 code); deferred, must be fixed before Phase 7 go-live"
requirements-completed: [ADMIN-01, ADMIN-05, ADMIN-11]
duration: 30min
completed: 2026-10-26
---

# Phase 6 Plan 26: Staging Deploy Dark and Sign-off Summary

**Staging now runs the Phase 6 build on devnet with the admin console closed. Web deployed first, and its pre-deploy applied migration 0007. The worker then booted with all five switches on and the fee engine on. The locked spec passed on staging: the not-configured card at 3 widths with 0 axe violations, 401/403, and a not_configured refusal with no cookie. The Phase 5 and Phase 4 matrices still pass (40 passed, 24 seeded-only skips). Both Neon computes suspended within 8 minutes of the last request. This plan spent 0 SOL, so the Phase 6 devnet total stays at 0.004855 SOL.**

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Deploy web then worker to staging | 9d637c7 | apps/worker/README.md, apps/web/e2e/README.md, deferred-items.md |
| 2 | Locked-state matrix, regressions, Neon idle and spend | fb1f420 | admin-locked.e2e.ts, 3 admin-locked -staging shots, 6 Phase 5 -staging shots |

## Task 1: deploy web, then the worker

- **Before.** `railway whoami` OK; linked project bondr, environment staging. Ops 5d9A...uDuk held **2.741621 SOL** at 05:24:38Z, the same as the end of 06-24.
- **Variables (names only).** Neither service has ADMIN_WALLET, ADMIN_EVACUATE or SENTRY_READ_TOKEN. The worker keeps FEE_ENGINE from 05-13. No variable was set or changed.

| Step | Deployment id | Result |
|---|---|---|
| web | 9a7f2884-8894-4b0e-a65b-7a4800782c69 | SUCCESS, 05:26:27 to 05:28:44 UTC (about 2.3 min). Pre-deploy printed `migrations applied`, then Next 16.3.8 ready |
| worker | 1a9b6aa9-033d-4f48-b52f-4ee2353d1fdd | SUCCESS, 05:29:28 to 05:30:56 UTC (about 1.5 min) |

- **Migration 0007.** The migrate script prints no names, so (as in 05-13) one read-only query on the staging database, URL never printed: `drizzle.__drizzle_migrations` has 8 rows and its latest `created_at` is 1792931781969, 0007_admin's journal stamp. The settings row has all five switch columns true and `evacuated_at` null.
- **Worker boot log** (05:30:44Z):
  ```
  worker listening on devnet
  switches: launches=on forcedBond=on sweeps=on finalize=on buybackBurn=on
  fee engine on: 2 coins armed
  backfilled 0 launches
  stream subscribed
  ```
- **First 5 minutes.** The log at 05:49Z (19 minutes after boot) is the 5 boot lines and nothing else: no `fee .* failed`, no `ops below floor`, and none of the v1 ingest lines the old deployment carried (see Deviations).
- **Smoke.** `/api/health` `{"ok":true}`; `/api/status` net devnet, `paused: null`; `/api/coins?sort=top` EX8EUJ and TESTCOIN; `GET /api/coin/CyR56j...bndr/ledger` 200; `/admin` 200.
- **Scope.** Only the bondr staging `web` and `worker` services were deployed.

## Task 2: locked matrix and regressions

- **Locked spec.** `E2E_BASE_URL=https://web-staging-72bad.up.railway.app pnpm exec playwright test apps/web/e2e/admin-locked.e2e.ts --project=chromium`: **5 passed (4.1 s)** on the first run.
  - 390, 768, 1440: h1 "Owner console", h2 "Admin is not configured", no button in main, robots noindex, gate() with 0 axe violations and no horizontal scroll. Shots `admin-locked-{390,768,1440}-staging.png`, checked visually.
  - `POST /api/admin/health`: 401 with the same origin and no cookie, 403 from https://evil.example; GET is not 200.
  - Nonce then verify with a valid signature from a fresh key: 403 `not_configured`, no `bondr_admin` cookie.
- **Full gate command** (plan verify, `--workers=3`): admin-locked, responsive-fee, responsive-trade and trade-sheet: **40 passed, 24 skipped (46.1 s)**.
  - admin-locked 5, responsive-fee 6 (staging home and coin-curve at 3 widths), Phase 4 29 (all of responsive-trade and trade-sheet, the same count as 04-13 and 05-13).
  - The 24 skips are all "seeded runs only" (home-norail 3, home-rail 3, six token page states x 3), as in 05-13.
- **Screenshots.** `rg -c "staging\.png$"` over the Phase 6 folder = 3. The six Phase 5 `-staging.png` were refreshed and committed: they now show the Phase 6 build (06-25's 1100px padding fix, window 4). The run also rewrote the 23 Phase 4 `-staging.png` from 04-13; restored, as in 05-13.

## Neon idle check

Read at 05:49:19 UTC with `neonctl api /projects/royal-waterfall-05278863/endpoints`, no browser open, 16 minutes after the last staging request (the gate run ended about 05:33). Both endpoints run at 0.25 CU (min and max).

| Endpoint | Branch | State | Last active | Suspended at |
|---|---|---|---|---|
| ep-gentle-pine | main (staging) | idle | 05:31:11Z (the locked and regression runs) | **05:38:16Z** |
| ep-aged-recipe | dev | idle | 05:21:00Z (06-25) | **05:26:47Z** |

Staging suspended about 7 minutes after the last request with the engine on and every switch on: the worker's timers read nothing.

## Devnet spend

| Reading | Ops balance |
|---|---|
| Task 1 start (05:24:38Z) | 2.741621 SOL |
| End of Task 2 (05:49:25Z) | 2.741621 SOL |

- **This plan:** 0 SOL. No deploy step sends a transaction; neither staging window had fees to collect.
- **Phase 6 total:** 06-01 to 06-23 0 SOL each (units, fork, stubbed e2e), 06-24 0.004855 SOL, 06-25 0 SOL (stubbed matrix), 06-26 0 SOL. **Total 0.004855 SOL**, under the 0.1 SOL cap. Real money: none.
- **Buyback reconcile.** The staging 04:00Z batch logged `reconcile: 1 accounts, 0 diffs`: the shared devnet buyback burned locally in 06-24 produced no diff on staging. Nothing to call noise.

## HV-05-01 (Phase 5 owner item), checked on staging

Both windows closed and ran unattended; neither produced rows, by design, because neither coin had creator fees.

| Coin | Window end | Worker log | Fees | Ledger |
|---|---|---|---|---|
| EX8EUJ CyR56j...bndr | 2026-10-25T19:15:52Z | `fee window CyR56j...bndr 2: done` at 19:15:56Z | `fees.budget` 0; last trade 2026-10-24T20:12Z | `rows: []`, token page "No fee movements yet" |
| TESTCOIN HHNKkx...bndr | 2026-10-26T04:29:47Z | `fee window HHNKkx...bndr 2: done` at 04:29:53Z | `fees.budget` 0; never traded (0 holders) | `rows: []` |

- `done` means the fees were not worth collecting (under the 10,000 lamport devnet minimum, here at most 1 base unit since budget = feeBudget + 90% of fees unclaimed) and W held 0 BONDR, so nothing was sent. Ops was 2.741621 SOL before and after both windows.
- 05-HUMAN-UAT.md test 1 records this as passed on the no-fee path. The rows themselves (Collect, Split 90/10, Sweep with Solscan links) were proven on devnet in 05-12 and 06-24. A staging window with real rows needs a trade on a staging coin before its window ends; EX8EUJ's window 4 ends 2026-10-26T19:15:52Z.

## ROADMAP Phase 6 criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Allowlisted wallet only, 30-minute sessions, fresh signature per money action | Unit: session and intent store (06-03, 06-05). Playwright: admin-signin (06-03). Devnet 06-24: every money action signed fresh through the fake Phantom. Staging: admin-locked proves fail-closed (401, 403, not_configured, no cookie) |
| 2 | Balances, every W with state, totals, health, per-coin timeline with next step and retry | Playwright: admin-console, admin-wtable, admin-timeline (06-12, 06-16, 06-17); 06-25 matrix at 3 widths. Neon: admin-neon (06-24). Staging console view waits on HV-06-01; Sentry cell on HV-06-02 |
| 3 | 11 recovery actions, simulate first, destination allowlist, audit log | Unit: admin-dest, admin-money, admin-audit (06-05, 06-10, 06-13). Fork 06-15: post-bond admin actions, `fork: 99 ok, 0 failed`. Devnet 06-24: Sweep now, Burn buyback now, negative Re-check, each with audit row "Landed" |
| 4 | Kill switches, hide, block, inspector | Unit: switches, moderate, inspect (06-07, 06-19, 06-21). Playwright: admin-switch, admin-moderation, admin-inspect. Staging: worker boot logs every switch on |
| 5 | EVACUATE by phrase and signature; jobs pause, W to treasury | Unit 06-22. Playwright admin-evacuate (06-23). Devnet 06-24: 1 of 1 W moved, every switch paused, then restored. Staging: ADMIN_EVACUATE unset, simulate only |

## For the owner (manual, non-blocking)

1. **HV-06-01: sign in to the staging console** (ADMIN-01, 02, 04, 09, 11). Set ADMIN_WALLET to your Phantom address on the staging web and worker services together, to the same value (on web alone every console call answers 403 forbidden). Open https://web-staging-72bad.up.railway.app/admin, sign in with Phantom, paste a staging signature into the inspector, then simulate (do not send) Burn buyback now and EVACUATE. With ADMIN_EVACUATE unset, staging EVACUATE is simulate only. After that, admin-locked.e2e.ts skips with "staging admin is configured".
2. **HV-06-02: Sentry count** (ADMIN-06). Create a read-only Sentry token, set SENTRY_READ_TOKEN on the staging worker, and confirm the Health panel's Sentry cell shows web and worker counts instead of Not configured.

## Deviations from Plan

1. **Migration confirmation by query.** As in 05-13: the migrate script prints `migrations applied` without names, so one read-only count on the staging migrations table confirmed 0007, URL never printed.
2. **Phase 5 staging shots committed, Phase 4 restored.** The regression run rewrites both. The Phase 5 ones now reflect the 06-25 padding fix on staging, so they were refreshed; the Phase 4 ones were restored as in 05-13.
3. **Found, not fixed (out of scope): staging ingest refuses devnet version 1 transactions.** About 1,100 `ingest ... failed: ... Transaction version (1) is not supported` lines since 2026-10-25T10:32Z, from a third-party devnet program whose txs mention the BONDR quote mint and touch no BONDR coin; the new worker logged none in its first 19 minutes. Pre-existing Phase 4 code (`maxSupportedTransactionVersion: 0`). Logged in deferred-items.md and the worker README. It is a Phase 7 risk: on mainnet a v1 trade on a BONDR coin would never be indexed.

## Known Stubs

None.

## Threat Flags

None. T-06-26-01: ADMIN_WALLET unset, locked spec green. T-06-26-02: only variable names were listed; no value, URL or secret was printed or written. T-06-26-03: boot log shows every switch on. T-06-26-04: ADMIN_EVACUATE unset. T-06-26-05: Neon check above. T-06-26-06: worker logs `listening on devnet`.

## Verification

- `pnpm lint` exit 0 (428 files). `pnpm typecheck` exit 0.
- Staging gate: 40 passed, 24 skipped (seeded only). No non-test source changed, so no full `pnpm test`.
- `curl -fsS https://web-staging-72bad.up.railway.app/api/health` `{"ok":true}`; worker logs match `switches: launches=on ...`.

## Self-Check: PASSED

- FOUND: apps/web/e2e/admin-locked.e2e.ts, 3 admin-locked -staging screenshots (Phase 6 `rg -c "staging\.png$"` = 3)
- FOUND: commits 9d637c7, fb1f420
