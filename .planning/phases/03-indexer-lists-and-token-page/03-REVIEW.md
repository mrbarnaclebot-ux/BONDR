---
phase: 03-indexer-lists-and-token-page
reviewed: 2026-10-24T00:00:00Z
depth: standard
diff_base: e970c0e548a31c604e3d8e4393b4dc81ffe6f008
files_reviewed: 90
status: issues_found
findings:
  critical: 4
  warning: 20
  info: 20
  total: 44
---

# Phase 3 Code Review

Two reviewers split the 90 changed source files. Finding ids are prefixed S- (server half: worker, core, API routes, server libs) and C- (client half: pages, components, live hooks, e2e).

# Server half

# Phase 3: Code Review Report (server half)

**Reviewed:** 2026-10-24
**Depth:** standard
**Files Reviewed:** 47
**Status:** issues_found

## Summary

I reviewed the worker indexer (stream, gap fill, ingest, holders, BONDR price, the /events stream), the core decoding (`events.ts`, `trades.ts`, `price.ts`, `coin-row.ts`, schema) and the web server side (live hub, `/api/live`, `/api/coins`, `/api/coin/[mint]/*`, `og.tsx`, `pinata.ts`, `proxy.ts`). Most of it holds up. Decoding checks the emit_cpi event authority. Trades are keyed by `(signature, ix)`, so replays do nothing. The `last_slot` guard stops an older trade from rolling a coin back. All SQL is parameterized or uses fixed column orders. The share card image fetch is limited to one host, with no redirects, a 5 s timeout and a 2 MB cap. I found no leaked secrets: the Helius key only appears in URLs, and every log line runs through `redact`.

The main problems are on the indexer's recovery paths:

1. **CR-01:** `coins.last_sig` is used as the gap-fill starting point, but live ingest moves it forward. So any trade that fails or is missed while later trades of the same coin succeed is lost for good.
2. **CR-02:** a `CreatePoolEvent` from any pool, not just the coin's canonical pool, moves the coin's venue. That is spoofable, and on a coin still on the curve the write fails and blocks the gap fill.
3. **CR-03:** gap fills and the boot backfill move the in-memory BONDR price back to old values. Later live trades are then priced and stored with that stale price.

On the Neon rule (D-04), I found no periodic reads. Two paths still wake or load Neon outside a trade: the delayed holder recount write (WR-04), and the uncached resync reads that every open token page makes (WR-05).

Size limits: every file is under 300 lines (`packages/core/src/trades.ts` is at 292). One non-test function is over 40 lines: `createHub` (WR-08).

## Critical Issues

### S-CR-01: Trades are lost for good when an ingest fails, a fetch misses, or a deferred gap fill starts after live writes

**File:** `apps/worker/src/stream.ts:34-41`, `apps/worker/src/stream.ts:43-58`, `apps/worker/src/ingest.ts:149-156`, `apps/worker/src/ingest.ts:187-219`

**Issue:** The gap fill walks a coin's signatures only back to `coins.last_sig` (`gapFill(conn, r.mint, r.lastSig)`). But `last_sig` is a high-water mark that every live trade moves forward. It does not mark a point up to which everything is indexed. Three paths lose trades because of this:

1. `drain()` catches an `ingestTx` failure, logs it and deletes the signature from the queue (`stream.ts:37-38`). Nothing retries it. The next live trade of that coin moves `last_sig` past it, so no later gap fill reaches it. Causes include an RPC 429, a Neon timeout, a constraint violation (WR-03, CR-02), or SIGTERM in the middle of a transaction.
2. `ingestTx` returns `[]` when `fetchTx` gives up after 10 s (`ingest.ts:151`). The miss is silent on both the live path and the gap-fill path. The gap fill then moves on to newer signatures, which move `last_sig` past the missed one.
3. `fillAll` with `again` (`stream.ts:46-58`): a reconnect during a running fill defers the second fill until the first one ends, which can take N coins x 100 ms or more. Meanwhile the new socket is already ingesting live trades, which move `last_sig`. When the second fill finally reads `coins`, the trades missed during the second disconnect sit behind the new `last_sig` and are skipped.

The phase goal is that the worker ingests every trade. Each of these paths drops trades from the feed, candles and volume with no error left behind.

**Fix:** Don't use the live-moved `last_sig` as the gap boundary, and never drop a signature that failed.
```ts
// ingest.ts: a miss is a failure, so callers retry it instead of skipping it
const tx = await fetchTx(conn, sig);
if (!tx) throw new Error(`tx ${sig} not visible yet`);

// stream.ts: failures wait for the next fill instead of vanishing
const retry = new Set<string>();
async function drain(conn: Connection) {
  draining = true;
  for (const sig of queue) {
    await ingestTx(conn, sig).catch((e) => { retry.add(sig); logged(`ingest ${sig}`)(e); });
    queue.delete(sig);
  }
  draining = false;
}
// fillAll: re-ingest `retry` first (idempotent), and snapshot each coin's last_sig at
// ws.onopen (before the subscription can deliver), passing that snapshot to gapFillAll
// rather than re-reading coins after a deferred fill.
```
The structural fix is a separate `filled_sig` column, moved only by a gap fill that finished, and used as `until` in place of `last_sig`.

### S-CR-02: Any PumpSwap pool's CreatePoolEvent moves a coin's venue (spoofable, and blocks the gap fill)

**File:** `packages/core/src/trades.ts:189-198` (line 197), `apps/worker/src/ingest.ts:74-81`

**Issue:** `handle()` sets `venue: "pool"` for any `CreatePoolEvent` whose `baseMint` is a known coin. It never checks that `e.data.pool` is the coin's canonical pool. PumpSwap `create_pool` is permissionless and takes an index, so any holder of the coin can create a pool with any quote mint.
- If the coin is `complete`, the venue flips to `pool` and a `bond` event goes out before the real migration. The real migration then does nothing.
- If the coin is on the curve, the update sets `venue = 'pool'` with `bonded_at` null. That breaks `coins_bonded`, so the whole transaction throws. The rogue tx names the mint, so every reconnect gap fill for that coin stops on it (CR-01: "a failed ingest stops the fill"). Once retries are added, it becomes a retry that fails forever.

`poolTrade` already filters on the canonical pool. `CreatePoolEvent` needs the same check.

**Fix:**
```ts
if (e.name === "CreatePoolEvent") {
  const k = c.pools.get(String(e.data.pool));
  return k?.mint === mint ? { patch: { mint, venue: "pool" } } : {};
}
```
Also, in `applyPatch`, only allow `pool` to come from `complete`, or set `bondedAt` together with it, so that a missed CompleteEvent can't poison the migration tx either.

### S-CR-03: Gap fills and the boot backfill move the in-memory BONDR price back in time, and live trades are stored with the stale price

**File:** `apps/worker/src/ingest.ts:106-116` (line 110), `apps/worker/src/bondr-price.ts:15-20`, `packages/core/src/trades.ts:113-117`

**Issue:** `parse()` calls `bondrPrice.set(parsed.bondr)` for every tx it parses, whatever its age. At boot, `seedBondrPrice` reads the current chain price. Then `backfillLaunches` re-parses old launch txs, all multi-hop with a BONDR leg. After that, every stream open gap fills each coin from `last_sig`, oldest first. The process ends up holding the BONDR price from the last historical tx it parsed, not the current one.

Live trades with no BONDR leg in the same tx (direct curve buys and sells paid in BONDR, or pool trades of a child) fall back to `c.bondr.sol` (`priceAt`). They are written with wrong `trades.sol` and `trades.mcap_sol`, and with a wrong `coins.mcap_sol` and `bond_sol`, until the next live BONDR event. These rows are stored permanently and feed candles, volume, Trending and Top. The same happens after every reconnect gap fill.

**Fix:** Record the slot with the price, and only move the price forward in slots.
```ts
// bondr-price.ts
let at = -1;
export const bondrPrice = {
  get: () => sol,
  set: (n: number, slot: number) => { if (slot >= at) { sol = n; at = slot; } },
};
// seedBondrPrice: at = await ctx.conn.getSlot("confirmed") before the read
// ingest.ts parse(): if (parsed.bondr !== null) bondrPrice.set(parsed.bondr, tx.slot);
```

## Warnings

### S-WR-01: The stream never notices a refused subscription or a half-open socket, so the indexer silently stops

**File:** `apps/worker/src/stream.ts:68`, `apps/worker/src/stream.ts:87-96`

**Issue:** A JSON-RPC error answering `logsSubscribe` (id 1) is only logged (line 68). The socket stays open with no subscription and nothing gets ingested until it closes. Pings are sent, but no reply is ever checked, so a half-open TCP connection can sit for many minutes with no `close` event. The ingest health is invisible: `/healthz` stays green.

**Fix:** Close the socket when the reply to id 1 has an error or no numeric `result`. Keep a `lastSeen = Date.now()` that every message updates, and in the ping interval run `if (Date.now() - lastSeen > 2 * PING_MS) ws.close()`. Helius answers `ping`, so silence means the link is dead.

### S-WR-02: An indexer boot failure is terminal, and a failed BONDR price seed is never retried

**File:** `apps/worker/src/main.ts:28-33`, `apps/worker/src/main.ts:61`, `apps/worker/src/bondr-price.ts:38-45`

**Issue:** `bootIndex(...).catch(failed("index boot"))` logs once and gives up. A transient Neon or RPC error in `loadCoins` or `backfillLaunches` leaves the worker serving HTTP with no stream, no gap fill and no live updates, until the next deploy. `seedBondrPrice` swallows a read failure and leaves `sol = null` for good, until some BONDR event comes in. Every trade with no BONDR leg then gets `sol: null`, fails the `trades_burn_sol` check (WR-03) and is dropped (CR-01).

**Fix:** Retry `bootIndex` with the same capped backoff the stream uses, or exit the process so Railway restarts it: `bootIndex(ctx, env.net).catch((e) => { failed("index boot")(e); void flush().finally(() => process.exit(1)); })`. Treat a null seed as a boot failure the same way.

### S-WR-03: parseTx emits rows that the schema rejects, turning one bad row into a failed write for the whole tx

**File:** `packages/core/src/trades.ts:120-138` (line 134), `packages/core/src/schema.ts:173-174`

**Issue:** `ParsedTrade.sol` is `string | null`. A buy or sell gets `sol: null` whenever no BONDR price is known, but `trades_burn_sol` requires `sol is not null` for every side except burn. Likewise, nothing filters `tokenAmount === "0"`, for example a `PostCompleteBuyEvent` with `baseOut` 0 on an exact completion, but `trades_token_amount` requires it to be over 0. Either case throws inside `writeParsed`. That rolls back every other row and patch in the tx, including a CompleteEvent, which is the most important tx a coin has. The error that surfaces is just an opaque check-constraint failure.

**Fix:** In `parseTx`, drop rows with zero tokens (`if (big(r.tokens) === 0n) return {}` in `row` callers). When a buy or sell has no price, either make `parse()` throw a clear `no BONDR price for ${sig}` before writing, so CR-01's retry picks it up once the price is known, or relax the check to `side <> 'burn' or sol is null`.

### S-WR-04: The holder recount writes to Neon up to 5 minutes after the last trade (D-04)

**File:** `apps/worker/src/holders.ts:24-25`, `apps/worker/src/holders.ts:44`, `apps/worker/src/holders.ts:48-56`

**Issue:** A trade that lands inside a coin's 5-minute window schedules `recount` for `countedAt + 5 min`. That recount then runs `UPDATE coins`. On a quiet app, the last trade at t=1 min causes a write at t=5 min, which resets Neon's 5-minute suspend timer. Compute then stays up about 10 minutes after the last trade instead of 5, which can double CU-h on sparse traffic. D-04 says the indexer "writes only when a trade lands".

**Fix:** Don't write from the timer. Keep the count in memory and publish it from the timer (no DB). Then persist `holders` and `holders_at` in the next trade's `writeParsed` transaction, or only recount right away when the window is due and skip otherwise (`schedule` returning `now` or null).

### S-WR-05: A resync makes every open token page do uncached Neon reads (D-04)

**File:** `apps/web/app/api/coin/[mint]/trades/route.ts:25`, `apps/web/app/api/coin/[mint]/candles/route.ts:19`, `apps/web/lib/trades.ts:36-59`, `apps/web/lib/trades.ts:107-110`

**Issue:** On a hub gap (every worker deploy or restart, and every upstream reconnect that missed events), the hub sends `resync` to every client. `coin-live.tsx` answers by fetching `/api/coin/:mint/trades` with no `before`, and that route runs `tradesPage(mint)` plus `coinByMint(mint)` straight against Postgres, with no cache. N open pages of one coin cost 2N queries at the same moment, which is the "every open browser becomes database reads" pattern D-04 forbids. The home resync is protected by `kept()`, but this route isn't. Separately, `bondTime(mint)` runs uncached on every candles request, even when the candles themselves are a 10 s cache hit.

**Fix:** Route the no-`before` page and the coin row through the same 10 s per-mint cache that `candles()` uses. Return `bondTime` from inside the cached candles read, for example by selecting `bonded_at` in the same query, or cache it the same way.

### S-WR-06: The live hub has no upstream watchdog, so a stalled worker stream freezes every browser with no resync

**File:** `apps/web/lib/live-hub.ts:94-113`, `apps/web/lib/live-hub.ts:134-144`

**Issue:** `run()` awaits `splitLines(await open())` forever. The worker pings every 15 s, but the hub never checks that pings keep arriving. If the private network drops the connection without a FIN or RST (container moved, network partition), the `for await` never ends. Every `/api/live` client keeps getting `:hb` heartbeats from the web process and looks healthy, but receives no events and no resync.

**Fix:** Pass an `AbortController` to `fetch` in `openWorker`, and reset a 45 s timer on every parsed line (pings included). When the timer fires, call `ac.abort()`, so the loop throws, backs off, reconnects, and `sync()` resyncs clients if anything was missed.

### S-WR-07: Gap-filled historical trades are published as live trade events

**File:** `apps/worker/src/ingest.ts:126-137`, `apps/worker/src/ingest.ts:181-182`

**Issue:** `ingestTx` is shared by the live stream and the gap fill, and `arm()` publishes every inserted row as `{ type: "trade" }`. After a reconnect or the boot backfill, old trades go out as live events. Clients prepend them as the newest feed rows, flash the cards green or red (D-15), and feed them to the chart as new ticks, even though they are hours old. The `coin` published alongside is current, because the `last_slot` guard held, so the trade row and the numbers disagree.

**Fix:** Have `ingestTx` take a `live` flag (true from `drain`, false from `gapFill` and `backfillLaunches`). When it is false, publish only a coin update, or nothing, and let one resync per fill catch clients up. Or publish only rows whose `slot >= coin.lastSlot`.

### S-WR-08: createHub is 65 lines, over the AGENTS.md 40-line function limit

**File:** `apps/web/lib/live-hub.ts:67-131`

**Issue:** AGENTS.md section 5 limits functions to 40 lines. `createHub` bundles the subscriber set, fan-out, gap sync, the upstream loop and `subscribe` into one closure.

**Fix:** Move `run` (the upstream loop) and `sync` out into module-level functions that take `{ ring, fan }`, or make the hub a small class with `fan`, `sync`, `run` and `subscribe` methods, each under 40 lines.

## Info

### S-IN-01: Same-slot ordering and the gapFill `until` boundary

**File:** `apps/worker/src/ingest.ts:68`, `apps/worker/src/ingest.ts:196`

**Issue:** `lte(coins.lastSlot, fresh.slot)` lets the later write win within a slot (this is documented). The other half isn't: `getSignaturesForAddress({ until: lastSig })` drops same-slot signatures that the RPC lists after `lastSig`. A same-slot trade that was missed is therefore never filled.

**Fix:** Covered by CR-01's `filled_sig`. Otherwise, set `until` to the first signature of an older slot.

### S-IN-02: Every reconnect costs one getSignaturesForAddress per known coin

**File:** `apps/worker/src/ingest.ts:208-219`

**Issue:** Credits per reconnect grow with the coin count, including coins that are years quiet, which is a D-05 budget risk once coins number in the hundreds.

**Fix:** Add a `ponytail:` note naming the ceiling. Later, skip coins whose `last_trade_at` is older than the disconnect start.

### S-IN-03: The per-IP SSE cap of 6 is shared by every user behind a carrier NAT

**File:** `apps/web/app/api/live/route.ts:11`, `apps/web/proxy.ts:11`

**Issue:** On mobile carrier-grade NAT, the 7th open tab on one public IP gets a 429, and EventSource does not retry a non-200 answer, so that user gets no live updates.

**Fix:** Accept and document it, or raise the cap and rely on the 30/min connect limit.

### S-IN-04: normalize() turns nested structs and arrays into "[object Object]"

**File:** `packages/core/src/events.ts:55-58`

**Issue:** `"toString" in v` is true for every object, so fields like `TradeEvent.shareholders` become the string "[object Object]". Nothing reads them yet.

**Fix:** Only stringify values that are a BN or a PublicKey (`BN.isBN(v) || v instanceof PublicKey`), or leave arrays alone.

### S-IN-05: og.tsx caches a rejected font or hero promise for the life of the process

**File:** `apps/web/lib/og.tsx:21`, `apps/web/lib/og.tsx:38`, `apps/web/lib/og.tsx:49-55`

**Issue:** If a single read fails, `fonts ??= readFonts()` and `hero ??= heroUri()` keep the rejected promise, so every later card fails until a restart.

**Fix:** `fonts = readFonts().catch((e) => { fonts = undefined; throw e; })`.

### S-IN-06: Duplicated helpers and program ids

**File:** `apps/worker/src/stream.ts:11-12`, `apps/worker/src/stream.ts:17-18`, `apps/worker/src/ingest.ts:29-30`, `apps/worker/src/main.ts:23-24`, `scripts/stream-probe.ts:17-20`, `apps/web/lib/coins.ts:49-59`, `apps/web/lib/trades.ts:93-104`

**Issue:** The pump and PumpSwap program ids are hardcoded in two places instead of using `PUMP_PROGRAM_ID` and `PUMP_AMM_PROGRAM_ID` from `@bondr/core/pump`. The `logged` and `failed` helper appears three times. The 10 s `kept` cache is written twice.

**Fix:** Import the ids from `@bondr/core/pump`, export one `logged` from a worker helper module, and reuse `coins.ts`'s `kept` in `trades.ts`.

### S-IN-07: Silent fallbacks in parse and launch ingest

**File:** `packages/core/src/trades.ts:250`, `apps/worker/src/ingest.ts:172-173`

**Issue:** A tx with no `blockTime` and no event timestamp is stamped 1970-01-01, which skews candles and volume windows. `ingestLaunch` returns quietly when the launch tx has no decodable CreateEvent, so the coin is never indexed and nothing gets logged.

**Fix:** Throw or log when `ts === 0`. Log `launch ${row.id}: no CreateEvent` before returning.

### S-IN-08: No backpressure on the worker /events writes or the /api/live enqueue

**File:** `apps/worker/src/events-route.ts:20-23`, `apps/web/app/api/live/route.ts:37-39`

**Issue:** `res.write` and `c.enqueue` ignore their backpressure signals (the `false` return and `desiredSize`), so a stalled consumer buffers in memory for up to 14 minutes. The events are small, so the risk is low.

**Fix:** In `/api/live`, drop the stream when `c.desiredSize < -N`. In `publish`, drop and end a subscriber whose `res.write` returns false and that has not drained within one ping.

### S-IN-09: The bond event carries only the final venue

**File:** `apps/worker/src/ingest.ts:134-135`

**Issue:** A tx that both completes the curve and migrates it publishes `bond` with `venue: "pool"`, so a client that counts `venue === "complete"` (home-live.tsx:152, client half) never counts that bond.

**Fix:** Publish the transition (`from`/`to`), or count `venue !== "curve"` on the client.

### S-IN-10: Gap-filled trades with no BONDR leg are priced at the current BONDR price

**File:** `packages/core/src/trades.ts:113-117`

**Issue:** For historical txs with no BONDR leg, `priceAt` falls back to the process's current price, which is an approximation that nothing marks as one.

**Fix:** Add a `ponytail:` comment, or price from the nearest stored `trades.bondr_sol` before that slot.


_Reviewed: 2026-10-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

# Client half

# Phase 3: Code Review Report (client half)

**Reviewed:** 2026-10-24
**Depth:** standard
**Files Reviewed:** 43
**Status:** issues_found

## Narrative Findings (AI reviewer)

### Summary

I reviewed the Phase 3 client diff (`e970c0e..HEAD`): the home and token pages, the live providers (`home-live`, `coin-live`, `use-live`), the chart and the trade feed, the share card routes, and the e2e specs.

What holds up:
- Rendering is XSS-clean. On-chain names, symbols and search text are only ever rendered as React text. `imageUrl` only accepts an alphanumeric CID, so the CSS `url("…")` in `coin-identity` cannot be broken out of. Social links are filtered to `https://`. Nothing uses `dangerouslySetInnerHTML`.
- Cleanup is mostly correct: the EventSource and its reopen timer, the chart instance (`chart.remove()`), the rAF batch in the feed, the drag listeners and the candle fetch abort.

The defects are in how live state merges with snapshots:
- Snapshots kept for 10 s overwrite newer live values.
- The token page loses the trades that land between its cached render and the first stream connect.
- A resync merge in the trade feed can put rows out of order or leave holes.
- A resync that races a tab switch mixes two sorts into one list.
- The hero bonded count drifts.

One share card defect is irreversible once crawled: a transient image failure gets cached for a year.

The e2e suite has two parallel-run flake sources. One file and ten functions break the AGENTS.md size limits.

## Critical Issues

### C-CR-01: A coin card that fell back to the letter (image fetch failed) is served `immutable` for a year

**File:** `apps/web/app/coin/[mint]/opengraph-image.tsx:15,28` (with `apps/web/lib/pinata.ts:47-59`)
**Issue:** `fetchCardImage` returns `null` in all of these cases:
- a gateway 429 or 5xx
- the 5 s timeout
- `PINATA_GATEWAY` unset
- a WEBP image

In each case `coinCard` renders the letter fallback, and the route still sends `public, immutable, max-age=31536000`. X, Telegram and any CDN then keep a card without the coin's image for a year. They cannot be told to re-fetch it, because the URL never changes. A single gateway hiccup on the first share leaves that coin's card wrong for a year, with no fix possible on our side.
**Fix:** Only mark the card immutable when the image actually embedded (or the coin has no image at all):
```tsx
export default async function Image({ params }: { params: Promise<{ mint: string }> }) {
  const v = await landedCoin((await params).mint);
  if (!v) return siteCard(SHORT);
  const img = await fetchCardImage(v.imageCid);
  // A missing image that should exist is retried by the crawler later, not frozen.
  return coinCard(v, img, img || !v.imageCid ? IMMUTABLE : SHORT);
}
```

## Warnings

### C-WR-01: Snapshots up to 10 s old overwrite newer live numbers (home lists)

**File:** `apps/web/components/home-coins.tsx:82`, `apps/web/components/home-live.tsx:160-165`
**Issue:** `listCoins` and `trending` are kept for 10 s per process (`lib/coins.ts:47-58`).
- **Tab switch, search or Show more:** the fetched page replaces the list outright (`setList(... got)`). A card that a live trade just moved to 900 SOL can drop back to the cached 860 SOL until its next trade.
- **Resync:** `union(got.coins, l.coins)` lets the server copy win. The resync arrives right after a reconnect, which is exactly when replayed or live events have already made the local rows newer than the 10 s snapshot.
- **Launches:** a launch inserted into Latest while the Latest fetch is in flight disappears when the cached page lands without it.
**Fix:** Merge by freshness instead of replacing. Keep the local copy when its `lastTradeAt` is newer:
```ts
const newest = (a: CoinRow, b?: CoinRow) =>
  b && (b.lastTradeAt ?? "") > (a.lastTradeAt ?? "") ? { ...a, ...pickLive(b) } : a;
// in load() and onResync: got.coins.map((c) => newest(c, byMint.get(c.mint)))
```
Also re-apply local launches that the snapshot is missing, using `insertLaunch` again after the swap.

### C-WR-02: The token page loses every trade between its cached render and the first stream connect

**File:** `apps/web/app/coin/[mint]/page.tsx:35-50,64`, `apps/web/lib/use-live.ts:61`, `apps/web/components/token-chart.tsx:84`
**Issue:**
- `firstPage` and `coinRow` are kept for 10 s. The first EventSource has no `Last-Event-ID`, so the hub replays nothing. A trade that landed inside that window (up to about 10 s plus hydration time) never appears in the feed. The stats heal on the next trade; the feed never does.
- The chart has the same gap. The candles route is also kept 10 s (`lib/trades.ts:93-102`), and `useDrawn` drops every live trade until both the dynamically imported chart and the candles have arrived (`if (!api || !seconds || !subscribe) return`).
**Fix:**
- Render the hub's current last event id into the page.
- Open the first stream with it, e.g. `/api/live?mint=…&last=<id>`. The hub already replays from `lastId` (`live-hub.ts:118-121`), or sends `resync` when the id is too old.
- For the chart, buffer the trades that arrive before `api && data` are ready and replay them through `liveBar` after `showCandles`.

### C-WR-03: The trade feed's resync merge can put rows out of order and leaves permanent holes

**File:** `apps/web/components/token-trades.tsx:35-44,105`
**Issue:** `prepend` puts every unseen row of the refetched first page above all existing rows.
- **Out of order:** live T5 arrives while the resync fetch is in flight, after T4 was missed in the gap. The fetch returns `[T5, T4, T3]`, and the feed becomes `[T4, T5, T3]`.
- **Holes:** if more than 50 trades landed during the gap, the 50 newest go on top. The ones between those and the old rows are never shown. Load more pages from the bottom, so it never fills that hole either.

The launch rows are part of the proof story (D-16). A misordered feed or one with holes undermines it.
**Fix:**
- Merge, then sort by `(slot, seq)` descending, comparing with `BigInt`.
- If the oldest refetched row is still newer than the newest existing row and `page.more` is true, there is a hole. In that case replace the rows with the page and set `more` to true, instead of prepending.

### C-WR-04: A resync that resolves after a tab switch or search mixes two lists

**File:** `apps/web/components/home-live.tsx:160-165`
**Issue:**
- `catchUp(sort[0], q[0])` captures the sort and query when the request starts. If the user switches tab or types before it resolves, the old sort's page 0 is unioned on top of the new list. For example, Top coins end up prepended to Oldest, or unfiltered coins appear in a search result.
- `load()` in `home-coins` aborts its own controller but cannot cancel this fetch.
**Fix:** Read the current view through a ref when the response lands, and drop stale responses:
```ts
const view = useRef({ sort: sort[0], q: q[0] }); view.current = { sort: sort[0], q: q[0] };
onResync: () => { const at = view.current;
  void catchUp(at.sort, at.q).then((got) => {
    if (!got || view.current.sort !== at.sort || view.current.q !== at.q) return; ... }) }
```

### C-WR-05: The hero bonded count drifts from the server count

**File:** `apps/web/components/home-live.tsx:150-153,124-128`
**Issue:**
- The client increments `bonded` only on a `bond` event with `venue === "complete"`.
- The worker publishes one bond event per announce, carrying the coin's current venue (`apps/worker/src/ingest.ts:133-135`). A coin that goes from curve to pool in one batch (backfill after a restart, catch-up) emits only `venue: "pool"` and is never counted, while the server count (`venue <> 'curve'`) includes it.
- `catchUp` does not return counts, so a resync never corrects either number. Launches missed during a gap are lost the same way.
**Fix:** Return `heroCounts()` (already kept 10 s) in the `trending=1` response and `setCounts(got.counts)` on resync. Have the worker send the previous venue in the bond event. The client then counts `prev === "curve" && venue !== "curve"`.

### C-WR-06: A failed "Show more" wipes the whole grid

**File:** `apps/web/components/home-coins.tsx:86-89`
**Issue:** The catch path runs `setList(null)` for any page, so a failed page 2 read replaces the 50 loaded cards with "Could not load coins". The retry then reloads only page 0, losing the user's place. The UI-SPEC state ("the error replaces the grid") fits a tab or search swap, not an append.
**Fix:** Only null the list for `page === 0`. For later pages, keep the list and show an inline error next to the Show more button:
```ts
} catch {
  if (c.signal.aborted) return null;
  if (page === 0) setList(null); else setMoreFailed(true);
}
```

### C-WR-07: A Trending drag that starts on a card image turns into a native image drag and leaves the scroller stuck dragging

**File:** `apps/web/components/home-trending.tsx:32-73`, `apps/web/components/coin-card.tsx:32-34`
**Issue:**
- `draggable={false}` is on the `<Link>`, but the `<img>` elements inside it are still draggable by default, and the art covers the top 150px of every trending card.
- A mouse-down on the art starts an HTML5 drag, which fires `pointercancel`, not `pointerup`. No `pointercancel` listener exists, so `start` stays set, and moving the pointer afterwards (button released) keeps scrolling the region until `pointerleave`.
- The e2e drag test presses on the card's centre (the text block), so it does not catch this.
- There is no pointer capture either, so a drag that leaves the region stops halfway.
**Fix:** Add `draggable={false}` to the `<img>` in `Art`. Add `["pointercancel", up]` to the listener list. Call `el.setPointerCapture(e.pointerId)` in `down`, and release it in `up`.

### C-WR-08: The trade time tooltip shows the server's timezone and locale forever

**File:** `apps/web/components/token-trades.tsx:51`
**Issue:** `title={new Date(t.at).toLocaleString()}` is computed on the server, which runs in UTC with the server's locale.
- React never patches attribute mismatches during hydration, and `suppressHydrationWarning` only hides the warning.
- The client's first render computes the same value on every later render, so React sees no change and never updates the DOM.
- Every server-rendered row keeps a UTC tooltip with no zone label. Only rows that arrive live show local time.
**Fix:** Format the title on the client after mount, for example with a `useEffect`-set `mounted` flag (`title={mounted ? local : undefined}`). Alternatively, render an explicit zone: `toLocaleString("en", { timeZone: "UTC", timeZoneName: "short" })`.

### C-WR-09: E2E card locators match on unanchored symbol substrings, so specs collide under fullyParallel

**File:** `apps/web/e2e/home.e2e.ts:149`, `apps/web/e2e/responsive-lists.e2e.ts:50`
**Issue:**
- Seeded symbols are `E${randomInt(100_000)}`, and the locators use `new RegExp(\`E2E ${coin.symbol}\`)` and `new RegExp(coin.symbol)`.
- About 10% of runs draw a symbol of 4 characters or fewer, such as `E12`. That matches `E2E E123…`, seeded at the same time by the other specs (`fullyParallel: true`) or left behind by a crashed run.
- When more than one card matches, Playwright's strict mode throws, so the spec fails intermittently.
**Fix:** Locate by href, as `home-live.e2e.ts:97` already does: `grid.locator(\`a[href="/coin/${coin.mint}"]\`)`. Alternatively, pad the symbol to a fixed width: `E${String(randomInt(1e5)).padStart(5, "0")}`.

### C-WR-10: Landed e2e fixtures become "the newest landed launch" for parallel specs, and are deleted mid-test

**File:** `apps/web/e2e/coin.e2e.ts:39-57`, `apps/web/e2e/og.e2e.ts:30-41`
**Issue:**
- `fixture("landed")` and og's `landed()` insert `state = 'landed'` rows with the default `created_at = now()`.
- Under `fullyParallel`, `newest()` in the coin "found" tests can pick the `BLINK` or `BCARD` fixture instead of a real launch. That fixture has no coins row and a random signature.
- The owning file's `afterAll` then deletes it while the other test is still on the page, which turns a 200 into a 404 halfway through.
- `seedCoin` avoids this already by back-dating a year (`fixtures.ts:1-3,48`).
**Fix:** Insert both fixtures with `created_at = now() - interval '1 year'`, or make `newest()` exclude e2e rows: `where state = 'landed' and w <> 'e2e'`.

### C-WR-11: AGENTS.md size limits are exceeded (a definition-of-done gate)

**File:** `apps/web/e2e/coin.e2e.ts` (352 lines, the limit is 300), and these functions over 40 lines:

| Function | Location | Lines |
| --- | --- | --- |
| `HomeCoins` | `home-coins.tsx:122-182` | 61 |
| `CoinCard` | `coin-card.tsx:124-179` | 56 |
| `McapChart` | `token-chart.tsx:97-147` | 51 |
| `FeedTable` | `token-trades.tsx:134-184` | 51 |
| `CoinPage` | `app/coin/[mint]/page.tsx:60-107` | 48 |
| `BondGlyph` | `bond-glyph.tsx:48-92` | 45 |
| `TradeFeed` | `token-trades.tsx:186-229` | 44 |
| `BondPanel` | `token-bond.tsx:69-112` | 44 |
| `useDrag` | `home-trending.tsx:32-74` | 43 |
| `seedCoin` | `e2e/fixtures.ts:31-72` | 42 |

**Issue:** AGENTS.md §5 and §12.1 make these limits part of "done".
**Fix:**
- Move the chart `describe` (lines 300-352) out of `coin.e2e.ts` into `coin-chart.e2e.ts`.
- Pull the JSX blocks out into small components: `FeedHead` (the `thead`), `ShowMore` in `HomeCoins`, `ChartFrame` in `McapChart`, `CardChips` in `CoinCard`, `Gradient` in `BondGlyph`, and the trades grid in `CoinPage`.
- Split `useDrag` into `down`/`move`/`up` handler factories.

### C-WR-12: The hero video and the motes loop with no pause control (WCAG 2.2.2)

**File:** `apps/web/components/home-hero.tsx:22-50`
**Issue:** For users without reduced motion, the hero autoplays a looping video plus 16 animated motes, indefinitely. That is moving content which starts automatically, lasts more than 5 s and sits alongside other content. WCAG 2.2.2 requires a way to pause it whether or not it is decorative. Honouring `prefers-reduced-motion` does not satisfy 2.2.2 on its own.
**Fix:** Add a small "Pause animation" toggle button. It should pause the `<video>` (through a ref) and set the motes' `animation-play-state: paused`. Alternatively, drop `loop` and let the clip stop on its poster after one play under 5 s.

## Info

### C-IN-01: The home flash map grows by one entry for every coin that trades, listed or not

**File:** `apps/web/components/home-live.tsx:148`
**Issue:** `setFlash` records every mint in the stream, including coins on no list. A long-open tab grows the map, and every trade re-renders every context consumer (the context `value` is not memoized).
**Fix:** Only record mints that are in `list` or `trend`.

### C-IN-02: The coin-live handlers trust the server's mint filter

**File:** `apps/web/components/coin-live.tsx:37-44`
**Issue:** `onTrade`, `onBond` and `onHolders` never check `d.mint === mint` (or `d.coin.mint`). A hub filter regression would flip this page to another coin's numbers or bond state.
**Fix:** Add a one-line guard in each handler, as defence in depth.

### C-IN-03: BondPanel invents a bond time and renders time-dependent text without a hydration guard

**File:** `apps/web/components/token-bond.tsx:44`
**Issue:** `age(c.bondedAt ?? new Date().toISOString())` prints "Bonded 1m ago" when `bondedAt` is unknown. It is also computed during SSR without `suppressHydrationWarning`, so it mismatches at minute boundaries.
**Fix:** Omit the age when `bondedAt` is null, and wrap it in `<time suppressHydrationWarning>`.

### C-IN-04: The search result count reads the loaded page, not the total

**File:** `apps/web/components/home-coins.tsx:157`
**Issue:** The count announces "50 coins match" when more exist (`list.more`).
**Fix:** Announce "50 or more coins match" when `list.more` is true.

### C-IN-05: Chart reloads reset the zoom, and a failed interval switch shows a mismatched label

**File:** `apps/web/components/token-chart-draw.ts:144-146`, `apps/web/components/token-chart.tsx:71,110-113`
**Issue:**
- Every resync reload re-runs `setVisibleLogicalRange` or `fitContent`, which discards the user's pan and zoom.
- After a failed switch, the old interval's candles stay drawn, and live bars keep bucketing at the old `data.iv`, while the aria label and the pressed button name the new interval.
**Fix:** Keep the range on a same-interval reload. Clear the series, or dim it and label it with `data.iv`, when `failed` is true.

### C-IN-06: A non-launch burn row would be labelled "Buy"

**File:** `apps/web/components/token-trades.tsx:47`
**Issue:** `SIDE[t.side === "sell" ? "sell" : "buy"]` maps `burn` to Buy. Phase 5 burns will show up mislabelled.
**Fix:** Add a `burn: ["Burn", "text-muted-foreground"]` entry and index `SIDE[t.side]`.

### C-IN-07: `generateImageMetadata` types `params` as a plain object, then awaits it

**File:** `apps/web/app/coin/[mint]/opengraph-image.tsx:19-20`
**Issue:** The declared type does not match the `Promise` the code treats it as.
**Fix:** Type it as `{ params: Promise<{ mint: string }> }`, matching `Image`.

### C-IN-08: Fire-and-forget timers on the home provider

**File:** `apps/web/components/home-live.tsx:109,118`
**Issue:** The `later` and `useFresh` `setTimeout` calls are never cleared on unmount. This is harmless in React 19, but it is the only uncleaned timer in the live code.
**Fix:** Track the timer ids in a ref and clear them in an unmount effect.

### C-IN-09: E2E fixed sleeps and environment-coupled assertions

**File:** `apps/web/e2e/home-live.e2e.ts:170,185`, `apps/web/e2e/live.e2e.ts:114,121,131-142`, `apps/web/e2e/home.e2e.ts:158,269`
**Issue:**
- The `waitForTimeout` negative checks can pass falsely on a slow machine.
- "Live on the real stream" needs a running worker.
- `expect(refused).toBe(2)` breaks if the real stream reconnects once inside the 30 s window.
- `blockTime` polls the public devnet RPC, which rate-limits.
**Fix:** Assert with `toBeGreaterThanOrEqual(2)`. Skip the real-stream test when the worker is not reachable.

### C-IN-10: `syncUrl` drops the URL hash

**File:** `apps/web/components/home-coins.tsx:64`
**Issue:** After "See all coins" (`#all-coins`), a tab switch or search removes the anchor.
**Fix:** Append `location.hash` in the `replaceState` URL.


_Reviewed: 2026-10-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
