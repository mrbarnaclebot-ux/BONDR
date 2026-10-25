---
phase: 06-admin-dashboard
plan: 15
subsystem: spike
tags: [fork, surfpool, recovery-actions, gate]
requires: [06-09, 06-13]
provides:
  - "scripts/spike/stages/admin.ts adminStage: admin.forced, admin.migrate, admin.leftover, admin.finalize, admin.distribute"
  - "scripts/spike/stages/admin-steps.ts: adminRun, act (simulate, sign, execute, poll), simChange, recordAct"
  - "engine-final.ts finalUpdateRule(devKey) factory; trades, shares, distributeRule, F exported; engine-bond.ts whaleBuy exported"
affects: [06-18, 06-22, 06-26]
tech-stack:
  added: []
  patterns: [fork stage driving the worker's admin money path with an in-memory audit and a one-coin engine stub]
key-files:
  created:
    - scripts/spike/stages/admin.ts
    - scripts/spike/stages/admin-steps.ts
  modified:
    - scripts/spike/nets/fork.ts
    - scripts/spike/stages/README.md
    - scripts/spike/stages/engine-bond.ts
    - scripts/spike/stages/engine-final.ts
    - scripts/spike/results/fork.json
    - packages/core/src/fixtures/pool-sell-launch.json
decisions:
  - "06-15: the fork admin key is ctx.key(\"sim\", \"admin\"); Role has no \"admin\" and a fork-only key does not justify widening core keys"
  - "06-15: the stage passes a one-coin engine stub (coin + inline exclusive) instead of engine null, so actionView never calls loadCoin (Postgres) on the fork"
  - "06-15: Retry forced bond runs with feesUnclaimed 0 and feeBudget = the TOP-UP, so it is one tx and its preview is exact; the collect path is already proven by engine.collect"
  - "06-15: the stage plays the indexer between actions (venue curve -> complete -> pool, finalize -> done), since the fork deps publish nothing and engine.landed() never runs"
metrics:
  duration: 35 min
  completed: 2026-10-25
  tasks: 1
  files: 8
---

# Phase 6 Plan 15: Admin fork gate Summary

The five fork-only recovery actions now run on the Surfpool mainnet fork through the worker's own `simulateAction` and `executeAction`. Each one uses an ed25519 signature over the stored intent message and is polled to completion through `intentView`. Each is audited in a `memoryAudit` that must settle landed with exactly the intent's signatures. Every simulated balance change matched the landed change exactly (0 base units off).

## What was built

- **admin-steps.ts (119 lines):**
  - `adminRun` creates a fresh child AD with the sim dev as its recorded deployer. It wraps the fork `feeDeps` ledger's `settle` so the stage can read each landed row (sig, burned, distribute detail). It builds the `MoneyCtx` with a one-coin engine stub, `memoryAudit()` and the admin key.
  - `act(action)` runs simulate, then asserts the intent exists and the destination check passed. It then signs with node:crypto (the primitive `signatureOk` verifies with), calls execute, and polls the intent until it leaves "sending" (500 ms interval, 60 s cap). It reports the audit as "landed" only when the last audit row settled landed with the same signatures.
  - `simChange` turns the preview's change column back into base units, using admin-sim's own decimals.
- **admin.ts (181 lines):** the five steps plus their rules. Every rule is wrapped in `audited`, which fails unless the audit is "landed".
- **fork.ts:** `adminStage` runs right after `engineFinalStage`. **README.md:** gains the admin row.

## Fork run (SPIKE_NET=fork)

`pnpm spike` gave `fork: 99 ok, 0 failed`. `pnpm spike:check` gave `100 passed, 0 failed`, so every earlier row still passes. `pnpm spike:fork-down` was run afterwards.

| Row | Landed facts |
|-----|--------------|
| admin.forced | 1 tx. Curve complete. Supply 1000000000000000 -> 585545665399141, a drop of 414454334600859, equal to the ledger's burned amount. W BONDR change: simulated -104141628189918, landed -104141628189918. |
| admin.migrate | 1 tx. The pool account exists. |
| admin.leftover | 38812200127700 child tokens sent to W, then burned. Supply dropped by exactly that amount and W's child balance is 0. Simulated W change: -38812200127700. |
| admin.finalize | 5 txs. Holders are AD's deployer and the treasury at 8000,2000, and the admin is revoked. |
| admin.distribute | 1 tx. Deployer 136470344779, treasury 34117586194 (80:20). Deployer change: simulated 136470344779, landed 136470344779. |

Each row has intent "landed" and audit "landed".

## Gates

- `pnpm lint`: clean (380 files).
- `pnpm typecheck`: pass.
- Full `pnpm test`: 81 files, 611 passed, 2 skipped (613).
- Line counts: admin.ts 181, admin-steps.ts 119, engine-final.ts 145 and engine-bond.ts 189 are all under 300.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `engine: null` would read Postgres**
- **Found during:** Task 1 (reading admin-actions.ts)
- **Issue:** `actionView` with a null engine calls `loadCoin(mint)`, which reads the Neon database. The fork has no row for AD, and the stage must not touch the database.
- **Fix:** a cast stub holding the one coin, with `exclusive` running inline.
- **Commit:** 5715206

**2. [Rule 3 - Blocking] No "admin" key role**
- **Issue:** the plan's `ctx.key("admin", "fork")` does not typecheck, because `Role` has no "admin".
- **Fix:** used `ctx.key("sim", "admin")`. It is still derived from the fork master seed.
- **Commit:** 5715206

**3. [Rule 1 - Bug in the stage] Distribute now refused as not_finalized**
- **Found during:** the first full fork run (the four rows before it passed)
- **Issue:** in the worker, the coin's `finalize = "done"` comes from `engine.landed()` on the update's publish. The fork deps' publish is a no-op.
- **Fix:** the stage sets it after the finalize action lands, just as it moves the venue. No worker code changed.
- **Commit:** 5715206

**4. Scope notes**
- The forced bond runs as a single tx (`feesUnclaimed: 0n`, `feeBudget` = the TOP-UP), so the simulated and landed comparison is exact. The plan's "W SOL change" became the W BONDR change, because W's SOL does not move (ops pays).
- The leftover rule compares the simulated W child change to the landed supply drop.
- Run migrate and Finalize split have no simulated-versus-landed check. Migrate's only watched account is ops SOL, which includes fees. Finalize is multi-tx, and only its first step is authoritative.
- The pool-trade rows reuse engine-final's `trades`, so their ids read `aux.engine.admin.final.*` and `aux.engine.admin.distribute.*`, and their labels mention E2.
- The split into admin-steps.ts was made up front so each file reads as one concept.
- The first fork run aborted in a prefund on a Surfpool upstream fetch error ("Failed to fetch accounts from remote"). That run was before any admin code ran, and the rerun was clean.

## Requirements

None are ticked. ADMIN-03 and ADMIN-04 still need the web dialog (06-18). Their worker and fork halves are now proven.

## Known Stubs

None.

## Threat Flags

None. The stage uses only `ctx.conn`, the local fork (T-06-15-01). Every send goes through `gatedDeps` inside `executeAction`, and a refused destination would leave the audit row "refused" and fail the rule (T-06-15-03).

## Self-Check: PASSED
