---
phase: 03-indexer-lists-and-token-page
verified: 2026-10-24T00:00:00Z
status: human_needed
score: 5/5 roadmap success criteria verified in code (8/8 requirements satisfied in code)
overrides_applied: 0
human_verification:
  - test: "Redeploy HEAD (27dfeb6) of phase-03-indexer-lists to staging, then re-run the staging specs (responsive-lists.e2e.ts, og.e2e.ts), one live devnet buy on an open token page, and the 10-minute Neon idle check"
    expected: "Same results as 03-15: 24 passed / 3 skipped, the buy shows on the page in a few seconds without a reload, Neon suspends while / sits idle"
    why_human: "Staging and the owner sign-off ran on the c749f01-era build. About 30 review-fix commits came after it, and they rewrote the indexer recovery paths (S-CR-01..03, S-WR-01..07), the holder recount trigger, the hub watchdog and the first-connect replay (11e2a1b). None of those has run against real devnet or real Neon. The verifier may not deploy."
    result: "Done 2026-10-24 with owner approval: web 198f6c51 and worker 2820ea7e deployed at d4dfd1c (SUCCESS, stream subscribed). Staging specs 24 passed, 4 skipped (3 coin-bonded: no bonded coin; 1 og cache test needs seeding). Live devnet buy 3AwHZsri...7JpSyn on the open page 2591 ms after blockTime. Ops balance unchanged at 2.750788 SOL. Neon idle check left to the owner."
  - test: "First bonded coin (mainnet, or any network where a child can complete): watch the open token page and home cards through the CompleteEvent, the migration, and the first PumpSwap buy and sell"
    expected: "Venue goes curve -> complete -> pool, the Bonded tag and the chart's Bonded marker appear, pool trades land in the feed with sensible SOL and market cap values, and the bonded count in the hero goes up"
    why_human: "The PumpSwap path (CreatePoolEvent, BuyEvent, SellEvent, pool price from post-trade balances plus virtual quote reserves) is proven only by 4 fixtures captured on the Surfpool fork. Devnet cannot bond a child (A8: it needs about 752M BONDR, BONDR's curve holds 723M). Staging has no bonded coin, so the 3 coin-bonded staging specs were skipped."
  - test: "Read the S-CR-01 fix (apps/worker/src/ingest.ts ingestOrKeep, retryFailed, gapFill, lastSigs; apps/worker/src/stream.ts fillAll)"
    expected: "Agree that a failed or missed signature is retried, and that a reconnect gap fill starts from marks read before logsSubscribe"
    why_human: "The server fixer marked it 'fixed, but a human should check the logic'. Unit tests cover the failed-ingest path only."
    result: "Done by the orchestrator on 2026-10-24. Agreed: a failed or missed sig is retried by the next drain or fill (20 tries, paced 100 ms, idempotent writes); marks are read before logsSubscribe; for queued fills the older mark wins. Cost noted: a stuck sig adds about 100 ms to each drain until it gives up."
---

# Phase 3: Indexer, Lists and Token Page Verification Report

**Phase Goal:** As a trader, I want live lists and charts of every BONDR coin, so that I can find and judge coins.
**Mode:** mvp
**Verified:** 2026-10-24
**Status:** human_needed
**Re-verification:** No, this is the first verification.

## User Flow Coverage (MVP)

| Step | Expected | Evidence in code | Status |
| --- | --- | --- | --- |
| Trader opens home | Hero counts, Trending, Top / Latest / Oldest | `app/page.tsx` reads `heroCounts`, `listCoins`, `trending` and wraps them in `HomeLiveProvider` | VERIFIED |
| Finds a coin | Search by name, symbol or mint; a pasted full mint opens the coin | `lib/coins.ts` `matches` (name/symbol ilike, mint prefix like, escaped); `home-coins.tsx:180` pushes `/coin/{mint}` | VERIFIED |
| Judges a coin | Chart, trade feed, holders, curve progress | `coin/[mint]/page.tsx`: McapChart, TradeFeed, TokenStats (Holders), BondPanel | VERIFIED |
| Sees it move | Live without a reload | One EventSource per page (`use-live.ts`) on the SSE route, fed by the hub, fed by the worker's `/events` | VERIFIED in code; real devnet run is pre-fix (human item 1) |
| Shares it | Preview card on X / Telegram | `coin/[mint]/opengraph-image.tsx` + `lib/og.tsx`; `metadataBase` from SITE_URL | VERIFIED (owner signed off the cards on staging) |

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Trending (1h quote volume), Top (mcap), Latest, Oldest of BONDR coins only; each row has image, name, symbol, mcap, 1h change, bond progress, age | VERIFIED | `coinRows` inner-joins `coins` to `launches`, so only BONDR launches are listed (D-03). ORDER covers top/latest/oldest. TRENDING orders by 1h volume, then 24h, then launch time (D-13); `trendMode` picks the caption (`home-trending.tsx:12-14`). `coin-card.tsx` renders art, name, symbol, mcap SOL, 1h change, progress glyph and the Age chip. The grid caps at 5 columns (`min-[1200px]:grid-cols-5`). |
| 2 | Rows and token page update live over SSE when a trade lands | VERIFIED (code + tests); staging run is pre-fix | Worker `announce` publishes after commit and only reads when a listener exists. `events-route.ts` streams NDJSON. `lib/live-hub.ts` has one upstream, a 2,000-event ring, replay and a resync on gaps. `/api/live` streams same-origin SSE with per-IP caps, and takes `last` as a first-connect fallback. Home re-ranks once a minute (D-12), flashes are skipped under reduced motion (D-15), and new launches enter Latest (D-14). |
| 3 | Find a coin by name, symbol or mint | VERIFIED | `parseQ`, `escapeLike`, `matches` in `lib/coins.ts`. A full mint opens the coin. The empty state explains a non-BONDR mint. |
| 4 | lightweight-charts chart with 1m/5m/1h/1d, live trade feed, holder count | VERIFIED | `lightweight-charts` is pinned at 5.2.1. Candles are computed on read (`lib/trades.ts read`) and open at the previous trade, or at the launch mcap (D-16). `chartInterval` gives 1m under 6 h, 5m under 72 h, then 1h (D-17). `liveBar` updates the last candle. The feed shows 50 rows with keyset Load more, Launch rows, short trader address and Solscan link (D-18). Holders: `holders.ts` recounts on a trade at most every 5 min per coin, with no timer, and excludes the curve, pool and incinerator (D-19). |
| 5 | Shared link renders a preview card with the coin's OG image | VERIFIED | The card shows identity and proof only, with no market cap (D-20), in the dark theme with Big Shoulders and Schibsted, image left (D-21). It is `immutable` only when the image embedded (C-CR-01). The owner checked Telegram and the X validator on staging. |

**Score:** 5/5 truths verified in code.

### Supporting checks on the decisions the brief named

| Item | Status | Evidence |
| --- | --- | --- |
| Indexer catches curve trades | VERIFIED | One `logsSubscribe` on the BONDR mint (D-05). `shouldIngest` covers PUMP and PUMP_AMM invokes and "Log truncated". `parseTx` handles TradeEvent. Live devnet buy seen on staging (pre-fix build). |
| Indexer catches PumpSwap trades | VERIFIED by fixture only | `poolTrade` handles BuyEvent / SellEvent on known canonical pools; CreatePoolEvent moves the venue only on the canonical pool (S-CR-02). `trades.test.ts` uses pool-buy, pool-sell and create-pool fixtures captured on the Surfpool fork. This has never run live (human item 2). |
| D-22 market cap = price x 1B | VERIFIED | `price.ts` has `SUPPLY = 1e15` base units (1B at 6 decimals) and `mcapSol = price * SUPPLY * bondrSol / 1e9`. It never reads live supply. |
| 1h change and volume | VERIFIED | `coin-row.ts`: `vol("1 hour" / "24 hours")` excludes burns; `change1h` compares against the last trade an hour ago, or the launch mcap. |
| D-04 no periodic DB reads | VERIFIED in code | No DB read sits on any web or worker timer. SSE is fed only by the hub. Kept 10 s caches sit on lists, trending, counts, candles, resync and bond time. The holder write rides on the trade (S-WR-04). The kill switch is held in memory, so `/api/status` polling on the launch page does not reach Neon. The owner's idle check passed on the pre-fix build. |
| D-10 curve progress panel | VERIFIED | `token-bond.tsx` shows "X of Y BONDR in the curve", "Bonds at about N SOL", the complete state, and Bonded on PumpSwap. |
| D-11 no trade panel | VERIFIED | There is only the UI-SPEC's muted note line (UI-SPEC lines 405 and 557). |

### Required Artifacts

| Artifact | Status | Details |
| --- | --- | --- |
| `apps/worker/src/stream.ts`, `ingest.ts`, `holders.ts`, `events-route.ts`, `bondr-price.ts` | VERIFIED | Substantive, wired from `main.ts` bootIndex |
| `packages/core/src/trades.ts`, `price.ts`, `coin-row.ts`, `schema.ts` (+ migrations 0003, 0004) | VERIFIED | Pure, unit tested; `drizzle-kit check` clean (orchestrator evidence) |
| `apps/web/lib/live-hub.ts`, `app/api/live/route.ts`, `lib/use-live.ts` | VERIFIED | Wired to the home and coin providers |
| `apps/web/lib/coins.ts`, `lib/trades.ts`, `app/api/coins`, `app/api/coin/[mint]/{candles,trades}` | VERIFIED | Real Drizzle queries, no static returns |
| `apps/web/app/page.tsx`, `components/home-*.tsx`, `coin-card.tsx` | VERIFIED | Data flows from the queries plus live events |
| `apps/web/app/coin/[mint]/page.tsx`, `token-chart*.tsx`, `token-trades.tsx`, `token-stats.tsx`, `token-bond.tsx` | VERIFIED | Data flows from the queries plus live events |
| `apps/web/app/coin/[mint]/opengraph-image.tsx`, `app/opengraph-image.tsx`, `lib/og.tsx` | VERIFIED | |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| Helius WS | ingestTx | logsSubscribe on the BONDR mint, queue, fetchTx, parseTx, writeParsed | WIRED |
| ingest | /events | `arm`, then `announce`, then `publish` (live only; a gap fill sends `skipId`, which triggers a resync) | WIRED |
| worker /events | web hub | NDJSON with WORKER_TOKEN, server-only | WIRED |
| hub | browser | `/api/live` SSE, then `useLive`, then the HomeLive and CoinLive providers | WIRED |
| token page render | first stream | `hub.head()` taken before the read and sent as `?last=` | WIRED (11e2a1b) |
| chart | candles API | fetch per interval, `liveBar` on trade events, buffered until the chart is ready | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Unit suite | `pnpm -s test` | 34 files, 205 passed, 1 skipped | PASS |
| Types | `pnpm -s typecheck` | exit 0 | PASS |
| Debt markers in phase files | rg TBD/FIXME/XXX/TODO/HACK over `git diff e970c0e..HEAD` sources | none | PASS |
| File size | wc over phase .ts/.tsx | no file over 300 lines | PASS |
| Playwright / staging | not run (not allowed) | orchestrator evidence: 180/2 skipped full, 24/3 skipped staging | SKIP |

### Probe Execution

No `scripts/*/tests/probe-*.sh` is declared for this phase. The 03-01 stream probe was a one-off Wave 0 devnet check, so Step 7c was skipped.

### Requirements Coverage

| Req | Status | Evidence |
| --- | --- | --- |
| LIST-01 | SATISFIED | Trending scroller, 1h volume with the D-13 fallback, up to 10 cards (the owner kept zero-volume cards at the end) |
| LIST-02 | SATISFIED | Top orders by `mcap_sol` desc |
| LIST-03 | SATISFIED | Latest / Oldest tabs, grid capped at 5 columns |
| LIST-04 | SATISFIED | Card fields plus live updates through HomeLiveProvider |
| LIST-05 | SATISFIED | Search by name, symbol or mint |
| TOKEN-01 | SATISFIED | lightweight-charts 5.2.1 with 1m/5m/1h/1d |
| TOKEN-02 | SATISFIED | Live feed plus holders |
| TOKEN-06 | SATISFIED | OG card, signed off on X and Telegram |

No requirement mapped to Phase 3 is orphaned.

### Anti-Patterns and Residual Risks (WARNING / INFO, not blockers)

| Where | Issue | Severity |
| --- | --- | --- |
| `ingest.ts` failed map | Retries live in memory only. A worker restart while a signature waits loses that trade for good (`ponytail:`, the upgrade is a `filled_sig` column) | WARNING |
| `ingest.ts` gapFill `until` | S-IN-01 was skipped: the same-slot `until` edge can skip a sibling tx in the boundary slot | WARNING |
| `trades.ts priceAt` | A gap-filled old tx with no BONDR leg is priced at today's BONDR price (`ponytail:`) | INFO |
| chart buffer | A buffered trade the candle read already counted adds its volume twice to that bar (`ponytail:`) | INFO |
| per-process caches, hub, IP caps | Correct only while web runs a single replica (`ponytail:`) | INFO |
| C-IN-02..05, 08, 09; S-IN-03, 04, 06, 08, 09 | Review info items left by scope | INFO |

### Human Verification Required

1. **Redeploy HEAD to staging and re-run the staging checks.** Done 2026-10-24: 24 passed, 4 skipped, live buy in 2.6 s. All staging evidence (2.9 s live buy, Neon idle, staging specs, card sign-off) predates about 30 review-fix commits that changed the indexer recovery, holder, hub and replay code.
2. **First real bond and PumpSwap trades.** Only the fork fixtures prove the pool path. Devnet cannot bond a child (A8), and staging has no bonded coin.
3. **Review the S-CR-01 retry and marks logic,** which the fixer flagged for a human check. Done: the orchestrator read it on 2026-10-24 and agrees.

### Gaps Summary

There are no blocking gaps. Every roadmap criterion and requirement exists, is substantive and is wired in code, and unit tests and types are green. What is left is real-world proof. The post-review build has not run on staging, and post-bond PumpSwap ingestion has never run live. Two known trade-loss edges remain: the in-memory retry is lost on restart, and the same-slot `until` boundary (S-IN-01) can skip a sibling tx. Both are documented as deliberate ceilings and are not fixed.

---

_Verified: 2026-10-24_
_Verifier: Claude (gsd-verifier)_
