---
phase: 03-indexer-lists-and-token-page
plan: 09
subsystem: live-token-page
tags: [live, eventsource, token-page, flash]
requires:
  - 03-08 /api/live SSE (trade, launch, bond, holders, resync; ?mint= filter)
  - 03-05 TradeFeed and the trades route
  - 03-06 TokenStats, BondPanel, CoinLive
provides:
  - lib/use-live.ts useLive({ mint?, onTrade, onLaunch, onBond, onHolders, onResync }) -> "live" | "reconnecting" | null
  - lib/flash.ts flashClass(side, "value" | "row"), empty under prefers-reduced-motion
  - components/coin-live.tsx CoinLiveProvider, useCoinLive, live VenueTag
  - GET /api/coin/[mint]/trades without `before` also returns `coin` (the resync read)
  - e2e/fixtures.ts blockTime (moved from launch-live.e2e.ts)
affects: [03-13, 03-14]
tech-stack:
  added: []
  patterns: [one EventSource per page through a context provider, remount by key to replay a CSS flash, per-frame batching of live rows]
key-files:
  created:
    - apps/web/lib/use-live.ts
    - apps/web/lib/flash.ts
    - apps/web/components/coin-live.tsx
    - apps/web/e2e/live.e2e.ts
  modified:
    - apps/web/app/globals.css
    - apps/web/components/token-trades.tsx
    - apps/web/components/token-stats.tsx
    - apps/web/components/token-bond.tsx
    - apps/web/components/coin-identity.tsx
    - apps/web/components/launch-flow.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/app/api/coin/[mint]/trades/route.ts
    - apps/web/e2e/fixtures.ts
    - apps/web/e2e/launch-live.e2e.ts
    - apps/web/e2e/og.e2e.ts
    - apps/web/lib/README.md
    - apps/web/e2e/README.md
    - apps/web/components/README.md
key-decisions:
  - "03-09: the resync read is the trades route without `before`, returning the first page plus the coin row, so one request catches up the feed and the stats"
  - "03-09: useLive returns null before the first open, so the indicator never claims Live (or announces Reconnecting) before the stream has opened"
  - "03-09: a flash replays by remounting the value with the trade counter as its key; rows rise once on mount via a `fresh` side on the row"
duration: 25min
completed: 2026-10-23
---

# Phase 3 Plan 09: Live token page Summary

The token page is now live. It opens one EventSource on `/api/live?mint=`, held by a context provider. New trades slide in at the top of the feed. Mcap, 1h and curve % flash green on a buy and red on a sell. A bond event switches the venue tag and the Bond and burn panel, and a holders event updates the count. A real devnet buy showed on an open page **4.5 s** after its blockTime.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | Live e2e (stubbed SSE, failing), useLive and the flash helper | 5808bfe (RED), 8f836a3 |
| 2 | Live feed, stats and bond panel, proven with a devnet trade | f64be1b |

## What was built

- **`use-live.ts`.** One `EventSource` with one listener per event type. `JSON.parse` sits in a try/catch, so a malformed frame is dropped. Handlers are read through a ref, so re-renders never reopen the stream. The state is null until the first open, then `live` on open and `reconnecting` on error. There is no polling and no timer.
- **`flash.ts`.** `flashClass(side, kind)` returns `animate-flash-up/down` for values or `animate-row-up/down` for rows. It returns `""` when `matchMedia("(prefers-reduced-motion: reduce)")` matches.
- **`globals.css`.** Adds the flash tokens:
  - `flash-up` and `flash-down`: leaf or destructive at 32% fading to transparent over 800 ms
  - row tokens: the existing `rise` keyframes at 640 ms spring, plus the flash
- **`coin-live.tsx`.** `CoinLiveProvider` calls `useLive` once (the only `useLive(` under components). Context carries:
  - the coin's live numbers
  - the last trade side with a counter
  - the stream state
  - a `subscribe` for trades and resync pages

  `VenueTag` moved here from `coin-identity.tsx`, so the server-rendered identity bar shows the live venue.
- **`token-trades.tsx`.** Live rows are batched per `requestAnimationFrame` and put on top, deduplicated by signature plus ix. Loaded rows are never removed. The head shows "Live" with a leaf dot, or "Reconnecting" with a static muted dot, in an `aria-live="polite"` span. A resync merges the refetched first page.
- **`token-stats.tsx` and `token-bond.tsx`.** These are client components now and read the provider. Mcap, 1h and curve % remount per trade, so the flash replays on every trade.
- **Trades route.** Without `before`, it returns `{ trades, more, coin }`; this request is only ever sent on resync. Load more is unchanged.

## Verification

- `live.e2e.ts` stubbed group (7 tests), all passing:
  - a buy flashes up and a sell flashes down, each landing on top
  - bond and holders events
  - a resync makes exactly one trades GET and creates no duplicate rows
  - Live on the real stream, Reconnecting when the stream is aborted
  - reduced motion: values update and no `animate-` class is ever added
- `coin.e2e.ts` passes.
- Full Playwright suite: 129 passed, 2 skipped (the devnet groups). That includes responsive with 0 axe violations on the coin page.
- `pnpm test`: 179 passed, 1 skipped.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` and `scripts/check-client-bundle.sh` all pass. The built CSS carries `@keyframes flash-up`.
- rg gates:
  - `EventSource` is in `use-live.ts`
  - `setInterval|setTimeout(.*fetch` finds nothing in `use-live.ts`
  - `prefers-reduced-motion` is in `flash.ts`
  - `useLive(` matches only `coin-live.tsx`

### Devnet proof

`E2E_DEVNET=1 playwright test live.e2e.ts -g devnet` used a local worker and web server on the Neon dev branch, with the newest indexed curve coin. It waited for "Live", then ran `scripts/devnet-trades.ts --buy 0.01 --json`.

| Signature | Result |
|-----------|--------|
| 5dPx5iQPVwziuaQHiTr8dByXCpmmPqxC6xJS7pUp8E3AZD8M9LKCtiQswpGZNCfebpbZQuNA2wcA1MsLzCKPppKY | First feed row's Tx link at **4461 ms** after blockTime (limit 15 s). Mcap text changed, no navigation |

Spend: the sim paid 0.010006 SOL (sim 0.089269 to 0.079263). Ops is unchanged at 2.750788 SOL. Playwright stopped the worker and web servers; ports 3000 and 8080 are free.

## Deviations from Plan

**1. [Rule 2 - Correctness] The resync read also returns the coin.**
- **Issue:** The plan says the feed, stats and last values refetch once on resync. There was no client route for the coin row.
- **Fix:** The trades route without `before`, which only the resync uses, returns `coin: coinByMint(mint)` alongside the page. One request through the rate-limited route covers both (T-03-09-03).
- **Files:** `apps/web/app/api/coin/[mint]/trades/route.ts`
- **Commit:** f64be1b

**2. [Rule 1 - Bug] The og fixture could borrow a seeded coin's wallet.**
- **Found during:** the full suite run.
- **Issue:** `og.e2e.ts` used `select wallet from launches limit 1`, which could return a parallel spec's "E2E" wallet. `dropCoin` then failed on the foreign key (seen once in `live.e2e.ts`'s afterAll).
- **Fix:** The query now excludes `name like 'E2E %'`.
- **Commit:** f64be1b

**3. Rename of `useLive` in `launch-flow.tsx` to `useLaunchStatus`.**
- **Issue:** That function is an unrelated local hook for the step 2 minimum and status. Its name made the one-EventSource gate (`useLive(` only in `coin-live.tsx`) ambiguous.
- **Change:** Name only.
- **Commit:** f64be1b

**4. `blockTime` moved from `launch-live.e2e.ts` to `fixtures.ts`.** It is now shared by both devnet groups instead of copied. The plan's "seconds until it showed" is measured from the chain's blockTime, not from when the script returned.

**5. `useLive` returns null before the first open,** in addition to `live` and `reconnecting`, so the polite span announces nothing on load.

**6. `--animate-rise` already existed (420 ms).** It was left as is. The feed row tokens reuse the `rise` keyframes at the UI-SPEC's 640 ms spring.

## Known Stubs

None.

## Notes for the owner

- TOKEN-02 is complete: the live feed and the live holder count were proven on devnet and in the stubbed e2e. LIST-04 (home cards) stays pending for 03-13, which can reuse `useLive` and `flashClass` as they are.
- `ponytail:` a refused connect (a 429 from the 6-stream per-IP cap) closes the EventSource for good, and the page shows "Reconnecting" until a reload. Add a timed reopen if that shows up in practice.
- Staging needs the 03-14 redeploy. No Railway change was made.

## Self-Check: PASSED

- Files: use-live.ts, flash.ts, coin-live.tsx and live.e2e.ts are present.
- Commits 5808bfe, 8f836a3 and f64be1b are in git log.
