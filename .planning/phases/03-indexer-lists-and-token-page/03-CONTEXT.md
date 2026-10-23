# Phase 3: Indexer, Lists and Token Page - Context

**Gathered:** 2026-10-23
**Status:** Ready for planning

<domain>
## Phase Boundary

As a trader, I want live lists and charts of every BONDR coin, so that I can find and judge coins.

Phase 3 delivers:
- The worker ingests every trade on every BONDR coin, on any venue (curve and, after bond, PumpSwap), into Postgres. It rolls trades up into candles (1m, 5m, 1h, 1d), market cap, 1h change and volume.
- The home page replaces the `/` to `/launch` redirect: hero, Trending side-scroller, and Top / Latest / Oldest tabs with search (LIST-01..05).
- The token page fills in: market cap chart, live trade feed, holder count, curve progress (TOKEN-01, TOKEN-02).
- Lists and the token page update live over SSE.
- Token links render a share card on X and Telegram (TOKEN-06).

Not in Phase 3: the buy and sell panel (Phase 4), burn budget, 24h window, fee ledger and totals (Phase 5, TOKEN-03..05), moderation (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Carried forward (locked earlier)
- **D-01:** Values are SOL equivalents everywhere ("Mcap 61.40 SOL"), and the chart plots market cap, per the approved mockups and the PROJECT.md risk response. Coins are quoted in BONDR, so the SOL value comes from BONDR's own curve or pool price, read on chain.
- **D-02:** SSE for live updates, TradingView lightweight-charts for the chart, BONDR's own indexer (no pump API).
- **D-03:** Lists show only coins launched through BONDR. Trending = quote volume in the last 1h; Top = market cap; Latest and Oldest = launch time.
- **D-04:** Neon budget (500 CU-h a month hard quota, 0.25 CU computes): the indexer writes only when a trade lands, and nothing reads the database on a timer, so a quiet app lets Neon scale to zero. SSE fan-out must not turn every open browser into database reads.
- **D-05:** Helius Developer plan ($49) is the RPC budget. Stay inside its included websocket and credit limits.
- **D-06:** Layout follows the approved `home.html` and `token.html` mockups; gsd-ui-phase writes the UI-SPEC before planning.
- **D-07:** Phase 2 rules still apply: the 14-day freshness rule for new dependencies, web imports only pure `@bondr/core` modules, secrets stay in the worker, and the CSP (connect-src 'self', img-src limited to ipfs.io and *.mypinata.cloud) must keep working. Charts and SSE are same-origin.

### Later-phase sections
- **D-08:** The home "Next to bond" rail is hidden until Phase 5 adds burn budgets.
- **D-09:** The hero line shows launched and bonded counts from the indexer ("N coins launched, M bonded"). Phase 5 changes it to the "bonded by their own fees" wording.
- **D-10:** The token page "Bond and burn" panel shows curve progress only: curve fill %, the BONDR in the curve, "bonds at about X SOL", and the Bonded / PumpSwap state once migrated. Burn budget, the 24h window, the forced-bond story and the ledger come in Phase 5.
- **D-11:** No trade panel placeholder before Phase 4; the chart and trade feed take the full width.

### Live list behavior
- **D-12:** Card numbers (market cap, 1h change, bond progress) update the moment a trade lands. Card positions re-rank at most once a minute, so nothing jumps under the cursor.
- **D-13:** Trending falls back when nothing traded in the last hour: 24h volume first, then the latest launches. The caption changes to match ("Ranked by volume in the last 24 hours").
- **D-14:** A new launch slides into the front of Latest live, without a reload.
- **D-15:** A trade flashes the changed numbers on the card briefly, green for a buy and red for a sell. No flash with prefers-reduced-motion.

### Trade feed and chart
- **D-16:** The launch transaction's dev buy and its exit (insta sell or burn) appear in the trade feed labelled "Launch", and the chart starts at the launch price.
- **D-17:** The chart's default interval depends on coin age: 1m under 6 hours, 5m under 3 days, then 1h. The 1m / 5m / 1h / 1d buttons still switch.
- **D-18:** The trade feed shows the latest 50 trades, then "Load more". Each row: time, buy or sell (or Launch), SOL amount, token amount, short trader address, Solscan link. New trades are added at the top live.
- **D-19:** The holder count is recounted only for coins that traded, at most every 5 minutes per coin, so quiet coins cost no Helius credits.

### Share card
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` (Phase 3 section): goal and the 5 success criteria
- `.planning/REQUIREMENTS.md`: LIST-01..05, TOKEN-01, TOKEN-02, TOKEN-06
- `.planning/PROJECT.md`: fee mechanic, the SOL-equivalent display rule, budget constraints, the own-indexer and SSE decisions

### Design
- `.planning/mockups/home.html`: home layout (hero, Next to bond, Trending side-scroller, All coins tabs with search)
- `.planning/mockups/token.html`: token page layout (header stats, proof, market cap chart, Bond and burn, trades feed)
- `.planning/mockups/tokens.css`: design tokens
- `.planning/design/DESIGN-BRIEF.md`: visual system
- `.planning/phases/02-launch-flow/02-UI-SPEC.md`: established UI contract the Phase 3 UI-SPEC extends

### Prior decisions and state
- `.planning/phases/02-launch-flow/02-CONTEXT.md`: Phase 2 decisions (D-14 freshness, D-15 web/core boundary)
- `.planning/STATE.md`: decisions log, Neon budget, staging details
- `.planning/research/FINDINGS.md`: pump program facts and Helius findings

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/events.ts`: `innerEvents`, `completeEvents` decode pump events from emit_cpi inner instructions; the trade parser builds on it.
- `packages/core/src/curve.ts`: `readCurve`, `costToComplete` for curve progress.
- `packages/core/src/schema.ts`: `launches` (mint, wallet, exit, signature, facts) is the list of BONDR coins to index; constraints-first style.
- `apps/web/lib/launches.ts`: `launchByMint`, `launchView` public read model.
- `apps/web/app/coin/[mint]/page.tsx`: the Phase 2 token page with a per-process cache; Phase 3 extends it.
- `apps/web/components/`: `coin-identity`, `ca-row`, `proof-stamp`, `tx-link`, `copy-chip`, `chrome` (header), `ui-button`.
- `apps/web/lib/format.ts`: `compact`, `short`, `sol` number and address formatting.
- `apps/web/lib/pinata.ts`: `ipfsUri`, `gatewayHost` for coin images.
- `apps/web/lib/guard.ts` and `apps/web/proxy.ts`: rate limits; proxy.ts already limits `/coin/:mint` reads.
- `apps/worker/src/status.ts`: chain reads with a 5 s cache and the venue (curve / awaiting / pool) detection.

### Established Patterns
- Worker owns chain access and secrets; web reads Postgres for public data and calls the worker over private HTTP with a token.
- Drizzle migrations in `packages/core/migrations`, run by the web pre-deploy command.
- One runnable check per non-trivial change: Vitest units and Playwright e2e against devnet.
- `ponytail:` comments mark deliberate shortcuts with their ceiling.

### Integration Points
- `/` redirect in `apps/web/next.config.ts` is replaced by the home page.
- The worker process (`apps/worker/src/main.ts`) gains the indexer loop; staging worker is private on Railway.
- The Phase 2 launch flow's success screen links to `/coin/[mint]`.

</code_context>

<specifics>
## Specific Ideas

- The hero line in the mockup ("31 coins bonded by their own fees. Next up: BOGW, 96.4% ready.") becomes counts only in Phase 3 (D-09).
- The launch's insta sell or burn being visible in the trade feed is part of the proof story (D-16).

</specifics>

<deferred>
## Deferred Ideas

- "Next to bond" rail, burn budget, 24h window, fee ledger and totals: Phase 5.
- Buy and sell panel: Phase 4.

</deferred>

---

*Phase: 03-indexer-lists-and-token-page*
*Context gathered: 2026-10-23*
