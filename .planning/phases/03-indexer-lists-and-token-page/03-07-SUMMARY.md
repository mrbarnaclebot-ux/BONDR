---
phase: 03-indexer-lists-and-token-page
plan: 07
subsystem: indexer-live
tags: [indexer, websocket, gap-fill, holders, helius]
requires:
  - 03-01 wsUrl, devnet-trades.ts, A1/A2 hold
  - 03-04 writeParsed, ingestTx, ingestLaunch, knownCoins, coins.last_sig
provides:
  - worker stream.ts (startStream, isPumpInvoke, shouldIngest, backoff)
  - worker holders.ts (countHolders, schedule, touch)
  - ingest.ts gapFill, gapFillAll, ingestLaunch(conn, row, tx) with gap fill
  - coins.last_slot (migration 0004) and the out-of-order guard in writeParsed
  - devnet-trades --expect-indexed
affects: [03-08, 03-14]
tech-stack:
  added: []
  patterns: [Node 24 global WebSocket, de-duplicated serial queue, trade-armed per-coin timer, slot guard on coin state]
key-files:
  created:
    - apps/worker/src/stream.ts
    - apps/worker/src/stream.test.ts
    - apps/worker/src/holders.ts
    - apps/worker/src/holders.test.ts
    - packages/core/migrations/0004_coin_last_slot.sql
    - packages/core/migrations/meta/0004_snapshot.json
  modified:
    - apps/worker/src/ingest.ts
    - apps/worker/src/ingest.test.ts
    - apps/worker/src/settle.ts
    - apps/worker/src/main.ts
    - apps/worker/README.md
    - packages/core/src/schema.ts
    - packages/core/migrations/meta/_journal.json
    - scripts/devnet-trades.ts
    - scripts/README.md
decisions:
  - "03-07: coin state (reserves, mcap, progress, last_sig, last_trade_at) applies only when the trade's slot >= coins.last_slot; same-slot txs have no known order, so the later write wins (ix is a per-tx event index and does not order txs)"
  - "03-07: venue only advances: complete applies where venue = curve, pool where venue is curve or complete; the coins_bonded check still refuses pool before complete"
  - "03-07: ingestLaunch takes conn again (ingestLaunch(conn, row, tx)) so it can gap fill the new coin"
  - "03-07: touch(conn, coin) takes the KnownCoin (curve and pool to exclude) instead of a bare mint; no import cycle with ingest.ts"
  - "03-07: the holder recount's last time lives in memory; the first trade of a coin after a restart recounts at once"
metrics:
  duration: 16 min
  completed: 2026-10-23
  tasks: 3
  files: 15
---

# Phase 3 Plan 07: Live Ingestion, Gap Fill and Holder Recount Summary

The worker now follows every BONDR trade live through one websocket log subscription on the BONDR mint. It fills gaps on every (re)connect and for each new coin, and recounts holders at most once per coin every 5 minutes, only for coins that traded. Gap fill makes out-of-order writes real, so coin state now moves only forward in slots.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| extra | Out-of-order guard (orchestrator requirement) | 62c80ab |
| 1 | Websocket stream, prefilter, reconnect and gap fill | 6dbe770 (RED), 43960eb (GREEN) |
| 2 | Throttled holder recount (D-19) | 8a56080 (RED), 404d061 (GREEN) |
| 3 | Stream at boot, README, devnet-trades --expect-indexed, devnet proof | afd09cb |

## What was built

- **Out-of-order guard.**
  - Added `coins.last_slot` with migration `0004_coin_last_slot` (`drizzle-kit generate`), applied to the dev branch with `pnpm db:migrate`.
  - In `writeParsed`, `applyPatch` updates curve state plus `last_sig`, `last_trade_at` and `last_slot` only `where last_slot is null or last_slot <= slot`.
  - Bond facts (venue, bond_sig, bonded_at) are a separate update that only advances the venue.
- **stream.ts (106 lines).**
  - `startStream(ctx, net)` opens `new WebSocket(wsUrl(net))`. On open it sends one `logsSubscribe { mentions: [Q] }` at confirmed, starts a 30 s ping, then runs the gap fill.
  - The gap fill is serialized: an open during a running fill queues one more pass.
  - Notifications that pass `shouldIngest` (no err, and a pump or PumpSwap invoke or "Log truncated") go into a de-duplicated Set that is drained one at a time by `ingestTx`.
  - `onclose` clears its timers and reconnects after `backoff(attempt)`: 1 s doubling to 30 s, with 20 percent jitter. Sixty seconds of healthy connection resets the attempt count.
  - Every log line goes through `redact`.
- **ingest.ts.**
  - `gapFill(conn, mint, until, ingest)` pages `getSignaturesForAddress` (limit 1000, `before`), skips err entries and ingests oldest first, paced at 100 ms.
  - `gapFillAll` makes one `coins` read per websocket open and fills each known coin from its `last_sig`. A failure on one coin is logged, and the fill moves on.
  - `ingestLaunch(conn, row, tx)` gap fills the new coin after registering it (Pitfall 3).
  - `arm()` calls `touch` for each coin that got a new trade, after the commit.
  - The header carries the ponytail no-rollback note (Pitfall 5).
- **holders.ts.**
  - `countHolders` is pure: it counts unique owners with a positive balance, excluding the curve, the pool and the incinerator.
  - `schedule` and `touch` keep one pending timeout per coin.
  - A recount uses `getProgramAccounts(TOKEN_2022, memcmp mint, dataSlice 32..72)` and writes `holders` and `holders_at`.
  - The recount time is recorded at the attempt, so a failure waits for the next trade.
  - A ponytail note covers the getProgramAccountsV2 switch at 80 percent of credits.
- **main.ts** calls `startStream(ctx, env.net)` after `backfillLaunches`.
- **README:** the worker README gains an Indexer section, and the scripts README documents the new flag.
- **devnet-trades `--expect-indexed S`:** records each landed signature with its land time, then polls `trades` by signature through the raw client. It exits 1 if a signature is missing after S seconds.

## Verification

- `pnpm test`: 167 passed, 1 skipped (29 files).
  - `stream.test.ts` (4 tests): prefilter, err skip, backoff bounds, and gap fill paging across 1002 signatures with an err entry.
  - `holders.test.ts` (3 tests): count, schedule, and a single timer under three touches.
  - `ingest.test.ts` now has 2 DB tests. The new one fails before the guard and passes after: an older curve-buy written after the newer curve-sell inserts 1 row, while mcap, reserves, last_sig and last_slot stay at the sell.
- `pnpm lint` and `pnpm typecheck` are clean.
- Acceptance gates:
  - No `from "ws"` in apps/worker.
  - `logsSubscribe` appears once in stream.ts.
  - The incinerator id is in holders.ts, and there is no `setInterval` there.
  - `startStream` is called in main.ts.

### Devnet proof (local worker, dev Neon branch, VANITY_THREADS=0, coin F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr)

| Step | Signature | Result |
|------|-----------|--------|
| Boot 1 gap fill | the four 03-01 trades (46kqL9MR, 2JV9VrkE, 3EJ8yLzS, 3RqeEFTQ) | "gap fill: 4 txs"; last_slot 514267902 |
| Live buy 0.01 | 65Pv5CgYCHtsM8asaEvM9bik7mJ7syHHejFxBvZcqHzAwjZHXPc92e8AoD3vJ5WGgKLVySJTVm8AcU5FcKPWGRHb | indexed 5.8 s after landing |
| Live sell | 23qXmAiLGHjeJzsxHEtKAXYuhhZepFhNMWLc65ZhuQaZN16WBDxTDN392nrKQVLuwvGyMHvtKprSGa53nh36e2zX | indexed 4.9 s after landing |
| Buy with the worker stopped | 2op7R6632FP4R5CrSwg1SVKWDrh9wxGnnMGorg4YtTsocNBPkLH7De4Ry5MF3pHuodxdyTcuuvZNLmPs4SoH5syw | not in trades while down; boot 2 logged "gap fill: 1 txs", row present (at 14:50:47), last_sig and last_slot 514282128 moved to it |
| Live buy 0.01 (throttle) | 56eqwDuRgRXTGss9k8YHaXwqYZbjNaanXqQz4sF1fGFeRGuwvN4UNuXs3BqX6mtJWGbqpFdtPEFpQtLK4fmYu4h2 | indexed 4.6 s after landing; holders_at unchanged 5 s later |

Holder counts:

- **Boot 1:** the gap-filled trades armed an immediate recount, giving `holders = 0` at 14:49:11. The dev burned its tokens and the sim had sold everything.
- **Boot 2:** the gap-filled buy recounted at once (after a restart the in-memory throttle is empty), giving `holders = 1` with `holders_at` 14:51:14.156.
- **Throttled recount:** after the 14:52 live buy, the next recount fired at 14:56:14.752 with `holders = 1`, exactly 5 min after the previous count. The trade armed a single timer and nothing ran in between.

All runs stayed inside the 0.05 SOL per-run budget. Ops held at 2.786339 SOL. The sim spent about 0.020 SOL net across 4 trades, and the sim's coin balance stays on devnet. Both worker processes were stopped.

## Deviations from Plan

**1. [Orchestrator requirement] Slot guard instead of (slot, ix).**
- **Why:** `ix` is an event index inside one tx, so it cannot order two txs in the same slot, and `getTransaction` gives no position in the block (Pitfall 4).
- **Result:** the guard compares slots only. A same-slot tie applies in arrival order. Bond facts were split out so that an older complete or pool tx still advances the venue.
- **Commit:** 62c80ab.

**2. [Rule 3] `ingestLaunch(conn, row, tx)`.**
- **Why:** gap fill on registration needs a connection.
- **Result:** settle.ts and backfillLaunches pass it. This is the plan's original signature.

**3. `touch(conn, coin)` and `schedule(countedAt, now)`.**
- **Why:** the plan has `touch(mint)` and `schedule(mint, holdersAt, now)`. The recount needs a connection and the coin's curve and pool to exclude, and the mint argument to `schedule` was unused.

**4. devnet-trades polls through `db().$client` (raw SQL).**
- **Why:** the root package does not depend on drizzle-orm, so `eq` cannot be imported from `scripts/`.

**5. The orchestrator-requested guard landed as one commit (test and fix together).**
- **Why:** the test needs the `last_slot` column in the schema to typecheck.
- **RED evidence:** the test was run against the dev branch before the guard was written. It failed with last_sig 3EJ8yLzS (the older trade) and last_slot null.

## Notes for later plans

- **03-14:** staging needs migrations 0003 and 0004 on deploy. The first staging boot gap fills every coin from its launch signature.
- **03-08:** publish `trade` events from `arm()` in ingest.ts, the one post-commit point for new trades. Publish `holders` events at the end of `recount()` in holders.ts.
- **Wasted calls on boot:** a backfilled launch is gap filled twice on that boot, once by `ingestLaunch` and once by the stream's first `gapFillAll`. Both are idempotent; this only happens for launches that are missing a coin row.

## Known Stubs

None.

## TDD Gate Compliance

- Task 1: `test(03-07)` 6dbe770, then `feat(03-07)` 43960eb.
- Task 2: `test(03-07)` 8a56080, then `feat(03-07)` 404d061.
- Guard: single `fix` commit (see deviation 5).

## Self-Check: PASSED

- stream.ts, stream.test.ts, holders.ts, holders.test.ts and migration 0004 exist.
- Commits 62c80ab, 6dbe770, 43960eb, 8a56080, 404d061 and afd09cb are in git log.
- The worker logs contain no `api-key=`, and no worker process is left running.
