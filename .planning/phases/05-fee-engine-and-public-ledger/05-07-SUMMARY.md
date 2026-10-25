---
phase: 05-fee-engine-and-public-ledger
plan: 07
subsystem: worker-fee-engine
tags: [worker, engine, forced-bond, fallback-burn, fork, tdd]
requires:
  - 05-04 land (urgent, sender), collectJob, splitJob, memoryLedger, FeeDeps
  - 05-05 Engine, onIngest, the publish wrap (Engine.landed), withCost
provides:
  - core bond.ts forcedBondIxs with the WR-08 fix, poolExactInBurnIxs
  - fee-burns.ts forcedJob, poolBurnJob, bondedJob
  - fee-engine.ts forced bond trigger per curve patch, bonded job on venue pool, boot catch-up
  - fork stage engine-bond.ts (engine.collect, engine.split, engine.forced, engine.collect.2, engine.split.2, engine.pool.burn)
  - fork state E2, E2.W, E2.sig, E2.dev for 05-08
affects: [05-08, 05-09, 05-12]
tech-stack:
  added: []
  patterns:
    - one buyAndBurn helper in core: read W's child balance, simulate at minOut 1, floor at simOut - pre, burn simOut
    - bond burns gate on every collect and split settling, like windowJob, so a treasury tenth is never burned
    - a per-coin forcing flag in the engine; the ledger's has() and unique index stop a second bond burn
key-files:
  created:
    - packages/core/src/bond.test.ts
    - apps/worker/src/fee-burns.ts
    - apps/worker/src/fee-burns.test.ts
    - scripts/spike/stages/engine-bond.ts
  modified:
    - packages/core/src/bond.ts
    - apps/worker/src/fee-engine.ts
    - apps/worker/src/fee-engine.test.ts
    - apps/worker/src/fee-prebond.ts
    - apps/worker/src/README.md
    - scripts/spike/stages/bond.ts
    - scripts/spike/nets/fork.ts
    - scripts/spike/stages/README.md
    - scripts/spike/results/fork.json
    - packages/core/src/fixtures/pool-sell-launch.json
decisions:
  - "W's prior child balance is read with getAccountInfo (null means 0), not getTokenAccountBalance, so a missing ATA needs no error-string match"
  - "A cost of 0 from the fresh read means the curve already completed: forcedJob sends nothing, and the migration event runs bondedJob"
  - "forcedJob and bondedJob always collect (urgent), then split every open collect of the coin, and stop if any step is unsettled"
  - "The pool_burn row records detail.path (exact_quote_in or buy_v2); the fork ran exact_quote_in, so A2 holds"
  - "Both bond burns share one land call (burnLand) with urgent, sender and 600k CU; the row amount is W's whole balance as intent, and the landed amount is W's BONDR delta from the meta"
  - "The publish wrap the plan asks for already existed from 05-05 (feeDeps.publish calls Engine.landed); no change needed"
metrics:
  duration: 18 min
  completed: 2026-10-25
  tasks: 3
  files: 14
---

# Phase 5 Plan 07: Forced bond and fallback burn Summary

Both bond burns now run from the engine:
- **Forced bond.** It fires when indexed trades put W's budget (fee_budget plus 90% of unclaimed) at 105% of the cost. The job collects and splits, then re-checks with a fresh `costToComplete` and a simulation. It then sends one `buy_exact_quote_in_v3` with W's whole BONDR plus a BurnChecked, in one transaction.
- **Fallback burn.** It fires on the migration event: collect, split, then one PumpSwap `buy_exact_quote_in_v2` of the whole budget, burned in the same transaction.

The WR-08 fix is in, so a leftover child token in W no longer reverts later bonds. Both burns ran on the Surfpool fork through `apps/worker/src/fee-burns.ts`, and W ended at 0 child tokens both times.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | WR-08 fix and the exact-quote-in pool burn in core | bfc5a43 (RED), 37a5dd0 (GREEN) | bond.ts, bond.test.ts |
| 2 | Forced bond and fallback jobs, and their engine triggers | 0a182ba (RED), f877d6e (GREEN) | fee-burns.ts, fee-burns.test.ts, fee-engine.ts, fee-engine.test.ts, fee-prebond.ts (exports), README.md |
| 3 | Fork rows through the engine's code | 00d142e | engine-bond.ts, bond.ts (export createChild), nets/fork.ts, stages/README.md, results/fork.json |

## Verification

- `pnpm vitest run packages/core/src/bond.test.ts packages/core/src/fees.test.ts`: 14 passed. bond.test checks the WR-08 cases (prior balance 7 with simulated 500 gives minOut 493 and burns 500; no ATA gives 500; equal values throw), using the real SDK instruction bytes. fees.test already covered `minOutAfter`.
- `pnpm vitest run apps/worker/src/fee-burns.test.ts apps/worker/src/fee-engine.test.ts apps/worker/src/fee-prebond.test.ts`: 26 passed.
  - forcedJob: not ready below 105%, ready at 105%, skipped once a bond burn exists, and nothing sent at cost 0.
  - bondedJob: the pool burn runs; an empty budget or an earlier forced bond adds no pool burn.
  - The buy_v2 fallback records its path.
  - Engine: one forced bond per qualifying run, none before ready and none below the trigger. `budgetOf` counts 90% of unclaimed. Venue pool runs bondedJob and venue complete runs nothing. The start catch-up runs bondedJob only for pooled coins that are not finalized.
- `pnpm typecheck` exit 0. `pnpm lint` exit 0.
- `pnpm test`: 389 passed, 2 skipped, 0 failed tests, but 1 failed file on the first run (`apps/web/lib/coins.test.ts` hook timeout). On the rerun, 1 failed test (`apps/worker/src/prepare.test.ts`, 30 s timeout). Both are Neon-backed suites that pass alone (coins.test 10/10 in 70 s, prepare.test 8/8). 05-05 saw the same flake. The first run leaked two seeded coins (E72292, E51310), and I deleted them the way `dropCoin` does. No non-bndr coins are left. The one remaining non-bndr launch is the known 07b0c060 row from before this phase.
- Acceptance greps:
  - `minOutAfter` appears 2 times in bond.ts, and `buyExactQuoteInV2Instructions` is there too.
  - `costToComplete` is in fee-burns.ts.
  - `sender: true` matches once in fee-burns.ts. That is the shared `burnLand` used by both the forced bond and the pool burn.
  - `apps/worker/src/fee-burns` is in engine-bond.ts.
- File sizes: fee-engine.ts 285, fee-burns.ts 111, bond.ts 175, engine-bond.ts 184.
- **Fork gate.** `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` gave `fork: 77 ok, 0 failed` and `78 passed, 0 failed`. Every earlier fork row still passes. `pnpm spike:fork-down` was run afterwards.

| Row | Signature | Facts |
|-----|-----------|-------|
| engine.collect | 4qkPGNTpidLn... | amount 359,615,003,833 |
| engine.split | 61Kr7kwXjARE... | amount 35,961,500,383 (floor of collect / 10) |
| engine.forced | 4u9x2SjFqXJV... | spent 104,465,281,693,368 (top-up 104,141,628,189,918 + 90% of the collect, the whole budget), burned 414,949,555,502,411, supply 1,000,000,000,000,000 to 585,050,444,497,589, W child after 0, complete true, 122,536 CU |
| aux.engine.bonded.1 | 158TznQk9h23... | states landed, landed (collect, split); poolBurns 0 |
| engine.collect.2 | 4GmHb3EuJG7Z... | amount 1,905,959,520,314 (collect after migration works) |
| engine.split.2 | 39s9qPPYNUKi... | amount 190,595,952,031 |
| engine.pool.burn | 566k8sVSeQpa... | path exact_quote_in, spent 1,715,363,568,283 (the whole budget), burned 2,555,816,847,535, W child after 0, 96,033 CU |

- Real SOL spent: 0. The fork is local, and no devnet or mainnet send was made.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] trigger105 is true at cost 0**
- **Found during:** Task 2
- **Issue:** Once the curve completes, `costToComplete` returns 0, and `trigger105(balance, 0)` is true for any balance. A late forced bond would then try to buy on a completed curve.
- **Fix:** forcedJob treats cost 0 as not ready. The engine trigger also skips a null or 0 cost.
- **Commit:** f877d6e

**2. [Rule 2 - Missing] Bond burns could burn an unsplit treasury tenth**
- **Found during:** Task 2
- **Issue:** The burn spends all of W's BONDR. If the split had failed or was unknown, the treasury's tenth would be burned.
- **Fix:** forcedJob and bondedJob split every open collect of the coin. They send the burn only when every step is settled, as windowJob does.
- **Commit:** f877d6e

**3. [Rule 3 - Blocking] Small additions outside the plan's file list**
- fee-prebond.ts now exports `wBondr` and `settled`, so fee-burns.ts reuses them instead of copying them.
- The WR-08 unit check went into a new `packages/core/src/bond.test.ts` rather than fees.test.ts. That keeps fees.test free of SDK imports, and fees.test already had the `minOutAfter` cases.
- The fork run rewrote `packages/core/src/fixtures/pool-sell-launch.json`, as every fork run does. It was committed with the run's results.

## Known limits

- The boot catch-up reruns bondedJob (one urgent collect and split) for each pooled coin whose finalize is still `none`, on every boot. 05-08 sets finalize, which ends this.
- A forced bond dropped by a restart is not re-armed at boot. The next qualifying trade fires it again.

## TDD Gate Compliance

Task 1 and Task 2 each have a `test(...)` commit followed by a `feat(...)` commit. Task 1's RED run failed on minOut (500, expected 493). Task 2's RED run failed on the missing module.

## Known Stubs

None. bondedJob ends after the pool burn on purpose: 05-08 appends finalize, as the plan says.

## Requirements

- FEE-02 and FEE-03 are proven on the fork through the engine's own code. D-06 makes the fork the proof, because devnet cannot bond a child. Both are marked complete.
- FEE-08 is left unchecked. The urgent path is unit-checked here, and 05-12 or 05-13 show it on a running worker, in line with 05-04 and 05-05.

## Threat Flags

None. T-05-07-01 to 06 are mitigated as planned:
- **Fresh read before sending:** a fresh `costToComplete` and a simulation run before every forced bond, and no hook fires before ready.
- **Front-runs:** minOut is the simulated out minus W's prior balance, so a front-run reverts instead of over-burning.
- **One bond burn per coin:** the forcing flag, `has()` and the unique index allow only one.
- **Pinned recipient:** the buyback recipient comes from `poolState`.
- **Low ops:** both burns are urgent, so they still run below the ops floor.
- **Sender:** it is used only when net is mainnet. The fork used a plain broadcast.

## Self-Check: PASSED

- FOUND: packages/core/src/bond.test.ts, apps/worker/src/fee-burns.ts, apps/worker/src/fee-burns.test.ts, scripts/spike/stages/engine-bond.ts
- FOUND commits: bfc5a43, 37a5dd0, 0a182ba, f877d6e, 00d142e
