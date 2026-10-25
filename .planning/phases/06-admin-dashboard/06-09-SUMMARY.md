---
phase: 06-admin-dashboard
plan: 09
subsystem: worker
tags: [worker, leftover, burn, close-accounts, distribute, tdd]
requires: [06-05, 06-07]
provides:
  - admin-leftover.ts leftoverBurnJob, closeAccountsJob, sweepLeftoversJob
  - distributeJob(d, coin, { anyAmount })
  - LedgerStore.has(mint, kinds, windowIndex?)
  - insertPending([]) returns [] in both stores without touching the database
affects: [06-11 row-less Run migrate, 06-13 admin money deps, 06-15 fork admin rows, 06-22 EVACUATE]
tech-stack:
  added: []
  patterns: [admin builders as plain fee jobs through d.land, step chain stopped at the first unsettled result]
key-files:
  created:
    - apps/worker/src/admin-leftover.ts
    - apps/worker/src/admin-leftover.test.ts
    - apps/worker/src/fee-admin-paths.test.ts
  modified:
    - apps/worker/src/fee-ledger.ts
    - apps/worker/src/fee-ledger-memory.ts
    - apps/worker/src/fee-ledger.test.ts
    - apps/worker/src/fee-finalize.ts
    - apps/worker/src/fee-batch.ts
    - apps/worker/src/README.md
    - scripts/spike/stages/engine-bond.ts
    - scripts/spike/results/fork.json
    - packages/core/src/fixtures/pool-sell-launch.json
decisions:
  - "06-09: the free window index uses a new optional windowIndex argument on LedgerStore.has, because has(mint, kinds) cannot see a single window; one read per occupied index, owner runs only"
  - "06-09: sweepLeftoversJob sets coin.open before the spend guard, so an owner run settles and splits from Postgres even for a coin idle since boot"
  - "06-09: finalize's checkEmpty returns the leftover burn's Landed into finalizeJob's output, so a failed burn feeds stuck tracking; leftover BONDR stays an error line for the owner's Sweep leftovers action"
  - "06-09: the pg empty-rows guard sits in pgLedger.insertPending before dbFn() is called, so a row-less job never opens a connection"
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 2
  files: 12
---

# Phase 6 Plan 09: Leftover burn, close accounts and Distribute now Summary

W's leftover child tokens are now burned and never held. "Burn W token balance" is `leftoverBurnJob`: one BurnChecked of W's whole child balance at COIN_DECIMALS, signed by W, with ops paying, and a public `leftover_burn` row. Finalize's closing step runs the same job by itself when the closing sweep leaves child tokens. "Sweep leftovers, close accounts" is `sweepLeftoversJob`. It sweeps leftover BONDR 90/10 at the lowest free window index through the spend guard, burns the leftover child tokens, then closes W's empty token accounts with the rent going to the treasury. "Distribute now" is `distributeJob(d, coin, { anyAmount: true })`, which skips the batch minimum but still sends nothing when nothing is pending.

## What was built

- **admin-leftover.ts (68 lines):** every step sends through `d.land`. Nothing calls sendTx or broadcast, so the intent row comes first, pacing applies and an unknown tx is never resent. `closeAccountsJob` reads both of W's Token-2022 ATAs in one `getMultipleAccountsInfo`. It closes only the ones that exist with a balance of 0, the destination is always `d.treasury`, and it sends with `rows: []`. `sweepLeftoversJob` stops at the first step that does not settle, so a failed burn sends no close.
- **Ledger:** `insertPending([])` returns `[]` and writes nothing in both stores. pg answers before `dbFn()` runs. `has` takes an optional `windowIndex` (memory and pg).
- **Finalize:** `checkEmpty` burns a non-zero child balance and logs `finalize <mint>: leftover burn <state>`. The `W child X, BONDR Y` line is an error only when BONDR is left. A failed read still logs and throws nothing.
- **Batch:** `worthPaying(d, pending, anyAmount)` returns false while pending is 0 or less, and true whenever anyAmount is set.

## Commits

| Gate | Commit | Message |
| ---- | ------ | ------- |
| 1 RED | 83305a6 | test(06-09): add failing tests for the leftover burn, close accounts and leftover sweep |
| 1 GREEN | 4896fff | feat(06-09): burn W's leftover child tokens, close its empty accounts and compose the leftover sweep |
| 2 RED | f240221 | test(06-09): add failing tests for finalize's leftover burn and Distribute now below the minimum |
| 2 GREEN | 0ffe521 | feat(06-09): burn leftover child tokens at finalize and let Distribute now skip the batch minimum |
| fork fix | d29ad05 | fix(06-09): give the fork forced-bond coin unclaimed fees so the engine stage collects again |
| docs | a664141 | docs(06-09): list the leftover recovery jobs in the worker README |

## Verification

- `pnpm vitest run apps/worker/src/admin-leftover.test.ts apps/worker/src/fee-ledger.test.ts`: 19 passed (6 + 13, pg cases against the Neon dev branch, rolled back).
- `pnpm vitest run apps/worker/src/fee-admin-paths.test.ts`: 4 passed. `pnpm vitest run apps/worker`: 39 files, 272 passed, 1 skipped. fee-finalize.test.ts and fee-batch.test.ts are unchanged and pass.
- `pnpm lint`, `pnpm typecheck`: clean.
- Full `pnpm test`: 73 files passed, 538 passed, 2 skipped (540).
- Fork gate: `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike` gave `fork: 85 ok, 0 failed`, and `SPIKE_NET=fork pnpm spike:check` gave `86 passed, 0 failed`. Every Phase 5 row passes, including engine.collect, split, forced, collect.2, split.2, pool.burn, finalize.config, finalize.update, finalize.sweep (wBondrAfter 0, wChildAfter 0) and distribute. `pnpm spike:fork-down` was run afterwards.
- Greps: `d\.land\(` matches admin-leftover.ts twice, and `sendTx|broadcast\(` matches nothing. `leftoverBurnJob` appears in fee-finalize.ts and `anyAmount` in fee-batch.ts.
- Line counts: admin-leftover 68, its test 167, fee-admin-paths.test 130, fee-finalize 172 (cap 200), fee-batch 200 (cap 220), fee-ledger 222, fee-ledger-memory 87.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The fork engine stage stopped at engine.collect**
- **Found during:** the fork gate. The first run gave `fork: 44 ok, 2 failed, aborted` with engine.collect `missing`.
- **Issue:** Phase 5 review fix 73853e4 made `forcedJob` collect only when `worthCollecting` holds. The fork stage's coin still had `feesUnclaimed: 0n`, so it never collected. 05-09's fork run came before that fix, and no fork run had happened since. The cause is in Phase 5, not in this plan.
- **Fix:** the forced-path coin in `scripts/spike/stages/engine-bond.ts` now carries `feesUnclaimed: 1n`, standing in for the indexer's memory after the whale buy. Engine code is unchanged. The rerun passes every row. The run also refreshed `fork.json` and the `pool-sell-launch.json` fixture, as every Phase 5 fork run did, and both are committed.
- **Commit:** d29ad05

**2. [Rule 3 - Blocking] `has` could not find a free window index**
- **Issue:** the plan says to pick the free index with `ledger has()`, but `has(mint, kinds)` cannot narrow to one window.
- **Fix:** added an optional third argument, `windowIndex`, to both stores. Existing callers are unchanged, and a pg case was added to the rolled-back forced_bond test.
- **Commit:** 4896fff

**3. [Rule 2 - Correctness] The leftover sweep forces the spend guard to read**
- **Issue:** `guard` skips the Postgres check for a coin that was never marked open. An owner run on a coin idle since boot would then sweep without settling pending collects or splits.
- **Fix:** `sweepLeftoversJob` sets `coin.open = true` first.
- **Commit:** 4896fff

## Threat Flags

None. Every new outflow is a burn or a CloseAccount to the treasury, and each test runs the built ixs through `refusedDestination` (T-06-09-01).

## Known Stubs

None.

## TDD Gate Compliance

Each task has a `test(...)` commit followed by a `feat(...)` commit. In Task 1's RED run, the memory store's empty-rows case and the existing-account cases passed already. The memory store's insert already handled an empty array, and the pg half of the same test failed as expected. Every other case failed for the expected reason (missing module, or `has` ignoring the window).

## Notes for later plans

- 06-11/06-13: run `leftoverBurnJob`, `closeAccountsJob` and `sweepLeftoversJob` through admin deps (`allowed: () => true`). None of them gates on a switch by itself. For stuck tracking, use `engine.exclusive(mint, fn, label)` with label `fee finalize ${mint}`. Allowlist for these actions: treasury, buyback, the coin's W, mints [Q, coin mint], closeTo treasury.
- A row-less job (`rows: []`) comes back from land as `landed` with `rows: []`. Surface `{ state: "done" }` with no sig as "Nothing to send" (Pitfall 7).
- `closeAccountsJob` closes W's BONDR ATA. Any later BONDR sent to W recreates it through the idempotent ATA create, which ops pays for.
- Distribute now: call `distributeJob(d, coin, { anyAmount: true })`. With a BONDR price of null, the minimum is already skipped.

## Self-Check: PASSED
