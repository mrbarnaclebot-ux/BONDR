---
phase: 02-launch-flow
plan: 03
subsystem: launch-builder
tags: [pumpswap, fork, launch-builder, d-18]
requires: []
provides:
  - Venue-aware buildLaunch (BONDR curve or BONDR PumpSwap pool), returning venue
  - quoteVenue and the AwaitingMigration error for the 6107 window
  - launchQuote (wallet-free quote for the worker's tokensOut route)
  - minSolOut option on LaunchOpts (insta-sell floor, default 1)
  - poolBaseFor (pure pool quote) and poolBuy `fetched` state reuse in trade.ts
  - Fork stages migrated.awaiting and migrated.launch with evidence rows
  - packages/core/src/fixtures/pool-sell-launch.json for the 02-12 co-sign test
affects: [02-06, 02-11, 02-12]
tech-stack:
  added: []
  patterns:
    - "One price() per launch: venue, Q out, qMin and child amount; build and quote share it"
    - "Pool venue fetches pool state once; poolBuy reuses it through `fetched`"
    - "Sell exit pins the pool's buyback wallet, whose WSOL ATA the pool buy creates in the same tx"
key-files:
  created:
    - scripts/spike/stages/pool-launch.ts
    - packages/core/src/fixtures/pool-sell-launch.json
  modified:
    - packages/core/src/launch.ts
    - packages/core/src/trade.ts
    - packages/core/src/bond.ts
    - packages/core/src/README.md
    - scripts/spike/stages/launch.ts
    - scripts/spike/stages/README.md
    - scripts/spike/nets/fork.ts
    - scripts/spike/page.ts
    - scripts/spike/results/fork.json
    - scripts/spike/results/index.html
decisions:
  - "The pool venue prices Q with pump-swap-sdk buyQuoteInput against one fetched pool state, and poolBuy reuses that state (no second fetch)"
  - "The sell's pool hop pays its buyback slice to PumpSwap GlobalConfig.buybackFeeRecipients[0], not pump Global's, because the pool leg must use a wallet the pool lists"
  - "OnlinePumpSdk keeps its connection private; launch.ts reads it with one cast instead of threading a second Connection through every caller"
metrics:
  duration: ~25 min
  completed: 2026-10-19
  tasks: 2
  files: 12
---

# Phase 2 Plan 03: Pool-route launches after BONDR migrates (D-18) Summary

buildLaunch now resolves BONDR's venue from chain. It buys Q on the curve, or on the PumpSwap pool once Q has migrated (exact out, at most solIn spent), and the insta-sell routes child to Q on the curve, then Q to SOL on Q's venue. In the complete-but-unmigrated window it throws AwaitingMigration. Both pool-route exits landed on the Surfpool fork within 1232 bytes, and the curve-route launches still pass in the same run.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Venue-aware launch builder, launchQuote, minSolOut, AwaitingMigration | 917f927 |
| 2 | Fork stages migrated.awaiting and migrated.launch, fixture, evidence page | cb6ea6d |

## Fork evidence (2026-10-19, one fresh fork run, 57 ok / 0 failed)

| Row | Venue | Bytes | Max-field bytes | No-table bytes | CU / limit | devChildAfter |
|-----|-------|-------|-----------------|----------------|------------|---------------|
| launch.burn | curve | 780 | 789 | 1552 | 336238 / 600000 | 0 |
| launch.sell | curve | 881 | 890 | 1808 | 468275 / 600000 | 0 |
| migrated.launch.burn | pool | 921 | 930 | 1817 | 307931 / 600000 | 0 |
| migrated.launch.sell | pool | 954 | 963 | 1881 | 455646 / 600000 | 0 |
| migrated.launch.awaiting | n/a | n/a | n/a | n/a | n/a | error AwaitingMigration |

- Both migrated rows and both table rows carry signatures. On the burn rows the supply drops by exactly `amount`.
- The pool route costs 73 to 141 more bytes than the curve route with the per-coin table, and it leaves 269 bytes of headroom at maximum field lengths.
- `launchQuote(online, Q, 0.25 SOL, 150 bps)` on the migrated Q returned venue pool, qMin 611629754969 and amount 16783853052690 with `PublicKey.default` as the user. No wallet was needed.
- `SPIKE_NET=all pnpm spike:check`: 81 passed, 0 failed. The page shows PASS 74, FAIL 0, EXPECTED FAIL 5.
- `pnpm test` (27), `pnpm lint` and `pnpm typecheck` exit 0 after each commit. The fork was stopped with `pnpm spike:fork-down`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The pool quote moved into trade.ts to avoid an import cycle**
- **Found during:** Task 1
- **Issue:** bond.ts already had `poolBaseOut` (buyQuoteInput against poolState), but bond.ts imports COIN_DECIMALS from launch.ts, so if launch.ts imported bond.ts the two files would import each other.
- **Fix:** the pure part is now `poolBaseFor(state, quote)` in trade.ts, and bond.ts `poolBaseOut` calls it with the same signature and callers. `poolBuy` takes an optional `fetched` state so the launch reads the pool state once.
- **Files:** packages/core/src/trade.ts, packages/core/src/bond.ts
- **Commit:** 917f927

**2. [Rule 1 - Correctness] The pool sell hop pins the pool's buyback wallet**
- **Issue:** the existing exit passed pump Global's buyback wallet. A pool leg must pay a wallet that PumpSwap GlobalConfig lists, and the SDK default picks one at random, whose WSOL ATA may not exist.
- **Fix:** the pool venue passes `poolState`'s pinned buyback. The pool buy earlier in the same tx creates that wallet's WSOL ATA.
- **Commit:** 917f927

**3. [Rule 2 - Evidence for a must-have] migrated.launch.awaiting row**
- The plan's truth "buildLaunch refuses with an awaiting-migration error" had no row. `awaitingStage` runs between complete and migrated on the fork, the only window where Q is complete and unmigrated. It calls `quoteVenue` and records the error name, and its rule requires `AwaitingMigration`. It is read-only and sends nothing.
- **Commit:** cb6ea6d

**4. [Rule 3 - Acceptance check] page.ts joins facts sections with newlines**
- `rg -c 'migrated.launch' index.html` counts lines, and all facts sections were on one line, so it reported 1 even though the page had all 5 ids. The sections are now joined with "\n", and the count is 5.
- **Commit:** cb6ea6d

### Other notes

- `maxFieldBytes` is recorded on every launch row, curve rows included. The plan asked only for the pool rows, but launchOne is shared and the fact is cheap. Only the pool rule checks it. The devnet rule is unchanged, so old devnet rows still pass.
- The spike's own child URI is 96 characters (a pinata gateway URL), longer than the 80-character ipfs.io URI the product uses. That is why the max-field rebuild adds only 9 bytes.
- Curve-venue Q pricing now reads the buy state as `PublicKey.default` instead of the dev. The math does not use the user, which lets build and quote share one path.
- The `migrated.` prefix also namespaces the state keys (`migrated.C.burn`, `migrated.C.sell`), so the curve launch's `C.burn` and `C.sell` are not overwritten.

## Threat model

- T-02-03-01: `minSolOut` is on LaunchOpts and passed as the multi_hop `minAmountOut`, so the worker can set a floor from its prepare simulation (02-11). The spike keeps the default of 1.
- T-02-03-02: `quoteVenue` throws `AwaitingMigration`, and this is proven on the fork by `migrated.launch.awaiting`.

## Self-Check: PASSED

- Files present: packages/core/src/launch.ts, scripts/spike/stages/pool-launch.ts, packages/core/src/fixtures/pool-sell-launch.json (keys: addresses, dev, exit, message, mint, table).
- Commits 917f927 and cb6ea6d are on phase-02-launch-flow.
