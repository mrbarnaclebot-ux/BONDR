---
phase: 04-trading
plan: 09
subsystem: trading
tags: [fork, surfpool, pumpswap, spike, evidence]
requires:
  - "04-02 quote-read.ts readConfigs, readMintState, hopInputs"
  - "04-01 quote.ts routeQuote"
  - "04-06 tokenDelta and lamportDelta in @bondr/core/trade"
provides:
  - "pureQuote, bondrHopBps and coinHopBps facts on every multihop leg"
  - "the 1-unit rule: pureQuote and outAmount may differ by at most 1 base unit"
  - "fork rows bonded.multihop.buy/sell (SOL -> Q curve -> C2 pool) and pooled.multihop.buy/sell (SOL -> Q pool -> C2 pool)"
affects: [04-10, 04-12, 04-13]
tech-stack:
  added: []
  patterns:
    - "Spike legs price the route with the worker's own read path (readConfigs, readMintState, hopInputs, routeQuote) before sending"
key-files:
  created: []
  modified:
    - scripts/spike/stages/multihop.ts
    - scripts/spike/nets/fork.ts
    - scripts/spike/stages/README.md
    - scripts/spike/results/fork.json
    - scripts/spike/results/index.html
    - packages/core/src/fixtures/pool-sell-launch.json
decisions:
  - "pureQuote is recorded on every multihop leg, including migrated. and future devnet legs; the rule only checks rows that carry it, so earlier devnet rows still pass"
  - "RESEARCH A1 closed: the route quote matches the program to the base unit on every venue mix (curve/pool, pool/curve, pool/pool); quote.ts needed no change"
  - "TRADE-04 left pending: the fork proves the PumpSwap path, but the UI signs no trade until 04-10"
metrics:
  duration: 9 min
  completed: 2026-10-24
---

# Phase 4 Plan 09: PumpSwap fork rows and the pureQuote rule Summary

The worker's route quote, computed from pre-trade state on a Surfpool mainnet fork, equals the landed amount to the base unit for buy and sell through SOL -> BONDR curve -> coin pool and SOL -> BONDR pool -> coin pool. Live fee rates (coin pool creator 150 bps, LP 20 bps) are proven against what the program charged.

## What was built

- `multihop.ts`: before each send, `pure()` reads `readConfigs` and `readMintState` for Q and the coin, builds both hops with `hopInputs`, and records `routeQuote(...).amountOut` as `pureQuote` (slippage 0) plus each hop's live bps. `legRule` keeps its checks and adds "pureQuote {p} differs from outAmount {o} by more than 1".
- `fork.ts`: `multihopStage("C2", "bonded.")` right after `finalizeStage`, `multihopStage("C2", "pooled.")` last.

## Fork rows (fresh fork run, 61 ok, 0 failed; spike:check passes)

| Row | Sig | Venues | Bytes | CU | amountIn | pureQuote | expectedOut | outAmount | Coin hop bps |
|-----|-----|--------|-------|----|----------|-----------|-------------|-----------|--------------|
| bonded.multihop.buy | xSQvdJQk... | curve,pool | 1110 | 151662 | 1000000000 | 3850690805197 | 3850690805197 | 3850690805197 | pool creator 150, lp 20 |
| bonded.multihop.sell | 4LNfWmMC... | pool,curve | 1100 | 137373 | 3850690805197 | 948706307 | 948706307 | 948706307 | pool creator 150, lp 20 |
| pooled.multihop.buy | 5VdcmQ7F... | pool,pool | 1132 | 130157 | 1000000000 | 3419379526785 | 3419379526785 | 3419379526785 | pool creator 150, lp 20 |
| pooled.multihop.sell | 22RkfJ3p... | pool,pool | 1100 | 116602 | 3419379526785 | 949160939 | 949160939 | 949160939 | pool creator 150, lp 20 |

BONDR hop: curve protocol 95 bps (bonded.), pool protocol 93 bps (pooled.). The coin hop carries protocol 0 because pump charges protocol once per route (legs mask). Full signatures are in `scripts/spike/results/fork.json`. The migrated. rows (pool -> curve) also gained pureQuote and match exactly.

## Deviations from Plan

- The first fork run aborted at `migrated.launch` on a transient Surfpool upstream fetch error ("Failed to fetch accounts from remote"); bonded. rows had already passed. A plain rerun passed every stage. No code change.
- `results/index.html` and `packages/core/src/fixtures/pool-sell-launch.json` regenerate on every fork run and were committed with fork.json so evidence stays in sync (cosign.test.ts passes on the new fixture).

## Notes for later plans

- migrated.multihop.sell reads the BONDR pool protocol fee at 5 bps while the buy reads 93 bps; the landed amount still matches the quote exactly, so it is pump's live tiering, but the Fees panel will show that swing.
- TRADE-04 stays pending for 04-10 (real sign and submit) and 04-12/04-13.

## Self-Check: PASSED

- scripts/spike/stages/multihop.ts, scripts/spike/nets/fork.ts, scripts/spike/results/fork.json exist
- commits 97a9822 and dcc61f1 exist
