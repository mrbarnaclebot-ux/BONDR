---
phase: 03-indexer-lists-and-token-page
fixed_at: 2026-10-24T11:50:00Z
review_path: .planning/phases/03-indexer-lists-and-token-page/03-REVIEW.md
iteration: 1
scope: server half, S-CR-* and S-WR-* plus one- and two-line S-IN-*
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report (server half)

All three blockers and all eight warnings are fixed. Four Info items were small enough to fix too. Each blocker has a Vitest test that fails without its fix.

## Critical

### S-CR-01: Trades lost when an ingest fails, a fetch misses, or a deferred fill starts late
**Commit:** 853defb. **Status:** fixed, but a human should check the logic.
- `ingestTx` now throws when `fetchTx` gives up. A miss counts as a failure.
- `ingestOrKeep` stores each failed signature in memory, up to 20 tries. `retryFailed` runs them again at the start of each drain and each fill.
- `gapFill` keeps a failed signature for retry and carries on. Before, the failure stopped the fill.
- `lastSigs()` reads each coin's last_sig before `logsSubscribe` is sent. The fill starts from that snapshot. A reconnect during a running fill queues its snapshot. If a coin appears in two queued snapshots, the older mark wins.
- Test: `stream.test.ts`, "a failed ingest does not stop the fill".
- `ponytail:` the retry set lives in memory. A worker restart while a signature is waiting loses it. The upgrade path is a `filled_sig` column that only a finished fill moves. It needs a migration, so I left it for later.

### S-CR-02: A CreatePoolEvent from any pool moved the coin's venue
**Commit:** bb1905d. **Status:** fixed.
- `handle()` now accepts a `CreatePoolEvent` only when `e.data.pool` is the coin's canonical pool.
- A pool patch now carries its own `bondedAt`. `applyPatch` writes `coalesce(bonded_at, value)`. If the CompleteEvent was missed, the migration no longer fails `coins_bonded`. If the CompleteEvent was seen, its time is kept.
- Tests: `trades.test.ts`, "a pool other than the coin's canonical one moves nothing". `ingest.test.ts` (Neon dev branch, rolled back): complete followed by pool keeps the complete time.

### S-CR-03: Gap fills moved the in-memory BONDR price back in time
**Commit:** d571a84. **Status:** fixed.
- `bondrPrice.set(n, slot)` ignores a slot older than the one it holds.
- The seed reads `getSlot` before it reads the price, so a newer live price still wins.
- Test: `ingest.test.ts`, "moves only forward in slots".

## Warnings

### S-WR-01: A refused subscription or a half-open socket stopped the stream silently
**Commit:** f61f93b. **Status:** fixed.
- `onMessage` returns false when the reply to id 1 has no numeric result. The socket then reconnects.
- A watchdog drops the link after two ping intervals with no message. `drop()` runs once per socket and does not wait for `close`.
- I changed the keepalive from `ping` to `getHealth`. I probed Helius devnet on 2026-10-24: it never answers a JSON-RPC `ping`, but it does answer `getHealth`. With `ping`, the watchdog would have reconnected every quiet socket each minute, and each reconnect reads Neon.
- Cost: about 86k `getHealth` calls a month, noted in a `ponytail:` comment (D-05).
- `startStream` is split into `drop` and `subscribe`, so it stays under 40 lines.
- Test: `stream.test.ts`, onMessage refused or accepted.

### S-WR-02: An index boot failure was terminal
**Commit:** 87b5c9f. **Status:** fixed.
- `bootIndex` retries with the stream's capped backoff. Every step is idempotent.
- I chose retry over `process.exit(1)` on purpose. Railway's default restart policy gives up after its retries run out, and that would also stop launches.
- `seedBondrPrice` now throws on a failed read, so a missing seed fails the boot and gets retried.

### S-WR-03: parseTx emitted rows the schema rejects
**Commit:** 21dcadf. **Status:** fixed.
- `parseTx` drops trade rows with 0 tokens.
- `parse()` throws `no BONDR price for <sig>` before writing a buy or sell with no price. S-CR-01's retry then picks it up.
- No new test: both changes are one-line guards, and no fixture has a 0-token event.

### S-WR-04: The holder recount wrote to Neon up to 5 min after the last trade
**Commit:** 6d4a4f2. **Status:** fixed.
- The recount now happens on the trade itself, when the last recount is 5 min old or more. Otherwise nothing happens: no timer, no deferred write. `schedule` is replaced by `due`.
- This keeps D-19's intent: only coins that trade are recounted, at most once every 5 min per coin.
- Trade-off: a trade inside the window shows up in the holder count at the coin's next due trade. If the coin goes quiet, the count stays one window behind.
- Test: `holders.test.ts`, touch recounts at once, arms no timer, and recounts again only after 5 min.

### S-WR-05: A resync made every open token page do uncached Neon reads
**Commit:** 507155c. **Status:** fixed.
- `lib/trades.ts` has one 10 s `kept` cache, the same shape as the one in `lib/coins.ts`.
- `candles`, `bondTime` and the new `resyncPage(mint)` (first page plus the coin row) all go through it. The trades route uses `resyncPage`.

### S-WR-06: The live hub had no upstream watchdog
**Commit:** cee6698. **Status:** fixed.
- `upstream()` passes an `AbortSignal` to `openWorker`. The connection is aborted after 45 s with no line (the timer resets with `refresh()`). The loop then reconnects, and the first ping resyncs clients if anything was missed.
- Test: `live-hub.test.ts`, "an upstream silent for the stall time is aborted and reopened".

### S-WR-07: Gap-filled historical trades were published as live trade events
**Commit:** e275bf8. **Status:** fixed.
- `ingestTx(conn, sig, live = true)`. The gap fill and the retries pass `false`.
- A write that is not live publishes nothing and calls `skipId()`. The skipped id is a gap, so each web hub resyncs its clients at the next ping (15 s). It also saves the `coinRow` read.
- Test: `events-route.test.ts`, "a skipped id leaves a gap".

### S-WR-08: createHub was 65 lines
**Commit:** 95da9f5. **Status:** fixed. `fan`, `sync`, `take` and `run` are now module-level functions over `{ ring, subs }`. Every function is under 40 lines.

## Info

| Id | Status |
|----|--------|
| S-IN-05 | Fixed, 203044a. A rejected font or hero read is cleared, so the next card retries it. |
| S-IN-07 | Fixed in part, facc6f6. A launch with no CreateEvent is now logged. Skipped: the 1970 timestamp fallback, because it needs a throw in pure core and its own test. |
| S-IN-02 | Fixed, facc6f6. A `ponytail:` comment on `gapFillAll` names the per-coin, per-reconnect credit ceiling. |
| S-IN-10 | Fixed, facc6f6. A `ponytail:` comment on `priceAt` marks that a gap-filled tx with no BONDR leg gets today's price. |
| S-IN-01 | Skipped. S-CR-01's retry covers failures but not the same-slot `until` edge. `filled_sig` would fix it, and that needs a migration. |
| S-IN-03, S-IN-04, S-IN-06, S-IN-08 | Skipped. None is a one- or two-line change. IN-06 also touches `lib/coins.ts`, which is the client fixer's file. |
| S-IN-09 | Skipped. It changes the bond event shape and needs a client change (see below). |

## Notes for the orchestrator (client side)

- **WR-07:** after a gap fill, open pages get a `resync` instead of old trade events. The trade feed's resync merge (C-WR-03) must sort by `(slot, seq)` so the refetched page lands in order.
- **WR-05:** the token page's resync answer can be up to 10 s old. The client merge should keep live rows that are newer than the snapshot (C-WR-01, C-WR-02).
- **IN-09 / C-WR-05:** the bond event still carries only the final venue. If the client counts `prev === "curve"`, the worker must add `from` to the bond event. That is an `applyPatch` plus `LiveEvent` change, not done here. Counting `venue !== "curve"` on the client needs no server change.

## Verification

- `biome check --write` on each touched file and `pnpm -s lint`: clean (222 files).
- `pnpm -s typecheck`: clean (root and web).
- Every test file I touched passes on its own: `ingest`, `trades`, `stream`, `holders`, `events-route`, `live-hub` and web `trades`.
- Full `pnpm -s test`, run three times: 197 then 202 then 204 passed. Each run had 1 to 3 failures, and they were different tests each time: `prepare.test` and `vanity.test` (30 s Neon timeouts), `coins.test` (ordering, or a hook timeout) and `db.test` (the settings row). Each time, other vitest processes were running against the same Neon dev branch and seeding coins into it, and a leftover seeded coin topped the list. When I reran `coins`, `prepare` and `vanity` alone while nothing else was running, they all passed. I have not changed any of those test files, `schema.ts` or `coins.ts` since 9431b0d.
- No Playwright, no deploy, no push.
