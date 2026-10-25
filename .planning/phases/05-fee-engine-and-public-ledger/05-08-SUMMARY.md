---
phase: 05-fee-engine-and-public-ledger
plan: 08
subsystem: worker-fee-engine
tags: [worker, finalize, fee-sharing, pre-flight, fork, tdd]
requires:
  - 05-04 land, LedgerStore, collect/split/sweep jobs, memoryLedger
  - 05-05 Engine, per-coin queue, publish wrap
  - 05-07 bondedJob, fork state E2, E2.sig, E2.dev
provides:
  - core sharing.ts finalizeConfigIxs, finalizeUpdateIxs, finalizeState (finalizeIxs is now their concatenation)
  - core collect.ts collectIxs sweepCurve option
  - fee-finalize.ts preflight, finalizeJob (closing collect, split, sweep)
  - fee-routes.ts feeRoutes with bearer POST /fee/release; Engine.release; feeEngine getter
  - LedgerStore release and markFinal; Landed.code; FeeDeps.windowMs
  - fork stage engine-final.ts (engine.finalize.config, engine.finalize.update, engine.finalize.sweep)
affects: [05-09, 05-12, 05-13, phase-06-admin]
tech-stack:
  added: []
  patterns:
    - finalize resumes from one chain read (curve, pool, SharingConfig) instead of a caller boolean
    - any doubt about the deployer writes a held row and a console.error (Sentry); only an owner release with a named deployer re-runs it
    - a send failure carries the program's custom code on Landed and in the failed row's error ("code 6009: ...")
key-files:
  created:
    - packages/core/src/sharing.test.ts
    - apps/worker/src/fee-finalize.ts
    - apps/worker/src/fee-finalize.test.ts
    - apps/worker/src/fee-routes.ts
    - scripts/spike/stages/engine-final.ts
  modified:
    - packages/core/src/sharing.ts
    - packages/core/src/collect.ts
    - packages/core/src/README.md
    - apps/worker/src/fee-burns.ts
    - apps/worker/src/fee-burns.test.ts
    - apps/worker/src/fee-engine.ts
    - apps/worker/src/fee-ledger.ts
    - apps/worker/src/fee-ledger.test.ts
    - apps/worker/src/fee-prebond.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/main.ts
    - apps/worker/src/README.md
    - apps/worker/README.md
    - scripts/spike/stages/engine-bond.ts
    - scripts/spike/nets/fork.ts
    - scripts/spike/stages/README.md
    - scripts/spike/results/fork.json
    - packages/core/src/fixtures/pool-sell-launch.json
decisions:
  - "Tx1's pool sweep parks W's post-bond pool fees in W's own coin creator vault, and the update pays nothing out (fork, both E2 and the spike's C2). RESEARCH Pattern 6 step 4 assumed otherwise. So finalize closes with a collect of W's own vaults with no curve sweep (the curve names the config by then), then the window split and the sweep."
  - "The closing step follows the window policy (collect, 10% split, then 90/10 sweep of the budget), not a straight 90/10. A collect without its split would stay open, and boot recovery would then try to split BONDR that is already gone."
  - "bondedJob with a live bond burn skips collect and split and goes straight to finalizeJob. A collect that sweeps the curve as W fails once the sharing config exists, so this is what lets a restart between tx1 and tx2 resume."
  - "An owner override skips the launch-tx fetch entirely. deployerOk runs with wallet = override, so only the distinct and on-curve checks apply. The held coin is released (held to none) only after that check passes."
  - "A missing launch signature or a launch tx with no CreateEvent for the mint holds the coin. A launch tx not found yet, or any RPC error, throws so the next run retries, with no held row."
  - "Dry mode writes no held row, release or markFinal; it logs what it would have done."
  - "POST /fee/release answers 400 invalid_input for bad keys, an off-curve deployer, or a coin the engine does not hold. It logs 'fee release {mint}' through redact."
  - "engine-bond.ts coins start finalize held, so its bondedJob does not finalize E1 or E2. engine-final.ts finalizes E2 after the post-bond trades."
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 3
  files: 23
---

# Phase 5 Plan 08: Finalize with deployer pre-flight Summary

Bonded coins now finalize through the engine. The worker first reads the coin's state from chain in one call. It then checks the deployer: the CreateEvent user from the launch tx must equal launches.wallet, must differ from both the treasury and W, and must be on curve. If that passes, it sends the two proven finalize txs, which end in the single 8000/2000 update. A closing collect, split and sweep then leaves W at 0 BONDR and 0 child tokens.

Any doubt about the deployer holds the coin. Nothing retries a held coin automatically; a bearer `POST /fee/release` lets the owner release it. On the fork, the worker's own `finalizeJob` locked E2's dev and the treasury in at 8000/2000 with the admin revoked, and W ended empty.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Resumable finalize builders and the chain-read finalize state | 7a1f7f4 (RED), f49906f (GREEN) | sharing.ts, sharing.test.ts |
| 2 | Deployer pre-flight, finalize job, closing sweep and the release route | a400a3e (RED), f991bbf (GREEN) | fee-finalize.ts (+test), fee-routes.ts, fee-ledger.ts (+test), fee-burns.ts (+test), fee-engine.ts, fee-prebond.ts, fee-send.ts, main.ts, READMEs, engine-bond.ts |
| 3 | Fork rows for the engine's finalize on the traders-bonded coin | 855a1cd (fix found by the fork), 636da5e | collect.ts, fee-finalize.ts, fee-burns.ts (+tests), engine-final.ts, engine-bond.ts, nets/fork.ts, stages/README.md, results/fork.json |
| docs | Core README | 3b12272 | packages/core/src/README.md |

## Verification

**Unit tests**
- `pnpm vitest run packages/core/src/sharing.test.ts`: 4 passed.
  - finalizeConfigIxs equals `finalizeIxs(...).slice(0, -2)`, compared by program id, data and keys.
  - finalizeUpdateIxs equals `[...configSweeps, vault ATA, update]`.
  - finalizeState returns none, revoked and configured from a single `getMultipleAccountsInfo([curve, pool, config])`. With no curve it reads not complete, and with no pool it returns null.
- `pnpm vitest run apps/worker/src/fee-finalize.test.ts apps/worker/src/fee-ledger.test.ts apps/worker/src/fee-burns.test.ts`: all passed. fee-finalize has 9 cases covering every behavior bullet:
  - preflight returns the deployer.
  - A wrong CreateEvent user holds once, logs one "finalize held" and sends nothing.
  - An RPC failure throws and writes no held row.
  - With sharing none: config, then update, then the closing collect, split and sweep. The update detail is `{ dBps: 8000, tBps: 2000, deployer, treasury }`, and the closing collect does not sweep the curve.
  - With sharing configured: only the update and the closing steps.
  - Revoked with [8000, 2000]: markFinal, then done and swept.
  - A 6009 fails the row with "6009", is never resent, and the coin is done only for our 80/20 (held for 50/50).
  - A held coin is skipped without an override. An override skips the fetch and releases the coin, and an override that equals the treasury holds again.
  - The route refuses non-base58 keys, off-curve deployers and coins that are not held, and enqueues the override.
- The pgLedger test also checks hold, then release, then markFinal on Neon (finalize held, then none, then done, with deployer_bps 8000).

**Full suite and checks**
- `pnpm typecheck` exit 0. `pnpm lint` exit 0.
- `pnpm test`: 403 passed, 2 skipped, 2 failed. Both failures are Neon timeouts in files this plan did not touch: `apps/worker/src/prepare.test.ts` (30 s) and `apps/web/lib/trades.test.ts` (10 s). Run alone, both files pass (13/13). No non-bndr test coins leaked (0 rows).

**Acceptance greps**
- `deployerOk`, `CreateEvent` and `6009` match in fee-finalize.ts. 6009 appears only in the final-state handling (ADMIN_REVOKED, then lockedFinal); nothing resends.
- `"POST /fee/release"` matches in fee-routes.ts.
- `apps/worker/src/fee-finalize` matches in engine-final.ts, and `finalizeJob` in fee-burns.ts.
- `feeRoutes` matches in main.ts.
- `getMultipleAccountsInfo` matches in sharing.ts, and `8000|2000` counts 1 there (FINAL_SHARES).

**File sizes:** fee-engine.ts 297, fee-ledger.ts 287, fee-finalize.ts 167, sharing.ts 172, engine-final.ts 116, fee-routes.ts 32. All are under 300 lines.

**Fork gate**
`pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` gave `fork: 82 ok, 0 failed` and `83 passed, 0 failed`. Every earlier row still passes. `pnpm spike:fork-down` was run afterwards.

| Row | Signature | Facts |
|-----|-----------|-------|
| aux.engine.final.buy / sell | 53w2qpcKzzfs... / 4Zz5XtvfX8ou... | sim PumpSwap buy_v2 and sell_v2 on E2's pool |
| engine.finalize.config | VJHDFx6gAGJx... | the pre-flight passed on E2's real launch tx; sweeps + create_fee_sharing_config, 188,304 CU, W BONDR delta 0 |
| engine.finalize.update | 5jcotdM8w8bu... | shares 8000,2000, holders [E2's dev 7kNdRQrS..., treasury HSRgAnRH...], adminRevoked true, 126,435 CU |
| engine.finalize.sweep | 5ZmpNq3Ls3Fa... | closing collect 197,555,000,187, split 19,755,500,018, buyback 160,019,550,153 (90% of the rest, floor to treasury); W BONDR after 0, W child after 0 |

- The worker logged `finalize FEeaBNPg...: W child 0, BONDR 0`.
- Real SOL spent: 0. The fork is local; there were no devnet or mainnet sends.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] W's post-bond fees never reached W, so the closing sweep found nothing**
- **Found during:** Task 3 (first fork run: config and update landed, then `engine.finalize.sweep: missing`).
- **Issue:** The fork tx deltas show that tx1's pool sweep moves the pool's creator fees (197.5B BONDR) into W's own coin creator vault (owner 7PkxPCdR). The update's inner distribution then moves nothing. The spike's C2 finalize behaves the same. RESEARCH Pattern 6 step 4 ("the update pays W the pre-update vault") does not hold, so those fees would have stayed in W's vault for good.
- **Fix:**
  - finalize now closes with `collectJob(d, coin, false, false)`. This is a collect of W's own vaults with no curve sweep: once the sharing config exists the curve names it, and a sweep naming W fails. After that come the open-collect split and the window sweep.
  - `collectIxs` gained `sweepCurve`.
  - bondedJob with a live bond burn now goes straight to finalizeJob without collecting. Otherwise a restart between tx1 and tx2 would stall on the failing curve sweep.
- **Files modified:** collect.ts, fee-prebond.ts, fee-finalize.ts, fee-burns.ts, and both tests.
- **Commit:** 855a1cd

**2. [Rule 2 - Missing] Dry mode would have written held rows**
- **Issue:** Dry mode must write nothing (05-05), but hold, release and markFinal write.
- **Fix:** All three run only in mode on. Dry mode logs instead.
- **Commit:** f991bbf

**3. [Rule 3 - Blocking] Small additions outside the plan's file list**
- `FeeDeps.windowMs`, because the closing sweep needs the current window and bondedJob has no engine options.
- `Landed.code`, plus the code as a prefix on a failed row's error, so the 6009 is visible to finalize and in the ledger.
- The `wBondr` token parameter, so W's child balance reuses the same read.
- `Engine.release` and the `feeEngine` getter, because the routes are built before the engine starts.
- The engine-bond.ts coins now start held, and pick, record, E and feeDeps are exported for engine-final.ts.
- The fork run rewrote `packages/core/src/fixtures/pool-sell-launch.json`, as every fork run does. It was committed with the results.
- **Commits:** f991bbf, 636da5e

## Known limits

- bondedJob treats a pending bond burn as live, the same as 05-07. Boot recovery settles pending rows before the engine starts, so this only matters for a burn left "unknown" during a live run.
- finalize_config and finalize_update rows record W's BONDR delta, which was 0 on the fork. The post-bond fees show up as the closing collect.

## TDD Gate Compliance

Task 1 and Task 2 each have a `test(...)` commit followed by a `feat(...)` commit.
- Task 1's RED run against the old sharing.ts failed all 4 tests: the new exports were missing.
- Task 2's RED run failed on the missing modules.

## Known Stubs

None.

## Requirements

FEE-05 is proven on the fork through the engine's own code: pre-flight, config, the single 8000/2000 update and the empty W. Held and release are unit-checked. ROADMAP criterion 4 is met. FEE-05 was already checked in REQUIREMENTS.md, and this plan marks it again.

## Threat Flags

None beyond the plan's register.
- **T-05-08-01:** the CreateEvent comes from innerEvents, which checks the event authority. The equality, distinct and on-curve checks all run, and a failure holds the coin and is never retried automatically.
- **T-05-08-02:** the route uses the existing bearer check, validates its body, and logs through redact.
- **T-05-08-03:** fee_ledger_once applies, finalizeState is read first, and a 6009 is final.
- **T-05-08-04:** config and update rows carry signatures and the shares in detail. A held row stays as history after release.
- **T-05-08-05:** the held reason appears only in the held row's detail and in the logs. It is not a public kind.
- **T-05-08-06:** the closing sweep pays only the derived buyback and treasury ATAs, and the fork confirmed W at 0 BONDR and 0 child tokens.

## Self-Check: PASSED

- FOUND: packages/core/src/sharing.test.ts, apps/worker/src/fee-finalize.ts, apps/worker/src/fee-finalize.test.ts, apps/worker/src/fee-routes.ts, scripts/spike/stages/engine-final.ts
- FOUND commits: 7a1f7f4, f49906f, a400a3e, f991bbf, 855a1cd, 636da5e, 3b12272
