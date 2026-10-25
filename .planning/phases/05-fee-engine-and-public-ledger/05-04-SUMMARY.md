---
phase: 05-fee-engine-and-public-ledger
plan: 04
subsystem: worker-fee-engine
tags: [worker, engine, ledger, intent-first, tdd]
requires:
  - 05-01 fee_ledger table, partial unique indexes, totalsFor, sweepSplit
  - 05-03 signTx, buyback role, tokenDelta and wFloat in core
provides:
  - fee-ledger.ts LedgerStore, memoryLedger, pgLedger (Entry, NewEntry, Facts)
  - fee-send.ts land, tipIxs, urgentBroadcast, opsLow, noteOps; FeeDeps, Job, Landed, FeeCoin
  - fee-config.ts OPS_FLOOR_LAMPORTS, feeConfig(net), SENDER_URL, SENDER_TIPS
  - fee-prebond.ts collectJob, splitJob, sweepJob, windowJob
  - core collect.ts sweepIxs
affects: [05-05, 05-06, 05-07, 05-08, 05-09]
tech-stack:
  added: []
  patterns:
    - sign, insertPending, broadcast, settle; a refused intent returns "done" and sends nothing
    - landing and coin totals in one db transaction; refused insert inside a savepoint so callers stay usable
    - ops floor read from each landed meta's postBalances[0], never an extra RPC call
key-files:
  created:
    - apps/worker/src/fee-config.ts
    - apps/worker/src/fee-ledger.ts
    - apps/worker/src/fee-ledger.test.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/fee-send.test.ts
    - apps/worker/src/fee-prebond.ts
    - apps/worker/src/fee-prebond.test.ts
  modified:
    - packages/core/src/collect.ts
    - apps/worker/src/README.md
decisions:
  - "FeeCoin, Job, Landed and FeeDeps live in fee-send.ts, next to land"
  - "noteOps(lamports) is exported so 05-05 seeds the floor from its one boot getBalance"
  - "collectJob and splitJob take an optional urgent flag (default false) for 05-07's forced bond"
  - "windowJob splits every open collect of the coin, not only the one it just landed, and sweeps only when every step settled (landed, done or dry); otherwise the sweep waits a window, so a treasury tenth is never swept 90/10"
  - "A split under 10 base units and a zero sweep return state done with no row"
  - "A Sender failure is always status unknown: skipPreflight means it may still land, so the row stays pending for recovery"
  - "Entry carries landedAt (LedgerRow needs it for publish)"
  - "No W float in split or sweep: W is a read-only signer there, and a 0-lamport read-only signer is valid; A4 is first proven on chain in 05-06"
metrics:
  duration: 13 min
  completed: 2026-10-25
  tasks: 3
  files: 9
---

# Phase 5 Plan 04: Fee engine money core Summary

The worker now has the fee engine's money core:
- a ledger store (Postgres and in-memory, with the same unique rules)
- one intent-first `land` pipeline with the ops floor and a mainnet-only Helius Sender branch
- the collect, 90/10 split and window sweep jobs

Nothing is wired into the running worker yet. 05-05 does that.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | LedgerStore in memory and on Postgres | a85e55c (RED), 9bf2d50 (GREEN) | fee-ledger.ts, fee-ledger.test.ts |
| 2 | land, the ops floor and the Sender path | 1298db0 (RED), faceb4e (GREEN) | fee-config.ts, fee-send.ts, fee-send.test.ts |
| 3 | Collect, split and window sweep jobs | 04afa59 (RED), cad3ac3 (GREEN) | fee-prebond.ts, fee-prebond.test.ts, core collect.ts, README.md |

## Verification

- `pnpm vitest run` on fee-ledger, fee-send and fee-prebond: 8, 9 and 7 tests pass. The two pgLedger cases ran against the Neon dev branch inside a transaction that always rolls back, so no seeded row survives.
- Full `pnpm test`: 51 files, 358 passed, 2 skipped. `pnpm typecheck` exit 0, `pnpm lint` (biome ci) clean.
- Acceptance greps:
  - `23505` and `totalsFor` are in fee-ledger.ts.
  - The text "ops below floor" is in fee-send.ts.
  - `sender.helius-rpc.com` appears only in fee-config.ts.
  - `export function sweepIxs` is in collect.ts.
  - The only balance read in fee-prebond.ts is `getTokenAccountBalance`, inside `wBondr`, which only sweepJob calls.
- File sizes: fee-ledger.ts 276 lines, fee-send.ts 198, fee-prebond.ts 95, fee-config.ts 42, collect.ts 81. Biome's 40-line function rule passes.
- The Sender tip accounts were re-checked against the Helius Sender docs on 2026-10-25: 10 mainnet-beta accounts, Sender Max minimum tip 0.001 SOL.
- Devnet spend: 0 SOL. Only units ran, with no chain sends.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] windowJob could sweep an unsplit treasury tenth**
- **Found during:** Task 3
- **Issue:** As written, the plan sweeps right after the collect and split. If the split failed, was skipped or was unknown, the sweep would send the treasury's tenth 90/10, mostly to the buyback. That breaks D-14.
- **Fix:** windowJob now splits every open collect of the coin. It sweeps only when every step is landed, done or dry. Otherwise the budget rolls to the next window, and nothing is lost.
- **Commit:** cad3ac3

**2. [Rule 2 - Missing] Distinguish a missing W ATA from an RPC error**
- **Found during:** Task 3
- **Issue:** Treating every balance read error as 0 would skip a sweep without any sign of it.
- **Fix:** Only "could not find account" counts as 0. Any other error throws to the caller, whose queue logs it.
- **Commit:** cad3ac3

**3. Zero sweep legs write no row**
- A balance under 10 units gives a treasury leg of 0. That leg's ix and its row are both left out, in line with sweepIxs omitting a zero leg.

## Deferred Issues

- `LedgerStore.diff(null, ...)` violates the 0005 check `fee_ledger_platform` on Postgres, because only `buyback_burn` may have a null mint. 05-09's buyback reconcile diff will need a migration or a different shape. This is logged in deferred-items.md.

## TDD Gate Compliance

Each task has a `test(...)` commit followed by a `feat(...)` commit. Each RED run failed on the missing module.

## Known Stubs

None. FeeDeps.publish, bondrSol and the engine wiring are injected on purpose. 05-05 supplies them.

## Requirements

FEE-01, FEE-02, FEE-04 and FEE-08 are left unchecked. This plan builds their send path and the pre-bond jobs, but nothing runs in the worker until 05-05. The forced bond (FEE-02) comes in 05-07.

## Threat Flags

None. T-05-04-01 to 06 are mitigated as planned:
- intent before broadcast, and a refused intent returns "done"
- unknown is never resent
- destinations are only the derived ATAs
- the split is sized from the collect row
- the collect minimum and the ops floor are in place
- errors are redacted
- the Sender branch is net-gated and unit-checked

## Self-Check: PASSED

- FOUND: fee-config.ts, fee-ledger.ts, fee-ledger.test.ts, fee-send.ts, fee-send.test.ts, fee-prebond.ts, fee-prebond.test.ts
- FOUND commits: a85e55c, 9bf2d50, 1298db0, faceb4e, 04afa59, cad3ac3
