# Phase 3: Indexer, Lists and Token Page - Research

**Researched:** 2026-10-23
**Domain:** Solana trade indexing (pump curve + PumpSwap), Postgres rollups on a scale-to-zero budget, SSE fan-out on Railway, lightweight-charts, next/og
**Confidence:** MEDIUM-HIGH (stack and code paths verified in this repo and installed SDKs; three chain behaviours need a Wave 0 devnet probe, listed in Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried forward (locked earlier)
- **D-01:** Values are SOL equivalents everywhere ("Mcap 61.40 SOL"), and the chart plots market cap, per the approved mockups and the PROJECT.md risk response. Coins are quoted in BONDR, so the SOL value comes from BONDR's own curve or pool price, read on chain.
- **D-02:** SSE for live updates, TradingView lightweight-charts for the chart, BONDR's own indexer (no pump API).
- **D-03:** Lists show only coins launched through BONDR. Trending = quote volume in the last 1h; Top = market cap; Latest and Oldest = launch time.
- **D-04:** Neon budget (500 CU-h a month hard quota, 0.25 CU computes): the indexer writes only when a trade lands, and nothing reads the database on a timer, so a quiet app lets Neon scale to zero. SSE fan-out must not turn every open browser into database reads.
- **D-05:** Helius Developer plan ($49) is the RPC budget. Stay inside its included websocket and credit limits.
- **D-06:** Layout follows the approved `home.html` and `token.html` mockups; gsd-ui-phase writes the UI-SPEC before planning.
- **D-07:** Phase 2 rules still apply: the 14-day freshness rule for new dependencies, web imports only pure `@bondr/core` modules, secrets stay in the worker, and the CSP (connect-src 'self', img-src limited to ipfs.io and *.mypinata.cloud) must keep working. Charts and SSE are same-origin.

#### Later-phase sections
- **D-08:** The home "Next to bond" rail is hidden until Phase 5 adds burn budgets.
- **D-09:** The hero line shows launched and bonded counts from the indexer ("N coins launched, M bonded"). Phase 5 changes it to the "bonded by their own fees" wording.
- **D-10:** The token page "Bond and burn" panel shows curve progress only: curve fill %, the BONDR in the curve, "bonds at about X SOL", and the Bonded / PumpSwap state once migrated. Burn budget, the 24h window, the forced-bond story and the ledger come in Phase 5.
- **D-11:** No trade panel placeholder before Phase 4; the chart and trade feed take the full width.
- **D-11a (owner, at UI-SPEC review):** On wide screens the chart is full width; below it the trade feed takes the wide left column and the 380px Bond and burn panel sits right (Phase 4 puts the trade panel in that column). The hero second button is "See all coins". The header gets a "Launch a coin" link on every page.

#### Live list behavior
- **D-12:** Card numbers (market cap, 1h change, bond progress) update the moment a trade lands. Card positions re-rank at most once a minute, so nothing jumps under the cursor.
- **D-13:** Trending falls back when nothing traded in the last hour: 24h volume first, then the latest launches. The caption changes to match ("Ranked by volume in the last 24 hours").
- **D-14:** A new launch slides into the front of Latest live, without a reload.
- **D-15:** A trade flashes the changed numbers on the card briefly, green for a buy and red for a sell. No flash with prefers-reduced-motion.

#### Trade feed and chart
- **D-16:** The launch transaction's dev buy and its exit (insta sell or burn) appear in the trade feed labelled "Launch", and the chart starts at the launch price.
- **D-17:** The chart's default interval depends on coin age: 1m under 6 hours, 5m under 3 days, then 1h. The 1m / 5m / 1h / 1d buttons still switch.
- **D-18:** The trade feed shows the latest 50 trades, then "Load more". Each row: time, buy or sell (or Launch), SOL amount, token amount, short trader address, Solscan link. New trades are added at the top live.
- **D-19:** The holder count is recounted only for coins that traded, at most every 5 minutes per coin, so quiet coins cost no Helius credits.

#### Share card
- **D-20:** The OG card shows identity and proof only: coin image, name, ticker, "on BONDR", and the proof line ("Dev holds 0 launch supply, insta burned" or "sold"). No market cap or other number that goes stale in X's and Telegram's image caches.
- **D-21:** The card uses the site style: the token page's dark theme and fonts, coin image large on the left, text on the right.

### Claude's Discretion
- Indexer design: websocket subscription vs polling vs Helius webhooks, the backfill from each coin's launch signature, reorg and missed-slot handling, and how post-bond PumpSwap trades are caught. Must meet D-04 and D-05.
- Event decoding: reuse `@bondr/core/events` (emit_cpi inner instructions, never "Program data" logs).
- DB schema for trades, candles and rollups, with constraints and indexes; whether candles are stored or computed from trades.
- SSE architecture: one worker or web fan-out point so open browsers never poll Postgres; a shared Postgres NOTIFY or worker HTTP stream are both acceptable.
- Search implementation (name, symbol, mint), and pasting a full mint goes straight to that coin.
- Holder count method (which accounts to exclude: curve, pool, burn) and the price source for BONDR to SOL.
- A site-level share card for non-token pages if it costs a few lines.
- How coins from e2e test runs appear on staging.

### Deferred Ideas (OUT OF SCOPE)
- "Next to bond" rail, burn budget, 24h window, fee ledger and totals: Phase 5.
- Buy and sell panel: Phase 4.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIST-01 | Trending side-scroller ranked by quote volume in the last hour | `trades(at)` index + list SQL with `sum(sol) filter (where at > now()-1h)`; D-13 fallback computed in the same query; client decay rule (Pattern 7) |
| LIST-02 | Top list by market cap | `coins.mcap_sol` point value updated per trade; `order by mcap_sol desc` |
| LIST-03 | Latest and Oldest tabs, card grid | `coins.launched_at` with index; server-rendered first page, `?sort=` |
| LIST-04 | Card shows image, name, symbol, mcap, 1h change, bond progress, age; live | `coins` row + windowed SQL; SSE `trade` event carries the coin's new numbers (Pattern 5) |
| LIST-05 | Search by name, symbol or mint | `ILIKE` with escaped wildcards + mint prefix; no extension (Pattern 8) |
| TOKEN-01 | lightweight-charts with 1m/5m/1h/1d candles | Candles computed on read from `trades` (Pattern 6); `lightweight-charts@5.2.1` `addSeries(CandlestickSeries)`, `update()` (Code Examples) |
| TOKEN-02 | Live trade feed and holder count | `trades` keyset pagination; SSE; holder recount via `getProgramAccounts` memcmp, D-19 throttle (Pattern 9) |
| TOKEN-06 | Shared token links render an OG card | `app/coin/[mint]/opengraph-image.tsx` with `generateImageMetadata` for per-coin alt, static TTF instances read with `fs`, Pinata fetch with cap (Pattern 10) |
</phase_requirements>

## Project Constraints (from AGENTS.md)

No CLAUDE.md in the project; AGENTS.md is the operating manual. Directives the plan must honour:

- Ponytail `full`: delete before adding; stdlib and installed deps first; mark deliberate shortcuts with a `ponytail:` comment naming ceiling and upgrade path.
- No emoji anywhere (code, UI, commits, docs).
- Files under 300 lines, functions under 40 lines, three directory levels max; a directory with more than five files gets a README (`apps/web/components/README.md` must gain a line per new file; `apps/worker/src` and `packages/core/src` already exceed five files, check their READMEs).
- One runnable check per non-trivial change; Vitest for units, Playwright for e2e; no new test frameworks.
- Database constraints over application checks.
- Never break the build; commit after every green task on the phase branch (`phase-03-indexer-lists-and-token-page` is checked out).
- Never commit secrets; never print the Helius key (all errors through `redact()` in `core/net.ts`).
- Every UI phase ends with Playwright screenshots at 390/768/1440 and an axe audit.
- 14-day freshness rule for new dependencies (D-07; Phase 2 D-14). Pin exact versions.
- Web imports only `@bondr/core/{math,rules,db,schema,api,scrub,sig}` (Biome `noRestrictedImports` in `biome.json`), and no `@solana/*`, `@pump-fun/*`, `bn.js` in web. `scripts/check-client-bundle.sh` fails the build if program ids reach the client bundle.

## Summary

The worker becomes the indexer. It holds **one standard `logsSubscribe` websocket with `mentions: [BONDR mint]`** (every BONDR coin trade, on the curve or on PumpSwap, carries the BONDR quote mint as an instruction account), fetches each candidate transaction with the existing `fetchTx` (1 credit), decodes it with an extended `core/events.ts` (pump `TradeEvent`, `CompleteEvent`, `PostCompleteBuyEvent`, PumpSwap `BuyEvent`, `SellEvent`, `CreatePoolEvent`), and writes trades for known BONDR mints in one Postgres transaction per Solana transaction. Gap fill runs on every (re)connect and on every new coin: `getSignaturesForAddress(mint, { until: coin.last_sig })` per coin, through the same ingest function. The launch transaction is ingested directly from `settle.ts` when it lands, so D-16's "Launch" rows never depend on the stream. Standard `logsSubscribe` is on every Helius plan, costs 2 credits per 0.1 MB of streamed data, and works on Surfpool too, so the same code runs in local fork tests. Webhooks, LaserStream and polling are rejected (reasons in Alternatives).

Live updates flow **worker to web over a private NDJSON stream, and web to browsers over SSE**. Each web process holds one upstream connection, fans out to every `EventSource`, keeps a short replay ring keyed by event id, and sends a heartbeat. Postgres LISTEN/NOTIFY is rejected: Neon drops LISTEN subscriptions when it suspends, and re-subscribing wakes the compute. Railway's edge closes any HTTP request after 15 minutes (or 5 minutes without data), so the web route closes streams itself at about 14 minutes and the browser resumes with `Last-Event-ID` from the ring, without a database read.

Candles are **computed on read** from `trades` (no candle table): one SQL query per chart load, correct under out-of-order gap fill and replays, and zero extra writes. The `coins` row holds point-in-time values (venue, reserves, supply, market cap in SOL, last trade, holders); windowed values (1h and 24h volume, 1h change) are computed in SQL at read time. BONDR's SOL price lives in worker memory, seeded from chain at boot and updated from every BONDR trade the stream sees; each trade row stores the snapshot it was valued at.

**Primary recommendation:** extend what exists (`events.ts`, `fetchTx`, `settle.ts`, `http.ts`, `launches.ts`) and add exactly one npm dependency (`lightweight-charts@5.2.1`). Node 24's global `WebSocket` and hand-parsed NDJSON cover the stream; no `ws`, no SSE library, no extensions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chain subscription, tx fetch, event decode | Worker | core (pure decode) | Worker owns the Helius key and chain access (D-07, Phase 2 D-15) |
| Trade, coin, holder writes | Worker | Postgres constraints | Single writer; idempotency enforced by primary key |
| BONDR to SOL price | Worker (memory) | Trade row snapshot | Read on chain (D-01); snapshot makes history reproducible |
| Market cap, bond progress math | Worker via core | Pump SDK helpers | Needs `@pump-fun` SDK (web may not import it) |
| Lists, search, candles, feed pages | Web server (route handlers / RSC) | Postgres | Existing pattern: web reads Postgres for public data |
| Live fan-out | Web server (one hub per process) | Worker (one stream) | Browsers never touch Postgres or the worker directly (D-04) |
| Re-rank tick, flash, chart update | Browser | none | Pure presentation of pushed numbers (D-12, D-15) |
| OG card render | Web server (`next/og`) | Pinata gateway fetch | Satori runs server-side; CSP does not apply to server fetches |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lightweight-charts` | 5.2.1 (published 2026-08-12) | Candles + volume histogram | Locked by D-02 and UI-SPEC; Apache-2.0; one dependency `fancy-canvas@2.1.0` [VERIFIED: npm registry, slopcheck OK] |
| `@pump-fun/pump-sdk` | 4.1.0 (installed, pinned) | `decodeTradeEventBc`, `decodeCompleteEventBc`, `decodePostCompleteBuyEvent`, `decodeBuyEventAmm`, `decodeSellEventAmm`, `decodeCreatePoolEventAmm`, `bondingCurveMarketCap`, `bondingCurvePda` | Already the only pump load point (`core/pump.ts`) [VERIFIED: introspected installed package] |
| `@pump-fun/pump-swap-sdk` | 2.1.0 (installed, pinned) | `pumpAmmJson` (AMM IDL for event discriminators), `PUMP_AMM_EVENT_AUTHORITY_PDA`, `poolMarketCap`, `canonicalPumpPoolPdaWithQuote` | Same [VERIFIED: introspected installed package] |
| `@solana/web3.js` | 1.99.0 (installed) | `getTransaction`, `getSignaturesForAddress`, `getProgramAccounts` | Already used by `fetchTx` |
| Node 24 global `WebSocket` | Node 24.13 (installed) | `logsSubscribe` client | Stable global in Node 24 (`typeof WebSocket === "function"` verified locally); no `ws` dependency |
| `next/og` `ImageResponse` | built into next 16.3.8 | Share card | Locked in UI-SPEC; no new dependency [VERIFIED: bundled docs] |
| Postgres via `drizzle-orm` 0.45.3 / `postgres` 3.4.9 | installed | Tables, raw SQL for windowed queries | Existing |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `uvx --from fonttools fonttools varLib.instancer` | One-time static TTF instances of Big Shoulders (wght 800) and Schibsted Grotesk (400, 600) for Satori | Wave 0 asset prep; output committed with `OFL.txt`. `uv` is installed. Not a project dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `logsSubscribe` + `getTransaction` | Helius `transactionSubscribe` (Enhanced WebSockets, included on Developer) | Saves the 1-credit fetch, but Helius-only (no Surfpool tests), a different payload shape (base64 wire + meta) needing an adapter, and no reconnect story that differs. Switch only if credits exceed 80% |
| logs stream | Helius webhooks | Needs a public ingress (worker is private), 100 credits per webhook edit, retries and auth. Rejected |
| logs stream | LaserStream gRPC | Mainnet needs Business ($499); Developer gets devnet only [CITED: helius.dev/docs/billing/plans]. Rejected |
| logs stream | Polling `getSignaturesForAddress` per coin | A chain timer per coin, seconds of latency, credits grow with coin count. Kept only as the gap-fill mechanism |
| Worker NDJSON stream to web | Postgres LISTEN/NOTIFY | Neon loses LISTEN on suspend and re-LISTEN wakes compute [CITED: neon.com/docs/introduction/compute-lifecycle]. Rejected |
| Candles on read | Stored candle rows upserted per trade | Four upserts per trade and broken open/close on out-of-order gap fill. Upgrade only if one coin exceeds ~100k trades |
| `getProgramAccounts` (10 credits) | Helius `getProgramAccountsV2` (1 credit, paginated) or DAS `getTokenAccounts` (10 credits, 1000/page) | V2 is Helius-only; switch if holder recounts become a credit problem. DAS is no cheaper |
| `ILIKE` | `pg_trgm` | Unneeded below tens of thousands of coins |

**Installation:**
```bash
pnpm --filter @bondr/web add lightweight-charts@5.2.1 --save-exact
```

**Version verification:** `npm view lightweight-charts@5.2.1` returned version 5.2.1, dependency `fancy-canvas 2.1.0`, license Apache-2.0, published 2026-08-12T11:37:41Z (72 days before 2026-10-23, passes the 14-day rule). The production bundle references only `https://www.tradingview.com/` (attribution link), the Apache license URL and the SVG namespace (grep of `lightweight-charts.production.mjs`).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| lightweight-charts | npm | 5.2.1 is 72 days; package since 2019 | not measured | github.com/tradingview/lightweight-charts | [OK] | Approved (pin 5.2.1) |
| fancy-canvas | npm | 2.1.0 from 2022 (transitive) | not measured | none linked (slopcheck note) | [OK] | Approved as transitive of lightweight-charts |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
slopcheck ran as `slopcheck scan` on a scratch package.json (the `install` subcommand would have installed). No postinstall scripts (`npm view lightweight-charts@5.2.1 scripts` is empty).

## Architecture Patterns

### System Architecture Diagram

```
 Helius devnet/mainnet WSS                     Helius HTTP RPC
   logsSubscribe(mentions:[BONDR])              getTransaction / getSignaturesForAddress / getProgramAccounts
            |                                              ^
            v                                              |
 +---------------------------------- WORKER (private) -------------------------------------+
 |  stream.ts: WebSocket, ping 30s, backoff reconnect --(on open)--> gapFill(all coins)    |
 |     | notification {signature, err, logs}                                                |
 |     | skip if err or logs lack a pump/PumpSwap invoke                                     |
 |     v                                                                                     |
 |  ingest(sig) = fetchTx -> parseTx (core/trades.ts, pure) -> rows for KNOWN mints only   |
 |     |            ^                        |                                               |
 |     |            | settle.ts landed() ----+ (launch tx: CreateEvent, Launch rows, coin)   |
 |     |            | registerCoin -> gapFill(mint)                                          |
 |     v                                                                                     |
 |  BONDR price (memory) <- BONDR TradeEvent / pool event in any tx; boot read from chain  |
 |     v                                                                                     |
 |  one DB transaction: insert trades ON CONFLICT DO NOTHING, update coins row              |
 |     v (only if rows were inserted)                                                        |
 |  publish(event) -> in-process subscribers -> GET /events (NDJSON, bearer, heartbeat)    |
 |  holders: per-coin timer armed by a trade, >= 5 min apart -> getProgramAccounts -> DB   |
 +-------------------------------------------|---------------------------------------------+
                                             | Railway private network, one connection per web process
                                             v
 +---------------------------------- WEB (public, Next 16) -----------------------------------+
 |  lib/live-hub.ts: upstream fetch, NDJSON parse, ring buffer (ids), epoch, Set<client>     |
 |  app/api/live/route.ts: SSE ReadableStream, ?mint= filter, Last-Event-ID replay,          |
 |                         heartbeat 20s, self-close ~14 min, resync event on gap            |
 |  app/page.tsx, app/api/coins: list SQL (short per-process cache) ------> Postgres (Neon)  |
 |  app/coin/[mint]: coin row + 50 trades; api/coin/[mint]/{trades,candles} -> Postgres      |
 |  app/coin/[mint]/opengraph-image.tsx: launch row + Pinata image + local TTF -> PNG        |
 +---------------------------------------------|----------------------------------------------+
                                               v
                       Browser: EventSource(/api/live) -> cards, feed, chart.update()
```

### Recommended Project Structure (new and changed files)
```
packages/core/src/
  events.ts          # extend: PumpSwap program + authority, AMM decoders, PostCompleteBuyEvent
  pump.ts            # export pumpAmmJson, PUMP_AMM_EVENT_AUTHORITY_PDA, bondingCurveMarketCap, poolMarketCap
  trades.ts          # NEW pure: parseTx(tx, coins, bondrSol) -> {trades, coinPatch, bondr}
  price.ts           # NEW pure bigint/number math: progress, bondrAtBond, toSol; worker-side only (imports SDK helpers)
  schema.ts          # add coins, trades
  api.ts             # add CoinRow, TradeRow, LiveEvent, Candle types (types only)
  net.ts             # add wsUrl(net) (same redact rules)
  migrations/0003_*.sql
apps/worker/src/
  stream.ts          # NEW websocket client + reconnect + gap fill trigger
  ingest.ts          # NEW fetch -> parse -> write -> publish; registerCoin; gapFill
  bondr-price.ts     # NEW boot read + in-memory price
  holders.ts         # NEW throttled recount
  events-route.ts    # NEW publish/subscribe + GET /events NDJSON writer
  settle.ts          # landed(): call ingestLaunch(tx)
  http.ts / main.ts  # wire the stream route and start the indexer
apps/web/
  lib/live-hub.ts, lib/use-live.ts, lib/coins.ts (list/search SQL), lib/trades.ts (feed/candles SQL)
  app/page.tsx, app/api/live/route.ts, app/api/coins/route.ts,
  app/api/coin/[mint]/trades/route.ts, app/api/coin/[mint]/candles/route.ts
  app/coin/[mint]/opengraph-image.tsx, app/opengraph-image.tsx, assets/og/*.ttf + OFL.txt
  components/ (per UI-SPEC inventory)
scripts/
  devnet-trades.ts   # NEW devnet trade generator for tests (curve buy/sell, optional complete + pool trade)
  capture-tx.ts      # NEW save a devnet tx as a Vitest fixture
```

### Pattern 1: One BONDR-mint log subscription, fetch, decode
**What:** `logsSubscribe({ mentions: [Q] }, { commitment: "confirmed" })` on `wss://devnet.helius-rpc.com/?api-key=...`. Every BONDR coin trade names the quote mint as an account: `buy_v3`, `sell_v3`, `buy_exact_quote_in_v3` list `quote_mint`; PumpSwap `buy_v2`/`sell_v2` list `quote_mint` [VERIFIED: pump IDL instruction accounts introspected from installed SDKs]. `mentions` accepts exactly one address [CITED: solana.com/docs/rpc/websocket/logssubscribe], so the static BONDR mint is the right key and no resubscribe is needed when a coin launches.
**Address lookup tables:** Agave's log collector matches `transaction.account_keys()`, which for v0 messages includes lookup-table-loaded addresses [VERIFIED: anza-xyz/agave master `runtime/src/bank.rs` `collect_transaction_logs`]. Helius serves the standard methods from its own backend, so the Wave 0 probe must confirm a launch tx (which loads keys from its per-coin table) is notified.
**Pre-filter:** skip notifications with `err !== null`, and skip when no log line contains `Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke` or `Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke` (plain BONDR transfers). If the logs contain "Log truncated", fetch anyway.
**Keepalive:** Helius closes websockets after 10 minutes of inactivity and recommends a ping at least once a minute; the JSON-RPC `{"jsonrpc":"2.0","id":n,"method":"ping"}` message is their browser-style example [CITED: helius.dev/docs/enhanced-websockets]. Send it every 30 s.
**Reconnect:** exponential backoff with jitter (1 s to 30 s); on every open: resubscribe, then `gapFill()` over all coins. Subscribe before gap fill so nothing falls between.

### Pattern 2: Ingest is one idempotent function
```
ingest(sig): tx = fetchTx(conn, sig); if !tx return
  r = parseTx(tx, knownCoins, bondrPrice)          // pure, unit-tested on fixtures
  if r.bondr: bondrPrice.set(r.bondr)              // memory only, never written
  if !r.trades.length && !r.coinPatches.length: return
  inserted = db.transaction(insert trades ON CONFLICT (signature, ix) DO NOTHING RETURNING ...;
                            update coins set ... where mint = ... (only for inserted rows))
  if inserted.length: publish(trade events); holders.touch(mint)
```
Callers: the stream, `gapFill`, `settle.ts` (launch). Same code path everywhere, so replays and overlaps are harmless.

### Pattern 3: Coin registry and gap fill
- `knownCoins: Map<mint, {pool, bondingCurve, ...}>` loaded at boot from `coins` (one query). Trades for any other mint are ignored (D-03; other people can create BONDR-quoted coins).
- `registerCoin` runs inside `settle.ts landed()` after facts: insert the `coins` row from the launch tx's `CreateEvent`, write the Launch trades (Pattern 4), add to the map, then `gapFill(mint)` to catch a sniper trade that the stream saw before the coin was known.
- `gapFill(mint)`: `getSignaturesForAddress(mint, { until: coin.last_sig, limit: 1000 }, "confirmed")`, page with `before`, reverse to oldest-first, skip `err`, `ingest` each, paced under the 50 req/s Developer limit [CITED: helius.dev/docs/billing/plans]. `coins.last_sig` is updated in the same transaction as each trade insert, so there is no separate cursor write.
- The pool trade of a coin is mapped to its mint through `coins.pool = canonicalPumpPoolPdaWithQuote(mint, Q)`, computed at registration (deterministic; `trade.ts` already uses it). PumpSwap `BuyEvent` and `SellEvent` carry `pool`, not the base mint [VERIFIED: AMM IDL fields].

### Pattern 4: Launch rows (D-16)
The launch tx contains, in order: a BONDR curve `TradeEvent` (SOL to BONDR, `mint = Q`), the child `CreateEvent`, the child dev-buy `TradeEvent`, then the exit: a child sell `TradeEvent` plus a BONDR sell (insta sell), or a Token-2022 burn with no event (insta burn). Every child event in the launch signature gets `launch = true`. For the burn exit, add one synthetic row `side = 'burn'`, `token_amount` = the dev buy's `tokenAmount`, `sol = null`, `ix` = a fixed value past the event indexes (for example 1000). `launch_mcap_sol` on the coin is the CreateEvent's initial virtual reserves priced at the BONDR price in the same tx; the chart's first candle opens there.

### Pattern 5: SSE fan-out (worker NDJSON, web hub, browser EventSource)
- Worker `GET /events` (bearer, same `authorized()`): `content-type: application/x-ndjson`, one JSON object per line, `{"id":"<epoch>-<seq>","type":"trade"|"launch"|"bond"|"holders","data":{...}}`, plus `{"type":"ping"}` every 15 s. `epoch` is the worker boot time, so a restart is visible to web.
- Web `lib/live-hub.ts` (module singleton on `globalThis` so dev HMR does not open duplicates): `fetch(WORKER_URL + "/events")` without `AbortSignal.timeout`, parse lines from `res.body`, push into a ring of the last 2,000 events, fan out to subscribers. On upstream error: backoff reconnect, then emit `resync` to every client.
- Web `app/api/live/route.ts`: `export const dynamic = "force-dynamic"`; returns `new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } })`. `no-transform` matters: Next's bundled `compression` skips responses with `Cache-Control: no-transform` [VERIFIED: regex in next/dist/compiled/compression], otherwise gzip buffers events. Write a 2 KB comment first (Safari buffers the first 1024 bytes [CITED: next 16 docs, guides/streaming]). Optional `?mint=` filters server-side. On `Last-Event-ID` inside the ring and same epoch: replay; else send `event: resync`. Close each stream after about 14 minutes with `retry: 1000`: Railway closes HTTP requests at 15 minutes even with data, and after 5 minutes without data [CITED: docs.railway.com/networking/public-networking/specs-and-limits]. Unsubscribe in the stream's `cancel()`.
- Browser `lib/use-live.ts`: one `EventSource`, typed handlers; on `resync` or `error`-then-`open` after an epoch change, refetch once (UI-SPEC "on reconnect the page refetches the visible list once"). The 14-minute rollover replays from the ring, so it does not refetch.
- **Budget effect:** N open browsers cost zero database reads after their first render. Refetches happen only on real gaps (worker or web restart).

### Pattern 6: Candles computed on read
One query per chart load and interval switch, cached per process for 10 s per (mint, interval):
```sql
-- $1 mint, $2 bucket seconds, $3 launch mcap
with t as (
  select at, slot, seq, mcap_sol, coalesce(sol, 0) as sol,
         coalesce(lag(mcap_sol) over (order by slot, seq), $3) as prev
  from trades where mint = $1 and side <> 'burn'
)
select (floor(extract(epoch from at) / $2) * $2)::bigint as time,
       (array_agg(prev order by slot, seq))[1] as open,
       greatest(max(mcap_sol), max(prev)) as high,
       least(min(mcap_sol), min(prev)) as low,
       (array_agg(mcap_sol order by slot desc, seq desc))[1] as close,
       sum(sol) as volume
from t group by 1 order by 1;
```
Open is the previous trade's market cap, so candles are continuous and the first opens at the launch price (D-16). `ponytail:` it scans every trade of the coin; store rollups when one coin passes about 100k trades. The browser applies SSE trades with `series.update(bar)`; a bar older than the last is dropped (or `update(bar, true)` historical update, available in 5.2.1 typings).

### Pattern 7: Lists with windowed values at read time
```sql
select c.*, l.name, l.symbol, l.image_cid,
  coalesce(sum(t.sol) filter (where t.at > now() - interval '1 hour'), 0) as vol1h,
  coalesce(sum(t.sol), 0) as vol24h,
  (select p.mcap_sol from trades p where p.mint = c.mint and p.at <= now() - interval '1 hour'
     and p.side <> 'burn' order by p.slot desc, p.seq desc limit 1) as mcap_1h_ago
from coins c join launches l on l.id = c.launch_id
left join trades t on t.mint = c.mint and t.at > now() - interval '24 hours' and t.side <> 'burn'
group by c.mint, l.id
```
`change1h = mcap_sol / coalesce(mcap_1h_ago, launch_mcap_sol) - 1`. Trending mode (D-13) is decided from the same rows. The SSE `trade` event carries the coin's new `mcap_sol`, `progress`, `venue`, `vol1h`, `vol24h`, `change1h`; the worker computes the three windowed values with the same SQL for that one mint right after its write (the database is awake anyway; this is a read on a trade, not on a timer).
**Client decay rule (no timer reads):** a coin whose `lastTradeAt` is older than 1 h has `vol1h = 0` (older than 24 h: `vol24h = 0`). That makes the D-13 mode switch exact on the 60 s client tick. `ponytail:` partial decay among active coins applies on the next refetch; upgrade is a worker-memory window plus a once-a-minute tick event.
Web caches each (sort, q, page) result for 10 s per process (the Phase 2 coin-page cache pattern), so crawlers and bursts collapse to one query.

### Pattern 8: Search
- Input trimmed, at most 64 characters; 1 character does nothing (UI-SPEC).
- Escape `\`, `%`, `_` before building the pattern; `where l.name ilike $p escape '\' or l.symbol ilike $p escape '\' or c.mint like $q || '%'` with parameters, never string concatenation.
- A full base58 32-44 match against `BASE58_KEY` (`lib/guard.ts`) that equals a coin's mint: the client navigates to `/coin/{mint}`; no match: the mint empty state.
- Neon supports `pg_trgm`, but a sequential scan of a few thousand rows is microseconds. Skip the extension.

### Pattern 9: Holder count (D-19)
- `holders.touch(mint)` on every inserted trade: if a recount is already scheduled, nothing; else schedule at `max(now, holders_at + 5 min)`. Quiet coins have no timer.
- Count: `conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint } }], dataSlice: { offset: 32, length: 40 } })`. Bytes 0-32 of the slice are the owner, 32-40 the u64 amount (SPL account base layout; Token-2022 keeps it). Count `amount > 0` whose owner is not the bonding curve PDA, the pool PDA, or the incinerator `1nc1nerator11111111111111111111111111111111`. Burns destroy supply, so there is no burn holder to exclude; W holds 0 child tokens by design.
- Cost: 10 credits per call [CITED: helius.dev/docs/billing/credits]. At 10 coins trading all month, 10 x 288 x 30 x 10 = 864k credits (under 9% of 10M). `ponytail:` switch to Helius `getProgramAccountsV2` (1 credit) if credits pass 80%.
- Write `coins.holders, holders_at`, then publish a `holders` event.

### Pattern 10: OG card in Next 16
- `app/coin/[mint]/opengraph-image.tsx` exports `size`, `contentType`, and `generateImageMetadata({ params })` returning `[{ id: "card", alt: "{Name} ({SYMBOL}) on BONDR. Dev holds 0 launch supply.", size, contentType }]`, because the static `export const alt` cannot vary per coin [CITED: next 16 bundled docs, generate-image-metadata.md]. The URL becomes `/coin/{mint}/opengraph-image/card`; Next still emits `og:image` and `twitter:image`.
- Fonts: TTF read with `readFile(join(process.cwd(), "assets/og/...ttf"))` (Node runtime). Satori reads TTF, OTF and WOFF, not WOFF2 [CITED: next 16 docs image-response.md]. Google Fonts ships only variable TTFs for both families [VERIFIED: github.com/google/fonts ofl/bigshoulders, ofl/schibstedgrotesk]; make static instances with fonttools (Big Shoulders wght 800, opsz default; Schibsted 400 and 600) and commit them with `OFL.txt`.
- Cache: `ImageResponse` defaults to `public, immutable, no-transform, max-age=31536000` in production and spreads `options.headers` after it [VERIFIED: next/dist/compiled/@vercel/og/index.node.js]. For an unknown mint, return the site card with `headers: { "cache-control": "public, max-age=300" }` so a card fetched before indexing is not frozen for a year.
- Image: server `fetch("https://" + PINATA_GATEWAY + "/ipfs/" + cid)` only when `cid` passes `/^[A-Za-z0-9]+$/`, `AbortSignal.timeout(5000)`, reject over 2 MB, accept `image/png|jpeg|gif` and pass as an `ArrayBuffer` data URI; anything else renders the letter fallback (UI-SPEC).
- Page metadata: `metadataBase: new URL(process.env.SITE_URL)` in the root layout; add `SITE_URL` to `WEB_ENV` and to staging web variables.
- Site card `app/opengraph-image.tsx`: the hero JPEG read from `public/art/`, same fonts.

### Anti-Patterns to Avoid
- **Parsing "Program data:" logs:** truncated on large txs; `events.ts` already refuses this. Always decode the emit_cpi inner instruction from the fetched tx.
- **Reading `solAmount` from a BONDR-quoted TradeEvent:** it is 0 for quote-mint coins; use `quoteAmount`, `virtualQuoteReserves`, `realQuoteReserves` [VERIFIED: decoded `forced-bond.json` fixture: `solAmount "0"`, `quoteAmount "119871667944226"`].
- **A held Postgres LISTEN, a polling loop over Postgres, or a per-browser DB query on reconnect** (D-04).
- **Reusing `worker.ts call()` for the stream:** its 15 s `AbortSignal.timeout` would kill it.
- **`next/image` for coin images:** web WR-07; UI-SPEC says plain `<img>`.
- **Importing `lightweight-charts` at module scope of a server component:** use `next/dynamic(..., { ssr: false })` from a client component.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event decoding | Borsh layouts for pump and PumpSwap events | `PUMP_SDK.decode*` (already in `events.ts`), discriminators from `pumpIdl` / `pumpAmmJson` | Pump changes layouts; the SDK pads older ones |
| Curve market cap | Own formula | `bondingCurveMarketCap({ mintSupply, virtualQuoteReserves, virtualTokenReserves })` | Exported by pump-sdk 4.1.0 [VERIFIED] |
| Pool market cap | Own formula | `poolMarketCap({ baseMintSupply, baseReserve, quoteReserve })` with `quoteReserve = poolQuote + pool.virtualQuoteReserves` | The SDK's own swap math adds `virtualQuoteReserves` (`poolHopAmountOut`) [VERIFIED: pump-swap-sdk dist] |
| Pool PDA | Seed math | `canonicalPumpPoolPdaWithQuote(mint, Q)` | Already used by `trade.ts` |
| Tx fetch with retry | New fetcher | `fetchTx` in `core/send.ts` | 20 x 500 ms retry, v0 support |
| Chart | Canvas/SVG chart | `lightweight-charts` | D-02 |
| SSE client reconnect | Custom retry loop | Browser `EventSource` (auto-reconnect, `Last-Event-ID`) | Native |
| Websocket | `ws` package | Node 24 global `WebSocket` | Already in the runtime; JSON-RPC ping works without protocol ping frames |
| Rate limiting | New limiter | `rateLimited()` in `lib/guard.ts` + `proxy.ts` matcher | Existing |

**Key insight:** every chain fact the indexer needs is already decoded by the pinned SDKs; new code is plumbing (subscribe, idempotent write, fan-out), not math.

## Data Model (migration 0003)

```
coins
  mint text PK references vanity_mints(pubkey)
  launch_id text not null unique references launches(id)
  launched_at timestamptz not null              -- landed_at of the launch
  bonding_curve text not null, pool text not null
  venue text not null default 'curve' check (venue in ('curve','complete','pool'))
  supply bigint not null check (supply > 0)     -- mint supply after the launch exit (see Open Question 1)
  initial_real_token_reserves bigint not null   -- from CreateEvent (793.1M x 1e6 on mainnet)
  real_token_reserves bigint not null, real_quote_reserves bigint not null
  virtual_token_reserves bigint not null, virtual_quote_reserves numeric not null
  mcap_sol double precision not null, launch_mcap_sol double precision not null
  last_trade_at timestamptz, last_sig text
  holders integer check (holders >= 0), holders_at timestamptz
  bond_sig text, bonded_at timestamptz
  check ((venue = 'curve') = (bonded_at is null))
  index (launched_at desc), index (mcap_sol desc)

trades
  signature text, ix smallint, primary key (signature, ix)   -- idempotency
  seq bigint generated always as identity                     -- ingestion order inside a slot
  mint text not null references coins(mint)
  slot bigint not null, at timestamptz not null               -- event timestamp (block time)
  side text not null check (side in ('buy','sell','burn'))
  launch boolean not null default false
  venue text not null check (venue in ('curve','pool'))
  trader text not null
  token_amount bigint not null check (token_amount > 0)
  quote_amount bigint                                          -- BONDR base units; null for burn
  sol bigint                                                   -- lamports at the snapshot; null for burn
  bondr_sol double precision                                   -- lamports per BONDR base unit used
  mcap_sol double precision                                    -- post-trade; null for burn
  check ((side = 'burn') = (sol is null))
  index (mint, slot desc, seq desc)    -- feed keyset + candles
  index (at)                           -- 24h window for lists
```
Feed pagination is keyset (`where (slot, seq) < ($slot, $seq)` limit 50), never offset. Generate with `pnpm --filter @bondr/core exec drizzle-kit generate --name indexer` (the root `db:generate` script hard-codes `--name init`).

## Prices, Market Cap and Progress (pure core functions, unit-tested)

Units: child and BONDR both have 6 decimals; SOL has 9.
- **BONDR price** (lamports per BONDR base unit): on its curve `vQ_sol / vT` from a BONDR `TradeEvent` (post-trade reserves; the launch fixture shows `virtualSolReserves 30493827159 = 30e9 + 493827159`, so TradeEvent reserves are post-trade [VERIFIED: fixture]). After BONDR migrates: `(poolQuote + virtualQuote) / poolBase` from the BONDR/SOL pool. Boot seed: `online.fetchBondingCurve(Q)`, or `poolState(...)` when complete (both already used in `status.ts`).
- **Child price in BONDR** = `virtualQuoteReserves / virtualTokenReserves` (curve), pool formula after migration.
- **Market cap in SOL** = SDK market cap in BONDR base units x BONDR price / 1e9.
- **Trade SOL value** = `quoteAmount x bondrSol`; when the same tx has a BONDR event (multi-hop, launch), use that event's price.
- **Bond progress** = `1 - realTokenReserves / initial_real_token_reserves`, capped at 1.
- **BONDR at bond** (`bondrAtBond`): constant product on virtual reserves, `k = vQ x vT`, `vT_end = vT - realTokenReserves`, `bondrAtBond = realQuoteReserves + k / vT_end - vQ`. Checked against the fork forced-bond fixture: at completion `virtualTokenReserves = 279.9e12 = 1073e12 - 793.1e12` [VERIFIED: fixture decode]. `{bondSol}` = that times the current BONDR price.
- **Pool reserves after a PumpSwap trade:** read `postTokenBalances` where `owner = pool` for base and quote mints (exact regardless of whether the event's `pool_*_token_reserves` are pre- or post-trade), plus `virtual_quote_reserves` from the event.
- **Migration:** `CompleteEvent` sets `venue = 'complete'`, `bond_sig`, `bonded_at`; PumpSwap `CreatePoolEvent` with `base_mint` = coin sets `venue = 'pool'`. The SDK has no decoder for pump's `CompletePumpAmmMigrationEvent`, so use `decodeCreatePoolEventAmm` [VERIFIED: SDK introspection].
- **PostCompleteBuyEvent** (synthetic migration fill, seen in the forced-bond fixture, currently undecoded) is a buy: `base_out`, `quote_in`, `pool_*_reserves_after`. Add the SDK decoder `decodePostCompleteBuyEvent` and record it as `venue = 'pool'`.

## Common Pitfalls

### Pitfall 1: Neon branches share one quota
**What goes wrong:** the dev branch (local worker) and staging branch each stay awake for 5 minutes after every trade. A steady trader on both all day costs 0.25 CU x 730 h = 182 CU-h per branch.
**How to avoid:** the local worker runs the indexer only when started; staging devnet traffic is test traffic. Watch Neon usage after the first staging week. Never start the indexer in Vitest.
**Warning signs:** Neon console compute hours rising on a quiet week.

### Pitfall 2: Railway 15-minute HTTP cap and undici body timeout
**What goes wrong:** browser streams end at 15 minutes; the web-to-worker fetch dies after 300 s without a chunk (undici `bodyTimeout` default) [ASSUMED: undici default 300 s].
**How to avoid:** web closes browser streams at ~14 min and replays from the ring; worker writes a ping line every 15 s; web heartbeats every 20 s.

### Pitfall 3: Stream sees a trade before the coin is known
**What goes wrong:** a sniper buy in the slot after the launch arrives before `settle.ts` marks the launch landed, and is dropped as an unknown mint.
**How to avoid:** `registerCoin` always runs `gapFill(mint)` from the launch.

### Pitfall 4: Trades out of order within a slot
**What goes wrong:** `getTransaction` does not give a position in the block; gap fill inserts old trades after new ones.
**How to avoid:** order by `(slot, seq)` everywhere; candles computed on read, so late inserts heal on the next load.

### Pitfall 5: Reorgs
**What goes wrong:** a `confirmed` slot that later does not finalize.
**How to avoid:** use `confirmed` (supermajority-voted) for liveness; rollback of a confirmed block is not expected in practice [ASSUMED]. `ponytail:` no rollback handling; idempotent keys keep a re-ingest safe. Finalized would add about 13 s of latency to every live update.

### Pitfall 6: LIKE wildcards in search
**What goes wrong:** a query of `%` or `_` matches everything.
**How to avoid:** escape, parameterize, cap length.

### Pitfall 7: Satori runtime fetches for emoji and non-Latin glyphs
**What goes wrong:** coin names with emoji or CJK make `next/og` fetch from `cdn.jsdelivr.net` and `fonts.googleapis.com` at render time [VERIFIED: URLs in next/dist/compiled/@vercel/og/index.node.js]. Server-side, so CSP is not involved, but it is an external fetch D-07 wanted to avoid, and it can fail.
**How to avoid:** accept it (failure falls back to missing glyphs), or strip non-Latin graphemes from the card text. Recommend accept and note.

### Pitfall 8: Variable fonts in Satori
**What goes wrong:** the Google Fonts TTFs are variable; Satori is not documented to apply weight axes [ASSUMED].
**How to avoid:** commit static instances made with fonttools.

### Pitfall 9: Devnet has almost no organic trades
**How to avoid:** `scripts/devnet-trades.ts` drives buys and sells on a staging coin with the sim wallet (BONDR from Q's curve, then the child) using `core/trade.ts`. Devnet curves are about 1/100 of mainnet (min dev buy 0.0025 SOL vs 0.25), so completing a child curve to test pool trades should be cheap; measure it in Wave 0.

### Pitfall 10: Pump program changes
**What goes wrong:** a new TradeEvent layout or instruction version.
**How to avoid:** decode only through the pinned SDK; log (via `redact`) and Sentry any `unknown:` event name seen on a known coin's tx; never crash the stream on a decode error.

### Pitfall 11: Next dev HMR duplicates the hub
**How to avoid:** store the hub on `globalThis`.

### Pitfall 12: proxy rate limits
`proxy.ts` matches only `/coin/:mint`, `/api/launch/:id`, `/api/status`. Add `/`, `/api/coins`, `/api/coin/:path*`, and `/api/live` with its own scope (for example 30 connects a minute per IP) so reconnect storms and scrapers are bounded.

## Code Examples

### Worker websocket (Node 24 global WebSocket)
```ts
// Source: Helius ping guidance (helius.dev/docs/enhanced-websockets); logsSubscribe (solana.com/docs/rpc/websocket/logssubscribe)
const ws = new WebSocket(wsUrl(net));
ws.onopen = () => {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe",
    params: [{ mentions: [Q.toBase58()] }, { commitment: "confirmed" }] }));
  ping = setInterval(() => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })), 30_000);
  void gapFillAll();
};
ws.onmessage = (m) => {
  const v = JSON.parse(String(m.data))?.params?.result?.value;
  if (v && v.err === null && v.logs.some(isPumpInvoke)) queue.push(v.signature);
};
ws.onclose = () => { clearInterval(ping); setTimeout(connect, backoff()); };
```

### Event decoding extension
```ts
// Source: installed SDKs (pumpAmmJson, PUMP_AMM_EVENT_AUTHORITY_PDA, PUMP_SDK.decode*Amm)
const PROGRAMS = [
  { program: PUMP_PROGRAM_ID, authority: PUMP_EVENT_AUTHORITY_PDA, idl: pumpIdl },
  { program: PUMP_AMM_PROGRAM_ID, authority: PUMP_AMM_EVENT_AUTHORITY_PDA, idl: pumpAmmJson },
];
const DECODE = {
  ...existing,
  PostCompleteBuyEvent: (b) => PUMP_SDK.decodePostCompleteBuyEvent(b),
  BuyEvent: (b) => PUMP_SDK.decodeBuyEventAmm(b),
  SellEvent: (b) => PUMP_SDK.decodeSellEventAmm(b),
  CreatePoolEvent: (b) => PUMP_SDK.decodeCreatePoolEventAmm(b),
};
```
Discriminators (hex, from `pumpAmmJson`): BuyEvent `67f4521f2cf57777`, SellEvent `3e2f370aa503dc2a`, CreatePoolEvent `b1310cd2a076a774`. Key the name map by program as well as discriminator.

### lightweight-charts 5.2.1
```ts
// Source: lightweight-charts 5.2.1 typings.d.ts (createChart, addSeries, update, createSeriesMarkers, attributionLogo)
import { CandlestickSeries, createChart, createSeriesMarkers, HistogramSeries } from "lightweight-charts";
const chart = createChart(el, { autoSize: true, layout: { attributionLogo: true, background: { type: "solid", color: "transparent" } } });
const candles = chart.addSeries(CandlestickSeries, { priceFormat: { type: "custom", formatter: mcapSol, minMove: 0.01 } });
const volume = chart.addSeries(HistogramSeries, { priceScaleId: "" });
volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
candles.setData(rows);                 // time: UTCTimestamp seconds, ascending, unique
candles.update(lastBar);               // same time replaces, newer appends
createSeriesMarkers(candles, [{ time: bondTime, position: "aboveBar", shape: "arrowDown", text: "Bonded" }]);
// unmount: chart.remove()
```

### SSE route
```ts
// Source: next 16 bundled docs guides/streaming.md (ReadableStream in route handlers)
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  let off = () => {};
  const stream = new ReadableStream({
    start(c) { off = hub.subscribe(c, { mint, lastId: req.headers.get("last-event-id") }); },
    cancel() { off(); },
  });
  return new Response(stream, { headers: {
    "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `chart.addCandlestickSeries()` | `chart.addSeries(CandlestickSeries)` | lightweight-charts 5.0 | v4 examples online are wrong for 5.2.1 |
| `series.setMarkers()` | `createSeriesMarkers(series, markers)` plugin | 5.0 | Same |
| Next `middleware.ts` | `proxy.ts` (already in repo) | Next 16 | Matchers live in `proxy.ts` |
| Pump TradeEvent `sol_amount` | `quote_amount` + `quote_mint` for coin-quoted curves | pump v3 curves | `solAmount` is 0 for BONDR coins |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Helius's standard `logsSubscribe` matches a mint loaded from an address lookup table (Agave does) | Pattern 1 | Trades via ALT-heavy routers missed live; gap fill by mint still catches them on reconnect only. Fallback: `transactionSubscribe` or per-coin mentions. Wave 0 probe |
| A2 | `getSignaturesForAddress(mint)` returns pool and multi-hop trades of the coin (mint is an account in both) | Pattern 3 | Gap fill misses them. Wave 0 probe with a devnet multi-hop |
| A3 | A `confirmed` block is not rolled back in practice | Pitfall 5 | Rare phantom trade row |
| A4 | undici `bodyTimeout` defaults to 300 s | Pitfall 2 | Upstream drops sooner; heartbeat covers any value above 15 s |
| A5 | Satori does not honour variable font weights | Pattern 10 | Only extra work; static instances are safe either way |
| A6 | Railway private networking (web to worker) has no 15-minute cap | Pattern 5 | Hub reconnects every 15 min and emits resync, causing refetches; fix by having the worker end streams at 14 min too |
| A7 | Event `quoteAmount` (net of fees) is the right "SOL amount" for the feed and volume | Prices | Displayed amounts differ from gross by about 2.45% on the curve |
| A8 | Completing a devnet child curve is cheap enough for a pool-trade e2e | Pitfall 9 | Pool path tested only by fixture |

## Open Questions (RESOLVED)

1. **Market cap supply (owner decision).** Pump.fun-style market cap uses the full 1B supply; PumpSwap's own `poolMarketCap` uses the live mint supply. BONDR coins burn at launch (insta burn) and, in Phase 5, up to about 80% of supply at a forced bond. With 1B, the market cap overstates burned coins; with live supply, a forced bond shows a large step down that is real.
   - Recommendation: live supply (`getTokenSupply` once per launch ingest, 1 credit; Phase 5 updates it after its own burns). The schema above stores `supply` either way.
   - **Owner decision (2026-10-23): fixed 1B supply** (D-22 in CONTEXT.md). Market cap = price x 1,000,000,000 on both curve and pool, so numbers match pump.fun and other trackers. Do not use `poolMarketCap` with live supply; use the 1B constant.
2. **Probe results A1, A2, A8.** Plan a Wave 0 task: run the stream against devnet, launch one coin through the existing `scripts/devnet-launch.ts`, run one `devnet-trades.ts` buy and sell, and assert all three are notified and appear in `getSignaturesForAddress(mint)`; capture each as a fixture. RESOLVED: planned as the 03-01 stream probe.
3. **PumpSwap event reserve semantics.** Avoided by reading `postTokenBalances`; confirm on the captured pool fixture that the computed price matches the pool account after the trade. RESOLVED: 03-02 reads postTokenBalances and checks it on the pool fixture.
4. **Staging e2e coins.** Recommend no special handling: staging is devnet and every staging coin is a test coin. Specs should name coins with a recognizable prefix (for example "E2E ") so a person can tell them apart; nothing filters them.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node global WebSocket | Worker stream | Yes | Node 24.13.0 | none needed |
| Helius devnet WSS + RPC | Indexer | Yes (key in .env, Developer plan) | n/a | none |
| Neon dev and staging branches | Tables | Yes | Postgres (Neon) | none |
| Railway staging (web public, worker private) | Live SSE e2e | Yes | n/a | none |
| `uv` / `uvx` | Static font instances | Yes | ~/.local/bin | download static TTFs from upstream repos |
| `slopcheck` | Package audit | Yes (`scan` mode) | homebrew | none |
| Context7 CLI `ctx7` | Docs lookup | No | n/a | Used bundled Next 16 docs and installed package typings instead |
| Surfpool | Fork tests of pool trades | Yes (Phase 1) | 1.6.1 | devnet |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (units, DB integration on the Neon dev branch), Playwright 1.63.0 + @axe-core/playwright 4.13.0 (e2e) |
| Config file | root `package.json` (`vitest run`, default config), `playwright.config.ts` (`*.e2e.ts`) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` (devnet groups with `E2E_DEVNET=1`) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIST-01..04 (data) | Pump TradeEvent (BONDR quote), AMM Buy/Sell, CreatePoolEvent, PostCompleteBuyEvent decode from real devnet/fork txs | unit | `pnpm vitest run packages/core/src/events.test.ts` | partial (extend; new fixtures needed) |
| LIST-01..04 (data) | `parseTx`: launch burn and sell produce Launch rows; unknown mints ignored; SOL value from same-tx BONDR price | unit | `pnpm vitest run packages/core/src/trades.test.ts` | Wave 0 |
| LIST-04, TOKEN-01 | Price, mcap, progress, `bondrAtBond` against fixture numbers | unit | `pnpm vitest run packages/core/src/price.test.ts` | Wave 0 |
| LIST-01..03 | Idempotent insert (same tx twice = same rows); list SQL trending modes 1h/24h/latest; Top/Latest/Oldest order | integration (Neon dev) | `pnpm vitest run apps/web/lib/coins.test.ts` | Wave 0 |
| LIST-05 | Search escapes `%` and `_`, mint prefix, 1-char no-op | integration | same file | Wave 0 |
| TOKEN-01 | Candle SQL: open = previous close, first open = launch mcap, burn rows excluded, bucket sizes | integration | `pnpm vitest run apps/web/lib/trades.test.ts` | Wave 0 |
| TOKEN-02 | Feed keyset pagination; holder count excludes curve, pool, incinerator, zero balances | unit | `pnpm vitest run apps/worker/src/holders.test.ts` | Wave 0 |
| LIST-04, TOKEN-02 (live) | Hub: fan-out, `?mint` filter, replay from Last-Event-ID, resync on epoch change, NDJSON split across chunks | unit | `pnpm vitest run apps/web/lib/live-hub.test.ts` | Wave 0 |
| LIST-04 | Number formats (mcap tiers, U+2212 sign, curve %) | unit | `pnpm vitest run apps/web/lib/format.test.ts` | exists (extend) |
| LIST-01..05 | Home renders lists, tabs, search states, full-mint navigation; axe 0 at 390/768/1440; screenshots | e2e | `pnpm e2e apps/web/e2e/home.e2e.ts` | Wave 0 |
| TOKEN-01, TOKEN-02 | Token page chart canvas, interval switch, feed with Launch rows, Load more, holders | e2e | `pnpm e2e apps/web/e2e/coin.e2e.ts` | exists (extend) |
| LIST-04, TOKEN-02 (devnet live) | `scripts/devnet-trades.ts` buy, then feed row and card value change appear without reload within 15 s | e2e devnet | `E2E_DEVNET=1 pnpm e2e apps/web/e2e/live.e2e.ts` | Wave 0 |
| TOKEN-06 | `/coin/{mint}/opengraph-image/card` returns 1200x630 PNG with immutable cache; unknown mint returns site card with short cache; `og:image` and `twitter:card` meta present | e2e (request) | `pnpm e2e apps/web/e2e/og.e2e.ts` | Wave 0 |
| D-04 | No DB query while a browser idles on `/` with the stream open (count queries via a test hook or Neon `pg_stat_statements` delta) | manual + e2e | staging check in VERIFICATION | manual |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`
- **Phase gate:** full suite plus `E2E_DEVNET=1` devnet groups and the staging run (`E2E_BASE_URL`) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/capture-tx.ts`: save a devnet tx (raw `getTransaction` JSON, the shape `events.test.ts` fixtures already use) into `packages/core/src/fixtures/`
- [ ] Fixtures: devnet launch (burn), devnet launch (sell), curve buy and sell of a child, multi-hop SOL to child, a pool buy/sell after migration (devnet if A8 holds, else Surfpool fork), a BONDR-only trade
- [ ] `scripts/devnet-trades.ts`: buy and sell a given coin with the sim wallet; `--complete` buys the curve out and waits for migration
- [ ] Stream probe (A1, A2): one script run asserting notifications for the launch, a curve trade and a multi-hop trade
- [ ] Static OG fonts under `apps/web/assets/og/` with `OFL.txt`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (read-only public pages) | n/a |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Worker `/events` behind the existing bearer `authorized()`; worker stays private |
| V5 Input Validation | yes | `BASE58_KEY` for mints, interval enum (`1m`,`5m`,`1h`,`1d`), numeric keyset cursors, search length cap and LIKE escape, parameterized SQL |
| V6 Cryptography | no | n/a |
| V12 Files and Resources | yes | OG image fetch only from `PINATA_GATEWAY` with CID regex, 5 s timeout, 2 MB cap, content-type allowlist (SSRF and memory) |
| V13 API | yes | `proxy.ts` rate limits for list, search, feed, candles and SSE connects; per-IP concurrent stream cap |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSE connection exhaustion | Denial of service | Per-IP connect rate limit and concurrent cap; streams closed at 14 min; one upstream per process |
| Search wildcard / heavy query | Denial of service | Escape, cap length, 10 s result cache |
| SSRF through coin image URL | Tampering | Image host is the configured gateway only; CID charset check |
| Coin name injection into page or card | Tampering | React escaping; Satori renders text, not HTML |
| Worker token leak | Information disclosure | Token only in `lib/worker.ts` and `live-hub.ts` (server-only import), never in the client bundle; `check:bundle` stays in CI |
| Helius key in logs | Information disclosure | All stream and RPC errors through `redact()`; the WSS URL built in `net.ts` |
| Forged trade data | Spoofing | Events accepted only from emit_cpi self-CPI with the program's event authority as account 0 (existing `innerEvents` rule) |

## Sources

### Primary (HIGH confidence)
- Installed `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0: IDL events and fields, instruction accounts, decoders, `bondingCurveMarketCap`, `poolMarketCap`, `poolHopAmountOut` (introspected locally)
- Repo fixtures `forced-bond.json`, `launch-20261008.json` decoded with `core/events.ts`
- Next 16.3.8 bundled docs: `guides/streaming.md`, `file-conventions/01-metadata/opengraph-image.md`, `functions/generate-image-metadata.md`, `functions/image-response.md`, `next-config-js/compress.md`; compiled `@vercel/og` and `compression` sources
- lightweight-charts 5.2.1 `typings.d.ts` and production bundle (npm pack)
- [Agave runtime/src/bank.rs](https://raw.githubusercontent.com/anza-xyz/agave/master/runtime/src/bank.rs): `collect_transaction_logs` mentions matching
- [Helius plans](https://www.helius.dev/docs/billing/plans), [Helius credits](https://www.helius.dev/docs/billing/credits), [Helius websockets](https://www.helius.dev/docs/enhanced-websockets), [Helius standard websocket](https://www.helius.dev/docs/rpc/websocket), [transactionSubscribe](https://www.helius.dev/docs/enhanced-websockets/transaction-subscribe)
- [Railway public networking specs and limits](https://docs.railway.com/networking/public-networking/specs-and-limits)
- [Neon compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle), [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero)
- [google/fonts ofl/bigshoulders and ofl/schibstedgrotesk](https://github.com/google/fonts) via `gh api`

### Secondary (MEDIUM confidence)
- [Helius DAS getTokenAccounts](https://www.helius.dev/docs/api-reference/das/gettokenaccounts) (page omits limits and cost; credits page gives 10)
- [Helius getProgramAccountsV2](https://www.helius.dev/docs/api-reference/rpc/http/getprogramaccountsv2) (search summary: limit 1-10,000, paginationKey)
- [Anza versioned transactions proposal](https://docs.anza.xyz/proposals/versioned-transactions)

### Tertiary (LOW confidence)
- Satori variable-font behaviour (no direct source found; static instances recommended regardless)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, one new pinned dependency verified on npm and slopcheck; everything else installed.
- Architecture: MEDIUM-HIGH, the subscription, fan-out and budget reasoning are sourced; A1, A2 need a devnet probe.
- Pitfalls: HIGH for Railway, Neon, Next compression, Satori fetches (sourced); MEDIUM for reorg and undici defaults.

**Research date:** 2026-10-23
**Valid until:** 2026-11-06 (pump ships breaking changes on short notice; re-check the SDK pins and Helius plan page before execution)
