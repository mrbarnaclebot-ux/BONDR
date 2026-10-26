---
phase: 06-admin-dashboard
plan: 20
subsystem: web
tags: [moderation, hide, block, web]
requires: [06-18, 06-19]
provides:
  - "AdminOverview.moderation: { hidden: {mint, symbol, reason, at}[]; blocked: {wallet, reason, at}[] }, newest first, in overviewData's one Promise.all"
  - "apps/web/lib/admin-copy-mod.ts: moderationError(result, query) -> {field, text}, moderationDone(op, label), coinLabel(query)"
  - "apps/web/components/admin-moderation.tsx: AdminModeration({overview, onChanged}), mounted in the console's right column"
  - "launch-sign.tsx FAULTS.blocked: 'This wallet cannot launch coins on BONDR.' with no action"
affects: [06-22, 06-25, 06-26]
tech-stack:
  added: []
  patterns: [reversible admin change at once with no dialog then con.reload (as kill switches), refusal-to-field copy map]
key-files:
  created:
    - apps/web/lib/admin-copy-mod.ts
    - apps/web/lib/admin-copy-mod.test.ts
    - apps/web/components/admin-moderation.tsx
    - apps/web/e2e/admin-moderation.e2e.ts
  modified:
    - apps/web/lib/admin-data.ts
    - apps/web/components/launch-sign.tsx
    - apps/web/components/admin-console.tsx
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-20: the hide status line takes the symbol from overview.rows when the query is a mint (the worker's ok answer carries no symbol); otherwise coinLabel upper-cases a symbol or shortens a mint"
  - "06-20: the forms use noValidate and aria-required instead of native required, so an empty reason reaches the worker and shows its 'Add a reason.' FieldError"
  - "06-20: an Unhide or Unblock answered no_match still reloads (another tab undid it); only a network or 5xx failure shows 'Could not save. Try again.'"
  - "06-20: launch-run.ts needed no change: prepare's 403 blocked already becomes Stop('blocked') through call(), so only the FAULTS copy changed"
metrics:
  duration: 16 min
  completed: 2026-10-26
  tasks: 2
  files: 10
---

# Phase 6 Plan 20: Moderation web Summary

The owner hides a coin (by symbol or mint) or blocks a deployer wallet from the console with a reason, at once and with no dialog, sees each change in the list and the audit log, and reverses it with Unhide or Unblock; a blocked wallet's launch reads "This wallet cannot launch coins on BONDR." with no reason shown.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 RED | 97c2214 | admin-copy-mod.test.ts: every ModerationResult reason to its line and field, mint labels, both success lines |
| 1 GREEN | 011b5e8 | admin-copy-mod.ts; overviewData loads hidden coins and blocked deployers newest first; the public blocked copy |
| 2 | 68651e3 | AdminModeration panel mounted in the console; admin-moderation.e2e.ts (admin-serial) |

## Verification

- `pnpm vitest run apps/web/lib/admin-copy-mod.test.ts`: 8 passed
- `pnpm exec playwright test apps/web/e2e/admin-moderation.e2e.ts --project=admin-serial --no-deps`: 3 passed (twice, before and after a refactor)
- `pnpm exec playwright test apps/web/e2e/launch-form.e2e.ts --project=chromium`: 13 passed
- After the runs, a direct Neon read showed no hidden coin and no blocked deployer
- `pnpm lint`, `pnpm typecheck`: clean
- Full `pnpm test`: 88 files, 662 passed, 2 skipped
- Sizes: admin-moderation.tsx 227 lines, admin-console.tsx 149, admin-data.ts 210; every function under 40 lines

## Deviations from Plan

**1. [Rule 1 - Bug] The spec's "drops out of home lists" check read a cached list**
- **Found during:** Task 2, first spec run
- **Issue:** `/api/coins?sort=top` is kept 10 s per key (lib/coins.ts), so it still listed the coin just hidden.
- **Fix:** the spec checks with the mint search (`/api/coins?q={mint}`), a key nothing had cached, and expects no coins.
- **Commit:** 68651e3

**2. launch-run.ts unchanged.** The plan listed it, but prepare's 403 `blocked` already reaches the client as `Stop("blocked")` (LaunchErrorCode includes it), so only launch-sign.tsx's FAULTS entry changed.

**3. The console mount has no wrapper stack.** admin-console.tsx must stay under 150 lines, so AdminModeration sits directly in the right column slot; the inspector plan (06-25) adds the `grid gap-8` stack around it and AdminInspect.

## Notes

- Audit rows the spec writes stay: admin_audit is append-only by trigger (D-33), as with the switch spec.
- The unblock and unhide list buttons read "Saving…" while in flight and disable every other list button until the answer.

## Self-Check: PASSED

- FOUND: apps/web/lib/admin-copy-mod.ts, apps/web/lib/admin-copy-mod.test.ts, apps/web/components/admin-moderation.tsx, apps/web/e2e/admin-moderation.e2e.ts
- FOUND: 97c2214, 011b5e8, 68651e3
