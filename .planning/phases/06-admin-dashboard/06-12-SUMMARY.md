---
phase: 06-admin-dashboard
plan: 12
subsystem: web
tags: [web, console, health-poll, neon-budget, wallets, tdd]
requires: [06-03, 06-10]
provides:
  - "[op]/route.ts FORWARD (nine worker admin routes) and LOCAL (overview)"
  - admin-data.ts overviewData(actor), emptyOverview, WRow, AdminOverview
  - admin-copy-health.ts Wallets and Health cell copy
  - use-health.ts useHealth (visibility-aware 10 s poll, memory only)
  - use-console.ts useConsole (overview, loading, failed, refresh, reload)
  - admin-panel.tsx Panel and TONE; admin-wallets.tsx; admin-health.tsx
  - the console grid in mockup order with commented slots
  - e2e/admin.ts openConsole
affects: [06-14 switches and audit, 06-16 W table, 06-17 timeline, 06-18 dialog, 06-19 inspector, 06-20 moderation, 06-23 evacuate]
tech-stack:
  added: []
  patterns: [one overview POST reloads every DB panel, setTimeout chain after each answer cleared on hidden, fake-clock request counting in Playwright]
key-files:
  created:
    - apps/web/lib/admin-data.ts
    - apps/web/lib/admin-copy-health.ts
    - apps/web/lib/admin-copy-health.test.ts
    - apps/web/lib/use-health.ts
    - apps/web/lib/use-console.ts
    - apps/web/components/admin-panel.tsx
    - apps/web/components/admin-wallets.tsx
    - apps/web/components/admin-health.tsx
    - apps/web/e2e/admin.ts
    - apps/web/e2e/admin-console.e2e.ts
  modified:
    - apps/web/app/api/admin/[op]/route.ts
    - apps/web/app/admin/page.tsx
    - apps/web/components/admin-console.tsx
    - apps/web/components/admin-signin.tsx
    - biome.json
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-12: overviewData takes the actor (the signed-in admin wallet) because the worker's /admin/overview is gated on it; page.tsx and the overview op both pass s.wallet"
  - "06-12: a failed page load renders the console with emptyOverview() (loadedAt 0) instead of an error page; Wallets shows its failed line, totals hide, vanity and reconcile show a dash, Refresh retries"
  - "06-12: the health poll is mounted in an inner Grid component, so it stops when the console swaps to the sign-in card and a stale 401 never overwrites the Signed out notice"
  - "06-12: reconcile count is the newest reconcile_diff per account from the last 7 days (a diff writes a row only when it first appears, so a fixed diff lingers up to a week rather than a persistent one reading Clean)"
  - "06-12: the 1100px breakpoint is written min-[68.75rem]; min-[1100px] sorts before md (48rem) in Tailwind v4, so md won at every width"
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 2
  files: 18
---

# Phase 6 Plan 12: Console top row, overview load and the health poll Summary

The signed-in owner now sees Wallets (treasury, buyback and ops, SOL first, with the platform totals) and Health (eight cells) at the top of the console, with Refresh and "Loaded {HH:MM}" in the top bar. Postgres is read once on page open and on each Refresh click through one POST /api/admin/overview. The only timer is the 10 s health poll, which reads worker memory, runs only while the tab is visible, and never calls the overview. The Playwright spec proves this on a fake clock.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | Forwarder, overview data and the health poll | 1119531 (RED), d680db1 (GREEN) |
| 2 | Wallets and Health panels, Refresh, and the console spec | 017e61a |

## What was built

- `[op]/route.ts`: `FORWARD` maps nine ops to worker paths (health, coin-live, switch, act, simulate, execute, intent, moderate, inspect), and `LOCAL` holds `overview`. A forwarded call sends `{ ...body, actor: s.wallet }`, so a body actor is always overwritten, and passes the worker's status and body through with no-store. Timeouts: execute 30 s, simulate with `action: "evacuate"` 90 s, others the 15 s default. A body that is not a JSON object becomes `{}`. Unknown ops answer 404. A failed overview read logs only the error code and answers 503 worker_unavailable.
- `admin-data.ts`: `overviewData(actor)` runs one Promise.all over six reads. (1) Coin rows joined to launches, with `bondSent` (a pending forced_bond or pool_burn) and `lastCollectAt` (max landed_at of collect rows). (2) Launches in signed, sent or unknown that have no coin row, marked `launch: "unconfirmed"`. (3) Totals: coins, bonded, 30-day trade SOL and 30-day landed treasury SOL (split_treasury, sweep_treasury, evacuate). (4) The free vanity count, with the worker's `ready` predicate repeated. (5) The newest reconcile diff per account. (6) The worker overview, null when it does not answer. Rows sort newest first. `emptyOverview()` is used for a failed page load.
- `admin-copy-health.ts`: pure cell copy with `{ value, sub, tone }`, plus `clock` and `since`. Tested in `admin-copy-health.test.ts` (9 tests).
- `use-health.ts`: follows Code Example 7. A `busy` flag keeps a visibilitychange during a request from starting a second chain. A 401 calls onUnauthorized. A failure sets `failedAt` and keeps the last payload.
- `use-console.ts`: `refresh()` dims the DB panels, and `reload()` refetches without the dim (for 06-17 and later, after an action settles). On failure the content stays and `failed` is set. A 401 ends the session.
- `admin-console.tsx` (163 lines) holds the layout and mounts only. The top bar has the session line and Refresh grouped on the right from 768px. Under it is the role alert "Could not refresh. Try again.". The top row is one column below 768px. From 768px Wallets and the switches cell sit side by side with Health spanning both, and from 1100px the columns are `1.1fr 1fr 1.2fr`. The later slots (W table, timeline row, audit, EVACUATE) are commented with their exact grid classes.
- `admin-wallets.tsx`, `admin-health.tsx` and `admin-panel.tsx`: each panel is a section named by its h2. The ops warn row is a warn-wash band. The heartbeat has the animate-live dot while polls answer and a static destructive dot when they fail. Leader lock reads "Single replica, no lock" with the instance and the UTC boot time. The stuck sub-line becomes a select button once `onSelect` is passed (06-16). Vanity and reconcile dim with the DB panels during a refresh.

## Verification

- `pnpm vitest run apps/web/lib/admin-copy-health.test.ts`: 9 passed (RED run first: the suite failed because the module did not exist).
- `pnpm exec playwright test apps/web/e2e/admin-console.e2e.ts apps/web/e2e/admin-signin.e2e.ts --project=chromium`: 9 passed on two consecutive runs, none skipped (4 admin-console, 5 admin-signin).
- The first two runs had Neon cold-start failures (`CONNECT_TIMEOUT` on the admin sign-in write and the worker's index boot). They went away once the compute was warm.
- `overviewData` against the Neon dev branch returned 6 rows, totals, vanity 0 and a clean reconcile. The worker was not running, so worker was null, as expected.
- Screenshots at 390, 768, 1100 and 1440 through `shoot.ts gate` (no horizontal scroll, 0 axe violations) were saved in scratch and not committed. They showed the 1100px breakpoint bug, which is fixed.
- `pnpm typecheck`: pass. `pnpm lint`: clean (370 files).
- Full `pnpm test`: 79 files passed, 592 passed, 2 skipped (594).
- Acceptance greps all hold: `actor: s.wallet` is present and there is no GET export. use-health has no setInterval, overviewData or db(). The route has 90_000. admin-console has no api/admin/overview and is under 200 lines. Every file is under 300 lines and every function under 40.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] biome refused `@bondr/core/api-admin` in web**
- **Found during:** Task 1 lint
- **Issue:** the D-15 allowlist in biome.json did not include api-admin, which is types only and documented as web-importable.
- **Fix:** added `!@bondr/core/api-admin` to the allowlist.
- **Commit:** d680db1

**2. [Rule 1 - Bug] the 1100px column switch never applied**
- **Found during:** Task 2 screenshots
- **Issue:** Tailwind v4 cannot order `min-[1100px]` (px) against `md` (48rem), and emitted it first, so md's two columns won at 1440.
- **Fix:** the breakpoint is written `min-[68.75rem]`.
- **Commit:** 017e61a

**3. Moved `SignInAgain` and `SignOut` into admin-signin.tsx** (not in files_modified). This keeps admin-console.tsx under its 200-line budget, and admin-signin already owns the sign-in flow and the session POST helper. **Added `admin-panel.tsx`**, the shared panel shell and tone map, so later panels do not copy the classes.

**4. Contract adjustments:** `overviewData` takes `actor`, because the worker route is gated on it. `useConsole` treats `loadedAt: 0` as "not loaded". The health spec waits for the first poll to settle instead of expecting exactly 1, because dev StrictMode mounts the effect twice. Only one chain survives the cleanup.

## Requirements

ADMIN-06 is complete: heartbeat, leader lock, last run per job, RPC, Sentry and the vanity pool are all on the console. ADMIN-02 is not ticked, because "every W with its state" ships with the W table in 06-16.

## Known Stubs

- `admin-console.tsx` Grid: the Kill switches cell is an empty `<div>` until 06-14. The W table, timeline row, audit and EVACUATE slots are comments for 06-14, 06-16, 06-17, 06-19, 06-20 and 06-23. This is intentional: this plan fixes the grid.
- `admin-wallets.tsx`: the Buyback row has no "Burn buyback now" yet (06-18 mounts it as the row's child).

## For the next plans

- Mount panels in `Grid` in admin-console.tsx. `con.overview`, `con.loading` (pass as `busy` to dim DB panels) and `con.reload()` (call after an action settles) come from `useConsole`. `poll` (the health payload with `switches`, `feeEngine`, `evacuatedAt`) is already in Grid for 06-14's switches.
- Use `<Panel id title note busy>` from admin-panel.tsx for every panel, and `TONE` for cell colors.
- For the 1100px breakpoint, write `min-[68.75rem]:`, not `min-[1100px]:`. token-ledger.tsx `min-[1100px]:p-6` probably has the same ordering problem (logged in deferred-items.md).
- To add a web-local op, add a `LOCAL` entry in `[op]/route.ts`. Every forwarded op is already in `FORWARD`.
- Playwright: `openConsole(page)` from e2e/admin.ts. For timer assertions, use `page.clock.install()` before `openConsole` and advance one second at a time with no request in flight (see `advance` in admin-console.e2e.ts). Dev StrictMode doubles the first poll.

## TDD Gate Compliance

Task 1 has `test(06-12)` 1119531 followed by `feat(06-12)` d680db1. Task 2 is `type="auto"` with no TDD flag, and its Playwright spec was committed with the feature.

## Self-Check: PASSED
