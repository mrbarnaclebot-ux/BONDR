---
phase: 05-fee-engine-and-public-ledger
plan: 03
subsystem: core
tags: [core, send, keys, curve, tdd]
requires:
  - 05-01 coins columns fees_unclaimed, cost_to_complete, bondr_sol
provides:
  - send.ts signTx and exported BlockhashInfo; sendTx = signTx + sendRaw
  - keys.ts Role "buyback"
  - float.ts wFloat(conn, w, bytes), one copy, rents read live
  - curve.ts costFromReserves(reserves, { global, feeConfig }, { creator, quoteMint, creatorFeeBps })
  - curve-state.ts curveState, with feesUnclaimed and bondrSol on every curve patch
  - CoinPatch costToComplete (filled by the worker, 05-05)
affects: [05-04, 05-05, 05-06, 05-07]
tech-stack:
  added: []
  patterns:
    - sign, record, then broadcast: signTx is the single signing choke point behind checkMessage
    - trigger inputs come from the indexed patch, never from a per-trade RPC read
key-files:
  created:
    - packages/core/src/float.ts
    - packages/core/src/curve-state.ts
    - packages/core/src/curve.test.ts
  modified:
    - packages/core/src/send.ts
    - packages/core/src/send.test.ts
    - packages/core/src/keys.ts
    - packages/core/src/keys.test.ts
    - packages/core/src/trade-error.ts
    - packages/core/src/curve.ts
    - packages/core/src/trades.ts
    - packages/core/src/trades.test.ts
    - packages/core/src/README.md
    - scripts/spike/stages/bond.ts
decisions:
  - "fromLogs and customCode moved from send.ts to trade-error.ts (their only other user) so send.ts stays under 300 lines after the signTx split"
  - "curveState moved to curve-state.ts (with the big and sol helpers) because trades.ts reached 302 lines; trades.ts is now 279"
  - "costFromReserves accepts string or bigint reserves, so a CoinPatch or coins row feeds it directly; the partial BondingCurve is a cast because the omitted fields only price a buy past the curve"
  - "costFromReserves is checked against costToComplete through a stubbed online SDK on the same curve-buy reserves, at creatorFeeBps 0 and 150"
metrics:
  duration: 9min
  completed: 2026-10-25
---

# Phase 5 Plan 03: Core prerequisites for the fee engine Summary

`signTx` is split out of `sendTx` so the engine can sign, record its intent, and only then broadcast. There is a `buyback` key role. `wFloat` lives in core and reads rents live. `costFromReserves` runs the SDK v3 quote over indexed reserves with no RPC. Every curve patch now carries `feesUnclaimed` (from `creatorFeeUnclaimed`) and `bondrSol`.

## Tasks

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | signTx, the buyback role and wFloat in core | 2a8336d (test), 47adfb4 (feat) | send.ts, send.test.ts, keys.ts, keys.test.ts, float.ts, trade-error.ts, spike bond.ts |
| 2 | costFromReserves and the fee fields on the curve patch | bdb304e (test), a2fc794 (feat) | curve.ts, curve.test.ts, curve-state.ts, trades.ts, trades.test.ts, README.md |

## Verification

- `pnpm test`: 48 files, 334 passed, 2 skipped
- `pnpm typecheck`: exit 0
- `pnpm lint` (biome ci): clean
- send.ts 294 lines, trades.ts 279, curve-state.ts 34
- `rg getMinimumBalanceForRentExemption scripts/spike/stages/bond.ts` finds nothing. bond.ts imports `@bondr/core/float`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] send.ts would have grown past 300 lines**
- **Found during:** Task 1
- **Issue:** with signTx in place and the code formatted, send.ts was 308 lines.
- **Fix:** moved `fromLogs` and `customCode` to trade-error.ts, which already imported them and is their only other user. send.ts now imports them from there.
- **Files modified:** packages/core/src/send.ts, packages/core/src/trade-error.ts
- **Commit:** 47adfb4

**2. [Plan contingency] trades.ts reached 302 lines**
- **Found during:** Task 2
- **Fix:** moved `curveState` into curve-state.ts, as the plan allows. Its signature is now `(mint, d, b, init)` instead of taking the parser Ctx.
- **Commit:** a2fc794

The "pool patch has no feesUnclaimed" behavior was already covered by the existing pool-buy `toEqual` assertion, so no new test was added for it.

## TDD Gate Compliance

Each task has a `test(...)` commit followed by a `feat(...)` commit. The tests were written in the same session as the implementation and committed first. The buyback-role check passes at runtime without the type change, because vitest does not typecheck. The type change itself is enforced by `pnpm typecheck`.

## Known Stubs

`CoinPatch.costToComplete` is declared but parseTx never sets it, on purpose. The worker fills it before the write in plan 05-05.

## Self-Check: PASSED

- FOUND: packages/core/src/float.ts, packages/core/src/curve-state.ts, packages/core/src/curve.test.ts
- FOUND commits: 2a8336d, 47adfb4, bdb304e, a2fc794
