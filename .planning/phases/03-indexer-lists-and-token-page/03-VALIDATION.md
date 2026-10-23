---
phase: 3
slug: indexer-lists-and-token-page
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-23
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 03-RESEARCH.md "Validation Architecture". The planner fills task IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (units, DB integration on the Neon dev branch); Playwright 1.63.0 + @axe-core/playwright 4.13.0 (e2e) |
| **Config file** | root `package.json` (`vitest run`), `playwright.config.ts` (`*.e2e.ts`) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` (devnet groups with `E2E_DEVNET=1`) |
| **Estimated runtime** | ~30 s quick, ~3 min full |

---

## Sampling Rate

- **After every task commit:** `pnpm test`
- **After every plan wave:** `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`
- **Before `/gsd:verify-work`:** full suite, the `E2E_DEVNET=1` groups and the staging run (`E2E_BASE_URL`) green
- **Max feedback latency:** 60 seconds

---

## Per-Requirement Verification Map

| Task ID | Requirement | Behavior | Threat Ref | Test Type | Automated Command | File Exists | Status |
|---------|-------------|----------|------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | LIST-04, TOKEN-02 | wsUrl redacts the key; probe listens | T-03-01-01 | unit + script | `pnpm vitest run packages/core/src/net.test.ts` | extend | pending |
| 03-01-T2 | LIST-04, TOKEN-02 | A1/A2 probe: launch, curve and multi-hop notified and in getSignaturesForAddress; 7 fixtures | T-03-01-02 | devnet script | `node --env-file=.env scripts/stream-probe.ts --check ...` | W0 | pending |
| 03-01-T3 | LIST-04 | A8: pool fixtures (devnet or fork) | T-03-01-02 | devnet/fork script | `ls packages/core/src/fixtures` count 4 | W0 | pending |
| 03-02-T1 | LIST-01..04 (data) | Pump TradeEvent (quoteAmount), AMM Buy/Sell, CreatePoolEvent, PostCompleteBuyEvent decode; forged authority rejected | T-03-02-01 | unit | `pnpm vitest run packages/core/src/events.test.ts` | partial | pending |
| 03-02-T2 | LIST-04, TOKEN-01 | Price, market cap (fixed 1B supply, D-22), progress, bondrAtBond against fixture numbers | — | unit | `pnpm vitest run packages/core/src/price.test.ts` | W0 | pending |
| 03-02-T3 | LIST-01..04 (data) | parseTx: Launch rows (burn synthetic, sell), unknown mints ignored, same-tx BONDR price, pool venue | T-03-02-02 | unit | `pnpm vitest run packages/core/src/trades.test.ts` | W0 | pending |
| 03-03-T1/T2 | TOKEN-06 | OG card 1200x630 PNG immutable; unknown mint gets the site card with a short cache; og/twitter meta | T-03-03-01 | e2e | `pnpm e2e apps/web/e2e/og.e2e.ts` | W0 | pending |
| 03-04-T1 | LIST-03, TOKEN-02 | coins/trades constraints and PK idempotency | T-03-04-02 | integration | `pnpm db:migrate && pnpm vitest run packages/core/src/db.test.ts` | extend | pending |
| 03-04-T2 | LIST-04 | Idempotent ingest, patches only on insert | T-03-04-01 | integration | `pnpm vitest run apps/worker/src/ingest.test.ts` | W0 | pending |
| 03-05-T1 | LIST-04 | Number formats (mcap tiers, U+2212 sign, curve %) | — | unit | `pnpm vitest run apps/web/lib/format.test.ts` | extend | pending |
| 03-05-T2 | TOKEN-02 | Feed keyset pagination, cursor validation | T-03-05-01 | integration | `pnpm vitest run apps/web/lib/trades.test.ts` | W0 | pending |
| 03-05-T3 | TOKEN-02 | Feed with Launch rows, Load more to the launch | — | e2e | `pnpm e2e apps/web/e2e/coin.e2e.ts` | extend | pending |
| 03-06-T1/T2 | TOKEN-02, LIST-04 | coinByMint windowed values; stats, holders, venue tag, bond panel states | T-03-06-01 | integration + e2e | `pnpm vitest run apps/web/lib/coins.test.ts && pnpm e2e apps/web/e2e/coin.e2e.ts` | W0 | pending |
| 03-07-T1 | LIST-04 | Prefilter, backoff, gap fill paging | T-03-07-02 | unit | `pnpm vitest run apps/worker/src/stream.test.ts` | W0 | pending |
| 03-07-T2 | TOKEN-02 | Holders exclude curve, pool, incinerator, zero balances; 5 min throttle | T-03-07-03 | unit | `pnpm vitest run apps/worker/src/holders.test.ts` | W0 | pending |
| 03-08-T1 | LIST-04, TOKEN-02 (live) | Worker /events bearer, NDJSON lines, increasing ids | T-03-08-02 | unit | `pnpm vitest run apps/worker/src/events-route.test.ts` | W0 | pending |
| 03-08-T2 | LIST-04, TOKEN-02 (live) | Hub fan-out, ?mint filter, Last-Event-ID replay, resync on epoch change, NDJSON split across chunks | T-03-08-01 | unit | `pnpm vitest run apps/web/lib/live-hub.test.ts` | W0 | pending |
| 03-09-T1/T2 | LIST-04, TOKEN-02 (live) | Stubbed SSE insert and flash; devnet buy shows without reload within 15 s | T-03-09-01 | e2e + e2e devnet | `pnpm e2e apps/web/e2e/live.e2e.ts && E2E_DEVNET=1 pnpm e2e apps/web/e2e/live.e2e.ts -g devnet` | W0 | pending |
| 03-10-T1 | TOKEN-01 | Candles: open = previous close, first open = launch mcap, burn excluded, bucket sizes | T-03-10-01 | integration | `pnpm vitest run apps/web/lib/trades.test.ts` | W0 | pending |
| 03-10-T2 | TOKEN-01 | Chart canvas, interval switch, default interval by age | T-03-10-SC | e2e | `pnpm e2e apps/web/e2e/coin.e2e.ts` | extend | pending |
| 03-11-T1..T3 | LIST-02, LIST-03, LIST-04 | Sort orders, pages, hero counts; home hero, grid, tabs | T-03-11-01 | integration + e2e | `pnpm vitest run apps/web/lib/coins.test.ts && pnpm e2e apps/web/e2e/home.e2e.ts` | W0 | pending |
| 03-12-T1 | LIST-05 | Search escapes `%` and `_`, mint prefix, length cap, full-mint navigation | T-03-12-01 | integration + e2e | `pnpm vitest run apps/web/lib/coins.test.ts && pnpm e2e apps/web/e2e/home.e2e.ts -g search` | W0 | pending |
| 03-12-T2 | LIST-01 | Trending modes 1h / 24h / latest; scroller arrows | — | integration + e2e | `pnpm e2e apps/web/e2e/home.e2e.ts` | W0 | pending |
| 03-13-T1 | LIST-04 | Pure live list rules (apply, rerank, decay, insert) | — | unit | `pnpm vitest run apps/web/lib/live-list.test.ts` | W0 | pending |
| 03-13-T2 | LIST-04 | Live cards, flash, re-rank hold, new launch glow | T-03-13-02 | e2e | `pnpm e2e apps/web/e2e/home.e2e.ts` | W0 | pending |
| 03-14-T1 | LIST-01..05, TOKEN-01..02 | Axe 0 and no horizontal scroll at 390 / 768 / 1440; screenshots | — | e2e | `pnpm e2e apps/web/e2e/responsive-lists.e2e.ts` | W0 | pending |
| 03-15-T2 | all | Staging matrix, og and live devnet trade on staging | T-03-15-01 | e2e staging | `E2E_BASE_URL=$STAGING_URL pnpm e2e apps/web/e2e/responsive-lists.e2e.ts apps/web/e2e/og.e2e.ts` | W0 | pending |
| 03-15-T3 | D-04, TOKEN-06 | No DB reads while `/` idles (Neon suspends); card renders in Telegram and X | T-03-15-03 | manual | owner checkpoint | manual | pending |

-------------|----------|------------|-----------|-------------------|-------------|--------|
| LIST-01..04 (data) | Pump TradeEvent (BONDR quote, use `quoteAmount`), AMM Buy/Sell, CreatePoolEvent, PostCompleteBuyEvent decode from real txs | forged trade data | unit | `pnpm vitest run packages/core/src/events.test.ts` | partial | pending |
| LIST-01..04 (data) | `parseTx`: launch burn and sell give Launch rows; unknown mints ignored; SOL value from same-tx BONDR price | — | unit | `pnpm vitest run packages/core/src/trades.test.ts` | W0 | pending |
| LIST-04, TOKEN-01 | Price, market cap (fixed 1B supply, D-22), progress against fixture numbers | — | unit | `pnpm vitest run packages/core/src/price.test.ts` | W0 | pending |
| LIST-01..03 | Idempotent insert; trending modes 1h / 24h / latest; Top / Latest / Oldest order | — | integration | `pnpm vitest run apps/web/lib/coins.test.ts` | W0 | pending |
| LIST-05 | Search escapes `%` and `_`, mint prefix, length cap | heavy query | integration | same file | W0 | pending |
| TOKEN-01 | Candles: open = previous close, first open = launch mcap, bucket sizes | — | integration | `pnpm vitest run apps/web/lib/trades.test.ts` | W0 | pending |
| TOKEN-02 | Feed keyset pagination; holders exclude curve, pool, incinerator, zero balances | — | unit | `pnpm vitest run apps/worker/src/holders.test.ts` | W0 | pending |
| LIST-04, TOKEN-02 (live) | Hub fan-out, `?mint` filter, Last-Event-ID replay, NDJSON split across chunks | SSE exhaustion | unit | `pnpm vitest run apps/web/lib/live-hub.test.ts` | W0 | pending |
| LIST-01..05 | Home lists, tabs, search, full-mint navigation; axe 0 at 390 / 768 / 1440; screenshots | — | e2e | `pnpm e2e apps/web/e2e/home.e2e.ts` | W0 | pending |
| TOKEN-01, TOKEN-02 | Chart canvas, interval switch, feed with Launch rows, Load more, holders | — | e2e | `pnpm e2e apps/web/e2e/coin.e2e.ts` | extend | pending |
| LIST-04, TOKEN-02 (devnet live) | A devnet buy shows in the feed and on the card without reload within 15 s | — | e2e devnet | `E2E_DEVNET=1 pnpm e2e apps/web/e2e/live.e2e.ts` | W0 | pending |
| TOKEN-06 | OG card 1200x630 PNG with immutable cache; unknown mint gets the site card; og/twitter meta present | SSRF via image | e2e | `pnpm e2e apps/web/e2e/og.e2e.ts` | W0 | pending |
| D-04 | No DB query while a browser idles on `/` with the stream open | — | manual + e2e | staging check in VERIFICATION | manual | pending |

---

## Wave 0 Requirements

- [ ] `scripts/capture-tx.ts`: save a devnet tx (raw `getTransaction` JSON) into `packages/core/src/fixtures/` (03-01-T1)
- [ ] Fixtures: launch (burn), launch (sell), curve buy and sell, multi-hop SOL to child, a pool buy/sell after migration (devnet if A8 holds, else Surfpool fork), a BONDR-only trade (03-01-T2, 03-01-T3)
- [ ] `scripts/devnet-trades.ts`: buy and sell a coin with the sim wallet; `--complete` buys the curve out and waits for migration (03-01-T2, 03-01-T3)
- [ ] Stream probe (A1, A2): assert notifications for a launch, a curve trade and a multi-hop trade, and that they appear in `getSignaturesForAddress(mint)` (03-01-T1, 03-01-T2)
- [ ] Static OG fonts under `apps/web/assets/og/` with `OFL.txt` (03-03-T1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Neon stays able to scale to zero with browsers connected | D-04 | Needs the live Neon console over minutes | Open `/` on staging, leave idle 10 min, confirm the compute suspends (Neon console) |
| Share card renders on X and Telegram | TOKEN-06 | Third-party crawlers | Paste a staging coin link in Telegram and the X card validator |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (03-01 scripts and fixtures; OG fonts in 03-03-T1)
- [x] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
