---
phase: 03-indexer-lists-and-token-page
fixed_at: 2026-10-24T00:00:00Z
review_path: .planning/phases/03-indexer-lists-and-token-page/03-REVIEW.md
iteration: 1
scope: client half (C-CR-*, C-WR-*, one- or two-line C-IN-*)
findings_in_scope: 17
fixed: 16
partial: 1
skipped: 0
status: partial
---

# Phase 3: Code Review Fix Report (client half)

**Source review:** `03-REVIEW.md`, client half. The server half (S-*) was fixed separately.

**Summary:** C-CR-01 and C-WR-01 to C-WR-12 attempted. All are fixed except the feed half of C-WR-02, which needs a
server-side change outside this fixer's files. Fixed info items: C-IN-01, C-IN-06, C-IN-07, C-IN-10.

## Fixed

| Finding | Commit | What changed |
| --- | --- | --- |
| C-CR-01 | 455fa1f | `opengraph-image.tsx` sends `immutable` only when the image embedded or the coin has no image. Otherwise it sends the 5 minute cache. The check is `og.e2e.ts`, "a coin whose image did not embed gets a short cache": a landed fixture whose CID no gateway has. |
| C-WR-01 | 21dd64b, 33021d9 | New `fresher` and `mergePage` in `lib/live-list.ts`. When a kept page or a resync lands, a local copy with a newer `lastTradeAt` wins. In Latest with no search, local launches newer than the page's newest stay in front. Used by Show more and tab loads (`home-coins`), the home resync (`home-live`) and the token page resync row (`coin-live`). Vitest: `mergePage ...`. |
| C-WR-03 | 612ff24, 5903825 | New `addTrades` and `resyncFeed` in `lib/live-list.ts`. Live rows, Load more and resync pages merge in BigInt `(slot, seq)` order. A resync page with `more` that contains no server-loaded row replaces the older rows. Live rows newer than the page's oldest row stay, because the page can be 10 s old (S-WR-05). Load more fills down from it. The feed state is now one `{ rows, more }`. Vitest: `addTrades ...`, `resyncFeed ...`. |
| C-WR-04 | 21dd64b | The home provider keeps a `view` ref. A resync answer is dropped if the sort or search changed while it was in flight. A launch reads the current view, not a captured one. |
| C-WR-05 | 21dd64b | `/api/coins?trending=1` also returns `heroCounts()`. On resync the client takes the server counts, and keeps a local count only where it is higher, because the kept server count can lag a live launch by 10 s. The worker's bond event is unchanged (it still carries only the final venue), so the server count corrects any missed bond. |
| C-WR-06 | 21dd64b | A failed Show more keeps the grid and shows "Could not load more coins. Try again." under the button. Only a page-0 failure replaces the grid. |
| C-WR-07 | d0abf14 | Card images are `draggable={false}`. `pointercancel` ends the drag. The scroller captures the pointer once a drag passes 4px; capture waits until then so a plain click still lands on the card. |
| C-WR-08 | 612ff24 | The feed's time `title` is set only after mount (`useClock().local`), so it shows the viewer's zone and locale. |
| C-WR-09 | 85f6420 | Seeded symbols are always 5 digits (`E00042`), so no card name matches another seeded symbol. |
| C-WR-10 | 85f6420 | The BLINK (`coin.e2e.ts`) and BCARD (`og.e2e.ts`) landed fixtures are back-dated a year, like `seedCoin`, so a parallel `newest()` never picks them. |
| C-WR-11 | 21dd64b, 612ff24, a139993, d0abf14, d072f3e, 85f6420, ab8f09f | `coin.e2e.ts` is down to 296 lines: the chart specs moved to `coin-chart.e2e.ts`. Every listed function is now under 40 lines: `Listing`, `ShowMore` and `Controls` came out of HomeCoins; `Chips` and `Age` out of CoinCard; `ChartFrame` and `useBondMarker` out of McapChart and useDrawn; `FeedHead`, `useClock` and `LoadMore` out of FeedTable and TradeFeed; `Panels` out of CoinPage; `Gradient` out of BondGlyph; `Gauge` out of BondPanel; `dragHandlers` out of useDrag; `tradeRows` out of seedCoin. Also `Ctas` out of HomeHero and `onKeys` out of SearchBox, which had reached 41 lines. |
| C-WR-12 | d072f3e | A quiet "Pause animation" / "Play animation" text button below the pulse line. It pauses the video through a ref and sets `animation-play-state: paused` on the breathe, the motes and the live dot (`.hero[data-paused]`). Under reduced motion nothing moves, so the button is not rendered. e2e: `home.e2e.ts`, "Pause animation holds the hero video and motes". |
| C-IN-01 | 21dd64b | Only coins in the grid or Trending get a flash entry. |
| C-IN-06 | 612ff24 | `SIDE` has a `burn` entry ("Burn", muted) and is indexed by `t.side`. |
| C-IN-07 | 455fa1f | `generateImageMetadata` types `params` as a `Promise`. |
| C-IN-10 | 21dd64b | `syncUrl` keeps `location.hash`. |

## Partial

### C-WR-02: trades between the cached token page render and the first stream connect

- **Fixed, chart half (a139993):** `useDrawn` buffers live trades that land before the chart library and the candles are ready, and replays them through `liveBar` on the first draw. A `ponytail:` note names the edge case: a buffered trade the candle read already counted adds its volume to that bar twice.
- **Fixed later by the orchestrator, feed half:** `/api/live` now takes `last` as a fallback for Last-Event-ID; `page.tsx` takes `hub.head()` before its kept read and the first EventSource sends it, so the hub replays trades that landed after the render. Originally skipped: the first EventSource can't send a `Last-Event-ID` header. Opening `/api/live?mint=…&last=<id>` needs `apps/web/app/api/live/route.ts` to read a `last` query param as a fallback for the header. That file belongs to the server fixer. Once it does, the client side is two lines:
  - `page.tsx` captures `hub.head()` inside its `kept` read and passes it down.
  - `use-live.ts` appends it to the first URL.

  A client-only refetch on first open would add a Neon read to every page view (D-04), so it was not done.

## Not fixed (C-IN, more than one or two lines, left by scope)

C-IN-02 (three handler guards), C-IN-03, C-IN-04, C-IN-05, C-IN-08, C-IN-09.

## Notes

- Functions over 40 lines remain in Phase 2 files that the review did not list (`consent-dialog.tsx`, `launch-coin.tsx`, `wallet-button.tsx`, `e2e/phantom.ts`, `e2e/responsive.e2e.ts`). They were left out of scope.
- `app/globals.css` was already over 300 lines (392) before these fixes; the pause rule adds 4.
- This fixer worked in the main tree, not a worktree, as the orchestrator asked (you own port 3000; stage paths explicitly).

## Verification

- `biome check --write` on every touched file, then `pnpm -s lint`: clean.
- `pnpm -s typecheck`: clean.
- `pnpm -s test`: 205 passed, 1 skipped. An earlier run failed 2 to 4 tests in `coins.test.ts` and `db.test.ts`. The cause was concurrent runs plus leftover fixture coins from today's interrupted runs: two `2099` search seeds and two `E2E` coins. Those four were removed with `dropCoin`. One older `E2E E69535` row from 2026-10-23 was left in place.
- `pnpm -s e2e apps/web/e2e/`: 180 passed, 2 skipped (the two real-devnet tests), at HEAD after the server fixes. The regenerated Phase 2 and Phase 3 screenshots were restored with git checkout. The screenshot specs run under reduced motion, so the new pause button never appears in them.

---

_Fixer: Claude (gsd-code-fixer), client half_
