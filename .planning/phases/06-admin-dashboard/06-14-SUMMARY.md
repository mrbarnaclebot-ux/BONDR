---
phase: 06-admin-dashboard
plan: 14
subsystem: web
tags: [web, kill-switches, audit-log, keyset-paging, tdd]
requires: [06-12]
provides:
  - admin-audit-page.ts auditPage, parseAuditCursor, AUDIT_PAGE (50)
  - AdminOverview.audit (first page) and AdminOverview.net
  - LOCAL op audit {before} (400 invalid_input on a malformed cursor)
  - admin-copy-audit.ts JOB_LABEL, auditActionCopy, auditTime, auditSim, auditResult
  - admin-switches.tsx KillSwitches; admin-audit.tsx AuditLog
  - e2e/admin-switch.e2e.ts (admin-serial)
affects: [06-16 W table, 06-17 timeline, 06-18 dialog, 06-20 moderation, 06-22/23 evacuate]
tech-stack:
  added: []
  patterns: [poll value overridden by in-flight target and a newer flip answer, panel remount keyed on overview loadedAt to drop older pages]
key-files:
  created:
    - apps/web/lib/admin-audit-page.ts
    - apps/web/lib/admin-copy-audit.ts
    - apps/web/lib/admin-copy-audit.test.ts
    - apps/web/components/admin-audit.tsx
    - apps/web/components/admin-switches.tsx
    - apps/web/e2e/admin-switch.e2e.ts
  modified:
    - apps/web/lib/admin-data.ts
    - apps/web/app/api/admin/[op]/route.ts
    - apps/web/components/admin-console.tsx
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-14: switch values come from the health poll only; the worker overview carries no switches, so before the first poll lands each row reads Unknown and is aria-disabled"
  - "06-14: the audit page sends only the params keys the copy reads (job, enabled, wallet, wallets); a hold reason or intent id never reaches the browser (T-06-14-03)"
  - "06-14: AuditLog is keyed on overview.loadedAt, so every overview load (Refresh, after a flip) drops older pages and shows the newest 50"
  - "06-14: AdminOverview gains net (from SOLANA_NET) for the audit Solscan links"
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 2
  files: 12
---

# Phase 6 Plan 14: Kill switches and the audit log Summary

The owner can now pause and resume any of the five jobs from the console with one click: no dialog, no fresh signature. The change survives a reload, and the worker writes it to the audit log. The Audit log panel lists every admin action, newest first. The first 50 rows come with the one overview load, and older pages load only when the owner clicks.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | Audit reader, copy and the audit panel | d94e776 (RED), c31fb50 (GREEN) |
| 2 | Kill switches panel and the serial spec | c3538cb |

## What was built

- `admin-audit-page.ts`: `auditPage(before?)` uses ledger.ts's keyset (truncated ms plus id, at desc and id desc) with 51 rows to compute `more`. It left-joins coins and launches for the symbol, trims simulation to `{ ok, cu }` and allowlists params. `parseAuditCursor` is `parseLedgerCursor`.
- `overviewData` runs `auditPage()` inside its Promise.all, so it is still one load. `emptyOverview` has an empty page.
- `[op]/route.ts`: LOCAL `audit` takes `{ before }`. A missing or malformed cursor answers 400 `invalid_input`. The two local ops share one `read()` that logs only the error code.
- `admin-copy-audit.ts`: action copy for all 18 actions. `finalize_split` reads "Retry finalize split: SWMP", following the UI-SPEC example. Also local times, the simulation and result words, and `JOB_LABEL`.
- `admin-audit.tsx`: the six columns in a focusable `<section aria-label="Audit log table, scrolls sideways">` (min width 880px, sticky Time column with a `bg-surface` fill). Times render after mount in the viewer's time zone. `LoadMore` uses the admin copy. The empty state uses the UI-SPEC copy. A failed page load reads "Could not load the audit log. Refresh to try again." No timers.
- `admin-switches.tsx`: five native `button role="switch"` rows (48 by 44 hit area, 28px track, knob translate-x 20px over 260ms ease-out, no motion under reduced motion). While a flip is in flight, the row shows the target value, reads "Saving…" and is aria-disabled, and the poll is ignored for that job. A success applies the worker's answer until a newer poll lands, then calls `con.reload()`. A failure reverts and shows the role alert line. A 401 calls onUnauthorized. Warn callouts show for FEE_ENGINE off or dry, and after EVACUATE.
- `admin-console.tsx` (165 lines): adds the two mounts only.

## Verification

- `pnpm vitest run apps/web/lib/admin-copy-audit.test.ts`: 6 passed. The RED run failed first because the module was missing.
- `pnpm exec playwright test apps/web/e2e/admin-switch.e2e.ts --project=admin-serial --no-deps`: 5 passed. The first run failed 1 test (the health route was registered after the first poll; fixed with a reload). Re-run together with admin-console.e2e.ts: 9 passed, none skipped. afterAll checks that health shows all five switches on.
- Gate screenshots at 390, 768 and 1440 through `shoot.ts gate`: no horizontal scroll, 0 axe violations. They were saved in scratch and not committed.
- `pnpm typecheck`: pass. `pnpm lint`: clean (378 files).
- Full `pnpm test`: 81 files passed, 611 passed, 2 skipped (613).
- Acceptance greps: `auditPage` is in admin-data.ts. There is no setInterval or setTimeout in admin-audit.tsx. `role="switch"` is present. There is no `<dialog` or `confirm(` in admin-switches.tsx. Every file is under 300 lines and admin-console.tsx is under 200.

## Deviations from Plan

**1. [Rule 3 - Blocking] No overview switches to seed from.** The plan says initial values come from the overview's worker switches, but `AdminOverviewWorker` has no switches. I did not widen the worker contract. Rows read "Unknown" and are disabled until the first poll lands, which happens immediately on mount.

**2. [Rule 3 - Blocking] `net` added to AdminOverview.** TxLink needs the cluster, and nothing in the console carried it.

**3. [Rule 2 - Security] Params allowlist in the audit page** (T-06-14-03). Hold reasons and intent ids stay on the server.

**4. Scroll region as `<section aria-label tabIndex=0>`**, not `div role="region"`. Biome's useSemanticElements refuses the div, and a named section is the same region landmark. noNoninteractiveTabindex is suppressed with its reason.

**5. Extra e2e coverage:** "Saving…" plus aria-disabled during a held flip, the evacuated callout, and the audit op's 400 and a valid page.

## Requirements

ADMIN-05 is complete: the worker route (06-10) and the console switches (this plan). ADMIN-10 is complete: the writer (06-10, 06-13) and the visible log with paging (this plan).

## Known Stubs

None. The two-column row (06-17) and the EVACUATE slot (06-23) remain comments, as planned.

## For the next plans

- Audit action copy reads `params.wallet` for block and unblock, and `params.wallets` (a number) for evacuate. 06-20 and 06-22 must write those keys, or the copy shows "…" and "all". `shownParams` in admin-audit-page.ts is the allowlist. Add any new key there.
- The `COIN_ACTION` labels in admin-copy-audit.ts match the timeline's recovery buttons, so 06-17 can import them instead of retyping.
- Any panel that calls `con.reload()` refreshes the audit log, because AuditLog remounts on `loadedAt`.
- Local FEE_ENGINE is off, so the console always shows the engine callout in dev.

## Self-Check: PASSED

- All six created files exist. Commits d94e776, c31fb50 and c3538cb are in `git log`.
