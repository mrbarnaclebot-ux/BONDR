---
phase: 03-indexer-lists-and-token-page
plan: 11
subsystem: home-lists
tags: [home, lists, cards, hero]
requires:
  - 03-06 coinRow windowed columns, BondGlyph, Tag
  - 03-10 Seg
provides:
  - "@bondr/core/coin-row coinRows(exec, order, limit, offset), sharing coinRow's select and mapping"
  - lib/coins.ts listCoins({ sort, page }), heroCounts(), parseSort, parsePage, SORTS, LIST_PAGE
  - GET /api/coins?sort=top|latest|oldest&page=0..99 -> { coins, more }
  - components/coin-card.tsx CoinCard (grid and trending variants, data-field mcap / change / curve)
  - components/home-coins.tsx HomeCoins; components/home-hero.tsx HomeHero; components/launch-link.tsx LaunchLink
affects: [03-12, 03-13, 03-14]
tech-stack:
  added: []
  patterns: [offset pages over fixed column orders, promise cache 10 s per key, client-only video swap for reduced motion]
key-files:
  created:
    - apps/web/app/page.tsx
    - apps/web/app/api/coins/route.ts
    - apps/web/components/home-hero.tsx
    - apps/web/components/launch-link.tsx
    - apps/web/components/coin-card.tsx
    - apps/web/components/home-coins.tsx
    - apps/web/e2e/home.e2e.ts
    - apps/web/public/art/hero-bond.jpg
    - apps/web/public/art/hero-bond-poster.jpg
    - apps/web/public/art/hero-bond.mp4
  modified:
    - packages/core/src/coin-row.ts
    - apps/web/lib/coins.ts
    - apps/web/lib/coins.test.ts
    - apps/web/proxy.ts
    - apps/web/next.config.ts
    - apps/web/components/chrome.tsx
    - apps/web/app/globals.css
    - apps/web/e2e/launch-form.e2e.ts
    - apps/web/e2e/README.md
    - apps/web/components/README.md
    - apps/web/lib/README.md
key-decisions:
  - "03-11: list rows reuse core coinRow's select and mapping (coinRows), so cards, the token page and live events read the same numbers"
  - "03-11: the header Launch link is an icon with the accessible name below 360px and the wordmark hides below 440px; otherwise the devnet header (badge, Launch, Connect) overflows the gutter at 320 and 390"
  - "03-11: the card's chips come after the body in the DOM (positioned on the card), so the link's accessible name reads name, symbol, market cap, change, curve first"
duration: 18min
completed: 2026-10-23
---

# Phase 3 Plan 11: Home page Summary

`/` is now the BONDR home page; the redirect to /launch is gone. The page has three parts:
- A paused banner, shown only when launches are paused. It comes from one status read when the page renders; nothing polls it.
- The "Built to bond." hero. It has the video art (a still image under reduced motion), "Launch a coin" (or "Launches paused"), "See all coins", and the line "N coins launched, M bonded." counted from the indexer.
- The All coins grid. It has Top, Latest and Oldest tabs, 50 cards a page with "Show more coins", and at most 5 cards per row.

The header now shows a "Launch a coin" link on every page.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Home e2e (failing), list read model and the coins route | a9850e4 (RED), 4620038 |
| 2 | Home page with hero, pulse counts and paused banner; header Launch link | c151eca |
| 3 | CoinCard and the All coins grid with tabs and Show more | cf4f523 |

## What was built

- **Read model.**
  - `coinRows` in `packages/core/src/coin-row.ts` reuses the select and row mapping that `coinRow` already used.
  - `listCoins` orders each tab as follows:
    - Top: market cap descending, then newest launch first, then mint.
    - Latest: launch time descending, then mint.
    - Oldest: launch time ascending, then mint.
  - Pages are 50 coins, fetched as `limit 51 offset page*50`. The extra row tells the page whether there are more.
  - `heroCounts` is one count query. "Bonded" counts venues `complete` and `pool`.
  - Both are kept 10 s per key in a per-process promise map that clears at 1000 entries. A failed read is not kept. `ponytail:` comments note two limits:
    - Offset pages are capped at 100; switch to keyset paging past 5,000 coins.
    - The cache is per process; move to a shared cache if web runs more than one instance.
- **Route.** `GET /api/coins`:
  - `sort` must be top, latest or oldest (default top). `page` must match `^\d{1,2}$`. Anything else is a 400.
  - A database failure is a 503. Responses are `no-store`.
  - The proxy's read limit now also covers `/` and `/api/coins`.
- **Hero.**
  - The art follows the UI-SPEC masks for each breakpoint (≥1080, 560-1079, <560) and has the `breathe` animation.
  - The 16 motes and the video render only after the client confirms reduced motion is off. The server render and reduced motion keep the still image with `srcset` 960w / 1920w.
  - The section heading reveal is CSS only, inside `@supports (animation-timeline: view())`.
- **CoinCard.**
  - One link per coin. Each image is a plain `<img>` from `imageUrl`, never `next/image`, and is hidden if it fails to load.
  - Card content: name (ellipsis) and symbol, "{mcap} SOL", the 1h change pill (leaf, destructive or muted), and the BondGlyph with an aria-hidden "curve {pct}%" or a "Bonded" tag.
  - Grid cards have an age chip. Trending cards take a rank chip, a volume chip and an "{age} old" line, ready for 03-12.
  - Below 560px the card turns horizontal.
  - `data-field` marks mcap, change and curve, so 03-13 can flash them.
- **HomeCoins.**
  - The Seg labelled "Sort coins" writes the sort to `?sort=` with `history.replaceState`, so it adds no history entries.
  - Switching tabs aborts any load in flight. The old cards stay at 60% opacity with `aria-busy` until the new list arrives.
  - "Show more coins" appends the next page and shows "Loading…" while it loads.
  - Empty state: "No coins yet" with "Launch a coin". Error state: an error callout with "Try again", which replaces the grid.

## Verification

- `coins.test.ts` (Neon dev): 6 passed. The new tests cover:
  - Top, Latest and Oldest heads, with the mcap tie broken by newest launch.
  - Page sizes and `more` against a direct count, with no overlap between pages.
  - `heroCounts` against a direct `count(*) filter`.
- `home.e2e.ts`: 8 passed.
  - Hero group:
    - `/` returns 200 and does not redirect. It has the title, the h1 "Built to bond.", both links, the pulse line regex, and no "Next to bond".
    - The header Launch link is present on `/` and `/terms`, and is current (`aria-current="page"`) on `/launch`.
  - Grid group, run in serial mode:
    - The seeded coin's card shows the href, symbol, "900,000 SOL", "+20.0%", "curve 64.2%" and the glyph label.
    - Top, Latest and Oldest set `aria-pressed` and `?sort=`, and `history.length` does not change.
    - `?sort=latest` is rendered on the server.
    - The route answers 400 for `sort=bad`, `page=-1`, `page=100` and `page=1.5`, and 200 with `no-store` otherwise.
- `home.e2e.ts` and `coin.e2e.ts` together: 27 passed.
- **Full Playwright suite:** run twice after the last code commit. Both runs: 139 passed, 2 skipped (the devnet-only groups), 0 failed (2.4 min, then 2.1 min). The regenerated Phase 2 screenshots were discarded both times.
- `pnpm test`: 186 passed, 1 skipped. `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` and `scripts/check-client-bundle.sh` all pass.
- Ad hoc axe run on `/` at 390, 768 and 1440 with reduced motion: 0 violations and no horizontal scroll. The header's right edge stays inside the gutter at every width from 320 to 1024.
- Acceptance greps:
  - no `destination: "/launch"` in `next.config.ts`
  - 3 hero assets in `public/art`
  - no "Next to bond" under `app` or `components`
  - "Launch a coin" is in the header (it lives in `launch-link.tsx`, which `chrome.tsx` renders)
  - `"/api/coins"` is in `proxy.ts`
  - no `next/image` in the card, and `replaceState` is used in `home-coins.tsx`
  - `coin-card.tsx` is 162 lines and `home-coins.tsx` is 143
- No seeded "E2E" launches are left on the dev branch.

## Deviations from Plan

**1. [Rule 3 - Blocking] launch-form.e2e.ts asserted the old redirect.** Its first test opened `/` and expected `/launch`. It now opens `/launch` directly and checks the same title, lede and step. Commit c151eca.

**2. [Rule 1 - Layout bug] The header overflowed at 320 and 390** once the Launch link was added (the Connect button ended at 331 and 411, past the 16 px gutter). Fixes:
- The wordmark hides below 440px; it hid below 359px before. The brand mark and its "BONDR home" label stay.
- Below 360px the Launch link shows a lucide `Rocket` icon, and the word "Launch" stays as sr-only text.

The UI-SPEC asks for the word "Launch" below 768px; it shows from 360px up. The header link lives in a small client file, `launch-link.tsx`, because `aria-current` needs `usePathname`. Commit c151eca.

**3. The core query was shared, not copied.** `packages/core/src/coin-row.ts` gained `coinRows`, which reuses `coinRow`'s select and mapping. This file was not in the plan's file list. The worker's `coinRow` signature is unchanged, and the worker tests pass. Commit 4620038.

**4. The grid e2e group runs in serial mode.** With `fullyParallel`, each worker ran its own `beforeAll`, which seeded several top coins. Commit cf4f523.

**5. Card chips follow the body in the DOM.** They are positioned absolutely on the card, so the link's accessible name reads in the UI-SPEC order.

**6. A null 1h change shows "–" in muted text.** The UI-SPEC says missing values are muted; it gives no glyph for them.

## Known Stubs

None. The trending variant's `rank` and `chip` props are not used yet; 03-12 passes them.

## Notes for the owner

- LIST-02 and LIST-03 are delivered and marked complete. LIST-04 is not marked: the card is done, but the live card updates come in 03-13.
- The home list and counts are kept 10 s per process. A new launch can take up to 10 s to show on reload until the 03-13 live insert lands.
- The paused banner is read once at render (owner decision 4), so it can be stale until reload.
- No staging deploy or Railway change was made.

## Self-Check: PASSED

- Files: page.tsx, api/coins/route.ts, home-hero.tsx, launch-link.tsx, coin-card.tsx, home-coins.tsx, home.e2e.ts and the 3 hero assets are present.
- Commits a9850e4, 4620038, c151eca and cf4f523 are in git log.
