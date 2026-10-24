---
phase: 03-indexer-lists-and-token-page
plan: 01
subsystem: indexer-wave-0
tags: [wave-0, devnet, fixtures, probe, websocket]
requires: []
provides:
  - wsUrl(net) in packages/core/src/net.ts
  - scripts/capture-tx.ts (fixture capture)
  - scripts/stream-probe.ts (A1/A2 probe)
  - scripts/devnet-trades.ts (devnet trade generator, A8 gate)
  - 11 tx fixtures for the 03-02 parser
affects: [03-02, 03-07]
tech-stack:
  added: []
  patterns: [Node 24 global WebSocket, raw getTransaction JSON fixtures]
key-files:
  created:
    - scripts/capture-tx.ts
    - scripts/stream-probe.ts
    - scripts/devnet-trades.ts
    - scripts/README.md
    - packages/core/src/fixtures/{launch-burn,launch-sell,curve-buy,curve-sell,multihop-buy,multihop-sell,bondr-buy}.json
    - packages/core/src/fixtures/{complete,create-pool,pool-buy,pool-sell}.json
  modified:
    - packages/core/src/net.ts
    - packages/core/src/net.test.ts
    - packages/core/src/README.md
decisions:
  - "03-01: A1 and A2 hold on devnet: Helius logsSubscribe mentions [BONDR] notified launches (BONDR loaded from the per-coin table), curve, multi-hop and BONDR-only trades; getSignaturesForAddress(mint) listed all of them. The 03-07 stream design stands"
  - "03-01: A8 fails on devnet: completing a child needs about 752M BONDR, more than BONDR's curve holds (723M), so it would complete BONDR and stop launches. Pool-trade and migration fixtures come from the Surfpool fork; devnet pool trades are fixture-only"
  - "03-01: devnet-trades --complete is a refuse-only gate (exit 2); the buy-out and pool trade path is not built because it cannot run on devnet"
metrics:
  duration: 12 min
  completed: 2026-10-23
  tasks: 3
  files: 18
---

# Phase 3 Plan 01: Indexer Wave 0 (probe, trade generator, fixtures) Summary

This plan adds `wsUrl`, a fixture capture script, a logsSubscribe probe and a devnet trade generator. The probe showed that A1 and A2 hold: every launch, curve trade and multi-hop trade appeared on the BONDR-mint stream and in `getSignaturesForAddress`. A8 fails on devnet, so the 4 pool and migration fixtures were captured from the Surfpool fork. With the 7 devnet fixtures that makes 11 new fixtures.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | wsUrl, capture-tx.ts, stream-probe.ts | 5a87943 |
| 2 | devnet-trades.ts, probe run, 7 devnet fixtures | 9a8d2a8 |
| 3 | A8 gate, 4 pool/migration fixtures from the fork | d9ed7a2 |

## Probe results (A1, A2)

The listener ran for 900 s on `logsSubscribe { mentions: [4Jw2pr67...] }`, confirmed. The launch coins were the burn coin F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr and the sell coin GoJKjYdyaGwNs82NrMM2xRJm19U5ZRLkx16Rbcjpbndr. Every notification had `err null` and a pump invoke.

| Kind | Signature | A1 (notified) | A2 (getSignaturesForAddress(mint)) |
|------|-----------|---------------|------------------------------------|
| launch burn (BONDR from table) | [38rFKbsN...VGt7](https://solscan.io/tx/38rFKbsN4C1nJb5sVS9USTbA3MXzsoNdXMpxnKgZGxYmWS8hHSpiAgjzMdSKoTX5u5f43efNpvCdpzyoWc1YGVt7?cluster=devnet) | PASS | PASS |
| launch sell (BONDR from table) | [2efBqPkF...r5tn](https://solscan.io/tx/2efBqPkFvWgH8tGiVep9u41ijSRyG3W2Cow6sngJuTjGtLRpWyFqaM7RgzSchUWUfcnD7FtWaUTDRGHKf8SCr5tn?cluster=devnet) | PASS | PASS |
| multi-hop buy 0.01 SOL | [46kqL9MR...f2d](https://solscan.io/tx/46kqL9MRHkGnnohmuE2vg5L67ShXSZ8k3yix22BgYkTGdRUnGzNA5ZrWWnZAQEedixdbJBbNDma3wvfWqQPk2f2d?cluster=devnet) | PASS | PASS |
| multi-hop sell | [2JV9VrkE...zbq](https://solscan.io/tx/2JV9VrkEaHC6dorjTpjHPZwEVJ4VkVHnjXvf1LJHFF5XxoopmRCU6hzh3cjsdDwTzoHe2DMihYZYfBwChnSKuzbq?cluster=devnet) | PASS | PASS |
| BONDR-only buy 0.005 SOL | [hosmBvyg...Lg8](https://solscan.io/tx/hosmBvygspHzzgzxWdCC9BzfqHqXxhA3HzjwHr59UBtt4aFtDv24hNE92iMWULvonbF5bPE223pLmoPPDSu5Lg8?cluster=devnet) | PASS | PASS (mint = BONDR) |
| child curve buy 1M BONDR | [3EJ8yLzS...bvQL](https://solscan.io/tx/3EJ8yLzSwQ4seCNm6qN31795ujKVfWvMi33KRQ95DZxztn8z73Syumm3Zg6yCnXTkyJwDzDUDb1pRWWTGF6obvQL?cluster=devnet) | PASS | PASS |
| child curve sell | [3RqeEFTQ...WSh](https://solscan.io/tx/3RqeEFTQu87rqS34g2ZxNFCcwAVqRdwwvQ9rkJFEAV4EL2aKeG4djVTJTRkcThYjh7HoBARxXDEsGrpXsjZmSWSh?cluster=devnet) | PASS | PASS |

The captured fixtures show what A1 covers. In both launch txs BONDR is in `meta.loadedAddresses`, so it came from the per-coin lookup table. In the trades it is a static key.

## A8 outcome

`devnet-trades --complete` on the fresh burn coin read the completion cost before any send. The coin needed 751,997,317,643,044 raw BONDR to complete, but BONDR's curve holds only 722,934,155,267,756. Buying the BONDR the curve does hold would cost more than 0.839 SOL. Ops held 2.786 SOL. The gate refused with `complete refused: cost >0.839427 SOL, budget 0.6` and exit 2. A devnet child cannot be completed without first completing BONDR, and a completed BONDR blocks every child create with 6107.

Fork path: `fork.sh up`, then `SPIKE_NET=fork pnpm spike` (57 ok, 0 failed). The four fixtures were captured with `--net fork` from child C2 (HJRK5jad...). The spike rewrote `scripts/spike/results/fork.json` and `fixtures/pool-sell-launch.json`; both were restored with a per-file checkout, and the fork was stopped.

| Fixture | Source row | Events |
|---------|-----------|--------|
| complete.json | bond.forced | TradeEvent, CompleteEvent, PostCompleteBuyEvent |
| create-pool.json | bond.migrate (migrate_v2) | CompletePumpAmmMigrationEvent, PumpSwap CreatePoolEvent |
| pool-buy.json | finalize.trade.1 (buy_v2) | PumpSwap BuyEvent |
| pool-sell.json | finalize.trade.2 (sell_v2) | PumpSwap SellEvent |

On the fork, the migration was called by the spike (ops signs migrate_v2). On devnet, pump's keeper calls it. Both use the same instruction. The A2 re-check for pool trades did not run, because it only runs on the devnet path.

## Ops balance

- Before: 2.841633 SOL (sim 0.037341).
- After: 2.786339 SOL (sim 0.054727).
- Ops spent 0.055 SOL: the launch run's own spend was 0.012, and a 0.043 top-up moved to the sim dev, which stays in the sim wallet.
- Every devnet-trades run exited 0 and stayed inside the 0.05 SOL budget; the largest net spend was 0.010.
- Ops is above the 2.4 floor.

## Deviations from Plan

**1. [Rule 1 - Bug] Test env restore** (Task 1, 5a87943): the old test assigned `undefined` back to `process.env`, which stores the string "undefined". Unset names are now deleted instead.

**2. [Scope] No mainnet refusal in wsUrl:** `Net` is `"devnet" | "fork"`, so the type system already rules mainnet out, and no runtime branch was added.

**3. [Scope] --complete is refuse-only:** the buy-out, migration wait and pool buy/sell path was not built, because it cannot run on devnet (see A8). A `ponytail:` comment in the script states this. If it ever passes the gate, it throws instead of sending.

**4. [Scope] --bondr is curve-only:** devnet BONDR is on its curve. The pool branch would be dead code, so the script throws if BONDR has left its curve.

**5. [Scope] No fork pool sell added to devnet-trades:** the spike's `finalize.trade.2` is already a PumpSwap sell_v2 of the child, so the plan's extra pool sell was not needed.

**6. [Rule 2 - AGENTS.md] scripts/README.md added:** `scripts/` now has more than five files.

**7. Probe listen ran for 900 s instead of the planned 600 s**, to leave margin. It does not change the result.

## Known Stubs

None.

## Self-Check: PASSED

- All 3 new scripts and all 11 fixtures exist.
- Commits 5a87943, 9a8d2a8 and d9ed7a2 are in git log.
- net.test.ts passes (5 tests), the core suite passes (61), and lint and typecheck are clean.
- No `api-key` string appears in any fixture.
