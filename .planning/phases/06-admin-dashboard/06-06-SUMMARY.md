---
phase: 06-admin-dashboard
plan: 06
subsystem: worker
tags: [worker, engine, split, hold, stuck, tdd]
requires: [06-04]
provides:
  - fee-boot.ts feeEngine, onIngest, startEngine, withCost, feeDeps (exported), loadCoin(mint)
  - Engine.exclusive(mint, fn, what?), idle(mints), coin(mint), setHold(mint, reason, resetFinalize), memory(), stuckCount(), STUCK_AT
  - fee-stuck.ts stepOf, verdict, codeOf (pure)
  - FeeCoin.hold, FeeDeps.allowed?(job, coin)
affects: [06-07 switches, 06-08 health, 06-11/06-13 admin actions, 06-16/06-17 W table and timeline, 06-22 EVACUATE]
tech-stack:
  added: []
  patterns: [one queue tail per mint shared by enqueue and exclusive, failures recorded from the job's returned Landed]
key-files:
  created:
    - apps/worker/src/fee-boot.ts
    - apps/worker/src/fee-stuck.ts
    - apps/worker/src/fee-engine-admin.test.ts
  modified:
    - apps/worker/src/fee-engine.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/fee-batch.ts
    - apps/worker/src/main.ts
    - apps/worker/src/announce.ts
    - apps/worker/src/ingest.ts
    - apps/worker/src/fee-engine.test.ts (import path only)
    - apps/worker/src/README.md
decisions:
  - "06-06: stuck counts per step: a repeat of the same step counts up, a different step failing starts at 1, any landed result clears the coin"
  - "06-06: step names come from the job label: finalize, forced bond, bonded, sweep (fee window), distribute, buyback burn; exclusive defaults to admin unless the caller passes a label"
  - "06-06: stuck codes are simulation_failed, blockhash_expired, rate_limited, timeout, insufficient_funds, job_error (thrown) and send_failed or program_<n> (failed Landed)"
  - "06-06: memory() lists the engine's loaded coins only; stuckCount() counts every failing queue key (platform included) and first is the earliest stuck"
  - "06-06: engine jobs and the batch's distribute and bonded jobs now return their Landed so the queue can see failed or landed steps"
metrics:
  duration: 12 min
  completed: 2026-10-25
  tasks: 2
  files: 11
---

# Phase 6 Plan 06: Engine admin controls Summary

Admin code can now drive the fee engine. Boot and deps moved out of fee-engine.ts into fee-boot.ts. The Engine has a result-returning `exclusive` run on a coin's queue in every mode, `idle` waits across several mints, a stuck-step memory (3 failures of one step since boot), and a manual hold loaded from `coins.held_reason` that is kept apart from `finalize = 'held'`.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Move boot and deps into fee-boot.ts | 8f4a1fe |
| 2 | Stuck memory, exclusive runs, idle waits and the manual hold (RED) | 559c235 |
| 2 | Stuck memory, exclusive runs, idle waits and the manual hold (GREEN) | b6268b3 |

## Task notes

- Task 1: fee-engine.ts lines 224-299 moved as they were, except `feeDeps` is now exported. fee-engine.ts exports `logged` and `WOf` for fee-boot.ts. The worker suite passed with only import paths edited: 29 files, 222 passed, 1 skipped. fee-engine.ts went from 299 to 209 lines, and fee-boot.ts is 97.
- Task 2 (TDD): all 10 cases failed first. Both rejections and failed Landed results go through one `track(mint, run, what, onError?)`, which sets the queue tail and records the verdict. `enqueue` passes `logged(what)` as onError, so its logging is unchanged. `exclusive` hands back the raw promise and stores the swallowing tail. Each internal engine job now uses `report(what)`, which logs the same `${what}: ${summary}` line as before and then returns the Landed[]. `loadRows(where?)` selects `heldReason`. `coinFrom` sets `hold` when it is non-null. `loadCoin(mint)` reads one row through `costCtx.wOf`, which `startEngine` sets in every mode, including off.

## Verification

- `pnpm vitest run apps/worker/src/fee-engine-admin.test.ts apps/worker/src/fee-engine.test.ts`: 2 files, 22 passed
- `pnpm vitest run apps/worker`: 30 files, 232 passed, 1 skipped
- `pnpm typecheck`: pass
- `pnpm lint`: clean (335 files)
- `pnpm test`: 64 files passed, 498 tests passed, 2 skipped, 0 failed
- Line counts: fee-engine.ts 273, fee-boot.ts 106, fee-send.ts 270, fee-stuck.ts 38, fee-engine-admin.test.ts 201

## Deviations from Plan

**1. [Rule 3 - Blocking] Stuck helpers live in a new fee-stuck.ts**
- Found during: Task 2
- Issue: with the helpers inline, fee-engine.ts came to 304 lines, over the 300-line rule.
- Fix: moved `STUCK_AT`, `stepOf`, `verdict` and `codeOf` (all pure) into fee-stuck.ts. fee-engine.ts re-exports `STUCK_AT`, so the contract import path still works.
- Commit: b6268b3

**2. [Rule 2 - Missing] Batch distribute and bonded jobs return their result**
- Found during: Task 2
- Issue: the batch's `pay` and `retry` jobs in fee-batch.ts returned void. A failed distribute send would never count toward stuck, yet the plan lists distribute as a step.
- Fix: both jobs now return their Landed. Counting and logging are unchanged. fee-batch.ts was not in the plan's file list.
- Commit: b6268b3

**3. [Contract addition] `exclusive` takes an optional third `what` label**
- This lets admin callers pass `fee finalize <mint>` and similar labels, so a failed admin retry counts against the same step as the automatic job. The default is `admin <mint>`.

## Threat mitigations

- T-06-06-01 and 02: `exclusive` chains on the same `queue` tail as `enqueue`. A test checks that the auto job runs first, then admin, then a rejecting admin job (rethrown to the caller), then the next job.
- T-06-06-03: codes come from a fixed table, and the test checks that a message containing an api-key URL never reaches `memory()`.
- T-06-06-04: `hold` is its own field. `setHold(mint, null, true)` moves finalize from held to none and leaves done alone (tested).

## Requirements

ADMIN-03, ADMIN-08 and ADMIN-11 are not marked complete. This plan adds engine plumbing, and the actions, timeline and EVACUATE come in later plans.

## Self-Check: PASSED

- FOUND: apps/worker/src/fee-boot.ts, apps/worker/src/fee-stuck.ts, apps/worker/src/fee-engine-admin.test.ts
- FOUND: 8f4a1fe, 559c235, b6268b3
