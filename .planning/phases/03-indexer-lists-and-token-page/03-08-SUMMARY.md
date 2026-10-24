---
phase: 03-indexer-lists-and-token-page
plan: 08
subsystem: live-pipe
tags: [sse, ndjson, live, fan-out, eventsource]
requires:
  - 03-04 LiveEvent, CoinLive, CoinRow, TradeRow; writeParsed
  - 03-06 coinByMint windowed SQL
  - 03-07 arm() and recount() publish points
provides:
  - worker GET /events (bearer NDJSON, ping with current id every 15 s), publish, listening, endStreams
  - http.ts Streams (long-lived handlers behind the same authorized() check)
  - "@bondr/core/coin-row coinRow(exec, mint): the coin query shared by web and worker"
  - web lib/live-hub.ts (hub, createHub, splitLines, Ring, HubEvent)
  - web GET /api/live SSE route with replay, resync, 6-stream per-IP cap; proxy live scope 30/min
affects: [03-09, 03-14]
tech-stack:
  added: []
  patterns: [one upstream per process on globalThis, ring replay keyed by epoch-seq ids, id-only SSE frame as a position mark, ping carries current id for gap detection]
key-files:
  created:
    - apps/worker/src/events-route.ts
    - apps/worker/src/events-route.test.ts
    - apps/web/lib/live-hub.ts
    - apps/web/lib/live-hub.test.ts
    - apps/web/app/api/live/route.ts
  modified:
    - apps/worker/src/http.ts
    - apps/worker/src/ingest.ts
    - apps/worker/src/holders.ts
    - apps/worker/src/main.ts
    - apps/worker/README.md
    - apps/web/lib/coins.ts (now a thin wrapper; body moved to packages/core/src/coin-row.ts)
    - apps/web/lib/worker.ts
    - apps/web/lib/README.md
    - apps/web/proxy.ts
    - biome.json
key-decisions:
  - "03-08: coinByMint's query moved to @bondr/core/coin-row (coinRow) so the worker's trade events carry exactly the numbers the token page reads"
  - "03-08: every worker ping carries the current id; a reconnecting hub resyncs only when that id differs from its head (worker restart or events missed), not on every reconnect"
  - "03-08: /api/live sends an id-only frame with the hub head after replay, so a browser that saw no events still resyncs after a web restart"
  - "03-08: the worker skips the coinRow read when no web hub is connected (listening() is 0)"
duration: 10min
completed: 2026-10-23
---

# Phase 3 Plan 08: Live pipe Summary

The worker now publishes every new launch, trade, bond and holder recount on a bearer-protected NDJSON stream. Each web process holds one upstream connection to that stream and serves it to browsers over same-origin SSE at `/api/live`. A browser that reconnects replays missed events from a 2,000-event ring. Only a real gap (a worker restart, or events missed while the upstream was down) produces a `resync`. No stream path reads Postgres.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Worker publishes events over a bearer NDJSON stream | 8be915e (RED), b3aba90 |
| 2 | Web hub and the SSE route | 4c92a3a (RED), ccefbc4 |

## What was built

- **Worker `events-route.ts`.** `publish(e)` stamps `<epoch>-<seq>` ids, where epoch is the boot time in ms, and writes one line to every open `/events` response. Each stream opens with `{"type":"ping","id":<current id>}` and repeats it every 15 s. `listening()` reports the open count. `endStreams()` runs on SIGTERM, because open streams would otherwise keep `server.close()` waiting forever.
- **`http.ts`.** `start(routes, token, port?, streams?)`. A stream handler runs after `authorized()` and before the JSON routes. `http.test.ts` passes unchanged.
- **`ingest.ts`.** `applyPatch` returns whether the venue moved. `writeParsed` collects those mints into `bonded`. After the commit, `arm()` publishes with one `coinRow` read per coin, and skips the read when no hub is listening:
  - a `launch` event for a new coin's first write
  - a `trade` event per inserted trade, carrying the coin's `CoinLive`
  - a `bond` event when the venue moved

  A write that inserted nothing publishes nothing.
- **`holders.ts`.** Publishes a `holders` event after each recount write.
- **Web `live-hub.ts`.** Server-only and stored on `globalThis`. Pure parts:
  - `splitLines`: an NDJSON async generator that skips malformed lines
  - `Ring`: 2,000 events after a `base` id; `since(id)` returns the replay, or null when it cannot replay
  - `matches`: a mint filter that never forwards launch events

  `createHub(open, wait)` connects on the first subscriber, with backoff from 1 s doubling to 30 s. The first ping of each connection is compared with the head. Anything different resets the ring and broadcasts `resync`. A subscriber whose write throws is dropped. The upstream fetch has no timeout.
- **`/api/live`.** `force-dynamic` with the Node runtime.
  - Requests:
    - an invalid `mint` returns 400
    - the 7th open stream from one IP returns 429
  - Stream contents, in order:
    1. a 2 KB comment, then `retry: 1000`
    2. a replay, or a resync, based on `Last-Event-ID`
    3. an id-only frame with the hub head
    4. `:hb` every 20 s
  - The stream closes itself after 14 min. `cancel()` and request abort both unsubscribe and release the IP slot.
  - Headers: `text/event-stream`, `no-cache, no-transform`, `x-accel-buffering: no`.
- **`proxy.ts`.** `/api/live` gets its own `live` scope (30 connects a minute per IP).

## Verification

- `pnpm test`: 179 passed, 1 skipped (32 files). That includes `events-route.test.ts` (2), `live-hub.test.ts` (6), `http.test.ts`, `ingest.test.ts` and `coins.test.ts` against Neon dev.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` (`/api/live` is dynamic) and `scripts/check-client-bundle.sh` all pass. No `WORKER_TOKEN` in `.next/static`.
- rg gates:
  - no db import in `live-hub.ts` or `route.ts`
  - `no-transform` and `globalThis` present
  - no `AbortSignal.timeout` in the hub
  - `"GET /events"` in `main.ts`
  - `publish(` in both `ingest.ts` and `holders.ts`

### Devnet proof

Setup: local worker (`VANITY_THREADS=0`), `next start`, Neon dev branch, coin F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr.

| Step | Signature | Result |
|------|-----------|--------|
| Buy 0.01 with `curl -N /api/live?mint=` open | 4SWnUXe1aBnEBj65hqUF3hRU2pvKFR3LWSB2RbjqTqBjNjkmNQiQsvi8q1T4ck8rFEpSknrZ85kCvSkqnyARCA2t | `event: trade` id `1792768555532-1` received on the filtered and the unfiltered stream, followed by `event: holders` (holders 1) |
| Sell, timed | 66Wfc7okTiyuHTD9gGjX8ycvXHJDSYzEX3HazC7cBhsMjLjseAYWUda5iABpzzuSu9i229LTXvUJaajj4iosZabP | landed (script print) at 1792768625049, SSE arrival at 1792768630661: **5.6 s** (limit 15 s) |
| Reconnect with `Last-Event-ID: ...-1` | | replayed `-2 holders`, `-3 trade`, then the id-only head frame |
| Reconnect with an id from another epoch | | one `event: resync` with id `-3` |
| 7 more connects from one IP with 3 open | | 3 accepted, 4 answered 429 |
| `?mint=0OIl` | | 400 |

Spend: buy 0.010006 SOL. The sell returned SOL to the sim; ops topped the sim up once. Ops is at 2.750788 SOL. The worker, web server and listeners were all stopped afterward.

## Deviations from Plan

**1. [Rule 2 - Correctness] Shared coin query in core instead of duplicating SQL in the worker.**
- **Found during:** Task 1.
- **Issue:** The plan says the worker should compute the windowed values "with the same SQL as web". A copy would drift.
- **Fix:** `apps/web/lib/coins.ts` moved to `packages/core/src/coin-row.ts` as `coinRow(exec, mint)`, and web's `coins.ts` became a 6-line wrapper. `biome.json` now allows `@bondr/core/coin-row` in web. The `coins.test.ts` tests pass unchanged.
- **Commit:** b3aba90

**2. [Rule 1 - Bug] SIGTERM would hang with open streams.**
- **Found during:** Task 1.
- **Fix:** `endStreams()` is called after `server.close()` in `main.ts`.
- **Commit:** b3aba90

**3. [Rule 1 - Correctness] Gap detection by position, not only by epoch.**
- **Found during:** Task 2.
- **Issue:** The plan resyncs on a new epoch. But events published while the hub was disconnected from a still-running worker would be silently lost.
- **Fix:** The worker's ping carries its current id, and the hub resyncs when that id differs from its head. Same epoch with nothing missed means no resync; a restart or missed events means resync.
- **Commit:** b3aba90, ccefbc4

**4. [Rule 2 - Correctness] Id-only head frame on connect.**
- **Issue:** A browser that never received an event has no `Last-Event-ID`, so after a web restart it would not resync.
- **Fix:** The route sends `id: <head>` after replay.
- **Commit:** ccefbc4

**5. Test fix during GREEN.** The ring test's first expectation was wrong. After 2,001 pushes, the pushed-out id `1-1` is the new base, so a client that saw `1-1` can replay all 2,000 held events. The test now asserts that, and asserts that `1-0` cannot replay.

## Known Stubs

None. The browser consumer (`use-live.ts`, list and page wiring) and the `lib/README.md` line for `live-hub.ts` are 03-09 by plan.

## Notes for the owner

- TOKEN-02 and LIST-04 are not marked complete. The live data now reaches `/api/live`, but nothing renders it until 03-09.
- `ponytail:` the first upstream connect after a web boot never resyncs, so a page rendered in those first seconds may miss events. Per-IP open-stream counts are per process, which is fine while web runs one replica.
- A6 (Railway private network has no 15-minute cap on web to worker) is still an assumption. If it is wrong, the hub reconnects every 15 min. Each reconnect resyncs only if events were missed.
- Staging needs both services redeployed (03-14). No Railway change was made.

## Self-Check: PASSED

- Files: events-route.ts, events-route.test.ts, live-hub.ts, live-hub.test.ts, app/api/live/route.ts and packages/core/src/coin-row.ts are present.
- Commits 8be915e, b3aba90, 4c92a3a and ccefbc4 are in git log.
