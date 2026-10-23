---
phase: 03-indexer-lists-and-token-page
plan: 10
subsystem: token-chart
tags: [chart, lightweight-charts, candles, token-page]
requires:
  - 03-09 CoinLiveProvider (subscribe for live trades and resync, live bondedAt)
  - 03-05 trades table read model (lib/trades.ts)
provides:
  - lib/trades.ts candles(mint, seconds), parseInterval(s), bondTime(mint)
  - GET /api/coin/[mint]/candles?interval=1m|5m|1h|1d -> { candles, bondTime }
  - components/ui-seg.tsx Seg (fieldset group, aria-pressed buttons, CSS sliding indicator), reusable by 03-11 sort tabs
  - components/token-chart.tsx McapChart; components/token-chart-draw.ts chart options, showCandles, placeBond, liveBar
  - lib/format.ts chartInterval(launchedAt) (D-17 default)
affects: [03-11, 03-13, 03-14]
tech-stack:
  added: [lightweight-charts@5.2.1 (exact pin; dependency fancy-canvas@2.1.0)]
  patterns: [candles computed on read with lag() open, library loaded by dynamic import inside an effect, CSS tokens resolved to rgba through a 1px canvas]
key-files:
  created:
    - apps/web/app/api/coin/[mint]/candles/route.ts
    - apps/web/components/ui-seg.tsx
    - apps/web/components/token-chart.tsx
    - apps/web/components/token-chart-draw.ts
    - apps/web/components/token-chart-draw.test.ts
  modified:
    - apps/web/lib/trades.ts
    - apps/web/lib/trades.test.ts
    - apps/web/lib/format.ts
    - apps/web/lib/format.test.ts
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/components/chrome.tsx
    - apps/web/components/README.md
    - apps/web/e2e/coin.e2e.ts
    - apps/web/package.json
    - pnpm-lock.yaml
key-decisions:
  - "03-10: the chart's role=img text summary is an overlay sibling of the canvas, not its wrapper, because lightweight-charts puts the attribution link inside the chart and an img role may not contain a link (axe nested-interactive)"
  - "03-10: the default interval is computed on the server from coins.launched_at (else the launch's created_at), so the pressed button never mismatches on hydration"
  - "03-10: CSS color tokens are oklch color-mix values the library's color parser rejects; they are converted to rgba through a 1px canvas"
duration: 19min
completed: 2026-10-23
---

# Phase 3 Plan 10: Market cap chart Summary

The token page now has a lightweight-charts 5.2.1 market cap chart in SOL. It sits full width between the contract address row and the feed and bond columns. It has 1m, 5m, 1h and 1d candles, a volume histogram, a mint dotted last-price line, and a "Bonded" marker on the bond candle. Candles are computed on read from `trades`. Each candle opens at the previous trade's market cap, so the first opens at the launch price (D-16). Live trades update the last candle or append a new one from the stream, with no polling.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Chart e2e (failing), candles computed on read and the candles route | 3ccf912 (RED), b45c749 |
| 2 | Install lightweight-charts, Seg and the McapChart on the token page | aca1cdd |

## What was built

- **Candles SQL** (`lib/trades.ts`). This is the RESEARCH Pattern 6 query:
  - `lag(mcap_sol)` gives each trade's open, with the coin's `launch_mcap_sol` as the first open.
  - `side <> 'burn'` keeps burns out.
  - Buckets are `floor(epoch / seconds) * seconds`, and volume is `sum(sol) / 1e9`.
  - Results are kept 10 s per (mint, interval) in a per-process map that clears at 1000 entries. A failed read is not kept. The `ponytail:` comment names the ceiling: store rollups past about 100k trades per coin.
- **Route.** The route checks in this order:
  - a bad mint (`BASE58_KEY`) is 404
  - an interval outside the enum is 400
  - a DB failure is 503
  - otherwise it returns `{ candles, bondTime }` with `cache-control: no-store`

  `bondTime` is one primary-key read of `coins.bonded_at`. The existing proxy read limit covers `/api/coin/:path*`.
- **Seg.** A `fieldset` (native role group) with `aria-label` and native `aria-pressed` buttons. The indicator slides with CSS only:
  - width is `calc((100% - 8px) / n)`
  - position is `translateX(calc(var(--i) * 100%))`
  - motion is a 520 ms spring

  Buttons are 44 px tall below 768 px and 36 px from 768 px.
- **McapChart.**
  - **Loading.** `import("lightweight-charts")` runs inside `useEffect`, so nothing loads on the server or in first-load JS. `chart.remove()` runs on unmount.
  - **Options.** All options follow the UI-SPEC table: font from `--font-martian`, `attributionLogo` true, mouse wheel off, `pan-y` touch, a custom `mcapSol` price format with `minMove: 0.01`, and local-time `Intl.DateTimeFormat` tick and crosshair labels. Volume uses its own hidden scale with `scaleMargins: { top: 0.84 }`.
  - **Interval switch.** The pressed button moves at once. The old chart stays at 50% opacity with `aria-busy` until the new data arrives.
  - **States.** The panel shows "Loading chart…", the no-candles copy, or the load-failed alert. Clicking the pressed interval refetches it after a failure.
  - **Readout.** It shows "O H L C ... SOL mcap" for the hovered candle, else the last one.
  - **Live updates** come through `liveBar`:
    - a trade in the same bucket widens the last candle
    - a trade in a newer bucket appends a candle that opens at the last close
    - an older bucket, a burn, or an unpriced trade is dropped
    - a resync refetches the candles once
  - **Bonded marker.** It is drawn with `createSeriesMarkers` from the route's `bondTime`, or from the live `bondedAt` after a bond event.
- **Footer.** "Charts by TradingView" links to https://www.tradingview.com/ (new tab, `rel="noopener"`, sr-only "(opens TradingView)").

## Verification

- `trades.test.ts` (Neon dev): 5 passed. This includes the candle cases:
  - 1m gives two continuous candles with the launch open and volume in SOL
  - 5m, 1h and 1d each give one candle
  - a burn priced 999 never shows up
  - `parseInterval` accepts only the four values
- `token-chart-draw.test.ts`: `liveBar` updates, appends and drops correctly. `format.test.ts`: `chartInterval` boundaries at 6 h and 72 h.
- `coin.e2e.ts` chart group:
  - the sr-only heading, the "Candle interval" group, and 1m pressed by default
  - the role img label "{SYMBOL} market cap in SOL, 1 minute candles. Last …", a canvas in the panel, and the OHLC readout
  - clicking 1h sends `interval=1h` and relabels to "1 hour candles"
  - the footer credit
  - route results: 404, 400, and 200 with the launch open
- Playwright runs:
  - Full suite: 127 passed, 2 skipped (devnet groups), 3 failed on the first run. The 3 were responsive coin axe `nested-interactive`, fixed as Deviation 1.
  - Rerun of coin, chart and responsive (coin, coin-404): 25 passed, 0 axe violations.
  - `live.e2e.ts`: passes.
- `pnpm test`: 184 passed, 1 skipped. `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` and `scripts/check-client-bundle.sh` all pass.
- rg gates:
  - `"lightweight-charts": "5.2.1"` pinned
  - no `addCandlestickSeries` or `setMarkers(` (v5 API only)
  - no `lightweight-charts` import under `app/`
  - `lag(` and `side <> 'burn'` are in `trades.ts`
- Screenshots at 390 and 1440 of a real devnet coin (12 trades) show green and red candles, volume bars, the mint last-price label, local time ticks and the attribution logo.
- **Package age (D-07):** `npm view lightweight-charts@5.2.1 time` gives 2026-08-12T11:37:41Z, 72 days before 2026-10-23. Its only dependency is `fancy-canvas` 2.1.0, and it has no install scripts.

## Deviations from Plan

**1. [Rule 1 - Accessibility bug] The role img is an overlay, not the canvas wrapper.**
- **Found during:** the full Playwright run. responsive.e2e coin at 390, 768 and 1440 failed axe `nested-interactive`.
- **Issue:** lightweight-charts appends its attribution `<a>` inside the chart's pane cell. A `role="img"` around the chart therefore contains a link.
- **Fix:** The summary `role="img"` (with `aria-busy`) is a `pointer-events-none` sibling covering the chart. The canvas and the attribution link sit beside it. The e2e checks the canvas inside the "Market cap chart" region instead of inside the img.
- **Commit:** aca1cdd

**2. [Rule 3 - Blocking] Colors go through a canvas.** The tokens are `color-mix(in oklch, …)`. The library parses colors with a regex on `getComputedStyle().color` and throws on `oklch(...)`. A 1px canvas converts each token to `rgba()`.

**3. Split for the size limits.** The library side (options, series, data, marker, `liveBar`) is in `token-chart-draw.ts`, which imports only types from lightweight-charts. It imports `../lib/format` relatively so its Vitest test loads without the `@` alias. `token-chart.tsx` holds the component and hooks. Both files are under 190 lines.

**4. `mcap_sol is not null`** was added to the candle filter. An unpriced row would otherwise reset `lag()` to the launch price in the middle of the series.

**5. `bondTime` is a narrow read.** It is a `coins.bonded_at` primary-key read, not `coinByMint` with its windowed subqueries.

**6. The default interval is computed on the server** with `chartInterval` in `lib/format.ts` and passed as `initial`, so there is no hydration mismatch.

**7. The plan's verify command** passes paths to `pnpm vitest run`. The root `pnpm test` runs the same files.

## Known Stubs

None.

## Notes for the owner

- The server keeps candles 10 s, so an interval switch right after a trade can briefly miss that trade until the next one arrives. Only the switch is affected; the live path is not.
- `ponytail:` candles scan every trade of a coin per (mint, interval) every 10 s. Add rollups past about 100k trades per coin.
- Clicking the in-chart TradingView logo sends the page path as `utm_source`; the library sets this. It is a click-only outbound link and CSP is unchanged.
- Staging needs the 03-14 redeploy. No Railway change was made. TOKEN-01 is delivered on the token page.

## Self-Check: PASSED

- Files: route.ts, ui-seg.tsx, token-chart.tsx, token-chart-draw.ts and token-chart-draw.test.ts are present.
- Commits 3ccf912, b45c749 and aca1cdd are in git log.
