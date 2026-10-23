---
phase: 3
slug: indexer-lists-and-token-page
status: draft
nyquist_compliant: false
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

| Requirement | Behavior | Threat Ref | Test Type | Automated Command | File Exists | Status |
|-------------|----------|------------|-----------|-------------------|-------------|--------|
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

- [ ] `scripts/capture-tx.ts`: save a devnet tx (raw `getTransaction` JSON) into `packages/core/src/fixtures/`
- [ ] Fixtures: launch (burn), launch (sell), curve buy and sell, multi-hop SOL to child, a pool buy/sell after migration (devnet if A8 holds, else Surfpool fork), a BONDR-only trade
- [ ] `scripts/devnet-trades.ts`: buy and sell a coin with the sim wallet; `--complete` buys the curve out and waits for migration
- [ ] Stream probe (A1, A2): assert notifications for a launch, a curve trade and a multi-hop trade, and that they appear in `getSignaturesForAddress(mint)`
- [ ] Static OG fonts under `apps/web/assets/og/` with `OFL.txt`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Neon stays able to scale to zero with browsers connected | D-04 | Needs the live Neon console over minutes | Open `/` on staging, leave idle 10 min, confirm the compute suspends (Neon console) |
| Share card renders on X and Telegram | TOKEN-06 | Third-party crawlers | Paste a staging coin link in Telegram and the X card validator |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
