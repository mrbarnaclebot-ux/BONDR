---
phase: 03-indexer-lists-and-token-page
plan: 12
subsystem: home-lists
tags: [search, trending, home, scroller]
requires:
  - 03-11 coinRows, listCoins, /api/coins, CoinCard trending variant, HomeCoins
provides:
  - "@bondr/core/coin-row coinRows(exec, order, limit, offset, where?) and the exported vol(window) column"
  - lib/coins.ts listCoins({ sort, page, q }), parseQ, escapeLike, trending() -> { mode, coins }, trendMode, TrendMode
  - GET /api/coins?q= (2-64 characters, 400 above 64)
  - components/home-search.tsx useSearch, SearchBox, MatchCount, SearchEmpty
  - components/home-trending.tsx HomeTrending (mode caption, arrows, mouse drag)
affects: [03-13, 03-14]
tech-stack:
  added: []
  patterns: [escaped ILIKE with an explicit ESCAPE clause, one ranked query whose first row decides the trending mode]
key-files:
  created:
    - apps/web/components/home-search.tsx
    - apps/web/components/home-trending.tsx
  modified:
    - packages/core/src/coin-row.ts
    - apps/web/lib/coins.ts
    - apps/web/lib/coins.test.ts
    - apps/web/app/api/coins/route.ts
    - apps/web/app/page.tsx
    - apps/web/components/home-coins.tsx
    - apps/web/e2e/home.e2e.ts
    - apps/web/components/README.md
    - apps/web/lib/README.md
key-decisions:
  - "03-12: a full mint goes through the same listCoins q (mint prefix of the full mint is exact); the client opens /coin/{mint} only when the result holds that exact mint, so no separate searchByMint"
  - "03-12: trending is one query ordered by 1h volume, 24h volume, newest launch; the mode is read from the first row and the list is not filtered, so it always holds up to 10 coins"
duration: 27min
completed: 2026-10-24
---

# Phase 3 Plan 12: Search and Trending Summary

You can now search the home page by name, symbol or mint, and a Trending scroller sits above All coins. Trending ranks coins by 1h volume. If nothing traded in the last hour it uses 24h volume, and if nothing traded in 24 h it shows the latest launches.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Search by name, symbol or mint (LIST-05) | b841d42 (RED), d91c148 |
| 2 | Trending side-scroller with the 1h, 24h and latest fallback (LIST-01, D-13) | 029a5ea (RED), b35e983 |

## What was built

- **Search SQL.**
  - `parseQ` trims the text. Under 2 characters it is treated as no query; over 64 it is invalid.
  - `escapeLike` backslash-escapes `\`, `%` and `_`.
  - Name and symbol use `ilike ... escape '\'`. The mint uses `like q% escape '\'`, which is case-sensitive because base58 is.
  - Every value is a bound parameter.
  - The cache key is `(sort, page, q)`, still kept 10 s.
  - `coinRows` gained an optional `where`. The worker's `coinRow` is unchanged.
- **Route and page.**
  - `/api/coins` accepts `q`; more than 64 characters returns a 400.
  - The server render reads `?q=` along with `?sort=`.
- **Search UI.**
  - `SearchBox`:
    - A labelled `type="search"` input with the Search icon, max length 64, and the native cancel glyph hidden.
    - An X "Clear search" button: 44px below 768px, 32px from 768px up.
    - Escape and X clear the search and leave focus in the input. Enter does nothing.
  - `useSearch` waits 300 ms after typing stops, then sends the query only if it changed. A single character therefore does nothing.
  - `HomeCoins` passes `q` into tab switches, Show more and Try again. It writes `?sort=` and `?q=` with `replaceState`.
  - If the result contains a coin whose mint equals the full query, the page goes to `/coin/{mint}`.
  - The sr-only polite live line reads "{n} coins match", "1 coin matches" or "No coins match".
  - Empty states (the query is shown as text, cut to 40 characters):
    - No match: 'No BONDR coin matches "{q}"'.
    - A valid mint not launched on BONDR: "No BONDR coin at this address".
    - Both have a quiet "Clear search" button.
  - The active `q` lives in HomeCoins state, so 03-13 can skip inserting new launches while a search is active.
- **Trending.**
  - `trending()` orders coins by `vol("1 hour")` desc, then `vol("24 hours")` desc, then newest launch, then mint. It returns 10 rows and is kept 10 s. Burns never count.
  - `trendMode` sets the mode from the first row: `1h`, then `24h`, then `latest`.
  - `HomeTrending` shows:
    - The Display h2 "Trending" and a caption that changes with the mode.
    - Arrow buttons from 760px up. Each click scrolls two card widths plus the gaps. At each edge (8px tolerance) the button is aria-disabled, at 35% opacity, and stays focusable. Scrolling is instant under reduced motion.
    - A focusable `section` named "Trending coins". It is a grid that flows by column: 288px cards, 80% below 760px, with snap, a bleed to the viewport edge, a hidden scrollbar and contained overscroll.
  - Mouse-only drag: it turns snap off while dragging, and a drag of more than 4px swallows the click that ends it.
  - Chips: "#n" plus "{vol} SOL 1h" or "{vol} SOL 24h". In latest mode the chip shows the age and there is no rank.
  - The page renders Trending only when at least one coin exists.

## Verification

- `coins.test.ts` (Neon dev): 10 passed. New tests:
  - escapeLike.
  - Search: "grub" matches the name "Grubby" and the symbol "GRUB". "0% tag" matches only the "50%" name, not "50x". "a_b tag" matches only "a_b", not "aXb". A 6-character mint prefix finds its coin. A padded full mint returns exactly that coin. A random mint returns nothing. Latest and Oldest orders hold within the results. One character returns the same list as no query.
  - trendMode for all three modes.
  - trending(): the two seeded 1h coins rank first and second, and a coin with only 24h volume never ranks above a coin with 1h volume.
- `home.e2e.ts`: 14 passed, run three times in a row with no failures.
  - Search group: one character does nothing; a lowercase symbol finds the coin; `?q=` survives a reload; Escape clears and keeps focus; a mint prefix finds the coin; a full mint opens `/coin/{mint}`; a foreign mint shows its empty state; "zzzzqq" shows the no-match state; Clear search restores the list and focus.
  - Trending group: the seeded coin is #1 with "5,000,000 SOL 1h" and the 1h caption. At 1440 the left arrow starts aria-disabled, the right arrow scrolls, and then the left arrow is enabled. At 390 there are no arrows. A mouse drag scrolls and does not open the card under the pointer.
  - The route test now also checks that a 65-character q returns a 400.
- **Full Playwright suite:** 145 passed, 2 skipped (the devnet-only groups), 0 failed in 2.4 min. The regenerated Phase 2 screenshots were discarded.
- `pnpm test`: 190 passed, 1 skipped. `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` and `scripts/check-client-bundle.sh` all pass.
- Ad hoc axe run (not committed) on `/`, `/?q=zzzzqq` and `/?q={foreign mint}` at 390, 768 and 1440 with reduced motion: 0 violations and no horizontal scroll.
- Acceptance greps:
  - `ilike ... escape` is in `coins.ts`, with no `sql.raw` or `unsafe(`.
  - Both D-13 captions and `pointerType` are in `home-trending.tsx`.
- Sizes: `home-coins.tsx` is 182 lines, `home-search.tsx` 113 and `home-trending.tsx` 171.

## Deviations from Plan

**1. [Ponytail] No separate `searchByMint`.**
- A full mint uses the same `listCoins` q. A prefix match on a full mint is an exact match.
- The client opens the coin only when the result holds that exact mint; otherwise it shows the mint empty state.
- The test covers "full mint returns the coin, random mint returns nothing" through `listCoins`.

**2. `packages/core/src/coin-row.ts` changed, though it is not in the plan's file list.**
- `coinRows` takes an optional `where`, and `vol` is exported so the trending order reuses the windowed column.
- The worker is unaffected.
- The plan's key-link pattern `interval '1 hour'` lives there as `vol("1 hour")`.

**3. `coin-card.tsx` was not changed.** The trending variant from 03-11 already takes `rank` and `chip`.

**4. Trending is not filtered to coins with volume.**
- In 1h mode, coins after the active ones show "0.000 SOL 1h". This keeps up to 10 cards and matches 03-13's rerank over the whole list.
- To filter instead, cut the list after the last row with volume in the current mode.

**5. The trending e2e group runs in serial mode,** for the same reason as the grid group: each parallel worker would seed its own #1 coin.

**6. [Rule 2] A drag e2e test was added.** Without it the drag-and-swallow-click logic had no check.

## Known Stubs

None.

## Notes for the owner

- This plan delivers LIST-05 and the static part of LIST-01. The live re-rank and the 60 s mode tick come in 03-13, so LIST-01 is not marked complete; LIST-05 is.
- Search and Trending reads are kept 10 s per process, the same as the lists. Nothing polls.
- No staging deploy or Railway change was made.

## Self-Check: PASSED

- Files: home-search.tsx and home-trending.tsx are present; coins.ts exports listCoins, trending and escapeLike.
- Commits b841d42, d91c148, 029a5ea and b35e983 are in git log.
