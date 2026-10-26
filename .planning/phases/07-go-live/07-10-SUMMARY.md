---
phase: 07-go-live
plan: 10
subsystem: worker contract check, switches, launch banner
tags: [contract-check, switches, health, pause, tdd]
requires: [07-08, 07-09]
provides:
  - "switches.ts switchesOff(): the five switch columns off in one write, evacuated_at untouched"
  - "apps/worker/src/contract-check.ts: runCheck(deps?), scheduleCheck(hour, deps), contractDeps(conn, net, bondr?), contractState(), contractFailed(), nextCheckAt(now, hour), resetCheck() (tests)"
  - "core api-admin AdminContract { kind, at, facts, programs, lastPass } and ContractKind; AdminHealth.contract"
  - "POST /admin/contract-check (gated) returns AdminContract"
  - "PauseReason gains contract_check; pauseReason({ enabled, venue, contract })"
affects: [07-11 admin contract cell, 07-15 genesis pause reason, 07-21/07-24/07-28/07-31/07-35 grep 'contract check passed']
key-files:
  created:
    - apps/worker/src/contract-check.ts
    - apps/worker/src/contract-check.test.ts
    - apps/web/e2e/launch-paused.e2e.ts
  modified:
    - apps/worker/src/switches.ts
    - apps/worker/src/switches.test.ts
    - apps/worker/src/main.ts
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/health.ts
    - apps/worker/src/health.test.ts
    - apps/worker/src/status.ts
    - apps/worker/src/status.test.ts
    - apps/worker/src/README.md
    - packages/core/src/api-admin.ts
    - packages/core/src/api.ts
    - apps/web/components/launch-flow.tsx
    - apps/web/app/page.tsx
    - apps/web/lib/admin-copy-health.test.ts
key-decisions:
  - "07-10: AdminContract is one flat shape keyed by kind (every field on every state) rather than a per-kind union, so the console reads it without narrowing"
  - "07-10: the deploy-slot baseline is the first completed run since boot; redeployed stays amber until restart"
  - "07-10: a failed pause write (database down) still leaves contractFailed true, so launches report contract_check from memory"
  - "07-10: the timer arms straight to nextCheckAt (next Monday at FEE_BATCH_HOUR_UTC) instead of firing daily and skipping non-Mondays: same schedule, one timer per week"
  - "07-10: pause priority is contract_check, then kill_switch, then awaiting_migration (kill_switch before awaiting kept as today, per the plan's behavior table)"
requirements-completed: []
duration: 30min
completed: 2026-10-26
---

# Phase 7 Plan 10: Contract Check in the Worker Summary

**The core contract check now runs inside the worker at boot, every Monday at FEE_BATCH_HOUR_UTC on its own timer (genesis and FEE_ENGINE=off included), and on POST /admin/contract-check. A mismatch turns every switch off through a switches-only write (no evacuated_at), writes one `contract_check` audit row and a Sentry error naming the facts, and keeps launches paused with the new `contract_check` reason until a later run passes. A changed deploy slot with passing facts is a warning; an RPC failure pauses nothing.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | switchesOff and contract-check.ts with the forced-mismatch proof | 61b7f03 |
| 2 | Boot, timer, admin route and health wiring | 834624b |
| 3 | contract_check pause reason and the launch banner per reason | 18c9562 |
| docs | Worker src README index | 2f9ca0f |

## Evidence

- contract-check.test.ts (new, unit, no database): forced mismatch built by `judge` from the devnet facts with Global grown to 1,096 bytes against the mainnet profile (wrong value plus wrong size): off called once, one audit row `{ actor: contract_check, action: switch, params: { job: all, enabled: false, facts } }`, state mismatch, contractFailed true, console.error names the facts; pass logs exactly `contract check passed: pump=510657843 pump AMM=508659436 pump fees=508659783`; redeployed warns once and pauses nothing; contractFailed stays true until a passing run; a throw is "failed" with lastPass kept; two concurrent runs share one check; nextCheckAt across Monday before/at the hour, Wednesday and Sunday.
- switches.test.ts: switchesOff writes exactly the five columns, keeps an existing evacuatedAt in memory and writes none.
- admin-routes.test.ts: the route list includes contract-check; the admin actor gets the not_run state, another actor 403 forbidden. health.test.ts: the snapshot includes `contract` (still with db() throwing).
- status.test.ts: the pauseReason table, contract_check ahead of kill_switch and awaiting_migration.
- launch-paused.e2e.ts: 2 passed (contract_check banner with "Trading is not affected." and a disabled "Launches paused" at step 3; kill_switch keeps its body).
- Live devnet run of the runner with the worker's own BONDR quote mint (`--bondr`): exit 0, so the boot check on local and staging passes.
- `pnpm typecheck`, `pnpm lint`: clean. contract-check.ts 117 lines, main.ts 115. No trade-*.ts file touched (D-22).

## Deviations from Plan

1. **[Rule 3] Home page PAUSED map.** apps/web/app/page.tsx has its own `Record<PauseReason, string>`, so it gained a contract_check line (the launch body's first two sentences) to keep the web typecheck green.
2. **[Rule 3] admin-copy-health.test.ts health literal** gained `contract` for the new required AdminHealth field.
3. **Pause priority.** The plan's must-have line and the UI-SPEC put awaiting_migration ahead of kill_switch, but the plan's own behavior table says `{ enabled: false, venue: "awaiting" }` stays "kill_switch" as today. I kept today's order below contract_check: the owner's pause does not lift itself, so "resume automatically" copy would be wrong. Flag for the verifier.
4. **TDD order.** For Task 1 the tests and the module were written in one step, and the tests passed on their first run, so no failing run was recorded. Task 3's new pauseReason case was seen failing first.
5. **Timer.** The plan describes a daily timer that skips non-Mondays; the timer arms straight to nextCheckAt instead. Same schedule, still restart-safe.

## Notes for later plans

- Later plans grep the log prefix `contract check passed:`.
- `runCheck()` with no deps returns the current state until main.ts has called `scheduleCheck` (which wires the deps).
- 07-15 adds `genesis` ahead of contract_check in pauseReason and in the launch PAUSED map (now `{ title, body }` per reason).
- The contract check runs at every worker boot, including the Playwright web server worker (4 RPC reads, writes only on a mismatch).

## Threat Flags

None. T-07-10-01..06 are mitigated as planned.

## Self-Check: PASSED

- FOUND apps/worker/src/contract-check.ts, apps/worker/src/contract-check.test.ts, apps/web/e2e/launch-paused.e2e.ts
- FOUND commits 61b7f03, 834624b, 18c9562, 2f9ca0f
