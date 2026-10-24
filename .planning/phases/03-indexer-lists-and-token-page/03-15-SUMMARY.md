---
phase: 03-indexer-lists-and-token-page
plan: 15
subsystem: ops
tags: [staging, deploy, railway, checkpoint, sign-off]
requires:
  - phase: 03-14
    provides: responsive-lists.e2e.ts, shoot.ts, Designer critique and fixes
provides:
  - "Staging runs the app code at ea84e98: web aa0bb542, worker ce332fcc, SITE_URL set on web"
  - "Staging Neon main branch migrated to 0004; worker backfill indexed both staging launches"
  - "21 staging screenshots; staging specs take real staging coins when E2E_BASE_URL is set"
affects: [phase-3 sign-off]
key-files:
  modified:
    - apps/web/e2e/responsive-lists.e2e.ts
    - apps/web/e2e/live.e2e.ts
    - apps/web/e2e/og.e2e.ts
    - apps/web/e2e/README.md
    - apps/worker/README.md
  created:
    - .planning/phases/03-indexer-lists-and-token-page/screenshots/ (21 -staging.png)
key-decisions:
  - "03-15: web deployed before worker, because migrations 0003 and 0004 run in the web pre-deploy and the worker's backfill needs the coins and trades tables"
  - "03-15: Trending keeps showing up to 10 coins, zero-volume coins at the end (owner decision 2026-10-24)"
  - "03-15: on staging the specs read coins from /api/coins?sort=top (the same order as the first cards on /) instead of seeding"
status: complete
requirements-completed: [LIST-01, LIST-02, LIST-03, LIST-04, LIST-05, TOKEN-01, TOKEN-02, TOKEN-06]
duration: ~10 min active, plus the owner's manual checks
completed: 2026-10-24
---

# Phase 3 Plan 15: Staging Deploy and Sign-off Summary

**Staging runs the Phase 3 build on devnet. Web and worker deployed on the first try, migrations 0003 and 0004 applied, and the worker backfilled both staging launches and subscribed to its stream. Every staging check passed, and a real 0.01 SOL devnet buy showed on the open staging token page 2.9 s after blockTime, without a reload. The owner signed off on 2026-10-24.**

## Task 1: owner approval

The owner chose "Approve and deploy" on 2026-10-24, relayed by the orchestrator. The approval covered exactly:
- set `SITE_URL=https://web-staging-72bad.up.railway.app` on the staging web service
- redeploy web (its pre-deploy runs migrations 0003 and 0004 on the staging database), then worker, in Railway project bondr, environment staging only
- one 0.01 SOL devnet buy on a staging coin for the live check

Nothing else on Railway was changed. No other Railway project was touched.

Owner decision recorded at the same time: Trending keeps showing up to 10 coins, with zero-volume coins at the end. No code change.

## Task 2: deploy and staging checks

### Deploys

| Step | Id | Result |
|---|---|---|
| `SITE_URL` on web (`--skip-deploys`) | n/a | set; readback shows the staging URL |
| web | aa0bb542-4f90-435f-a10a-e7a15dd5f128 | SUCCESS, about 2 min (04:26 to 04:28 UTC). Pre-deploy log: "migrations applied", then Next 16.3.8 ready |
| worker | ce332fcc-16da-4e59-b177-b5a3f6d9312b | SUCCESS, about 1.5 min (04:28 to 04:30 UTC). Log: "worker listening on devnet", "backfilled 2 launches", "stream subscribed" |

- `/api/health`: `{"ok":true}`. `/api/status`: net devnet, fees 95/30 bps, `paused: null`.

### Staging database readback (one read from the Mac)

- 5 migrations recorded (0000 to 0004).
- 2 landed launches (4 launches in total). Both have a coins row, and no landed launch is missing one.
- 4 trades, all launch rows: two per coin. 0 bonded coins.

### Staging e2e (`E2E_BASE_URL=https://web-staging-72bad.up.railway.app`, project chromium)

- `responsive-lists.e2e.ts` and `og.e2e.ts`: **24 passed, 3 skipped**. The skips are coin-bonded at 3 widths, because staging has no bonded coin.
  - 0 axe violations and no horizontal scroll on 7 surfaces at 390, 768 and 1440.
  - 21 `-staging.png` screenshots written (`ls … | rg -c "staging\.png$"` = 21).
  - The coin card's `og:image` starts with the staging URL, which confirms SITE_URL reaches `metadataBase`. The card is a 1200x630 PNG with an immutable cache, and the alt reads "{name} ({symbol}) on BONDR. Dev holds 0 launch supply."
- `home.e2e.ts -g "hero|the coins route checks"`: **5 passed**. These are the groups that need no seeding.
- `live.e2e.ts -g devnet` with `E2E_DEVNET=1`: **1 passed**.
  - Coin: `CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr` (EX8EUJ), the first curve coin on staging.
  - Buy signature: `2w4nvRB5ZcBVvcw6J5U9GrMxw9ZvFPaZ7MKVfH87HSgGLF6MSonDVSLfZ1MGpKbKLB8TsrhzgYsYdYuutzxnZzK2`.
  - The row showed on the open page **2857 ms after blockTime**, with no navigation, and Mcap changed.
  - Balances: ops 2.750788 SOL before and after (no top-up needed). The sim wallet went from 0.079263 to 0.069257 SOL. Run spend 0.010006 SOL of the 0.05 budget.

### Spec changes for staging (c749f01)

- `responsive-lists.e2e.ts`: with `E2E_BASE_URL` set, it seeds nothing. The coins are the first curve and PumpSwap coins from `/api/coins?sort=top`, and coin-bonded skips with the reason "staging has no bonded coin". The search query is now URL-encoded.
- `live.e2e.ts`: the devnet group takes the first curve coin from staging's `/api/coins` instead of the dev branch database.
- `og.e2e.ts`: the coin-card test uses the first staging coin and requires `og:image` to start with the staging URL. The other two tests are request-only and unchanged.
- `apps/worker/README.md`: deploy web first when a migration is new. Staging coins are all devnet test coins and are not filtered (RESEARCH Open Question 4).

## Task 3: owner sign-off (APPROVED 2026-10-24)

The owner replied "approved" to the checklist (relayed by the orchestrator), covering:
1. The home page at https://web-staging-72bad.up.railway.app: hero counts, Trending caption, Top, Latest and Oldest tabs, and search by name, symbol and pasted mint.
2. The token page https://web-staging-72bad.up.railway.app/coin/CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr: chart intervals, the trade feed with the Launch rows and the 03-15 buy, holders, and Bond and burn.
3. The share card in Telegram and the X card validator (TOKEN-06).
4. The Neon idle check (D-04): / open and idle for 10 minutes, compute suspended.

The automated part, `og.e2e.ts` against staging, passed in Task 2.

**TESTCOIN's blank art is not a bug.** Its IPFS image is a 1x1 px e2e fixture PNG, and the gateway serves it as 200 image/png.

**Known minor follow-ups, handled after sign-off by the orchestrator in separate work (not in this plan):**
- the chart's Bonded marker label is clipped on phones
- the bond bar looks heavy at tablet width
- the trade feed stays on Reconnecting when the stream is refused at the per-IP cap

## Deviations from Plan

1. **[Rule 3 - Blocking] `og.e2e.ts` was changed too.** It is not in the plan's file list. Its coin-card test inserts a row into the dev branch database, and that coin does not exist on staging. On staging the test now uses a real staging coin and also checks that og:image is absolute on the staging URL.
2. **Deploy order: web first, then worker.** This matches the approval and the plan's order, but the worker README said worker first. The README now says web first when a migration is new.
3. **The staging coin list comes from `/api/coins?sort=top`, not from the first card's DOM.** It returns the same order, with the venue and symbol already parsed.

## Known Stubs

None.

## Threat Flags

None. SITE_URL is public, and no secret was printed or committed. T-03-15-01 is met: nothing changed on Railway before the approval.

## Self-Check: PASSED

- FOUND: c749f01, 54b7fff, 21 staging screenshots, the 5 modified files
