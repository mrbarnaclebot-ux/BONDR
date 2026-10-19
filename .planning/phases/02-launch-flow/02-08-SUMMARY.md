---
phase: 02-launch-flow
plan: 08
subsystem: web-launch-form
tags: [launch-form, receipt, paused, live-fees]
requires: [02-06, 02-07]
provides:
  - "lib/worker.ts (server-only): workerGet, workerPost; Bearer WORKER_TOKEN, 15 s timeout, worker errors rebuilt from { error, paused } only, anything else 503 worker_unavailable"
  - "GET /api/status (force-dynamic, no-store) and POST /api/quote (sameOrigin, JSON, 1 KB cap) proxying the worker"
  - "lib/use-status.ts: useStatus() polls /api/status on mount and every 10 s; a failed poll keeps the last value and sets error"
  - "lib/format.ts: sol(lamports, decimals, up), pct(bps, prose), compact(tokens), short(address), explorer(kind, value, net)"
  - "components/launch-buy.tsx: LaunchBuy (step 2), useQuote (400 ms debounce, wallet only after consent), checkBuy, minOf, needed, EXIT_NAME, types Buy and QuoteState"
  - "components/launch-review.tsx: LaunchReview (step 3), fee callout, connect / paused / sign button"
  - "components/launch-receipt.tsx: LaunchReceipt aside, live fees and costs, Unavailable when the chain read failed"
  - "components/callout.tsx: Callout info / warn / error"
  - "launch-flow.tsx: Live type on StepProps, paused callout between stepper and panel, receipt in the 400px column"
  - "playwright.config.ts: worker webServer (VANITY_THREADS=0) plus web; a paused project that runs after chromium"
  - "e2e/coin.ts: toStep2, toStep3, liveStatus, row, panel, receipt helpers"
affects: [02-10, 02-11, 02-13, 02-17, 02-18]
tech-stack:
  added: []
  patterns:
    - "One useStatus poll and one useQuote per page, in LaunchFlow; steps and the receipt read them through StepProps.live"
    - "An empty dev buy gets the minimum copy, not the not-a-number copy"
    - "Cost rows round up (sol(v, 4, true)) so a real fee never reads 0 SOL"
    - "Specs that flip shared DB state run in their own Playwright project with dependencies on chromium"
key-files:
  created:
    - apps/web/lib/worker.ts
    - apps/web/lib/use-status.ts
    - apps/web/lib/format.ts
    - apps/web/lib/format.test.ts
    - apps/web/app/api/status/route.ts
    - apps/web/app/api/quote/route.ts
    - apps/web/components/callout.tsx
    - apps/web/components/launch-buy.tsx
    - apps/web/components/launch-review.tsx
    - apps/web/components/launch-receipt.tsx
    - apps/web/e2e/paused.e2e.ts
    - apps/web/e2e/coin.ts
  modified:
    - apps/web/components/launch-flow.tsx
    - apps/web/components/README.md
    - apps/web/components/wallet-button.tsx
    - apps/web/components/consent-dialog.tsx
    - apps/web/e2e/launch-form.e2e.ts
    - playwright.config.ts
decisions:
  - "A pause outranks the wallet on step 3: Launches paused shows even when disconnected, since there is nothing to connect for"
  - "Step 3 Connect Phantom to launch is disabled while Phantom is missing or loading; the header popover explains a missing Phantom"
  - "The dev buy error shows once the field has text, has been blurred, or an exit is chosen; the button state uses it at all times"
  - "short() moved to lib/format.ts; wallet-button and consent-dialog import it from there (one copy)"
  - "Review row You after bond uses the UI-SPEC copy (80% of the creator fee, permanently); the live percentage is in the fee callout title"
metrics:
  duration: ~45 min
  completed: 2026-10-19
  tasks: 2
  files: 18
---

# Phase 2 Plan 08: Steps 2 and 3, receipt and paused state Summary

Steps 2 (dev buy and exit) and 3 (review) now work against live devnet values, read through two thin web routes that proxy the worker. The receipt beside the form updates on every keystroke and shows the pump protocol and creator fees from chain (0.95% and 0.30% on devnet today), with BONDR's platform fee at 0. When the owner turns `settings.launches_enabled` off, a paused callout appears without a reload. The form stays fillable, and step 3 shows a disabled "Launches paused" button. Both clear when the flag comes back on.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Worker proxy routes, status polling, display formats, Playwright worker server | d2e2f2c |
| 2 | Step 2, step 3, receipt, paused callout and their e2e | 6398ff9 |

## Verification

- `pnpm vitest run`: 60 passed (4 new in format.test.ts). `pnpm lint` and `pnpm typecheck` exit 0 after each commit. The web build lists `ƒ /api/status` and `ƒ /api/quote` as dynamic.
- `pnpm exec playwright test apps/web/e2e`: 34 passed. That covers launch-form (13, 6 of them new), paused (1, new), wallet (7), consent (7) and terms (6).
- RED: the six new launch-form cases failed against the 02-07 stub before any component existed. Per the orchestrator, no failing test was committed.
- Proxy smoke, through the web dev server and the real worker:
  - `/api/status` returned the live devnet values: min 2500000, fees 95 and 30 bps, create cost 11917680, network fee 10600.
  - `/api/quote` returned tokensOut and solBackEstimate.
  - A cross-site origin got 403. Bad JSON got 400, and `solIn "0"` got the worker's 400 `invalid_input` passed through.
- Kill switch: paused.e2e.ts set the flag to false on the Neon dev branch. The callout appeared above the panel inside 20 s, the form filled through to step 3, and "Launches paused" was disabled. After the flag was restored, the callout cleared inside 20 s on the same page load, and "Connect Phantom to launch" was enabled again. The afterAll asserts the flag is true, and a direct query afterwards confirmed `launches_enabled true`.
- Screenshots of step 2, step 2 with errors, and step 3 were taken at 390, 768 and 1440 (scratchpad, not committed). They match launch.html and the step 2, step 2 errors and step 3 screenshots. At 390, the exit cards stack and the receipt follows the form. At 1440 the receipt is sticky in the 400px column with its perforated edge. No width scrolls sideways. Designer sign-off is at 02-18.

## Acceptance greps

- `import "server-only"` is in worker.ts.
- `WORKER_TOKEN` in apps/web (excluding e2e) appears in `lib/worker.ts` and in `next.config.ts`. The next.config.ts hit is the WEB_ENV allowlist entry from 02-02, which copies the name and never reads the value. No component or route touches the token.
- `cluster=devnet` is in format.ts, and `healthz` is in playwright.config.ts.
- `0\.25` in the three step components: none.
- `1\.5%|2\.45|0\.95` in components: one hit, `md:leading-[0.95]` in consent-dialog.tsx (02-05 line-height, not a fee). No fee literal.
- `role="alert"|role="status"` in callout.tsx: the pattern does not match literally. The roles are set from the variant map (`role: "status"` for info and warn, `role: "alert"` for error) and rendered as `role={v.role}`. The e2e finds the paused callout by `getByRole("status")`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WORKER_URL was not set locally**
- The root .env had no `WORKER_URL`. A node one-liner appended `WORKER_URL=http://127.0.0.1:8080` (gitignored, nothing printed). playwright.config.ts also defaults the web server's WORKER_URL to the worker it starts, so the e2e does not depend on the .env line.
- **Commit:** d2e2f2c (config). The .env is not committed.

**2. [Rule 1 - Test isolation] The pause would leak into parallel specs**
- `fullyParallel` would let the step 3 spec see a paused worker while paused.e2e.ts runs. paused.e2e.ts is now its own `paused` project with `dependencies: ["chromium"]`, so it runs after every other spec. Side effect: running only paused.e2e.ts also runs the chromium project first (about 45 s).
- **Commit:** d2e2f2c, 6398ff9

**3. [Rule 2] Extra e2e and a shared helper file**
- An added case: a consented wallet with 0 SOL gets the Insufficient balance copy and "Fix the dev buy". The step 3 case also asserts that no request carries the wallet before Accept (T-02-08-02).
- `e2e/coin.ts` holds the step 1 and step 2 fillers shared by both specs (not in files_modified). The step 1 tests now import PNG, field and current from it.
- **Commit:** 6398ff9

**4. [AGENTS.md] One copy of short()**
- `short` moved from wallet-button.tsx to lib/format.ts. wallet-button.tsx and consent-dialog.tsx import it from there. Neither file was in files_modified.
- **Commit:** d2e2f2c

**5. [Rule 1] Live region for the pause**
- A role=status element that mounts already holding its text is often not announced. The callout therefore renders inside an always-mounted `aria-live="polite"` wrapper.
- **Commit:** 6398ff9

### Interpretations

- The step 3 table lists "disconnected" before "paused". I put the pause first: the mockup disables the launch button whenever paused, and connecting cannot help while launches are off.
- Chip values use the trimmed SOL form (0.0025, 0.005, 0.01, 0.02), not "two decimals". Two decimals cannot show the devnet minimum.

## TDD Gate Compliance

There is no separate RED commit, per the orchestrator: never commit a failing test. RED was observed locally (6 failed), and test and code were committed together in 6398ff9. format.test.ts was written alongside format.ts and passed on its first run.

## Known Stubs

- "Sign in Phantom" on step 3 moves to step 4. That panel is still only its sr-only heading until 02-13 builds sign and prepare. This is planned.
- `explorer()` has no caller yet. Steps 4 and 5 (02-13) use it, and the plan asked for it now.

## Notes for later plans

- **02-10:** add the per-IP rate limit in `app/api/quote/route.ts`, where a ponytail comment marks the place.
- **02-11:** `workerPost("/prepare", body)` passes the worker's 400/404/409/413/429/500 `{ error, paused }` through and maps anything else to 503 `worker_unavailable`. Prepare should recheck the balance: step 3 does not, and the step 2 check uses the quote's balance, which is briefly missing during the 400 ms debounce.
- **02-13:** StepProps carries `live` (status, statusError, buy, quote). Step 4 should read `live.status?.paused` for the "paused before send" path. The receipt's "Mint, reserved" row should switch to the reserved mint (format `short`) once prepared.
- **Local e2e:** Playwright starts the worker with VANITY_THREADS=0. `reuseExistingServer` reuses any worker already on 8080, including one that is grinding.

## Requirements

None ticked. LAUNCH-02 is also covered by 02-18, LAUNCH-06 by 02-17 and 02-18, and PLAT-04 by 02-18 and others.

## Threat Flags

None beyond the plan's threat model:
- **T-02-08-01:** only worker.ts reads the token, and it is server-only.
- **T-02-08-02:** the wallet is sent to /api/quote only when `consented` is true, and the e2e checks nothing leaks before Accept.
- **T-02-08-03:** `sameOrigin` and the JSON-only guard are on /api/quote (403 and 400 checked).
- **T-02-08-04:** 400 ms debounce, with the rate limit coming in 02-10.
- **T-02-08-05:** the UI only reflects the pause.

## Self-Check: PASSED

- All 12 created files are present.
- Commits d2e2f2c and 6398ff9 are on phase-02-launch-flow.
