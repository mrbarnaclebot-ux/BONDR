---
phase: 06-admin-dashboard
plan: 07
subsystem: worker
tags: [worker, kill-switch, gates, health, tdd]
requires: [06-06]
provides:
  - switches.ts loadSwitches, switchOn, switchState, setJob, switchesLoaded, SwitchState
  - health.ts bootAt, instance, Mark, mark, marks
  - engine deps allowed = switchOn(job) and no manual hold
  - a gate at the top of windowJob, forcedJob, poolBurnJob, finalizeJob, distributeJob, buybackBurnJob
affects: [06-08 health snapshot, 06-10 hold and release, 06-13 admin money deps, 06-14 switch panel, 06-22 EVACUATE]
tech-stack:
  added: []
  patterns: [switch memory loaded once at boot and written DB-first on each flip, gate per job before any read]
key-files:
  created:
    - apps/worker/src/switches.ts
    - apps/worker/src/switches.test.ts
    - apps/worker/src/health.ts
    - apps/worker/src/fee-gate.test.ts
  modified:
    - apps/worker/src/status.ts
    - apps/worker/src/main.ts
    - apps/worker/src/fee-guard.ts
    - apps/worker/src/fee-burns.ts
    - apps/worker/src/fee-finalize.ts
    - apps/worker/src/fee-batch.ts
    - apps/worker/src/fee-boot.ts
    - apps/worker/src/README.md
decisions:
  - "06-07: a job stamps its last-run mark only after its gate passes, so a paused job's last run goes stale instead of looking alive"
  - "06-07: liveStatus(fresh) re-reads the whole settings row through loadSwitches, so a switch written in SQL also reaches the fee jobs at the next prepare or submit"
  - "06-07: bondedJob checks the forcedBond switch before its urgent collect, so a paused pool burn sends nothing (the collect only feeds the burn)"
  - "06-07: the Phase 5 POST /fee/release runs finalizeJob with the engine deps, so it now obeys the finalize switch and a manual hold; the admin release must use admin deps"
metrics:
  duration: 9 min
  completed: 2026-10-25
  tasks: 2
  files: 12
---

# Phase 6 Plan 07: Kill switches and last-run marks Summary

The owner's five switches (launches, forced bond, sweeps, finalize, buyback burn) now live in worker memory. They load once at boot from the settings row, with `evacuated_at`, and a missing row switches everything off. Each fee job checks its switch and the coin's manual hold on its first line and returns `skipped` before any read or send. Each job that runs also stamps an in-memory last-run time for the health panel.

## What was built

- `switches.ts`: `loadSwitches` (one select of row 1), `switchOn`, `switchState`, `setJob` (UPDATE first, then memory; a failed write leaves memory as it was), `switchesLoaded`. Nothing reads on a timer.
- `status.ts` delegates: `setSwitch` (POST /kill-switch) calls `setJob("launches")` and still answers `{ enabled }`. `liveStatus` reads launches from the same memory, and `fresh` re-reads the row. The module-level `switchOn` in status.ts is gone.
- `main.ts bootIndex`: `loadSwitches()` before `startEngine`, then one log line: `switches: launches=on forcedBond=on sweeps=on finalize=on buybackBurn=on` (real states).
- Gates (D-19, Pattern 7): windowJob uses sweeps; forcedJob, poolBurnJob and bondedJob's burn branch use forcedBond; finalizeJob and distributeJob use finalize; buybackBurnJob uses buybackBurn with coin null. Reconcile has no gate. `settled()` treats `skipped` as not settled (fee-prebond.ts line 83), so bondedJob stops before finalize.
- `fee-boot.ts feeDeps`: `allowed: (job, coin) => switchOn(job) && !coin?.hold`. Admin deps override it with `() => true` (06-11, 06-13).
- `health.ts`: `bootAt`, `instance` (RAILWAY_REPLICA_ID or 4 random bytes in hex), `mark`, `marks`. Marks: windowJob sets `split`, then `sweep` just before its sweep. forcedJob sets `bondCheck`, distributeJob `distribute` and buybackBurnJob `buyback`. Nothing sets `stream` or `engine` yet: 06-08 wires `stream` and derives lastEngine from the job marks.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 RED | 1e39985 | test(06-07): add failing tests for the five switches in memory |
| 1 GREEN | 3ad0729 | feat(06-07): hold the five switches in memory, loaded at boot, launches delegated |
| 2 RED | 398bca9 | test(06-07): add failing tests for the fee job gates and last-run marks |
| 2 GREEN | 768c59d | feat(06-07): gate each fee job on its switch and hold, and stamp its last run |

## Verification

- `pnpm vitest run apps/worker/src/switches.test.ts apps/worker/src/status.test.ts`: 10 passed.
- `pnpm vitest run apps/worker`: 243 passed, 1 skipped (244).
- `pnpm lint`, `pnpm typecheck`: clean.
- Full `pnpm test`: 66 files passed, 509 passed, 2 skipped (511), 396 s.
- Acceptance greps: the six job entries match `allowed("<job>"` (plus the extra bondedJob line), fee-reconcile.ts has no `allowed`, switches.ts has no timer, and main.ts has `switches: launches=`. fee-batch.test.ts and fee-burns.test.ts are untouched.
- Line counts: fee-guard 55, fee-burns 129, fee-finalize 165, fee-batch 195, fee-boot 109, health 22, switches 50, status 229, fee-gate.test 170. All are within budget.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security, T-06-07-01] bondedJob sent an urgent collect while the forced bond switch was off**
- **Found during:** Task 2 (the fee-gate test asserted zero land calls with forcedBond paused)
- **Issue:** bondedJob's burn branch always ran `collectJob(urgent)` and the split before calling poolBurnJob. Gating only poolBurnJob would still have sent a collect and a split under a paused switch.
- **Fix:** one gate line at the top of that branch returns `skipped` before the collect. A coin whose bond burn already landed still goes on to finalizeJob, which has its own finalize gate.
- **Files modified:** apps/worker/src/fee-burns.ts
- **Commit:** 768c59d

**2. [Rule 3 - Blocking] `switchesLoaded()` exported beyond the contract**
- status.ts needs to know whether boot has loaded the switches yet, so GET /status reads the row once instead of reporting paused. The old code checked `switchOn === undefined` for this.

## Notes for later plans

- Admin deps must set `allowed: () => true` (D-16). Without it, an admin run on a held coin or under a paused switch returns `skipped`.
- POST /fee/release (Engine.release, then finalizeJob with the engine deps) now does nothing while finalize is paused or the coin is under a manual hold. 06-10 and 06-13 should route the owner's release through admin deps.
- A `skipped` result is neutral for stuck tracking: `verdict` returns null, so it neither fails nor clears a step. The batch summary shows `burn: "skipped"` when the buyback burn is paused, and `finalize` still counts the bonded retries it queued.
- `setJob` before `loadSwitches` writes one switch on top of an all-off memory, which is fail closed. With no settings row, the UPDATE matches nothing but memory still flips; the old `setSwitch` behaved the same way.
- POST /admin/switch (06-08 or 06-14) should call `setJob(job, enabled)` and return its `AdminSwitches`.

## Known Stubs

None.

## TDD Gate Compliance

Both tasks have a `test(...)` commit, then a `feat(...)` commit. One case passed during Task 2's RED run: "with sweeps paused the forced bond still collects, splits and lands". It guards against a regression, because the per-job gate must not pause the forced bond's urgent collect. The other five cases failed for the expected reasons.

## Self-Check: PASSED
