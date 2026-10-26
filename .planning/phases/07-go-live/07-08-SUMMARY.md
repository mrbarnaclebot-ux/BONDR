---
phase: 07-go-live
plan: 08
subsystem: core contract check
tags: [contract-check, pump, idl, tdd]
requires: [07-04]
provides:
  - "packages/core/src/contract.ts (@bondr/core/contract): PROFILES, Profile, judge, drift, effective, checkContract(conn, net, bondr?: PublicKey) -> { facts: string[], slots: Record<'pump'|'pump AMM'|'pump fees', string> }"
  - "scripts/contract-check.ts runner (devnet or fork)"
affects: [07-10 worker schedule and pause, 07-21 fork run, admin Health contract cell]
key-files:
  created:
    - packages/core/src/contract.ts
    - packages/core/src/contract.test.ts
    - scripts/contract-check.ts
  modified:
    - scripts/spike/stages/config.ts
    - scripts/README.md
key-decisions:
  - "07-08: account sizes are exact for the four pump config accounts (Pitfall 9); BONDR's curve or pool is checked for owner, discriminator and SDK decode only, since neither was measured on mainnet"
  - "07-08: BONDR's pool is judged when its canonical SOL pool account exists, else its bonding curve; the gatherer reads both in the same call"
  - "07-08: no on-chain Anchor IDL hash (discretion): the deploy slot signals change, and discriminators plus SDK decode are the compatibility test"
  - "07-08: the max creator fee fact is checked by judge on its own (D-19), deduplicated with drift's else-if string"
requirements-completed: []
duration: 30min
completed: 2026-10-26
---

# Phase 7 Plan 08: Pump Contract Check (Core) Summary

**The pump contract check now lives in core. It has measured per-net profiles and a pure judge that turns program, account and Global facts into plain-word failures. A gatherer collects those facts in 4 RPC calls plus readLiveConfig. The spike's drift strings moved into core byte-for-byte, and the spike imports them back. The live devnet run passes the devnet profile.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| RED | Failing judge tests (both measured networks inline) | bda9935 |
| 1 | contract.ts profiles, pure judge, moved drift and the RPC gatherer | 534d814 |
| 2 | The runner and the live devnet pass | d83ad10 |

## Evidence

- contract.test.ts: 6 passed. Red was committed first: the module did not exist.
  - Mainnet facts against the mainnet profile give []. Devnet facts against the devnet profile give [].
  - Devnet facts against the mainnet profile give exactly: "creator fee not configurable, assumed 150 bps per coin", "max creator fee 0 bps, below assumed 150", "AMM LP 25 bps, assumed 20".
  - Global at 1100 bytes gives "Global account is 1100 bytes, expected 1088". A changed discriminator and a decode failure each give their fact.
  - A non-executable pump program, and a pump AMM program not owned by the loader, each give their fact.
  - "create_v2 disabled" and "maxCurveDepth 0, need 1" fire as expected. PROFILES.fork equals PROFILES.mainnet.
- Live devnet run: `node --env-file=.env scripts/contract-check.ts --net devnet`, then again with `--bondr` set to the devnet BONDR mint. Both exited 0:
  ```
  { "net": "devnet", "facts": [], "slots": { "pump": "510657843", "pump AMM": "508659436", "pump fees": "508659783" } }
  ```
  The slots match the RESEARCH measurement. Neither output contains `api-key`.
- The spike config.ts diff is only the core import, the call `drift(facts, PROFILES.mainnet)`, and the removal of the moved functions and their now-unused types. With the mainnet profile the strings are the same templates producing identical text.
- contract.ts is 209 lines. Its chain ids, PDAs, IDLs and coders all come from ./pump.ts. `pnpm typecheck` and `pnpm lint` are clean.

## TDD Gate Compliance

The RED commit `test(07-08)` bda9935 is followed by the GREEN commit `feat(07-08)` 534d814. No refactor commit was needed.

## Deviations from Plan

1. **packages/core/package.json is unchanged.** Its `"./*": "./src/*.ts"` export already resolves `@bondr/core/contract`.
2. **Two plain-word facts beyond the templates:** "{account} account not owned by the {program} program" (an owner change), and a missing account reported as "{account} account is 0 bytes, expected N" (no owner, so it reports as not owned).
3. **`checkContract`'s third argument is the BONDR mint (`PublicKey`).** Pool versus curve is decided from chain, not by the caller.

## Notes for later plans

- 07-10: `checkContract(ctx.conn, env.net, env.quoteMint ?? undefined)`. An RPC throw propagates, which is "Could not run". `slots` are decimal strings, so compare them against the boot run for the amber "redeployed" state.
- 07-21: the fork run is `node --env-file=.env scripts/contract-check.ts --net fork` with Surfpool up, and it must pass the mainnet profile.

## Threat Flags

None. T-07-08-01..04 are handled as planned.

## Self-Check: PASSED

- FOUND packages/core/src/contract.ts, packages/core/src/contract.test.ts, scripts/contract-check.ts
- FOUND commits bda9935, 534d814, d83ad10
