---
phase: 07-go-live
plan: 05
subsystem: worker fee engine
tags: [fee-config, sender, mainnet, tdd]
requires: [07-04]
provides:
  - "feeConfig(net): paceMs 1100 everywhere, opsFloorLamports (mainnet 0.1 SOL, devnet 0.05 SOL), launchTipLamports 1_000_000"
  - "ensureTable(conn, ops, keys, prior, net); noteOps(lamports, net); refreshOps needs net on its deps"
  - "core net.ts exports heliusKey()"
  - "urgentBroadcast(net, conn, raw, o: RawOpts & { swqosOnly? }, post): keyed Sender URL"
affects: [07-09 launch Sender (sets swqosOnly from launchTipLamports), admin overview opsFloor]
key-files:
  created:
    - apps/worker/src/fee-config.test.ts
  modified:
    - apps/worker/src/fee-config.ts
    - apps/worker/src/build.ts
    - apps/worker/src/prepare.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/fee-send.test.ts
    - apps/worker/src/fee-boot.ts
    - apps/worker/src/admin-overview.ts
    - packages/core/src/net.ts
    - apps/worker/src/README.md
    - "tests: admin-overview, admin-sim, admin-evacuate, fee-batch, fee-send-mint, prepare (noteOps/ensureTable net argument)"
key-decisions:
  - "07-05: the ops floor is per net in feeConfig and every reader (table build, fee engine, admin overview) passes the net; no exported floor constant remains"
  - "07-05: the Sender URL is built inside urgentBroadcast's try, so a missing key still yields an 'unknown' result like any Sender error"
requirements-completed: []
duration: 25min
completed: 2026-10-26
---

# Phase 7 Plan 05: Per-Net Money Numbers and the Keyed Sender Summary

**feeConfig now holds every per-net number the go-live gates change: pace 1100 ms on every net (G-10), the ops floor at 0.1 SOL on mainnet and 0.05 SOL on devnet (G-4), and the launch tip of 0.001 SOL (G-6). Every Sender POST carries the Helius key and adds `swqos_only=true` only when asked. The key never reaches a log.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Per-net pace, ops floor and launch tip in feeConfig, readers moved | 5d7ee71 |
| 2 | Authenticated Sender URL with the swqos rule | 0a22a58 |

## Evidence

- fee-config.test.ts (new, unit): the mainnet and devnet value tables. Red was checked first.
- fee-send.test.ts: the new cases are:
  - the mainnet floor: 99,999,999 is low and 100,000,000 is not
  - every Sender POST URL starts with SENDER_URL and has `api-key=`
  - `swqos_only=true` appears only with `swqosOnly`
  - a Sender 400 whose message carries the key returns "unknown", with no key in `err`
  - devnet never calls post (existing test)
- `! rg OPS_FLOOR_LAMPORTS apps/worker/src`: passes. `rg "post\(SENDER_URL,"`: no match. fee-send.ts is 277 lines and build.ts is 147.
- `pnpm typecheck`, `pnpm lint`: clean. `vitest --project unit`: 83 files, 628 passed, 1 skipped.

## Deviations from Plan

1. **[Rule 3] admin-overview.ts was a third OPS_FLOOR_LAMPORTS reader, not in the plan.** It now reports `feeConfig(net).opsFloorLamports`, so the admin panel shows the mainnet floor on mainnet.
2. **noteOps takes the net as a second argument**, which is the plan's "thread the net" option. Six test files were updated mechanically.
3. **ensureTable takes `net` (core `Net`)**; prepare.ts passes `ctx.env.net`.
4. **[Docs] The worker src README fee-config line now names the floor and the tip.**

## Notes for later plans

- 07-09: pass `swqosOnly: feeConfig(net).launchTipLamports < 1_000_000` to urgentBroadcast for launches only.
- Unit tests that reach urgentBroadcast on mainnet need `process.env.helius_api_key` set (fee-send.test.ts sets a fake key in beforeAll and restores it).

## Threat Flags

None. T-07-05-01..04 are mitigated as planned.

## Self-Check: PASSED

- FOUND apps/worker/src/fee-config.test.ts
- FOUND commits 5d7ee71, 0a22a58
