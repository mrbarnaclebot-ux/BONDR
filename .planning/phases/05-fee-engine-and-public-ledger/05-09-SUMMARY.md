---
phase: 05-fee-engine-and-public-ledger
plan: 09
subsystem: worker-fee-engine
tags: [worker, batch, buyback-burn, distribution, reconcile, fork, tdd]
requires:
  - 05-04 land, LedgerStore, memoryLedger, the ops floor
  - 05-05 Engine (coins in memory, per-coin queue)
  - 05-07 bondedJob
  - 05-08 finalizeJob, fee-routes.ts, fork state E2
provides:
  - fee-batch.ts buybackBurnJob, distributeJob, runBatch, nextBatchAt, scheduleBatch, batchNow
  - fee-reconcile.ts reconcile, impliedOf, pgImplied
  - LedgerStore.implied in both stores
  - bearer POST /fee/batch (single-flight)
  - migration 0006 (a buyback reconcile_diff may carry no mint)
  - fork row engine.distribute
affects: [05-12, 05-13, phase-06-admin]
tech-stack:
  added: []
  patterns:
    - the batch reads its coins from the engine's memory; its only planned database read is the reconcile sum
    - every batch send goes through the coin's own queue (the buyback burn under "platform")
    - reconcile reads and records only; dry mode logs the diffs and writes nothing
key-files:
  created:
    - apps/worker/src/fee-batch.ts
    - apps/worker/src/fee-batch.test.ts
    - apps/worker/src/fee-reconcile.ts
    - packages/core/migrations/0006_reconcile_platform.sql
  modified:
    - apps/worker/src/fee-ledger.ts
    - apps/worker/src/fee-ledger.test.ts
    - apps/worker/src/fee-engine.ts
    - apps/worker/src/fee-routes.ts
    - apps/worker/src/fee-prebond.ts
    - apps/worker/src/README.md
    - packages/core/src/pump.ts
    - packages/core/src/schema.ts
    - scripts/spike/stages/engine-final.ts
    - scripts/spike/stages/README.md
    - scripts/spike/results/fork.json
decisions:
  - "The batch takes its coins from Engine.coins rather than a new batchCoins() read. Memory already holds every coin with its W key, venue and finalize state (hold, markFinal and landed keep it current), so the run wakes Neon once and fee-ledger.ts stays under 300 lines."
  - "Pooled coins still at finalize none get bondedJob, not bare finalizeJob. This is the same retry Engine.start runs at boot: it redoes the pool burn if it never landed, then finalizes."
  - "With no BONDR price in memory, any pending post-bond fees count as worth distributing, the same null-price rule collect uses (D-11). The fork deps have no price, so this rule is the fork-sized minimum."
  - "The distribute recipients and shares come from the sharing config, read in the same getMultipleAccountsInfo as the pending amounts, not from launches.wallet. An owner-released deployer is therefore recorded correctly. Row amount = deployer + treasury deltas, so the row's sol and the coin's deployer_earned_sol are filled in."
  - "Migration 0006 relaxes fee_ledger_platform to `kind = 'reconcile_diff' or (mint is null) = (kind = 'buyback_burn')`. This fixes the 05-04 deferred item. Applied to the Neon dev branch with pnpm db:migrate."
  - "The batch hour is env.feeBatchHourUtc. FEE_BATCH_HOUR_UTC was already parsed in env.ts and defaults to 4."
  - "POST /fee/batch answers 409 paused while the engine is off or not started."
metrics:
  duration: 35 min
  completed: 2026-10-25
  tasks: 3
  files: 18
---

# Phase 5 Plan 09: Daily batch, distribution crank and reconciliation Summary

The worker now has its daily batch. Once a day at FEE_BATCH_HOUR_UTC it does four things:
- burns the buyback wallet's whole BONDR balance in one BurnChecked;
- pays out post-bond fees of finalized coins when the ops fee would be under 1% of the payout;
- retries the bond and finalize steps for pooled coins still at none;
- reconciles each W's and the buyback's ledger-implied BONDR against the chain.

Each send goes through its coin's queue. Below the ops floor the batch skips every send and only reconciles. POST /fee/batch (bearer, single-flight) runs it on demand. On the fork, the worker's own `distributeJob` paid E2's post-bond fees exactly 80:20.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Buyback burn, distribution crank and the batch run | 353e76c (RED), 4c3ee76 (GREEN) | fee-batch.ts (+test), fee-routes.ts, fee-engine.ts, fee-prebond.ts, pump.ts, README.md |
| 2 | Nightly reconciliation | 12c0c79 (RED), ac2363b (GREEN) | fee-reconcile.ts, fee-ledger.ts (+test), schema.ts, 0006 migration |
| 3 | Fork row engine.distribute | 3b71870 | engine-final.ts, stages/README.md, results/fork.json, pool-sell-launch.json |

Task 2 went green before Task 1 because `runBatch` calls `reconcile`. Both RED commits came before either GREEN commit.

## Verification

**Unit tests**
- `pnpm vitest run apps/worker/src/fee-batch.test.ts`: 11 passed. Every behavior bullet in both tasks is covered:
  - Buyback burn:
    - Balance 0 or a missing ATA sends nothing.
    - 5,000,000 gives one buyback_burn row: mint null, amount and burned 5,000,000, buyback signer, one T22 instruction, not urgent.
  - distributeJob:
    - Pending is read in one 4-account call.
    - Below the minimum it sends nothing.
    - Above it, one distribute row with deployerAmount 800000, treasuryAmount 200000, dBps 8000, tBps 2000.
    - With no sharing config it sends nothing.
  - runBatch:
    - Runs on the queues platform, the done coin, then the pooled-none coin.
    - Curve and held coins are untouched.
    - `implied` is called once.
    - Below the ops floor there are no sends, but reconcile still runs.
  - `nextBatchAt` returns 03:59 to 04:00 the same day, and 04:00 or 23:00 to 04:00 the next day.
  - POST /fee/batch answers 409 before wiring, then two calls return the same promise.
  - impliedOf gives 0 for W and 10 for the buyback.
  - Reconcile:
    - An exact match writes nothing.
    - Chain 5 calls `diff(mint, { implied: "0", chain: "5", diff: "5" })` and logs "reconcile diff".
    - With 150 coins it makes reads of 100 and 51 accounts, finds 150 diffs, and lands nothing.
- `pnpm vitest run apps/worker/src/fee-ledger.test.ts`: 9 passed on Neon. The new pg case checks that implied gives 900 for collect 1000 minus split 100 in one query. It also checks that `diff(null, ...)` writes, which failed with 23514 before 0006.
- `pnpm test`: 58 files, 417 passed, 2 skipped, 0 failed. No Neon timeouts this run.
- `pnpm typecheck` and `pnpm lint`: exit 0.

**Acceptance greps**
- `getMinimumDistributableFee` in apps/worker/src: none.
- `"POST /fee/batch"` in fee-routes.ts: matches.
- `land(|signTx|broadcast` in fee-reconcile.ts: none.
- `reconcileDiff` in fee-reconcile.ts: matches.

**File sizes**

| File | Lines |
|------|-------|
| fee-engine.ts | 299 |
| fee-batch.test.ts | 297 |
| fee-ledger.ts | 291 |
| fee-batch.ts | 183 |
| engine-final.ts | 142 |
| fee-reconcile.ts | 92 |

All are under 300.

**Fork gate**

`pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` gave `fork: 85 ok, 0 failed` and `86 passed, 0 failed`. Every engine.* row passed: collect, split, forced, collect.2, split.2, pool.burn, finalize.config, finalize.update, finalize.sweep and distribute. `pnpm spike:fork-down` was run afterwards.

| Row | Signature | Facts |
|-----|-----------|-------|
| aux.engine.distribute.buy / sell | (aux) | sim PumpSwap trades on E2 after finalize; creator fees accrue to the sharing config |
| engine.distribute | W9jizGAR4e9R... | 124,829 CU; total 171,705,473,710; deployer 137,364,378,968 (exactly floor(total x 0.8)); treasury 34,341,094,742 |

Real SOL spent: 0. Everything ran on the local fork.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A buyback reconcile diff could not be written to Postgres (05-04 deferred item)**
- **Found during:** Task 2
- **Issue:** fee_ledger_platform allowed a null mint only on buyback_burn rows, so `diff(null, ...)` failed with 23514.
- **Fix:** Migration 0006 relaxes the check for reconcile_diff only. Applied to the dev branch. The pgLedger test covers it.
- **Files modified:** schema.ts, 0006_reconcile_platform.sql, meta snapshot and journal, fee-ledger.test.ts
- **Commit:** ac2363b

**2. [Rule 3 - Blocking] Small additions outside the plan's file list**
- pump.ts exports `coinCreatorVaultAtaPda` and `coinCreatorVaultAuthorityPda`, which the pending read needs for the AMM vault ATA.
- fee-prebond.ts has `tokenBalance(d, owner)`, which `wBondr` now wraps, so the buyback burn reuses the same missing-ATA-is-0 read.
- **Commit:** 4c3ee76

**3. [Plan adjustment] No `batchCoins()` read; bondedJob for retries**
- See decisions. The coins come from engine memory, which keeps the plan's one-wake goal with less code. The retry uses the boot path, which also covers a pool burn that never landed.
- **Commit:** 4c3ee76

## Known limits

- The batch timer is per process, like every engine timer. A restart re-arms it for the next batch hour, so a restart exactly at the hour skips that day's run. POST /fee/batch covers a manual run.
- The minimum check uses the BONDR price in memory. Just after a boot with no price yet, any pending amount gets distributed.

## TDD Gate Compliance

- Task 1: test 353e76c, then feat 4c3ee76. The RED run failed on the missing fee-batch.ts.
- Task 2: test 12c0c79, then feat ac2363b. The RED run failed on the missing modules.

## Known Stubs

None.

## Requirements

- FEE-06: the buyback burn is unit-proven; the devnet e2e in 05-12 proves the supply drop.
- FEE-07: proven on the fork through the engine (engine.distribute, 80:20 exact).
- FEE-08: the batch pauses its sends below the ops floor.
- FEE-09: reconcile is proven in units and on Neon.

## Threat Flags

None beyond the plan's register.
- **T-05-09-01:** BurnChecked only, signed by the per-lane buyback key, and the program is on the signTx allowlist.
- **T-05-09-02:** distributeIxs pays the on-chain shareholders; the engine passes no recipient.
- **T-05-09-03:** distributeMin, and the batch skips its sends below the ops floor.
- **T-05-09-04:** coins come from memory; one batch a day on one timer.
- **T-05-09-05:** reconcile_diff rows plus console.error (Sentry); no send path.
- **T-05-09-06:** existing bearer check and single-flight.

## Self-Check: PASSED

- FOUND: apps/worker/src/fee-batch.ts, apps/worker/src/fee-batch.test.ts, apps/worker/src/fee-reconcile.ts, packages/core/migrations/0006_reconcile_platform.sql
- FOUND commits: 353e76c, 12c0c79, ac2363b, 4c3ee76, 3b71870
