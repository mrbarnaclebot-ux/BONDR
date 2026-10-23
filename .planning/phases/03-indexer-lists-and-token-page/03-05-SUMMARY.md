---
phase: 03-indexer-lists-and-token-page
plan: 05
subsystem: token-page
tags: [token-page, trade-feed, keyset, format]
requires:
  - 03-04 trades and coins tables, TradeRow
provides:
  - lib/format.ts mcapSol, tradeSol, signedPct, curvePct, relTime, thousands
  - lib/trades.ts tradesPage(mint, before?) and parseCursor
  - GET /api/coin/[mint]/trades (older pages by slot.seq cursor)
  - components/token-trades.tsx TradeFeed
  - TxLink icon-only variant (label prop)
  - e2e/fixtures.ts seedCoin and dropCoin (shared by later specs and lib/trades.test.ts)
  - token page grid with an empty 380px right slot for Bond and burn (03-06)
affects: [03-06, 03-07, 03-08]
tech-stack:
  added: []
  patterns: [row-value keyset (slot, seq) < (a, b) with limit PAGE+1 for more, per-process 10 s page cache]
key-files:
  created:
    - apps/web/lib/trades.ts
    - apps/web/lib/trades.test.ts
    - apps/web/app/api/coin/[mint]/trades/route.ts
    - apps/web/components/token-trades.tsx
    - apps/web/e2e/fixtures.ts
  modified:
    - apps/web/lib/format.ts
    - apps/web/lib/format.test.ts
    - apps/web/e2e/coin.e2e.ts
    - apps/web/components/tx-link.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/proxy.ts
    - apps/web/components/README.md
    - apps/web/lib/README.md
    - apps/web/e2e/README.md
decisions:
  - "03-05: the feed cursor is the last row's \"slot.seq\"; parseCursor also refuses values past int8 max so a bad cursor is a 400, never a DB error"
  - "03-05: Load more ends on more=false from the server (limit 51), not on spotting the launch rows client-side"
  - "03-05: seeded e2e coins get launches.created_at a year back so the specs' newest-landed-launch query never picks one"
  - "03-05: curvePct floors to 1 decimal so the gauge never reads 100.0% before the curve is complete"
metrics:
  duration: 11 min
  completed: 2026-10-23
  tasks: 3
  files: 14
---

# Phase 3 Plan 05: Token Page Trade Feed Summary

The token page now shows a Trades table (50 newest, keyset Load more back to the launch transaction's two Launch rows under the "Launch transaction: ... then insta burn/sell." caption), backed by a `(slot, seq)` keyset read and a validated older-trades route, plus every Phase 3 number formatter.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Feed e2e (failing) and Phase 3 number formatters | 5264d1b |
| 2 | Keyset feed read and older-trades route | fdeaf41 |
| 3 | TradeFeed on the token page with the wide-left layout | 1e44cbc |

## Verification

- `pnpm vitest run apps/web/lib`: 6 files, 32 passed, 1 skipped (pinata live).
- `trades.test.ts` against Neon dev: 50 then 10 rows, newest first, no overlap, no gap, both launch rows last; cursor parsing.
- `playwright test apps/web/e2e/coin.e2e.ts`: 14 passed (404, found, trades feed, route 404/400/200, Trader hidden at 390).
- `responsive.e2e.ts -g coin`: 6 passed (axe and no horizontal scroll at 390, 768, 1440); its regenerated Phase 2 screenshots were discarded.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build`, `scripts/check-client-bundle.sh`: all pass.
- Screenshot at 1440 checked by eye: Trades in the wide left column, launch caption with dashed rule, Launch rows in mint, "burned" muted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Route checks live in the e2e, not a vitest**
- **Found during:** Task 2
- **Issue:** vitest has no `@/` alias, so the route file cannot be imported in a unit test.
- **Fix:** the 404 / 400 / 200 checks run in the coin.e2e.ts trades group through `request`.
- **Commit:** fdeaf41

**2. [Rule 1 - Bug] TxLink accessible name**
- **Found during:** Task 3
- **Issue:** the sr-only "(opens Solscan)" had no leading space, so the name could run into the label.
- **Fix:** `{" (opens Solscan)"}`; existing callers unchanged otherwise.
- **Commit:** 1e44cbc

**3. [Rule 3 - Blocking] Load more assertion timeout**
- **Found during:** Task 3
- **Issue:** the dev server compiles the route on its first request, past the 5 s default.
- **Fix:** 20 s timeout on that one assertion, with a comment.
- **Commit:** 1e44cbc

**4. Fixture seeding batched**
- 60 single inserts took about 30 s against Neon; one multi-row insert keeps seq in VALUES order, which trades.test.ts asserts.

## Not in this plan

- The Live indicator, live row inserts and the reconnect refetch (D-18) arrive with the stream in 03-07.
- The right column is an empty slot until Bond and burn (03-06).

## Known Stubs

- `apps/web/app/coin/[mint]/page.tsx`: empty right-column `div` at 1100px and up; 03-06 fills it with Bond and burn (planned, D-11a).

## Threat Flags

None. The new route is in the threat model (T-03-05-01, -02, -04 mitigated as planned).

## Self-Check: PASSED

- All created files exist; commits 5264d1b, fdeaf41 and 1e44cbc are in git log.
