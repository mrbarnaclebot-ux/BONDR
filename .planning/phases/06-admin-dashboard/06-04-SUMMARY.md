---
phase: 06-admin-dashboard
plan: 04
subsystem: worker
tags: [worker, ledger, multi-mint, split, tdd]
requires: [06-02]
provides:
  - fee-ledger-memory.ts memoryLedger (signature keys include the mint, mirroring 0007)
  - fee-ledger.ts factsOf export
  - fee-send.ts publishByMint, withSol skips rows that carry their own sol
  - fee-reconcile.ts evacuate counted as an outflow in impliedOf and pgImplied
affects: [06-09 leftover sweep, 06-22 EVACUATE]
tech-stack:
  added: []
  patterns: [Map.groupBy per mint before publish, facts merged per mint group in recovery]
key-files:
  created:
    - apps/worker/src/fee-ledger-memory.ts
    - apps/worker/src/fee-send-mint.test.ts
  modified:
    - apps/worker/src/fee-ledger.ts
    - apps/worker/src/fee-ledger.test.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/fee-recover.ts
    - apps/worker/src/fee-recover.test.ts
    - apps/worker/src/fee-reconcile.ts
    - apps/worker/src/fee-reconcile.test.ts
    - apps/worker/src/README.md
    - scripts/spike/stages/engine-bond.ts
    - apps/worker/src/{fee-batch,fee-burns,fee-finalize,fee-prebond,fee-send}.test.ts (import path only)
decisions:
  - "06-04: memoryLedger lives in fee-ledger-memory.ts and is not re-exported from fee-ledger.ts; factsOf is exported from fee-ledger.ts because both stores apply landed facts with it"
  - "06-04: a row built with its own sol keeps it; withSol only fills sol for rows without one"
  - "06-04: landed rows are published per mint through publishByMint (fee-send.ts), shared by the send path and boot recovery"
  - "06-04: recovery merges per-mint factsFor results; Facts stay keyed by kind, so two mints with the same W-delta kind in one tx would share one value (ponytail comment in fee-recover.ts)"
metrics:
  duration: 12 min
  completed: 2026-10-25
  tasks: 2
  files: 18
---

# Phase 6 Plan 04: Multi-mint ledger fixes and fee-ledger split Summary

The fee ledger and send path now handle one transaction that carries rows for several coins. The memory ledger keys signatures by (signature, kind, mint) like the 0007 index. Rows built with their own SOL value keep it after landing. Each coin's landed rows are published to that coin only, in both the send path and boot recovery. The nightly reconcile counts `evacuate` as an outflow of W's BONDR. fee-ledger.ts is down from 297 to 218 lines.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Split the memory ledger out and key signatures by mint | b0c70d0 |
| 2 | Per-row sol, per-mint publish and evacuate in reconcile | b648b4d |

## Task notes

- Task 1 (TDD): the new memory case (two evacuate rows on one signature for mints A and B) failed while the key was still `sig:${signature}:${kind}`, then passed with `:${mint ?? ""}`. The Postgres case seeds a second coin inside the rolled-back transaction and inserts both rows against the real 0007 index. It passed from the start because 06-01 had already widened the index. `rolledBack` now passes `tx` to the test body, and the transaction type has a `Tx` alias. The `live`, `ONCE`, `BURN` and `SWEEP` constants moved with `keysOf` because nothing else used them. fee-ledger.ts is 218 lines and fee-ledger-memory.ts is 85.
- Task 2 (TDD): all four new cases failed first. Before the fix, withSol returned `{evacuate: {sol: 200n}}` and both landed rows had 200n. Recovery read W_A for both mints and published once. Implied BONDR for an evacuated W was 1000n. The landed paths in fee-send and fee-recover now both go through `publishByMint`. Recovery groups rows by mint, runs `factsFor` against each coin's W and merges the results. The DB totals path was already grouped by mint and is unchanged. The pgImplied test captures the SQL with a fake `execute` and renders it with `PgDialect`, so it needs no database. fee-send.ts is 266 lines.

## Verification

- `pnpm vitest run apps/worker/src/fee-ledger.test.ts`: 11 passed (Neon dev branch, rolled back)
- `pnpm vitest run fee-send, fee-send-mint, fee-recover, fee-reconcile, fee-engine`: 5 files, 36 passed
- The other memoryLedger users (fee-batch, fee-prebond, fee-burns, fee-finalize and the rest): 7 files, 61 passed after the import move
- `pnpm typecheck`: pass
- `pnpm lint`: clean (328 files)
- `pnpm test`: 61 files passed, 460 tests passed, 2 skipped, 0 failed
- `rg "rows\[0\]\.mint"` in fee-send.ts and fee-recover.ts: no match. `evacuate` appears 3 times in fee-reconcile.ts.

## Deviations from Plan

None that change behavior. Small calls:

- `factsOf` is exported from fee-ledger.ts rather than moved. pgSettle and memoryLedger both use it.
- The one-line import updates also touched fee-batch, fee-burns, fee-finalize and fee-prebond tests, which the plan's file list did not name. The action said to update "every test that used memoryLedger".
- `publishByMint` is exported from fee-send.ts so recovery shares it. No new file.
- fee-ledger.test.ts is DB-backed and was already in the vitest `DB` list. The new test files touch no database.

## Requirements

ADMIN-11 and ADMIN-03 are not marked complete. This plan fixes the ledger groundwork they depend on. The leftover sweep (06-09) and EVACUATE (06-22) still have to ship.

## For the next plans

- Rows for EVACUATE and the leftover sweep should carry their own `amount` and `sol`. withSol leaves those rows alone, and per-kind facts would otherwise overwrite sibling rows. `factsFor` has no `evacuate` or `leftover_burn` case, so those rows keep their intent amounts.
- Facts are still keyed by kind. If one tx ever needs W-measured amounts for the same kind on two mints, Facts must be keyed by row.
- These worker kind lists still lack the new kinds: `W_OUT` in fee-send.ts (`evacuate` is not measured from meta), `HOLDS` in fee-guard.ts and `BOND_KINDS` in fee-burns.ts. Decide in 06-09 and 06-22 whether a pending evacuate should hold the coin's spend guard. It probably should, so that nothing races the drain.
- Import memoryLedger from `./fee-ledger-memory.ts`.

## Self-Check: PASSED

- FOUND: apps/worker/src/fee-ledger-memory.ts, apps/worker/src/fee-send-mint.test.ts
- FOUND: commits b0c70d0, b648b4d
