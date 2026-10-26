---
phase: 07-go-live
plan: 11
subsystem: admin console health and kill switches
tags: [admin, health, contract-check, ui]
requires: [07-10]
provides:
  - "apps/web/lib/admin-copy-health.ts contractCopy(c, now): Cell; Cell gains optional dot"
  - "Pump contract check cell (last, md:col-span-2) with Run check now in admin-health.tsx"
  - "FORWARD entry contract-check -> /admin/contract-check"
  - "Kill switches error callout 'The pump contract check failed.' on a mismatch"
  - "stubConsole(page, { health? }) merges fields into every real health answer"
affects: [07-15 genesis callout in Notices, later admin responsive shots]
key-files:
  created:
    - apps/web/e2e/admin-contract.e2e.ts
  modified:
    - apps/web/lib/admin-copy-health.ts
    - apps/web/lib/admin-copy-health.test.ts
    - apps/web/components/admin-health.tsx
    - apps/web/components/admin-switches.tsx
    - apps/web/app/api/admin/[op]/route.ts
    - apps/web/e2e/admin-stubs.ts
    - apps/web/components/README.md
    - .planning/phases/07-go-live/07-UI-SPEC.md
key-decisions:
  - "07-11: the Run check now answer replaces the poll's contract until a poll that left after the answer lands (poll.lastOk is the poll's start time)"
  - "07-11: the mismatch callout is keyed by the run's time, so each new mismatch mounts one new alert"
requirements-completed: []
duration: 20min
completed: 2026-10-26
---

# Phase 7 Plan 11: Admin Pump Contract Check Cell Summary

**The owner console now shows the contract check in the Health panel's last, full-width cell, built from worker memory on the existing 10 s poll: Not run since boot, Checking…, Passed {time} in leaf, Passed with a pump redeploy in amber, Mismatch with a static destructive dot and every fact, and Could not run. "Run check now" posts through the admin forwarder and shows the answer at once. On a mismatch, Kill switches leads with an error callout. Both the cell and the callout say launches stay paused until Run check now passes.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | contractCopy, one case per state row; UI-SPEC copy aligned | 372f575 |
| 2 | The cell, Run check now, the forwarder entry and the mismatch callout | 777849e |
| docs | Components README | 30d5e2c |

## Evidence

- admin-copy-health.test.ts: 4 new cases (not run, checking and passed; redeployed with one, two and three programs; mismatch with the dot and joined facts; could not run with and without a last pass). The tests failed before contractCopy existed. 19 tests pass, including admin-copy-audit.
- admin-contract.e2e.ts: 6 passed (passed in text-leaf; redeployed in text-warn; mismatch value, one destructive dot, both facts and the Kill switches alert; could not run; Run check now answered with passed updates the cell; a 500 shows "Could not run the check. Try again." in an alert).
- UI-SPEC: 3 lines carry "Launches stay paused until Run check now passes." (the state table, the callout row and the copywriting row with both strings).
- `pnpm typecheck` and `pnpm lint` are clean. admin-health.tsx is 187 lines, admin-switches.tsx 142, route.ts 97, admin-copy-health.ts 176.
- No new Postgres read. The cell uses the existing health poll, and the forwarder route reaches only worker memory and RPC.

## Deviations from Plan

1. **A function-only import cycle.** admin-copy-health.ts now imports `auditTime` from admin-copy-audit.ts, which already imports `clock` from admin-copy-health.ts. Both are plain functions and nothing runs at import, so the cycle is safe. A comment at the import explains it.
2. **The StuckLine classes moved into a shared `LINK` const**, which both buttons use. The output is unchanged.
3. **No screenshot matrix in this plan.** The plan asks for none. The admin responsive shots with the contract states belong to the phase's UI verification plans.

## Notes for later plans

- 07-15 adds the genesis callout in `Notices`, after the contract mismatch callout and before the fee engine notice (UI-SPEC surface 6 order).
- Every AdminHealth literal needs `contract`. Use `stubConsole(page, { health: {...} })` to drive any health state in a spec.

## Threat Flags

None. T-07-11-01..04 are handled as planned: the cookie-gated forwarder with the actor from the cookie and the worker's gated(); every state shown as a word with an aria-hidden dot; no new reads; facts are public chain data.

## Self-Check: PASSED

- FOUND apps/web/e2e/admin-contract.e2e.ts
- FOUND commits 372f575, 777849e, 30d5e2c
