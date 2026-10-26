---
phase: 06-admin-dashboard
plan: 11
subsystem: worker
tags: [worker, simulate, registry, recovery-actions, tdd]
requires: [06-05, 06-07, 06-09]
provides:
  - admin-sim.ts captureDeps, simulateJob, balanceRows, simSummary, Step, Watched, AccountSnap
  - admin-actions.ts ACTIONS (nine transaction actions), ActionDef, ActionView, actionView, runOn
  - LedgerStore.failedSweep(mint) in pg and memory stores
  - fee-send.ts DEFAULT_CU exported; admin-dest.ts short exported
affects: [06-13 money actions (simulate and execute), 06-15, 06-17 action grid applicability mirror, 06-18 sim dialog, 06-22 EVACUATE]
tech-stack:
  added: []
  patterns: [one FeeDeps.land seam swapped for simulation, read-only ledger wrapper in capture deps, registry of action definitions]
key-files:
  created:
    - apps/worker/src/admin-sim.ts
    - apps/worker/src/admin-sim.test.ts
    - apps/worker/src/admin-actions.ts
    - apps/worker/src/admin-actions.test.ts
  modified:
    - apps/worker/src/fee-send.ts
    - apps/worker/src/admin-dest.ts
    - apps/worker/src/fee-ledger.ts
    - apps/worker/src/fee-ledger-memory.ts
    - apps/worker/src/fee-ledger.test.ts
decisions:
  - "06-11 (Claude's discretion, owner may override; OQ1, A6): multi-step simulations make the first step authoritative; later steps are marked estimated and the RPC preflight checks them again when sent; the balance table is the sum of per-step deltas"
  - "06-11: finalize_split's allowlist names the treasury, the buyback, the deployer = coin.wallet and W; the buyback is there because finalize's closing sweep sends post-bond fees 90/10 (A6), otherwise execute would refuse it after the permanent update"
  - "06-11: captureDeps also wraps the ledger read-only (only pending, pendingFor, openCollects, has, failedSweep, implied pass; every other method throws), so a job that ever writes in dry mode fails loudly"
  - "06-11: simSummary takes the watch list as a fifth argument (balances need names and units); ActionView gains buybackBondr (burn_buyback applicability) and pendingSweeps is Entry[]"
  - "06-11: each action has one reason code (retry_forced_bond answers below_trigger even off the curve, matching the UI-SPEC's one line per action)"
  - "06-11: sweep_now and retry_sweep set coin.open before windowJob so the spend guard reads Postgres for a coin idle since boot, like sweepLeftoversJob"
metrics:
  duration: 19 min
  completed: 2026-10-25
  tasks: 2
  files: 9
---

# Phase 6 Plan 11: Simulate-first engine and recovery action registry Summary

Every recovery action can now be previewed through the real engine job. `captureDeps` swaps `FeeDeps.land` for a per-step `simulateTransaction` call and writes nothing. `ACTIONS` maps the nine transaction actions to their jobs, the state each one applies in, its destination allowlist and the accounts its balance table shows.

## What was built

- `admin-sim.ts`
  - `captureDeps(base, sink, watch)` returns `{ ...base, mode: "dry", ledger: readOnly, publish: noop, allowed: () => true, land }`.
  - `land` runs `simulateJob` against the base deps, pushes one `Step` and returns `{ state: "dry" }`.
  - `simulateJob` builds `budget(cu) + job.ixs` with ops as payer. It runs one `getMultipleAccountsInfo` (pre balances) alongside one `simulateTransaction` (`sigVerify: false`, `replaceRecentBlockhash: true`, watched addresses in `accounts`). The blockhash is a placeholder because the RPC replaces it, which saves one RPC call per step.
  - Decoding: SOL accounts read by lamports, token accounts by `AccountLayout` amount. A null or closed account reads 0. A failed simulation keeps `post = pre`.
  - Fee: `5000 x required signatures + ceil(cu limit x 1000 / 1e6)`.
  - `balanceRows` gives the net change per watched account across steps. Display units are SOL 9 decimals, BONDR 6 and child tokens 6. The change is signed with "+" or U+2212, and an unchanged account still shows before and after.
  - `simSummary(action, mint, steps, dest, watch)`: step 1 is authoritative and later steps are `estimated: true`. Zero steps gives `nothing: true` and `ok: false`.
- `admin-actions.ts`
  - `ACTIONS` covers the nine keys. Reason codes: not_curve, below_trigger, no_child, not_complete, not_bonded, no_failed_sweep, not_finalized (distribute_now and sweep_leftovers), no_bondr.
  - Run mapping:
    - sweep_now runs `windowJob` at the current `windowOf` (A9).
    - retry_sweep runs `settleRows` on the pending sweeps (only when mode is "on"), then `windowJob` at the failed row's window index.
    - retry_forced_bond runs `forcedJob`.
    - burn_w_tokens runs `leftoverBurnJob`.
    - run_migrate runs `migrateIxs` with ops as the user, then `d.land({ rows: [], cu: 600_000 })` (the fork used 342k CU).
    - finalize_split runs `finalizeJob(d, coin, coin.wallet)`.
    - distribute_now runs `distributeJob(..., { anyAmount: true })`.
    - sweep_leftovers runs `sweepLeftoversJob`.
    - burn_buyback runs `buybackBurnJob(d)`.
  - Allowlists, each with W as internal and closes going to the treasury:
    - sweeps: treasury and buyback
    - retry_forced_bond: treasury
    - finalize_split: treasury, buyback and the deployer = coin.wallet
    - burn, migrate and distribute: none
  - `actionView(d, mint, engine, load = loadCoin)` takes the engine's coin, or loads it when the engine is off (A1). It makes one `getMultipleAccountsInfo` call (buyback BONDR ATA and W child ATA), calls `costToComplete` only for curve coins, and does two ledger reads (`failedSweep`, `pendingFor` sweeps).
  - `runOn(engine, mint | null, fn)` uses `engine.exclusive(mint ?? "platform", fn)`, or runs `fn` directly when the engine is null.
- `LedgerStore.failedSweep(mint)` returns the oldest failed or expired sweep row whose window has no live sweep of the same kind. Postgres does this with a correlated `not exists`. A memory version mirrors it, and both have tests (the pg test runs inside a rolled-back transaction).

## Commits

- 17ce71d test(06-11): add failing tests for the capture deps, step simulation and balance diff
- 39d7b44 feat(06-11): simulate captured engine jobs per step with balances and no sends or writes
- 8e83104 test(06-11): add failing tests for the recovery action registry and failed sweep lookup
- 9b4c8df feat(06-11): map the nine recovery actions to their engine jobs, states and allowlists

## Verification

- `pnpm vitest run apps/worker/src/admin-sim.test.ts apps/worker/src/admin-actions.test.ts`: 28 passed
- `pnpm lint`, `pnpm typecheck`: clean
- Full `pnpm test`: 78 files, 583 passed, 2 skipped
- `rg "sendTx|broadcast|sendRaw|insertPending" admin-sim.ts`: no match
- `rg "finalizeJob\(d, .*\.wallet"` matches; `rg "deployer.*body|body.*deployer"`: no match
- The capture-run test runs the real `finalizeJob` (config, update, closing collect and sweep, leftover burn). Every captured step passes `refusedDestination` against finalize_split's allowlist, and the update carries the launch wallet.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] finalize_split allowlist includes the buyback**
- **Found during:** Task 2
- **Issue:** The plan lists only the treasury and the deployer. Finalize's closing sweep transfers W's post-bond fees to the buyback, so the destination check would refuse that step at execute, after the permanent update had already landed.
- **Fix:** The buyback is added to finalize_split's allowlist. The deployer is still only `coin.wallet` (D-15). The test asserts that no other address is allowed.
- **Commit:** 9b4c8df

**2. [Rule 3 - Blocking] New `LedgerStore.failedSweep`**
- **Found during:** Task 2
- **Issue:** The ledger could not find failed or expired rows, which retry_sweep's applicability needs ("through the ledger").
- **Fix:** One method in both stores, with a memory test and a pg test. The fee-send fake inherits it by spreading `memoryLedger()`.
- **Commit:** 8e83104 (tests), 9b4c8df

**3. [Rule 2 - Critical] Read-only ledger in captureDeps (T-06-11-01)**
- **Fix:** Every ledger method except the six reads throws inside a capture run, with a test. Also adds `failedSweep` to the reads.
- **Commit:** 39d7b44, 9b4c8df

**4. Contract additions (backward compatible):** `simSummary` takes a fifth `watch` argument. `ActionView.buybackBondr` is new. `pendingSweeps` is `Entry[]`. `runOn` accepts `mint: null` (it means "platform"). `actionView` takes an optional `load` for tests.

## Known Stubs

- The "Fee sharing config" balance row is watched as SOL (its rent), not bps. Watched kinds stay "sol" | "token" per the contract. Decoding the deployer share would need a holder field. ponytail: add kind "bps" if the owner wants the share in the table.

## Threat Flags

None. Nothing here adds a route or a key path. Simulation reads chain state only.

## Self-Check: PASSED

- FOUND: apps/worker/src/admin-sim.ts, admin-sim.test.ts, admin-actions.ts, admin-actions.test.ts
- FOUND: 17ce71d, 39d7b44, 8e83104, 9b4c8df
