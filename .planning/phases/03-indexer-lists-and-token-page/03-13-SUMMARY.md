---
phase: 03-indexer-lists-and-token-page
plan: 13
subsystem: home-lists
tags: [live, home, rerank, flash]
requires:
  - 03-08 /api/live SSE (trade, launch, bond, resync)
  - 03-09 useLive, flashClass, the CoinLiveProvider pattern
  - 03-11 CoinCard, HomeCoins, /api/coins, heroCounts
  - 03-12 search q, trending(), HomeTrending
provides:
  - lib/live-list.ts applyTrade, applyBond, insertLaunch, decay, rerank, trendingMode, union (pure, tested)
  - components/home-live.tsx HomeLiveProvider, useHome, useHomeLive (one useLive for the home page)
  - GET /api/coins?trending=1 adds `trending` to the page, so the home resync is one request
  - CSS animate-launch (rise, then --glow held 3 s, faded over 600 ms; static under reduced motion)
affects: [03-14, 03-15]
tech-stack:
  added: []
  patterns: [one 60 s client tick held by CSS :hover and :focus-within on data-hold regions, list state lifted into a page provider so live events see sort and search]
key-files:
  created:
    - apps/web/lib/live-list.ts
    - apps/web/lib/live-list.test.ts
    - apps/web/components/home-live.tsx
    - apps/web/e2e/home-live.e2e.ts
  modified:
    - apps/web/app/api/coins/route.ts
    - apps/web/app/page.tsx
    - apps/web/app/globals.css
    - apps/web/components/coin-card.tsx
    - apps/web/components/home-coins.tsx
    - apps/web/components/home-trending.tsx
    - apps/web/components/home-hero.tsx
    - apps/web/components/README.md
    - apps/web/lib/README.md
    - apps/web/e2e/README.md
key-decisions:
  - "03-13: the re-rank hold is a CSS check at tick time (document.querySelector('[data-hold]:hover, [data-hold]:focus-within')) plus a deferred re-check on pointerleave and blur, so a region removed while hovered can never leave the hold stuck"
  - "03-13: resync is one GET /api/coins?trending=1; page 0 is merged in front of the loaded coins (later pages stay), Trending is replaced"
  - "03-13: on the tick Trending is re-picked from its own coins plus the grid's (top 10 by the trending order), so a grid coin that starts trading can enter it and the mode follows"
  - "03-13: the hero bonded count increments only on a bond event with venue complete (pool always follows complete)"
duration: 15min
completed: 2026-10-24
---

# Phase 3 Plan 13: Live Home Lists Summary

The home page is now live from a single SSE stream. When a trade lands, every card for that coin updates its market cap, 1h change and curve %, with a green flash on a buy and a red one on a sell. Trending's volume chip updates too. Cards change position at most once a minute, and not while the pointer is over the grid or scroller or focus is inside them. A new launch slides into the front of Latest with a 3 s glow, and the hero counts go up on launch and bond events. The only database read is the catch-up after a resync.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Pure live list rules | c85fbaa (RED), fbc0937 |
| 2 | Home live provider, live cards, re-rank tick and new-launch glow | 2188743 |

## What was built

- **`live-list.ts`** (pure, no React or DOM):
  - `applyTrade` and `applyBond` patch one coin by mint. If the coin is not listed, they return the same array, so nothing re-renders.
  - `insertLaunch` prepends only in Latest with no search, and skips a mint that is already listed.
  - `decay` sets 1h volume to 0 after an hour with no trade, and 24h volume to 0 after a day.
  - `rerank` uses the same orders as the server (Top, Latest, Oldest and trending) and always returns a copy.
  - `trendingMode` returns `1h` if any coin has 1h volume, else `24h` if any has 24h volume, else `latest`.
  - `union` merges lists by mint.
- **`home-live.tsx`**: `HomeLiveProvider` holds the grid list, sort, search, Trending, hero counts, flash per mint and the set of fresh launches.
  - It calls `useLive` once.
  - It runs one `setInterval(60_000)` that decays, re-ranks, re-picks Trending and refreshes ages. The tick never fetches.
  - `hold` is spread on the grid `<ol>` and the Trending scroller.
  - On resync it makes one `fetch` to `/api/coins?...&trending=1`.
- **`HomeCoins`** now reads its list, sort and search from the provider instead of its own state. The fetch, abort and Show more logic is unchanged.
- **`HomeTrending`** reads Trending from the provider and hides itself when there are no coins. The scroller hooks now sit in an inner `Scroller`, so drag works once Trending first appears.
- **Hero pulse** reads the counts from the provider.
- **`CoinCard`** (now `"use client"`): mcap, change and curve % remount on each trade (keyed by the trade counter) with `flashClass(side)`. A grid card that is fresh gets `animate-launch`.
- **`/api/coins`** takes `trending=1` and adds `trending` to the response, read in parallel. Both reads are still kept for 10 s.

## Verification

- `live-list.test.ts`: 7 passed.
- `home-live.e2e.ts`: 7 passed on a stubbed stream:
  - buy and sell flash up and down on all three fields, in both the grid and Trending, and the volume chip updates
  - no flash with reduced motion
  - a launch is prepended with `animate-launch` and the hero count goes up by 1
  - a launch during a search is not inserted, but is still counted
  - a resync makes exactly one `/api/coins` GET, with `trending=1`
  - with `page.clock`, a 60 s tick under a hovering mouse does not reorder, and moving the mouse away does
- Full Playwright suite: **152 passed, 2 skipped (devnet groups), 0 failed** in 2.7 min. The regenerated Phase 2 screenshots were discarded.
- `pnpm test`: 197 passed, 1 skipped.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` and `scripts/check-client-bundle.sh` all pass. The built CSS contains `@keyframes glow`.
- rg gates:
  - `useLive(` matches only `coin-live.tsx` and `home-live.tsx`.
  - `home-live.tsx` has exactly one `setInterval` (60_000). Its only `fetch` is in `catchUp`, which only resync calls.
  - `live-list.ts` has no react, document or window.

## Deviations from Plan

**1. [Rule 3 - Blocking] The live e2e is in a new `e2e/home-live.e2e.ts`, not `home.e2e.ts`.** `home.e2e.ts` is 272 lines, and the live group would have pushed it past the AGENTS.md 300-line limit.

**2. [Rule 3 - Blocking] `app/api/coins/route.ts` gained `trending=1`. It is not in the plan's file list.** The plan asks for resync to refetch both the list and Trending through `/api/coins`, with exactly one GET. A single combined request is the only way to meet both.

**3. [Ponytail] Smaller choices:**
- `union` is added to `live-list.ts` so Trending can be re-picked on the tick.
- The glow class is `animate-launch`, a theme animation, rather than a separate `--glow` utility.
- The hold uses CSS `:hover` and `:focus-within` instead of tracking pointer and focus state.

**4. Top and Oldest do not pick up a new launch on the next re-rank.** The plan's behavior requires `insertLaunch` to return the list unchanged for those tabs. UI-SPEC says they pick it up on the next re-rank or reload; here they pick it up on reload or resync.

## Known Stubs

None.

## Threat Flags

None. The only new surface is `trending=1` on an existing rate-limited GET, which reads the same 10 s cached `trending()` the page already renders.

## Self-Check: PASSED
