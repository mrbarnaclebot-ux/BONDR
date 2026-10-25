---
phase: 05-fee-engine-and-public-ledger
plan: 13
subsystem: ops
tags: [staging, deploy, railway, devnet, sign-off]
requires:
  - phase: 05-09
    provides: "migration 0006, POST /fee/batch, reconciliation"
  - phase: 05-12
    provides: "the devnet engine e2e, the responsive-fee staging path, the fee engine runbook"
provides:
  - "Staging runs the Phase 5 build: web e07a1f4e (migrations 0005 and 0006), worker 0cb154a4 with FEE_ENGINE=on"
  - "6 Phase 5 -staging screenshots"
affects: [phase-5 sign-off, phase-6, phase-7]
key-files:
  modified:
    - apps/worker/README.md
  created:
    - .planning/phases/05-fee-engine-and-public-ledger/screenshots/ (6 -staging.png)
key-decisions:
  - "05-13: staging runs FEE_ENGINE=on with the 24 h window (FEE_WINDOW_MS unset); local stays off, because both sign with the one devnet ops wallet (Pitfall 11)"
  - "05-13: boot recovery prints nothing when 0 rows are pending, so the armed line (printed only after recover returns) plus an empty staging fee_ledger stand in for the 'fee recover:' line"
requirements-completed: [FEE-01, FEE-02, FEE-03, FEE-04, FEE-05, FEE-06, FEE-07, FEE-08, FEE-09, TOKEN-03, TOKEN-04, TOKEN-05]
duration: 31min
completed: 2026-10-25
---

# Phase 5 Plan 13: Staging Deploy and Sign-off Summary

**Staging now runs the Phase 5 build on devnet with the fee engine on. Web deployed first, and its pre-deploy applied migrations 0005 and 0006. The worker then booted with the engine off, and setting the flag armed both staging coins with no errors. The staging matrix passed: 35 passed, and the 24 skips are all seeded-only states. Both Neon computes suspended after the deploy. This plan spent 0 SOL, so the phase total stays at 0.006348 SOL.**

## Task 1: deploy web, then the worker with the engine off

| Step | Deployment id | Result |
|---|---|---|
| web | e07a1f4e-78ee-48e7-998d-2effd1512792 | SUCCESS in about 1.7 min (08:23:45 to 08:25:27 UTC). The pre-deploy printed `migrations applied`, then Next 16.3.8 was ready |
| worker | 66dfcb18-fa9a-4942-a6ac-5b78248c993c | SUCCESS in about 0.9 min (08:25:59 to 08:26:50 UTC). Log: `worker listening on devnet`, `fee engine off`, `backfilled 0 launches`, `stream subscribed` |

- **Migrations.** The migrate script prints only `migrations applied`, without names. To confirm which ones ran, I did one read-only query on the staging database (URL never printed). `drizzle.__drizzle_migrations` has 7 rows. Its latest `created_at` is 1792914550899, which is 0006_reconcile_platform's journal stamp. `fee_ledger` exists, and 0006's `fee_ledger_platform` check is live. So 0005 and 0006 were both applied before the worker deployed.
- **Engine off at boot.** The worker had no `FEE*` variable at deploy time (checked by key names only).
- **Smoke checks**
  - `/api/health` returned `{"ok":true}`.
  - `/api/status` returned net devnet, `paused: null`.
  - `/api/coins?sort=top` returned 2 coins.
  - `GET /api/coin/CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr/ledger` returned 200 with `{rows: [], more, next}`.
  - `/api/coin/not-a-mint/ledger` returned 404.
  - The token page HTML contains "Fee ledger" and "Bond and burn".
- **Scope.** Only the bondr project's staging `web` and `worker` services were deployed. No other project or environment was touched.
- **README.** Records that web deployed first and its pre-deploy applied 0005 and 0006, then the worker booted with the engine off. Commit d635066.

## Task 2: engine on

- **Ops before the flag.** 5d9A...uDuk held **2.744696 SOL** at 08:27:48 UTC, the same as at the end of 05-12.
- **Flag.** I ran `printf %s on | railway variable set FEE_ENGINE --stdin --service worker --environment staging` at 08:27:54. FEE_ENGINE is a devnet flag, not a secret, and it was the only variable changed. `FEE_WINDOW_MS` stays unset, so staging keeps the 24 h window.
- **Redeploy.** Worker deployment **0cb154a4-6468-4a91-8e02-dfb8b4842cce** reached SUCCESS at 08:29:21. 66dfcb18 is now REMOVED.
- **Boot log**
  ```
  worker listening on devnet
  fee engine on: 2 coins armed
  backfilled 0 launches
  stream subscribed
  ```
- **N matches.** N = 2, the same count as `/api/coins` (EX8EUJ and TESTCOIN).
- **Recovery.** There is no `fee recover:` line. `recover()` logs only when rows are pending (fee-recover.ts:125), and the armed line prints only after it returns. A read-only count of staging `fee_ledger` by state came back empty, so 0 rows were pending.
- **First 5 minutes.** The full log at 08:34:46 is the 4 lines above. `rg "fee .* failed|ops below floor"` found nothing. The plan's verify command (`rg -q "fee engine on: [0-9]+ coins armed"`) passed.
- **README.** Staging runs `FEE_ENGINE=on` and local stays off. A recovery with nothing pending is silent. Commit 7625bf0.

### Next window ends (HV-05-01)

The formula is `windowEnd = launchedAt + (index + 1) x 24 h`. The token page shows the same thing, counted from 1: "Window 3 closes in 10h 40m".

| Coin | Mint | launchedAt | Next window end (UTC) |
|---|---|---|---|
| EX8EUJ | CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr | 2026-10-22T19:15:52Z | **2026-10-25T19:15:52Z** (index 2) |
| TESTCOIN | HHNKkxQxFXTzcmRnuTPJmaNuSe34Cxyemspf1Wofbndr | 2026-10-23T04:29:47Z | **2026-10-26T04:29:47Z** (index 2) |

The next daily batch is at **2026-10-26T04:00:00Z** (`FEE_BATCH_HOUR_UTC` default 4).

## Task 3: staging matrix and the Neon idle check

- **Command.** `E2E_BASE_URL=https://web-staging-72bad.up.railway.app pnpm exec playwright test apps/web/e2e/responsive-fee.e2e.ts apps/web/e2e/responsive-trade.e2e.ts apps/web/e2e/trade-sheet.e2e.ts --workers=3`. Result: **35 passed, 24 skipped** in 48 s.
- **responsive-fee: 6 passed.** These are staging home and coin-curve at 390, 768 and 1440, with 0 axe violations and no horizontal scroll.
- **24 skipped, all marked "seeded runs only":**
  - home-norail: 3
  - home-rail: 3
  - six token page states at 3 widths: 18
  
  Staging seeds nothing. Those states passed locally in 05-11 and 05-12.
- **Phase 4 regression: 29 passed.** That is all of responsive-trade.e2e.ts and trade-sheet.e2e.ts, the same count as 04-13.
- **No dev database.** The spec needed no fix. On the staging path `url` is undefined, so no postgres client opens.
- **Screenshots: 6 Phase 5 `-staging.png`.** These are coin-curve and home-norail at 390, 768 and 1440 (`rg -c "staging\.png$"` = 6). I checked them visually. The run also rewrote 04-13's 23 committed Phase 4 `-staging.png` files, so I restored those instead of committing them. Commit c0390d5.
- **Neon idle check.** I read the endpoints at 08:51:11 UTC, with no browser open, no trades and the engine on. Both endpoints run at 0.25 CU.

| Endpoint | Branch | State | Last active | Suspended at |
|---|---|---|---|---|
| ep-gentle-pine | main (staging) | idle | 08:35:30Z (the matrix run) | **08:41:16Z** |
| ep-aged-recipe | dev | idle | 08:17:57Z (05-12) | **08:26:46Z** |

  Staging suspended about 6 minutes after the last request while the engine was on. Its window and batch timers read nothing (D-03).

## Devnet spend

| Reading | Ops balance |
|---|---|
| Before FEE_ENGINE=on (08:27:48Z) | 2.744696 SOL |
| End of Task 3 (08:51:23Z) | 2.744696 SOL |

- **Staging spend since Task 2:** 0 SOL. No window has ended yet, and no batch has run.
- **Phase 5 devnet total**
  - 05-12 devnet e2e: 0.006348 SOL.
  - 05-13 staging: 0 SOL.
  - 05-01 to 05-11: 0 SOL each (units, dry runs and the local fork only; 05-04, 05-05, 05-07, 05-08 and 05-09 say so explicitly).
  - **Total: 0.006348 SOL**, under the 0.1 SOL phase cap.
- **Real money:** none.
- Staging's first real engine sends come at 19:15:52Z, when EX8EUJ's window ends. They count toward the phase total only after this plan.

## ROADMAP Phase 5 criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Unattended collect, 90/10 split, every ledger row with amount, time and tx link | 05-12 devnet: window 566 on BSELL landed collect 3CF4BWF8, split 4HHsXcQ8 and sweep 5154v32w with no manual help, and the rows were on the token page with Solscan links 64 s later. Fork: engine.collect and engine.split (05-07). Staging: ledger route 200/404, and the engine is armed on 2 coins |
| 2 | 105% forced buy + burn bonds the coin; trader-bonded coin gets a PumpSwap buy + burn | Fork 05-07: engine.forced (burned 414,949,555,502,411, complete true, W child 0) and engine.pool.burn (exact_quote_in, W child 0). Helius Sender with a real tip is mainnet only, so it is HV-05-02 |
| 3 | 24 h sweep 90/10, buyback burned, post-bond distribution, ops pays, floor alert | 05-12 devnet: sweep_buyback 184,368,137,504 plus sweep_treasury, and the batch burn 4WwZ1Th2 dropped supply by exactly that amount. Fork 05-09: engine.distribute. Ops paid every fee (05-12 spend table). The ops floor and pause are covered by the 05-04 units and the runbook. Staging 24 h sweep: HV-05-01 |
| 4 | Post-bond sweep, deployer pre-flight, single 8000/2000 update, deployer share shown | Fork 05-08: engine.finalize.config (pre-flight on the real launch tx), engine.finalize.update (8000,2000, adminRevoked) and engine.finalize.sweep (W BONDR 0). The token page held and deployer-share states are in the 05-12 matrix |
| 5 | Bond progress, budget vs cost, window time left, totals; nightly reconciliation | Staging coin-curve screenshots at 3 widths: curve filled, burn budget vs cost, "Window 3 closes in 10h 40m", and the Fee ledger totals. 05-12 batch: `diffs: 0` with no new reconcile_diff. 0006 is on staging |

## For the owner (manual, non-blocking)

1. **HV-05-01: a real 24 h sweep on staging (FEE-04).**
   - After 2026-10-25T19:15:52Z, open https://web-staging-72bad.up.railway.app/coin/CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr.
   - After 2026-10-26T04:29:47Z, open https://web-staging-72bad.up.railway.app/coin/HHNKkxQxFXTzcmRnuTPJmaNuSe34Cxyemspf1Wofbndr.
   - On each, confirm the Collect, Split 90/10 and Sweep rows with Solscan links.
   - A coin with no new creator fees, or fees under the 10,000 lamport devnet collect minimum, shows no rows. That is by design. Both coins currently show "No creator fees yet".
2. **HV-05-02: Helius Sender on mainnet with a real tip (FEE-02, FEE-03).** This is Phase 7 and owner-gated. On the first forced bond after go-live, check the Sender response and the tip transfer on Solscan.

## Deviations from Plan

1. **No `fee recover:` line.** The plan expected `fee recover:` with 0 pending. The code is silent when nothing is pending. I used the armed line, which prints only after recovery returns, together with a read-only count showing an empty staging `fee_ledger`. I left the code as is and documented the silent case in the README. This is not a bug.
2. **Migration confirmation by query.** The migrate script does not list migration names. I confirmed 0005 and 0006 with one read-only count on the staging migrations table, without printing the URL.
3. **No spec change needed.** `responsive-fee.e2e.ts` is listed in files_modified, but its staging path already opens no database.

## Known Stubs

None.

## Threat Flags

None.
- **T-05-13-01:** only the staging web and worker services changed, and only one variable was set (FEE_ENGINE).
- **T-05-13-02:** no secret or URL was read into output or printed. The migration ran in web's pre-deploy.
- **T-05-13-03:** one worker replica, and recovery ran before the armed line.
- **T-05-13-04:** both Neon computes suspended, and spend was 0.
- **T-05-13-06:** ids, log lines, window ends, counts and Neon times are recorded above.

## Self-Check: PASSED

- FOUND: commits d635066, 7625bf0, c0390d5
- FOUND: 6 `*-staging.png` in .planning/phases/05-fee-engine-and-public-ledger/screenshots/, apps/worker/README.md
