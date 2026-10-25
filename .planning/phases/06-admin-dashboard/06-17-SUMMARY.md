---
phase: 06-admin-dashboard
plan: 17
subsystem: web
tags: [web, timeline, recovery-actions, hold, recheck-launch, tdd]
requires: [06-16]
provides:
  - admin-timeline.ts timelineSteps, types Step/CoinTimeline/TimelineRow/TimelineLaunch
  - admin-timeline-data.ts coinTimeline (server-only)
  - admin-applies.ts actionStates, isHeld, types ActionKey/GridKey/ActionState
  - admin-copy-actions.ts ACTION_COPY, DEFAULT_HINT, fill, actResultCopy, stuckErrorCopy
  - LOCAL admin op coin {mint} -> {timeline, live}
  - AdminTimeline (optional onTx), StuckBox, HeldBox, ActionGrid, ActionButton, isAct
  - Panel focusTitle prop
  - e2e/admin-timeline.e2e.ts
affects: [06-18 dialog, 06-25 phase gate]
tech-stack:
  added: []
  patterns: [pure step builder run client-side with the viewer's clock; one coin request per pick and per overview load]
key-files:
  created:
    - apps/web/lib/admin-timeline.ts
    - apps/web/lib/admin-timeline-data.ts
    - apps/web/lib/admin-applies.ts
    - apps/web/lib/admin-copy-actions.ts
    - apps/web/lib/admin-timeline.test.ts
    - apps/web/lib/admin-applies.test.ts
    - apps/web/lib/admin-copy-actions.test.ts
    - apps/web/components/admin-timeline.tsx
    - apps/web/components/admin-timeline-boxes.tsx
    - apps/web/components/admin-action-grid.tsx
    - apps/web/e2e/admin-timeline.e2e.ts
  modified:
    - apps/web/app/api/admin/[op]/route.ts
    - apps/web/components/admin-console.tsx
    - apps/web/components/admin-panel.tsx
    - apps/web/components/admin-audit.tsx
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-17: coinTimeline lives in admin-timeline-data.ts (server-only), not admin-timeline.ts, so the client component can import the pure timelineSteps without pulling the database into the browser bundle"
  - "06-17: the coin refetches on each overview load (Refresh, or the reload after an action) as well as on a pick; still user-driven, never a timer"
  - "06-17: the final step is titled 'Up next' with the next-step copy as its sub-line; a stuck step is titled with the engine name (update_fee_shares_v2 once the config landed, else create_fee_sharing_config); a held step reads 'Finalize held' or 'Held for review'"
  - "06-17: an unconfirmed launch shows only its launch step, state next, sub-line 'Re-check launch' (no stuck box: there is no error or attempt count to show)"
  - "06-17: hold and release_hold toggle on the held flag (heldAt, finalize held or a memory hold): exactly one applies; the console's hold reason is 'Held for review from the console' (Claude's discretion)"
  - "06-17: collects fold by collect rows only (each split is its collect's 10%), detail is the BONDR collected; distributes fold into one step"
metrics:
  duration: 45 min
  completed: 2026-10-25
  tasks: 2
  files: 18
---

# Phase 6 Plan 17: Per-coin timeline and non-transaction actions Summary

Picking a coin now opens its Timeline. It shows the launch, every landed fee step with its Solscan link, any reconcile mismatch, and then one stuck, held or next step. Under that sits the recovery grid: each button that does not apply stays focusable and says why. Hold for review, Release hold and Re-check launch run in one click.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | Timeline builder, applicability and action copy | 22e5aa0 (RED), de7fb1d (GREEN) |
| 2 | Timeline panel with non-transaction actions | 589ca75, 055142a (refactor, function size) |

## What was built

- `admin-timeline.ts` (191 lines, pure). `timelineSteps(t, row, mem, live, now, windowMs)` builds the steps in order:
  - The launch step comes first: "Launched, insta burn" or "Launched, insta sell", with the burned tokens or the dev buy.
  - Then the ledger and migration steps, sorted by time:
    - Collects fold into "Collect and split, {n} runs" with the BONDR collected.
    - Forced-bond and fallback burns, then "Migrated to PumpSwap" (from `bondedAt`).
    - "Pending fees swept" when finalize_config moved fees, then create_fee_sharing_config and update_fee_shares_v2 with its bps.
    - "Distributed post-bond fees" (folded), "Swept to buyback, window {n}" for each window, leftovers, evacuate, and "Reconcile mismatch, {bondr} BONDR".
    - Failed, expired and pending rows are left out.
  - Then one closing step: stuck ("Stuck, {n} attempts"), held ("Held {age} ago", using `heldAt` or else the latest held row), or "Up next" with `nextStepCopy`.
  - Each sub-line already carries its age, so the component renders it as given.
- `admin-timeline-data.ts`: server-only `coinTimeline(mint)`. It reads the landed launch (or the newest one), plus every fee_ledger row for the mint, oldest first, in one Promise.all.
- `admin-applies.ts`: `actionStates` copies the worker's applies rules:
  - curve: sweep now; plus retry forced bond once the stored budget reaches 105% of cost
  - live child tokens: burn W tokens
  - complete: run migrate
  - pool, not finalized: finalize split
  - finalized: distribute now and sweep leftovers
  - a failed or expired sweep with no pending or landed twin: retry sweep
  - BONDR in the buyback: burn buyback
  - unconfirmed launch: re-check launch
  - hold and release_hold toggle on the held flag
  - Transaction actions need a landed launch.
  - Each reason is filled-in copy when the action does not apply, and empty when it does.
- `admin-copy-actions.ts`:
  - `ACTION_COPY` covers all 13 keys. Reasons match the UI-SPEC table word for word, and the finalize and burn permanent callouts are included.
  - `DEFAULT_HINT`, `fill` and `actResultCopy`. A worker error or no answer reads "...Nothing changed...".
  - `stuckErrorCopy` maps the fee-stuck.ts codes, plus `program_N`, to words. Anything else reads "an unexpected error".
- LOCAL op `coin`:
  - It checks the mint against BASE58_KEY and answers 400 before any read.
  - It then runs `coinTimeline` and the worker's coin-live read together, using the cookie actor.
  - `live` is null when the worker gives anything but 200.
- `AdminTimeline` (230 lines):
  - The h2 "Timeline, {SYMBOL}" is a focus target, with the W Solscan note and the live line "W holds {sol} SOL, {bondr} BONDR, {tokens} {SYMBOL}" plus a Token page link.
  - The steps `ol` carries sr-only state words. Stuck and held boxes sit inside their step.
  - The grid has the polite hint line.
  - It sends one coin POST per pick and per overview load. A 401 ends the session.
  - The act POST sends hold with its reason. While it runs the button reads "Working…" with aria-busy. Afterwards the result goes to the hint and `reload()` runs.
  - Transaction buttons, including the stuck box retry and the held box Finalize split, render only when `onTx` is passed.
- `admin-console.tsx` (199 lines):
  - The Timeline is mounted in the 1.3fr/1fr row, from 1100px up.
  - `usePick` wraps `con.select` for the W table and the Health stuck button. Focus moves to the Timeline h2 only after a user pick, never on the default selection.

## Verification

- `pnpm vitest run` on the three new test files: 19 passed. The RED run failed first because the modules were missing.
- `pnpm exec playwright test apps/web/e2e/admin-timeline.e2e.ts --project=chromium`: 4 passed, none skipped. The first run ever failed one test, Hold for review, because an element was not found while the dev server was compiling cold. The next five runs passed 4/4. Re-run together with admin-wtable and admin-console: 9 passed.
- I also ran a layout gate (`shoot.ts gate`) from a temporary spec for STUK (stuck box) and COLL at 390, 768, 1100 and 1440. All 8 passed with no horizontal scroll and 0 axe violations. The spec was deleted afterwards, and the screenshots stay in scratch, not committed.
- `pnpm lint`: clean (397 files). `pnpm typecheck`: passes.
- Full `pnpm test`: 86 files, 650 passed, 2 skipped (652).
- Acceptance greps:
  - `aria-disabled` is present in admin-action-grid.tsx.
  - No ` disabled` attribute appears on any action button.
  - No `setInterval` or `setTimeout` appears in the three components.
  - Every file is under 300 lines and every function under 40. admin-console.tsx is under 200.

## Deviations from Plan

**1. [Rule 3 - Blocking] coinTimeline moved to `admin-timeline-data.ts`.** The contract put it in admin-timeline.ts next to `timelineSteps`. The client panel imports `timelineSteps`, and a server-only database import there would break the client build. `timelineSteps` and the types stay in admin-timeline.ts as specified.

**2. e2e check (1) uses "Re-check launch" rather than "Run migrate" as the aria-disabled button.** Check (4) requires that no transaction button renders without `onTx`, so Run migrate cannot appear in this plan. Re-check launch on a landed coin is non-applicable and non-transaction, so it exercises the same path: aria-disabled stays focusable and Enter writes the reason. 06-18 can add the Run migrate assertion once `onTx` exists.

**3. `ActionKey` is defined in admin-copy-actions.ts and re-exported from admin-applies.ts**, which avoids an import cycle. `GridKey = Exclude<ActionKey, "evacuate">` is the actionStates key type. `ACTION_COPY.evacuate` exists only so the map covers every key ("EVACUATE runs from its own panel.").

**4. `Panel` gained `focusTitle`** (h2 tabIndex -1), so the Timeline can use the shared shell.

**5. The coin also refetches on each overview load.** That load comes from Refresh or from the reload after an action, so this is how the plan's "reload and refetch the coin" is done. It is still never on a timer.

**6. The COIN_ACTION export suggested in carry was not used.** The grid label "Finalize split" differs from the audit label "Retry finalize split", so `ACTION_COPY` holds its own labels.

**Extra (requested): audit table scroll box.** `admin-audit.tsx`'s scroll section is now `relative`, with a why-comment. This is the one-word fix from deferred-items.md (06-16).

## Requirements

Neither ADMIN-08 nor ADMIN-03 is ticked:
- ADMIN-08: the timeline, its steps and the next step ship here, but the stuck step's retry button renders only once 06-18 passes `onTx`.
- ADMIN-03: hold, release and re-check ship here; the transaction actions come in 06-18.

## Known Stubs

None. The transaction buttons are deliberately absent until 06-18 passes `onTx`, as the contract specifies.

## Threat Flags

None. The new `coin` op is in the plan's threat model (T-06-17-03). Like every admin op it is gated by cookie, sameOrigin and rate limit, and it checks the mint before any read. Stuck errors go through `stuckErrorCopy` (T-06-17-02).

## Self-Check: PASSED

- The created files exist. Commits 22e5aa0, de7fb1d, 589ca75 and 055142a are in `git log`.
