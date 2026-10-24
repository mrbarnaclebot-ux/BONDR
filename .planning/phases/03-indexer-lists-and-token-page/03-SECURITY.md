---
phase: 03
slug: indexer-lists-and-token-page
status: verified
threats_total: 59
threats_closed: 59
threats_open: 0
asvs_level: 1
created: 2026-10-24
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register: every `<threat_model>` block of 03-01..03-15 PLAN.md (59 threats: 52 mitigate, 7 accept, 0 transfer).
> Evidence is code (file:line) or a test on branch phase-03-indexer-lists at db46f6a. Deployment-only mitigations cite
> 03-15-SUMMARY (Railway, Neon and Helius were not called). Pure tests re-run for this audit: events, trades, net,
> pinata, live-hub, http (48 passed, 1 skipped).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| owner Mac -> Helius | API key in the RPC and websocket URLs | API key in URL |
| scripts -> devnet ops wallet | probe, trade and capture scripts spend devnet SOL | devnet SOL, signed txs |
| chain tx -> parser | any wallet can send txs that mention BONDR or a BONDR coin | untrusted tx bytes, events |
| Helius websocket -> worker | notifications are hints; the fetched tx is the source of truth | signatures, logs |
| chain -> worker -> Postgres | parsed chain data, worker is the only writer | trades, coin rows |
| URL param -> image route / token page | untrusted mint string | mint |
| web server -> Pinata gateway | server-side fetch of a user-uploaded image | public image bytes |
| stored metadata -> cards and OG image | user-supplied name, symbol, image CID | public text |
| browser -> /api/coin/[mint]/trades, candles | untrusted mint, cursor, interval | query params |
| browser -> / and /api/coins | untrusted sort, page, q, trending | query params |
| browser -> /api/live | public, unauthenticated, long-lived SSE | mint, last id |
| web -> worker /events | Railway private network, bearer token | public chain events |
| SSE payload -> client render | event data from the web hub | public chain data |
| e2e -> dev branch DB | fixtures written and removed | test rows |
| npm registry -> build | lightweight-charts 5.2.1 | package code |
| owner Mac -> Railway | variable change and redeploy | SITE_URL (public) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-03-01-01 | I | wsUrl, stream-probe errors | mitigate | packages/core/src/net.ts:10-14 redact(), :27-30 wsUrl built only here; scripts/stream-probe.ts:57,92, capture-tx.ts:62, devnet-trades.ts:264 print through redact; net.test.ts:30-33 redact(wsUrl) has no key | closed |
| T-03-01-02 | D | devnet ops wallet | mitigate | scripts/devnet-trades.ts:46-47 TRADE_BUDGET_SOL 0.05, COMPLETE_BUDGET_SOL 0.6; :60 per-trade cap; :249 OPS_FLOOR_SOL refusal; :166-178 completion cost read and refused before any send; :257 run spend over budget exits 1 | closed |
| T-03-01-03 | E | network selection | mitigate | net.ts:44-55 genesis guard unchanged; keys.ts:8 Net = devnet or fork; capture-tx.ts:22 and devnet-trades.ts:235 refuse other nets | closed |
| T-03-01-04 | I | committed fixtures | accept | See AR-01 | closed |
| T-03-02-01 | S | forged trade events | mitigate | packages/core/src/events.ts:86-87 program must be pump or PumpSwap and account 0 its event authority PDA; events.test.ts:99 forged authority yields no events | closed |
| T-03-02-02 | T | non-BONDR coins in lists | mitigate | packages/core/src/trades.ts:160,183 init map (KnownCoin plus launch CreateEvent, :248-250), :168-169 pool map; :194 other events skipped for unknown mints | closed |
| T-03-02-03 | D | malformed or new event layouts | mitigate | events.ts:43-51 pinned SDK decoders only, :68-76 decode exception becomes invalid:name, :91 unknown:disc; trades.ts:292 unknown list; apps/worker/src/ingest.ts:118-121 logged once, never thrown | closed |
| T-03-02-04 | T | failed transactions | mitigate | events.ts:81 meta.err returns no events | closed |
| T-03-03-01 | T (SSRF) | fetchCardImage | mitigate | apps/web/lib/pinata.ts:48 fetch only when PINATA_GATEWAY set, host from gatewayHost (:9-13), :15 https, :19 CID /^[A-Za-z0-9]+$/, :51 redirect "error"; pinata.test.ts:56 | closed |
| T-03-03-02 | D | card render | mitigate | pinata.ts:51 5 s AbortSignal.timeout, :23-24,52-55 content-type allowlist and 2 MB cap (content-length plus capped stream read :27-41); app/coin/[mint]/opengraph-image.tsx:16,31 immutable only when the image embedded or the coin has none (review C-CR-01 fix 455fa1f); apps/web/proxy.ts:12,19 read limit on /coin/:path* | closed |
| T-03-03-03 | T | coin name injection | mitigate | lib/og.tsx:175-177 name and symbol as Satori text nodes; lib/launches.ts:89 BASE58_KEY (lib/guard.ts:46) before the query; biome.json:12 noDangerouslySetInnerHtml, no dangerouslySetInnerHTML in apps/web | closed |
| T-03-03-04 | I | external font or emoji fetch | accept | See AR-02 (03-03-SUMMARY:108) | closed |
| T-03-03-05 | S | non-BONDR mint card | mitigate | lib/launches.ts:66-67 landed launches only; opengraph-image.tsx:27-28 any other mint gets siteCard | closed |
| T-03-04-01 | T | duplicate or replayed ingest | mitigate | migrations/0003_indexer.sql:47 PK (signature, ix); apps/worker/src/ingest.ts:100 onConflictDoNothing().returning(), :103-104 patches only for inserted rows; :57 coin insert on conflict do nothing | closed |
| T-03-04-02 | T | inconsistent rows | mitigate | 0003_indexer.sql:25-28 coins_venue, coins_bonded (curve iff bonded_at null), coins_progress 0..1, coins_holders; :48-51 trades_side, trades_venue, trades_token_amount, trades_burn_sol; :54-56 FKs to vanity_mints, launches, coins | closed |
| T-03-04-03 | D | Neon budget | mitigate | ingest.ts:164-198 writes only on a landed launch or trade; apps/worker/src/bondr-price.ts in memory; worker timers (stream.ts:108 getHealth to Helius, :115 and main.ts:36 reconnect backoff, events-route.ts:35 ping) issue no DB read or write; holders.ts:47-53 recount on the trade, no timer (review S-WR-04) | closed |
| T-03-04-04 | D | Helius rate limit during backfill | mitigate | ingest.ts:27 BACKFILL_PACE_MS 100, :201,237,280 pace() between fetches; :272-277 boot pass over landed launches with no coin row only | closed |
| T-03-04-05 | I | logs | mitigate | ingest.ts:29-30 logged() through redact; every worker console line that prints an error goes through redact (stream.ts:18,72,144,145, holders.ts:52, main.ts:24,78, http.ts:92); remaining lines print ids only (ingest.ts:190,283) | closed |
| T-03-05-01 | T | mint and cursor params | mitigate | app/api/coin/[mint]/trades/route.ts:17 BASE58_KEY, :19-21 parseCursor 400; lib/trades.ts:15-19 strict /^\d{1,19}\.\d{1,19}$/ and int8 range; :41-49 drizzle bound parameters | closed |
| T-03-05-02 | D | feed scraping | mitigate | proxy.ts:12,20 300/min read limit on /api/coin/:path*; lib/trades.ts:9,49 keyset pages of 50; app/coin/[mint]/page.tsx:36-54 first page kept 10 s; lib/trades.ts:96-104,119-123 resync page kept 10 s | closed |
| T-03-05-03 | I | trader addresses | accept | See AR-03 | closed |
| T-03-05-04 | I | DB errors | mitigate | trades/route.ts:25-27 logs only cause.code, 503 worker_unavailable with no detail (same in candles/route.ts:21-23, coins/route.ts:27-29) | closed |
| T-03-06-01 | T | mint param | mitigate | app/coin/[mint]/page.tsx:89-90 landedCoin (BASE58_KEY, lib/launches.ts:89) and notFound before coinByMint; core/src/coin-row.ts:70-71 eq() parameterized | closed |
| T-03-06-02 | D | Neon budget from page views | mitigate | page.tsx:36-55 kept() 10 s per mint around coinByMint and the first page; one read each per render (:92) | closed |
| T-03-06-03 | R | misleading bond numbers | mitigate | values only from the coins row the worker writes from chain events (ingest.ts:64-86, trades.ts:141-155); components/token-bond.tsx:105 "Read from the pump curve on-chain." | closed |
| T-03-07-01 | S | websocket notifications | mitigate | apps/worker/src/stream.ts:74-77 a notification only queues a signature; ingest.ts:165-167 rows come from fetchTx plus parseTx, which applies events.ts:87 | closed |
| T-03-07-02 | D | spam txs mentioning BONDR | mitigate | stream.ts:20-25 prefilter err === null and pump or PumpSwap invoke; :33-43 de-duplicated serial queue; ingest.ts:168 unknown mints write nothing | closed |
| T-03-07-03 | D | Helius credits | mitigate | stream.ts:81-85 one logsSubscribe, main.ts:39 one startStream per boot; holders.ts:17,26-27,47-50 recount at most every 5 min per coin, on trades only; ponytail notes holders.ts:6-7, stream.ts:87 | closed |
| T-03-07-04 | I | websocket URL in logs | mitigate | stream.ts:6,118 wsUrl from net.ts; :18,72,144,145 every error log through redact | closed |
| T-03-07-05 | T | reorg of a confirmed block | accept | See AR-04 (ingest.ts:5-6 ponytail note) | closed |
| T-03-08-01 | D | SSE connection exhaustion | mitigate | proxy.ts:11 live scope 30 connects/min per IP; app/api/live/route.ts:11,72-75 6 open streams per IP with release (:23-27,57); :12,47-50 14-minute self-close; lib/live-hub.ts:172-174 one hub per process, :147-150 one upstream | closed |
| T-03-08-02 | E | worker /events | mitigate | apps/worker/src/http.ts:42-46 timingSafeEqual bearer check, :84-85 runs before streams[key]; main.ts:63 GET /events registered as a stream; worker has no public domain (02-16-SUMMARY, unchanged in 03-15) | closed |
| T-03-08-03 | I | WORKER_TOKEN | mitigate | only lib/worker.ts:18 and lib/live-hub.ts:160 read it, both `import "server-only"` (worker.ts:4, live-hub.ts:5); next.config.ts:66-69 env inlines only NEXT_PUBLIC_SENTRY_ENVIRONMENT and PINATA_GATEWAY; package.json:21 check:bundle gate | closed |
| T-03-08-04 | T | mint query param | mitigate | app/api/live/route.ts:67-68 BASE58_KEY, 400 otherwise; filter applied server-side in live-hub.ts:62-63,72 | closed |
| T-03-08-05 | D | Neon budget from open pages | mitigate | live-hub.ts:5-6 and api/live/route.ts:5-6 import no database module (guard.ts has none either); refetch only on resync: coin-live.tsx:53-55, home-live.tsx:120-124 | closed |
| T-03-08-06 | I | event payload | accept | See AR-05 | closed |
| T-03-09-01 | T | event payload render | mitigate | lib/use-live.ts:35-40 JSON.parse in try/catch drops malformed frames; React text only (biome.json:12, no dangerouslySetInnerHTML in apps/web) | closed |
| T-03-09-02 | D | browser reconnect storms | mitigate | api/live/route.ts:41 `retry: 1000`; use-live.ts:30,71-76 a refused (closed) EventSource reopens only after 15 s; one useLive per page provider (coin-live.tsx:42, home-live.tsx:164); per-IP limits as T-03-08-01 | closed |
| T-03-09-03 | D | Neon refetch on resync | mitigate | coin-live.tsx:53-55 one fetch on a resync event through /api/coin/[mint]/trades (proxy.ts:20 rate-limited, lib/trades.ts:119-123 kept 10 s); token-chart.tsx:104 candles reload once (kept 10 s, lib/trades.ts:108-109) | closed |
| T-03-10-01 | T | interval and mint params | mitigate | app/api/coin/[mint]/candles/route.ts:14 BASE58_KEY, :16-17 parseInterval enum (lib/trades.ts:62-66, Object.hasOwn) 400; lib/trades.ts:75-88 sql template with bound ${mint}, ${seconds} | closed |
| T-03-10-02 | D | candle query cost | mitigate | lib/trades.ts:108-109 kept 10 s per (mint, interval); proxy.ts:20; ponytail ceiling lib/trades.ts:106-107 | closed |
| T-03-10-SC | T | npm install of lightweight-charts | mitigate | apps/web/package.json:18 exact "5.2.1"; pnpm-lock.yaml:3047-3048,5912-5914 only dependency fancy-canvas 2.1.0, no build scripts; 03-RESEARCH.md:151-154 slopcheck [OK] both; 03-10-SUMMARY:115 published 2026-08-12 (72 days), no install scripts; next.config.ts:40 connect-src unchanged | closed |
| T-03-11-01 | T | sort and page params | mitigate | lib/coins.ts:16-21 parseSort enum, parsePage /^\d{1,2}$/; app/api/coins/route.ts:14-18 400; coins.ts:41-45 fixed ORDER branches, no interpolated column names; app/page.tsx:40 falls back to top | closed |
| T-03-11-02 | D | list queries | mitigate | coins.ts:49-59,71 kept 10 s per (sort, page, q); :14,21 page cap 99; proxy.ts:17-18 read limit on / and /api/coins | closed |
| T-03-11-03 | T | coin name or image injection | mitigate | React text; components/coin-card.tsx:38-40 and coin-identity.tsx:54 image src only through imageUrl (pinata.ts:18-21 CID check, gateway host); next.config.ts:39 img-src unchanged | closed |
| T-03-11-04 | I | worker status at render | accept | See AR-06 | closed |
| T-03-12-01 | T (SQLi) | search | mitigate | lib/coins.ts:30 escapeLike, :34-38 bound ilike/like with explicit `escape '\\'`; no sql.raw or unsafe() in apps/web, apps/worker or packages/core (rg) | closed |
| T-03-12-02 | D | wildcard or heavy search | mitigate | coins.ts:30 escaped wildcards, :24-27 64-char cap (route 400) and 2-char minimum; components/home-search.tsx:9 300 ms debounce; coins.ts:71 cache key includes q; proxy.ts:18 | closed |
| T-03-12-03 | T | reflected query text | mitigate | home-search.tsx:98-101 q rendered as React text, cut to 40 chars; home-coins.tsx:64 q only in the query string via URLSearchParams, never in a path or HTML | closed |
| T-03-12-04 | S | mint paste navigation | mitigate | components/home-coins.tsx:180 router.push only when the BONDR-only list result (coins rows, coins.ts:63-65) contains that exact mint; other mints get the empty state (home-search.tsx:115-116). searchByMint was folded into listCoins (03-12-SUMMARY deviation 1); the control is the same | closed |
| T-03-13-01 | T | event payload render | mitigate | React text only; use-live.ts:35-40 guarded parse; coin-card.tsx:38 images only through imageUrl | closed |
| T-03-13-02 | D | Neon reads from open home pages | mitigate | components/home-live.tsx:85-103 the 60 s tick only decays and re-sorts in memory, no fetch; the only fetch is catchUp on resync (:120-124,141,182) | closed |
| T-03-13-03 | D | unbounded list growth | accept | See AR-07 | closed |
| T-03-14-01 | T | shared kill switch during e2e | mitigate | playwright.config.ts:31-38 paused.e2e.ts ignored by chromium, runs alone in its own project after it; e2e/paused.e2e.ts:26-28 afterAll and :47-49 finally restore the switch | closed |
| T-03-14-02 | T | leftover fixture rows | mitigate | e2e/fixtures.ts:71-75 negative vanity idx, "E2E " names, :85 dropCoin; every spec that seeds also drops (home, coin, coin-chart, live, home-live, responsive-lists, og) | closed |
| T-03-15-01 | E | staging deploy and variables | mitigate | 03-15-SUMMARY Task 1: owner chose "Approve and deploy" before any Railway change; scope listed; nothing else changed | closed |
| T-03-15-02 | I | SITE_URL and worker token | mitigate | 03-15-SUMMARY Threat Flags: SITE_URL public, no secret printed or committed; instrumentation.ts:9-12 boot guard and scripts/check-client-bundle.sh unchanged | closed |
| T-03-15-03 | D | Neon and Helius budgets on staging | mitigate | 03-15-SUMMARY Task 3 item 4: owner's 10-minute idle check, compute suspended; one websocket per worker (main.ts:39); holder throttle (holders.ts:17,26-27) | closed |
| T-03-15-04 | R | sign-off | mitigate | 03-15-SUMMARY Task 2 and Task 3: buy signature 2w4nvRB5..., deploy ids, check outcomes and owner "approved" recorded | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*
*Category: S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-03-01-04 | Committed fixtures are public on-chain transactions; they hold no keys | owner (03-01 plan) | 2026-10-24 |
| AR-02 | T-03-03-04 | Satori may fetch emoji or non-Latin glyphs from its CDNs server-side (RESEARCH Pitfall 7); a failure only drops those glyphs (03-03-SUMMARY:108) | owner (03-03 plan) | 2026-10-24 |
| AR-03 | T-03-05-03 | Trader addresses are public on-chain data and are shown short | owner (03-05 plan) | 2026-10-24 |
| AR-04 | T-03-07-05 | A confirmed-block rollback is not expected in practice (A3); the (signature, ix) keys keep a re-ingest safe. Finalized commitment would add about 13 s to every live update (ingest.ts:5-6) | owner (03-07 plan) | 2026-10-24 |
| AR-05 | T-03-08-06 | SSE payloads hold only public chain data already shown on the page | owner (03-08 plan) | 2026-10-24 |
| AR-06 | T-03-11-04 | The worker status read at render is already public at /api/status | owner (03-11 plan) | 2026-10-24 |
| AR-07 | T-03-13-03 | Latest grows by live launches while the page stays open (UI-SPEC: the last card is not removed); bounded by session length | owner (03-13 plan) | 2026-10-24 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

None. Three SUMMARY files have a `## Threat Flags` section and each maps to registered ids: 03-05 (T-03-05-01, -02, -04),
03-13 (`trending=1` on the rate-limited, 10 s kept /api/coins: T-03-11-02, T-03-13-02), 03-15 (T-03-15-01, -02). The
other twelve summaries have no section.

Informational, outside the register (from 03-REVIEW.md and the two fix logs):
- S-CR-02 (pool spoofing): closed in bb1905d. packages/core/src/trades.ts:197-199 accepts a CreatePoolEvent only for the
  coin's canonical pool; apps/worker/src/ingest.ts:75-81 a pool patch carries bondedAt through coalesce, so a missed
  CompleteEvent cannot fail coins_bonded. Test trades.test.ts:185 (re-run, passes).
- C-CR-01 (OG cache poisoning): closed in 455fa1f. opengraph-image.tsx:31 sends immutable only when the image embedded
  or the coin has no image; otherwise 5 min. e2e og.e2e.ts:91,97.
- New surface added after the plans, not in any threat model: `/api/live?last=` (C-WR-02 feed half). It is capped at
  64 characters (api/live/route.ts:70-71) and used only as a ring lookup key (live-hub.ts:53-57,142); an unknown id gets
  a resync. Covered in spirit by T-03-08-01/-04; register it in a later plan if the hub grows replay from storage.
- Also post-plan: the getHealth keepalive and the in-memory failed-signature retry set (S-WR-01, S-CR-01). Both are
  bounded (30 s interval; 20 tries) and noted with `ponytail:` comments.
- Still open, informational: S-IN-03 (per-IP cap of 6 SSE streams is shared behind carrier NAT), S-IN-08 (no
  backpressure on worker /events writes or /api/live enqueue; small events, 14-minute stream life), C-IN-02 (coin-live
  handlers trust the hub's mint filter; defence in depth only).
- Deployment note: staging runs ea84e98 (03-15), which predates the review fixes, including S-CR-02 and C-CR-01. They
  reach staging with the next approved redeploy.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-24 | 59 | 59 | 0 | gsd-security-auditor (claude-opus-5-5) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-24
