---
phase: 03-indexer-lists-and-token-page
plan: 02
subsystem: indexer-parser
tags: [tdd, decoder, parser, market-cap, pure]
requires:
  - 03-01 fixtures (devnet curve, multi-hop, launch; fork completion, migration, pool)
provides:
  - innerEvents with program ("pump" | "amm") and running ix, PumpSwap and migration decoders
  - price.ts (SUPPLY, curvePrice, poolPrice, toSol, mcapSol, progress, bondrAtBond)
  - trades.ts parseTx(tx, coins, bondr, launch?) and its types
affects: [03-04, 03-07]
tech-stack:
  added: []
  patterns: [events keyed by program plus discriminator, nearest same-tx BONDR price, patches merged per mint]
key-files:
  created:
    - packages/core/src/price.ts
    - packages/core/src/price.test.ts
    - packages/core/src/trades.ts
    - packages/core/src/trades.test.ts
  modified:
    - packages/core/src/events.ts
    - packages/core/src/events.test.ts
    - packages/core/src/pump.ts
    - packages/core/src/README.md
decisions:
  - "03-02: parseTx's third argument is Bondr { mint, pool, sol } instead of bondrSol: a SOL-quoted TradeEvent or pool event cannot be told apart from another pump coin's without BONDR's mint and pool. 03-04 passes { mint: Q, pool: canonicalPumpPoolPdaWithQuote(Q, NATIVE_MINT), sol: bondrPrice.get() }"
  - "03-02: each child row is valued at the nearest BONDR event in the same tx (tie goes to the earlier one), else the passed price; result.bondr is the last BONDR event's price"
  - "03-02: pool trades and the PostCompleteBuyEvent patch only mcapSol; curve reserve columns stay curve state"
  - "03-02: NewCoin launchMcapSol, mcapSol and bondSol are number | null (null only when no BONDR price exists); bondSol is SOL as a number, like mcapSol"
metrics:
  duration: 8 min
  completed: 2026-10-23
  tasks: 3
  files: 8
---

# Phase 3 Plan 02: Event Decoding, Price Math and parseTx Summary

This plan adds a pure, fixture-tested parser: `parseTx` turns one fetched transaction into trade rows and coin patches. In launch mode it also returns the new coin. Every value is a SOL equivalent at a fixed 1B supply (D-01, D-22). `innerEvents` now decodes PumpSwap and migration events, and each event carries its program and an index.

## Tasks

| Task | Name | RED | GREEN |
|------|------|-----|-------|
| 1 | PumpSwap and migration event decoding | ba8b7c7 | e1b0507 |
| 2 | price.ts (D-01, D-22) | 2cf4ea5 | 2fe9448 |
| 3 | parseTx | db3f48f | 063d077 |

## What was built

- **events.ts:** the `PROGRAMS` list covers pump and PumpSwap, and the name map is keyed by `program:discriminator`. Account 0 must be that program's own event authority. `PostCompleteBuyEvent`, `BuyEvent`, `SellEvent` and `CreatePoolEvent` now decode through the pinned SDK. If the SDK throws on an event, the event is named `invalid:<name>` and parsing continues (T-03-02-03).
- **price.ts:** SDK-free, with bigint inputs. `bondrAtBond` on the forced-bond fixture's pre-completion reserves comes out 1 base unit below the curve's real quote at completion.
- **trades.ts** (292 lines):
  - Curve trades, multi-hop, PumpSwap buy and sell, the completing buy, the `PostCompleteBuyEvent` fill (venue pool), `CompleteEvent` (venue complete with bondSig and bondedAt) and `CreatePoolEvent` (venue pool).
  - Launch mode marks every launch-mint row `launch: true`, adds the synthetic burn row at ix 1000, and returns `created`, with `launchMcapSol` taken from the CreateEvent's initial reserves.
  - Pool prices come from `postTokenBalances` where owner = pool, plus the event's virtual quote reserves. Patches are merged into one per mint.
  - `unknown` lists the event names that were not used, and only for a tx that touched a known coin. For create-pool these are `InitBoostEvent` and `CompletePumpAmmMigrationEvent`.

## Verification

- `pnpm vitest run packages/core/src`: 87 passed (events 11, price 7, trades 12, plus the existing suite).
- `pnpm lint` and `pnpm typecheck` are clean.
- A throwaway compile check confirmed that `fetchTx`'s return type (web3.js `VersionedTransactionResponse`) can be assigned to `TradeTx`. The check file was removed.
- Acceptance greps:
  - "Program data" appears only in the events.ts header comment.
  - `PUMP_AMM_EVENT_AUTHORITY_PDA` appears in both events.ts and pump.ts.
  - price.ts has no SDK or `@solana` import, and it contains `1_000_000_000_000_000n`.
  - trades.ts never uses `solAmount`.

## Deviations from Plan

**1. [Rule 3 - Blocking] `parseTx` takes `bondr: { mint, pool, sol }` instead of `bondrSol: number | null`**
- **Found during:** Task 3.
- **Issue:** In the fixtures, a BONDR TradeEvent is just a SOL-quoted TradeEvent. A tx that only buys BONDR (bondr-buy) has no child event to infer BONDR's mint from. A BONDR/SOL pool event names only its pool. Without BONDR's mint and pool, the "bondr-buy sets bondr" behavior and the pool-price precedence cannot be met. Each net also has a different BONDR mint (4Jw2 on devnet, 8rYq and 45QP on the fork).
- **Fix:** `Bondr = { mint, pool, sol }`, with the same position and meaning for `sol`. 03-04's calls change from `parseTx(tx, map, bondrPrice.get())` to `parseTx(tx, map, { mint: Q, pool, sol: bondrPrice.get() })`, and from `parseTx(fixture, map, null, launch)` to `{ ..., sol: null }`.
- **Commit:** 063d077.

**2. [Scope] Pool and post-complete patches carry only `mcapSol`.** The coin's reserve columns hold curve state, and pool reserves serve no display. Curve trades patch the full set.

**3. [Rule 2] Decode failures become `invalid:<name>` and are never thrown.** The threat model requires this, and the old events.ts did not have it.

**4. The pool-reserve check on the pool fixture comes from postTokenBalances (RESEARCH Open Question 3).** The BuyEvent's own pool reserves are pre-trade: its pool base reserves equal the post-trade balance plus baseAmountOut. Reading balances avoids that ambiguity.

## Notes for later plans

- The `PostCompleteBuyEvent` row's mcap uses `poolQuoteReservesAfter / poolBaseReservesAfter` with no virtual quote reserves, because the event has none. The next pool trade's mcap adds them, so the chart can step once at migration.

## Known Stubs

None.

## TDD Gate Compliance

Each of the three tasks has a `test(...)` RED commit followed by a `feat(...)` GREEN commit. No refactor commits were needed.

## Self-Check: PASSED

- All 4 created files and 4 modified files exist.
- Commits ba8b7c7, e1b0507, 2cf4ea5, 2fe9448, db3f48f and 063d077 are in git log.
