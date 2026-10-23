---
phase: 03-indexer-lists-and-token-page
plan: 04
subsystem: indexer-storage
tags: [schema, migration, indexer, ingest, idempotent]
requires:
  - 03-02 parseTx, price math, Bondr { mint, pool, sol }
provides:
  - coins and trades tables (migration 0003_indexer, applied to the dev branch)
  - api.ts Venue, CoinLive, CoinRow, TradeRow, Candle, LiveEvent
  - worker ingest.ts (writeParsed, ingestTx, ingestLaunch, loadCoins, backfillLaunches, knownCoins)
  - worker bondr-price.ts (bondrPrice.get/set, bondr(), seedBondrPrice)
affects: [03-05, 03-06, 03-07, 03-14]
tech-stack:
  added: []
  patterns: [insert on conflict do nothing returning, patch only on inserted rows, int8 as decimal string customType]
key-files:
  created:
    - packages/core/migrations/0003_indexer.sql
    - packages/core/migrations/meta/0003_snapshot.json
    - apps/worker/src/ingest.ts
    - apps/worker/src/ingest.test.ts
    - apps/worker/src/bondr-price.ts
  modified:
    - packages/core/src/schema.ts
    - packages/core/src/api.ts
    - packages/core/src/db.test.ts
    - packages/core/migrations/meta/_journal.json
    - apps/worker/src/settle.ts
    - apps/worker/src/main.ts
    - apps/worker/src/status.ts
    - apps/worker/README.md
decisions:
  - "03-04: int8 amount columns use a customType with string data (drizzle 0.45 bigint has no string mode); trades.seq is bigint mode number"
  - "03-04: BONDR's identity (mint, pool) lives in bondr-price.ts, set synchronously by seedBondrPrice(ctx) before its first await; ingestTx/ingestLaunch read it through bondr() and throw if unseeded"
  - "03-04: a coin patch applies when its mint got a newly inserted trade, or when the tx has no trade of that mint at all (CreatePoolEvent migration), which only re-sets the same values"
  - "03-04: ingestLaunch(row, tx) and backfillLaunches(conn) take no ctx: the pool is canonicalPumpPoolPdaWithQuote(mint, BONDR mint) from bondr()"
metrics:
  duration: 12 min
  completed: 2026-10-23
  tasks: 3
  files: 13
---

# Phase 3 Plan 04: Coins and Trades Tables, Idempotent Ingest, Launch Backfill Summary

Every landed BONDR launch now gets a `coins` row and its Launch trade rows in Postgres. Settle writes them from the tx it has already fetched, and each boot backfills any launch still missing them. All writes go through `writeParsed`, which keys trades on `(signature, ix)` with `on conflict do nothing`, so a replay inserts nothing and changes no coin.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | coins and trades tables, contract types, migration 0003 applied | 51ede8a |
| 2 | Idempotent ingest and BONDR price in memory | 329d354 (RED), 03a191a (GREEN) |
| 3 | Settle hook, boot backfill, devnet proof | b1f85e4 |

## What was built

- **schema.ts:** the `coins` and `trades` tables, following RESEARCH Data Model as amended by D-22: no `supply` column; `progress` in 0..1, plus `bondr_at_bond` and `bond_sol`.
  - Checks: venue enum, `(venue = 'curve') = (bonded_at is null)`, `holders >= 0`, side enum, trade venue enum, `token_amount > 0`, and `(side = 'burn') = (sol is null)`.
  - Foreign keys run coins to vanity_mints and launches (launch_id is unique), and trades to coins.
  - Indexes: launched_at desc, mcap_sol desc, (mint, slot desc, seq desc), and at.
- **Migration 0003_indexer** was generated with `drizzle-kit generate --name indexer` and applied to the dev Neon branch with `pnpm db:migrate`. Staging was not touched; it migrates on the 03-14 deploy.
- **api.ts:** types only, `Venue`, `CoinLive`, `CoinRow`, `TradeRow`, `Candle` and `LiveEvent`.
- **bondr-price.ts:** BONDR's price lives in memory and is never stored.
  - `seedBondrPrice(ctx)` reads BONDR's curve, or the BONDR/SOL pool through `poolState` when `venueOf` reports `pool`. Errors are logged through redact.
  - `venueOf` is now exported from status.ts.
- **ingest.ts** (138 lines):
  - `writeParsed(exec, parsed, launch?)` runs in the caller's transaction.
  - `ingestTx(conn, sig)`, `ingestLaunch(row, tx)`, `loadCoins(exec)`, `backfillLaunches(conn)` (paced with `pace(100)`) and `knownCoins`.
  - Each unknown event name on a known coin is logged once per process through redact (Pitfall 10).
- **settle.ts** `landed()`: after the facts write, it passes the same tx to `ingestLaunch`. A failure there is logged and leaves the row landed.
- **main.ts** listening handler: `bootIndex` runs `seedBondrPrice`, `loadCoins(db())` and then `backfillLaunches`. Any failure is logged and the worker keeps running.
- **README:** documents the index tables, the ingest path and the boot backfill.

## Verification

- `pnpm db:migrate` applied cleanly (twice).
- `pnpm test`: 153 passed, 1 skipped (26 files). This includes:
  - db.test.ts with the new constraint cases (23514 for each check, 23503 for the FK, and a duplicate `(signature, ix)` inserting 0 rows).
  - ingest.test.ts: the launch writes 1 coin and 2 trades, then 0 on replay. A curve-buy patches mcap, progress, last_sig and last_trade_at, and a replay leaves a changed coin alone.
  - settle-flow.test.ts.
- `pnpm lint` and `pnpm typecheck` are clean.
- Gates:
  - `onConflictDoNothing` appears in ingest.ts.
  - No `setInterval` in ingest.ts or bondr-price.ts.
  - `ingestLaunch` is called from settle.ts.
  - `seedBondrPrice`, `loadCoins` and `backfillLaunches` are called from main.ts.

### Devnet proof (dev Neon branch)

Local worker run with `VANITY_THREADS=0 WORKER_PORT=8091`, counts taken with a one-off node and postgres query:

| | Before | After boot 1 | After boot 2 |
|---|---|---|---|
| landed launches | 6 | 6 | 6 |
| coins | 0 | 6 | 6 |
| Launch trade rows | 0 | 12 (2 per coin) | 12 |
| unindexed landed launches | 6 | 0 | 0 |

- Boot 1 logged `backfilled 6 launches`, and boot 2 logged `backfilled 0 launches`.
- The 4 burn coins have rows `buy,burn` and the 2 sell coins `buy,sell`.
- Launch mcap is about 0.07 to 0.08 SOL. Burn coins sit near 3.9% progress; sell coins are at 0.
- Both worker processes were stopped. Counts were unchanged after the full test suite, so the ingest test's transaction rolled back.

## Deviations from Plan

**1. [Rule 3 - Blocking] int8 columns as a string customType**
- **Found during:** Task 1.
- **Issue:** drizzle-orm 0.45 `bigint()` only has the `bigint` and `number` modes, and the parser's amounts are decimal strings.
- **Fix:** amount columns use a one-line `customType` with `dataType: "bigint"` and string data, which is what postgres-js returns for int8. This changes no SQL; `drizzle-kit generate` reports no diff. `trades.seq` is `bigint` in number mode, because identity needs the int builder.
- **Commit:** 51ede8a.

**2. [Rule 1 - Bug] Patches with no trade in the tx**
- **Issue:** the plan rule "patch only when that mint had inserted rows" would never apply a migration tx's `CreatePoolEvent` (venue pool), because that tx has no trade of the coin.
- **Fix:** such a patch is applied too. It only re-sets the same venue, so a replay is harmless.
- **Commit:** 03a191a.

**3. Signatures differ from the plan**
- **Change:** the plan's `ingestLaunch(conn, row, tx)` is `ingestLaunch(row, tx)`, and `backfillLaunches(ctx)` is `backfillLaunches(conn)`. BONDR's mint and pool come from `bondr()` in bondr-price.ts, which `seedBondrPrice` sets synchronously before resume can land anything.
- **Reason:** settle's `landed()` has no ctx, so ingestLaunch cannot take one.

**4. Task 1 was a single commit.**
- **Reason:** the constraint tests need migration 0003 on the database first, so the RED step could only fail on missing tables.
- **Result:** schema, migration and tests landed together.

## Notes for later plans

- `writeParsed` has no slot-order guard. A gap fill that writes an older trade after a newer one moves the coin back to the older state, until the next new trade (RESEARCH Pitfall 4). 03-05 or 03-07 should decide whether patches need a `slot >=` guard.
- `pace()` is process-wide and shared with sends, so the boot backfill can delay a send by about one pace interval. It only runs once per boot.
- Staging has no coins until 03-14 deploys migration 0003; the first staging boot then backfills its own landed launches.

## Known Stubs

None.

## TDD Gate Compliance

- Task 2 has a RED commit `test(03-04)` (329d354) followed by a GREEN commit `feat(03-04)` (03a191a).
- Task 1 has no separate RED commit (see deviation 4).

## Self-Check: PASSED

- All created and modified files exist.
- Commits 51ede8a, 329d354, 03a191a and b1f85e4 are in git log.
