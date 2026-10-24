---
phase: 04-trading
plan: 02
subsystem: trading
tags: [quote, worker, cache, chain-read, tdd]
requires:
  - "04-01 quote.ts routeQuote, curveRates, HopInput; api.ts TradeQuote, TradeBalance"
provides:
  - "core quote-read.ts: Configs, MintState, readConfigs, readMintState, hopInputs (the one HopInput builder)"
  - "worker trade-state.ts: mintState (2 s single flight per mint), configs (60 s)"
  - "worker trade-quote.ts: parseTrade, quoteTrade, maxSolIn, tradeBalance"
  - "worker routes POST /trade/quote and POST /trade/balance"
  - "prepare.ts walletOf exported"
affects: [04-03, 04-04, 04-05, 04-09]
tech-stack:
  added: []
  patterns: ["keyed single-flight cache with failure eviction (status.ts live, generalised)", "MintState discriminated union on venue"]
key-files:
  created:
    - packages/core/src/quote-read.ts
    - apps/worker/src/trade-state.ts
    - apps/worker/src/trade-state.test.ts
    - apps/worker/src/trade-quote.ts
    - apps/worker/src/trade-quote.test.ts
    - apps/worker/src/README.md
  modified:
    - packages/core/src/pump.ts
    - packages/core/src/README.md
    - apps/worker/src/prepare.ts
    - apps/worker/src/main.ts
decisions:
  - "MintState is a union on venue carrying mint, supply and tokenPrograms; awaiting throws the existing launch.ts AwaitingMigration from hopInputs, and quoteTrade maps an awaiting hop to 409 paused before building"
  - "readMintState refuses a pool whose stored vaults are not its derived ATAs, so a vault mismatch fails the read (not cached) instead of mispricing"
  - "maxSolIn caps only net devnet; fork and mainnet are uncapped (fork mirrors mainnet)"
  - "networkMax is 505000 lamports: one 5000 signature plus the D-08 500000 priority cap"
metrics:
  duration: 10 min
  completed: 2026-10-24
  tasks: 2
  files: 10
---

# Phase 4 Plan 02: Worker quote state and trade quote routes Summary

The worker now answers `POST /trade/quote` with an exact masked route quote built from one cached chain read per mint per 2 s (configs per 60 s) through the single `hopInputs` builder. It also answers `POST /trade/balance` with SOL and coin balance from one read. Every input is re-parsed at the worker.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Chain reader, hopInputs and the per-mint quote cache | 12c117f (RED), 198151e (GREEN) | quote-read.ts, pump.ts, core README, trade-state.ts, trade-state.test.ts |
| 2 | Worker quote and balance handlers | 7f2f8eb (RED), ef9543c (GREEN) | trade-quote.ts, trade-quote.test.ts, prepare.ts, main.ts, worker README |

## Verification

- `pnpm vitest run apps/worker/src/trade-state.test.ts apps/worker/src/trade-quote.test.ts`: 19 passed
- `pnpm test`: 37 files, 238 passed, 1 skipped
- `pnpm typecheck`, `pnpm lint`: pass
- Acceptance greps: `getMultipleAccountsInfo` count 2 in quote-read.ts, one `export function hopInputs`, a ponytail line in trade-state.ts, both `hopInputs(` calls in trade-quote.ts, both route keys in main.ts, README has trade-quote.ts and trade-state.ts
- Live devnet read (a throwaway script, deleted, nothing sent): readConfigs and readMintState decode the real accounts. BONDR and child F9DVpq...bndr both read as curve, the AMM FeeConfig is set, a 0.01 SOL buy and its sell back both quote, and `maxSolIn` reads 728,203,042 lamports (0.809 SOL cost to complete less 10%, matching RESEARCH Pitfall 4)

## Deviations from Plan

1. **[Rule 2 - Correctness] Pool vault check.** readMintState reads the pool's derived ATAs in the same call. It then throws if the decoded pool names other vaults, so a wrong vault can never price a quote. A failed read is evicted from the cache.
2. **MintState carries `mint` and `tokenPrograms`** on top of the planned fields. `hopInputs` needs the programs, and `AwaitingMigration` takes the mint.
3. **pump.ts also exports** `PUMP_FEE_CONFIG_PDA`, `normalizeQuoteMint`, `GLOBAL_CONFIG_PDA`, `PUMP_AMM_FEE_CONFIG_PDA` and the pump `FeeConfig` type. The curve venue rule compares the normalized quote mint, as the SDK resolver does, so a legacy default quote mint still counts as SOL.
4. **quoteTrade and tradeBalance take narrow contexts.** quoteTrade takes `{ conn, Q, net }` and tradeBalance takes `{ conn }`, not the full `Ctx`, so the tests need no online SDK. main.ts passes `{ ...ctx, net: env.net }`.

## TDD Gate Compliance

Task 1: RED `test(04-02)` 12c117f (module missing), then GREEN `feat(04-02)` 198151e. Task 2: RED 7f2f8eb (module missing), then GREEN ef9543c. No refactor commits.

## Known Stubs

None.

## Threat Flags

None. Both routes sit behind the existing bearer check. The /trade/balance wallet trust (T2) depends on 04-05 sending only the session wallet.

## Self-Check: PASSED
