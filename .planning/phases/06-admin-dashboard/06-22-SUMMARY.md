---
phase: 06-admin-dashboard
plan: 22
subsystem: worker
tags: [evacuate, worker, packing, break-glass, tdd]
requires: [06-04, 06-21]
provides:
  - "admin-evacuate.ts: evacuateBalances, packBatches, buildBatch, planBatches, evacuateAllow, simulateEvacuate, executeEvacuate, evacuateRefusal, EVAC_SIM_CONCURRENCY, WBalance, EvacCoin"
  - "admin-send.ts: gatedDeps, codeOf, progress, outcome, logged (moved out of admin-money.ts)"
  - "switches.ts pauseAll (one UPDATE: every switch false plus evacuated_at, then loadSwitches)"
  - "fee-boot.ts loadFeeCoins (every coin whose W derives from this seed)"
  - "MoneyCtx.evacuate / MoneyCtx.coins; POST /admin/simulate accepts evacuate with mint null"
  - "apps/worker/README.md EVACUATE runbook"
affects: [06-23, 06-24]
tech-stack:
  added: []
  patterns: [promise pool capped at 8, greedy wireSize packing, pause-first execute loop with per-batch idle and fresh balances]
key-files:
  created:
    - apps/worker/src/admin-evacuate.ts
    - apps/worker/src/admin-evacuate.test.ts
    - apps/worker/src/admin-evacuate-exec.test.ts
    - apps/worker/src/admin-send.ts
  modified:
    - apps/worker/src/admin-money.ts
    - apps/worker/src/admin-money.test.ts
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/switches.ts
    - apps/worker/src/switches.test.ts
    - apps/worker/src/fee-boot.ts
    - apps/worker/src/README.md
    - apps/worker/README.md
decisions:
  - "06-22: A2 taken as Claude's discretion (owner may override): ADMIN_EVACUATE defaults to simulate; an EVACUATE intent exists only when it is on and the net is devnet, and executeEvacuate refuses again (409 not_applicable simulate_only / devnet_only) before pausing anything"
  - "06-22: the EVACUATE allowlist is the treasury and BONDR only (allowFor treasury, internal [], mints [Q]); the plan's looser list (W internal, child mints) would let a child transfer to the treasury pass the gate, which D-36 forbids. Burns always pass"
  - "06-22: simulate gives an intent when at least one batch passes (ok = some batch ok); failures counts the wallets of failed batches and error is the first failure's contract code, so one stuck W never blocks the break-glass path"
  - "06-22: evacuate rows always carry sol (0 when the BONDR price is unknown), because an unset sol would let withSol fill every row of the kind from the first one (Pitfall 4)"
  - "06-22: one evacuate row per W even when its BONDR is 0 (amount 0); the leftover_burn row only when it held child tokens"
  - "06-22: the shared send pieces (gatedDeps, codeOf, progress, outcome, logged) moved to admin-send.ts so admin-evacuate.ts reuses them without a runtime import cycle with admin-money.ts"
metrics:
  duration: 14 min
  completed: 2026-10-26
  tasks: 2
  files: 13
---

# Phase 6 Plan 22: EVACUATE worker Summary

The worker now has EVACUATE end to end. Simulate reads every W with its BONDR and child accounts in reads of 100 accounts. It packs several W per transaction under `PACKET_LIMIT` and simulates the batches through a pool of 8, then returns totals: wallets, BONDR, its SOL value, SOL, wallets with child tokens to burn, and failures. Execute needs `ADMIN_EVACUATE=on`, devnet, the owner's fresh signature and the pending audit row. It first switches every job off and stamps `evacuated_at` in one write. It then moves each batch: it waits for that batch's queued engine jobs, re-reads its balances and lands it through the gated land, paced like the engine. W's BONDR and SOL go to the treasury and child tokens are burned. Each W writes its own `evacuate` row, plus a `leftover_burn` row when it held child tokens.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | Balances, packing, batch build and simulation | ac35516 (RED), 608c105 (GREEN) |
| 2 | Execute loop, money path wiring and runbook | 79c36ad (RED), 46aac02 (GREEN) |

## What was built

- `admin-evacuate.ts` (253 lines). `evacuateBalances` drops a W that holds nothing anywhere. `packBatches(ops, perW, first)` follows RESEARCH Code Example 5: a W that alone overflows still gets its own batch. `buildBatch` builds one idempotent treasury BONDR ATA create (ops pays) plus, per W, a TransferChecked of exactly its BONDR, a BurnChecked of exactly its child balance and a System transfer of exactly its lamports. Its rows carry their own amount and sol, it passes no facts, and every W signs. `simulateEvacuate` builds the plan, runs each batch through `simulateJob(d, job, [])` (an RPC throw fails only that batch), then computes totals and the destination check. `executeEvacuate` follows the order in the paragraph above.
- `admin-money.ts`: simulate dispatches `evacuate` to `simulateEvacuate` before `defOf`. Execute dispatches it to `beginEvacuate`, which runs the mode and net re-check and then inserts the pending audit row (action evacuate, mint null, `params: { wallets }`, simulation trimmed and now including `totals`). `executeEvacuate` then runs in the background. The existing catch maps a refusal to intent state `refused`.
- `admin-routes.ts`: `TX` includes evacuate. The mint must be absent or null for both burn_buyback and evacuate. The money ctx carries `evacuate: env.adminEvacuate`.
- `switches.ts`: `pauseAll()` sets all five columns to false and `evacuatedAt` to `new Date()` in one UPDATE, then calls `loadSwitches()` so memory carries evacuatedAt.
- `fee-boot.ts`: `loadFeeCoins()` returns every coin whose W derives from this seed, and `[]` before startEngine. It is named apart from ingest.ts `loadCoins`.

## Verification

- `pnpm vitest run admin-evacuate, admin-evacuate-exec, admin-money, admin-routes, switches`: 5 files, 37 passed. Both RED runs failed first: the module was missing for Task 1, and for Task 2 the routes refused evacuate and `executeEvacuate` did not exist.
- The 200-W case shows at most 8 simulations in flight, every batch simulated exactly once and all 200 W totalled. One failing batch counts only its own wallets as failures, the others complete, and the run still returns an intent.
- The execute order is recorded as `pause, idle n, land, pace, idle n, land`. The last batch's TransferChecked carries the balance changed on chain after the first land, which shows the balances are re-read per batch.
- `pnpm typecheck`: pass. `pnpm lint`: clean (418 files).
- Full `pnpm test`: 91 files passed, 686 passed, 2 skipped (688).
- No fork run: the plan names none. The devnet proof is 06-24.
- Acceptance greps:
  - `PACKET_LIMIT` and `EVAC_SIM_CONCURRENCY` are in admin-evacuate.ts.
  - `createTransferChecked` is used only for the BONDR leg.
  - `mainnet` appears in the refusal comment.
  - `EVACUATE` is in apps/worker/README.md.
  - Every touched file is under 300 lines, and every function under 40.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Shared send helpers moved to admin-send.ts**
- **Found during:** Task 1
- **Issue:** executeEvacuate needs `gatedDeps`, `outcome`, `progress` and `codeOf` from admin-money.ts, and admin-money.ts imports admin-evacuate.ts, so importing them back would create a runtime import cycle.
- **Fix:** moved them unchanged into admin-send.ts (62 lines). admin-money.test.ts now imports `gatedDeps` from there.
- **Commit:** 608c105

**2. [Rule 3 - Blocking] fee-boot.ts loadFeeCoins**
- **Found during:** Task 1
- **Issue:** with the engine off (the 06-24 devnet run) nothing listed every coin with its W.
- **Fix:** added a one-query `loadFeeCoins()` beside `loadCoin`. fee-boot.ts was not in files_modified.
- **Commit:** 608c105, renamed in 46aac02

**3. [Rule 2 - Security] Tighter EVACUATE allowlist**
- The gate's allowlist is the treasury with BONDR only. The plan's list (W internal plus the child mints) would allow a child-token transfer to the treasury, which D-36 forbids. The test checks every built instruction against both the plan's list and the strict one.

**4. Treasury ATA create per batch**
- Every batch starts with an idempotent create of the treasury's BONDR ATA, paid by ops. The plan did not list it, but without it the first transfer fails when that account does not exist. It passes the destination lock: the ATA program's create is allowed.

**5. Execute tests in their own file**
- admin-evacuate.test.ts would have passed 300 lines, so the execute-loop tests live in admin-evacuate-exec.test.ts. The code stayed in admin-evacuate.ts (253 lines), so admin-evacuate-run.ts was not needed.

## Threat mitigations

| Threat | How |
|--------|-----|
| T-06-22-01 | buildBatch pays only the treasury or burns. The gated land checks every tx against the signed allowlist (treasury, BONDR only). A test shows an allowlist without the treasury refuses before base land. |
| T-06-22-02 | `pauseAll` runs before the first send, `engine.idle` runs per batch, and balances are re-read per batch. The recorded-order test covers all three. |
| T-06-22-03 | Two evacuate rows with different mints in one batch: the 0007 index and the memory mirror (06-04). The rows test covers it. |
| T-06-22-04 | One pending audit row goes in before the first send, every W gets its own ledger row, and the intent counts moved and failed W. The audit settles once with every signature. |
| T-06-22-05 | ADMIN_EVACUATE defaults to simulate (no intent). Execute refuses off devnet in the loop as well as at boot. |
| T-06-22-06 | The same `take` signature check against ADMIN_WALLET as every money action. |
| T-06-22-07 | 8 simulations run in parallel, covered by the 200-W unit test. |

## Requirements

ADMIN-11 is not ticked. The web section (06-23) and the devnet proof (06-24) are still to come.

## Known Stubs

None. `balances: []` in the evacuate simulation is deliberate: the totals carry the numbers.

## For the next plans

- 06-23 (web):
  - Simulate with `{ action: "evacuate", mint: null }`. The result has `totals` (EvacuateTotals: amounts are decimal strings of base units, SOL in lamports), `steps` (one per batch, none estimated), `balances: []` and `error` (the first failed batch's contract code) even when `ok` is true.
  - An intent appears only when ADMIN_EVACUATE is on, the net is devnet, at least one batch passed and the destinations passed. Use `health.evacuate` to show the simulate-only state.
  - The poll view's `moved` and `failed` are W counts, and `landed` and `total` are tx counts.
  - Execute refusals arrive as 409 not_applicable with reason `simulate_only` or `devnet_only`. Web `workerPost` still drops `reason`.
  - The audit params key is `wallets` (number).
- 06-24 (devnet):
  - The coin list comes from `loadFeeCoins()`: every DB coin whose W derives from the seed, with the engine on or off.
  - `pauseAll` turns launches off too, so afterAll must POST every switch back on and clear `settings.evacuated_at`. Nothing in the worker clears it.
  - W's emptied ATAs stay open with their rent, because EVACUATE does not close accounts.
  - Pacing is `pace(feeConfig.paceMs)` between batches, on top of land's own broadcast pace, so expect about 1.1 s extra per batch on devnet.
- Deferred: `evacuate` is still not in `HOLDS` (fee-guard.ts). An unknown evacuate tx is never resent, and its exact-amount TransferChecked fails if a later sweep moved the BONDR, so the risk is low. Add it if the owner re-enables sweeps while an evacuate row is still pending.
- `MoneyCtx.coins` and `MoneyCtx.evacuate` are the test and fork seams. A fork EVACUATE row can pass `evacuate: "on"` and its own coin list to `act()`.

## TDD Gate Compliance

Task 1: `test(06-22)` ac35516, then `feat(06-22)` 608c105. Task 2: `test(06-22)` 79c36ad, then `feat(06-22)` 46aac02.

## Self-Check: PASSED

- FOUND: apps/worker/src/admin-evacuate.ts, admin-evacuate.test.ts, admin-evacuate-exec.test.ts, admin-send.ts
- FOUND: commits ac35516, 608c105, 79c36ad, 46aac02
