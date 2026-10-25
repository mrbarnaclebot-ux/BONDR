---
phase: 05-fee-engine-and-public-ledger
reviewed: 2026-10-25T09:00:05Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - apps/web/app/api/coin/[mint]/ledger/route.ts
  - apps/web/app/coin/[mint]/page.tsx
  - apps/web/app/page.tsx
  - apps/web/components/bond-after.tsx
  - apps/web/components/bond-budget.tsx
  - apps/web/components/coin-live.tsx
  - apps/web/components/home-hero.tsx
  - apps/web/components/home-live.tsx
  - apps/web/components/home-next.tsx
  - apps/web/components/ledger-totals.tsx
  - apps/web/components/ready-bar.tsx
  - apps/web/components/tag.tsx
  - apps/web/components/token-bond.tsx
  - apps/web/components/token-ledger.tsx
  - apps/web/components/token-stats.tsx
  - apps/web/components/token-trades.tsx
  - apps/web/components/trade-quote.tsx
  - apps/web/e2e/coin.e2e.ts
  - apps/web/e2e/fee-bonded.e2e.ts
  - apps/web/e2e/fee-devnet.e2e.ts
  - apps/web/e2e/fee-ledger.e2e.ts
  - apps/web/e2e/fee-live.e2e.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/home.e2e.ts
  - apps/web/e2e/phantom.ts
  - apps/web/e2e/responsive-fee.e2e.ts
  - apps/web/e2e/shoot.ts
  - apps/web/e2e/trade.e2e.ts
  - apps/web/lib/coins.test.ts
  - apps/web/lib/coins.ts
  - apps/web/lib/format.test.ts
  - apps/web/lib/format.ts
  - apps/web/lib/ledger-copy.test.ts
  - apps/web/lib/ledger-copy.ts
  - apps/web/lib/ledger.test.ts
  - apps/web/lib/ledger.ts
  - apps/web/lib/live-list.test.ts
  - apps/web/lib/live-list.ts
  - apps/web/lib/trades.ts
  - apps/web/lib/use-live.ts
  - apps/web/next.config.ts
findings:
  critical: 1
  warning: 4
  info: 8
  total: 13
status: issues_found
---

# Phase 5: Code Review Report (web)

**Reviewed:** 2026-10-25T09:00:05Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

Scope: the Phase 5 web diff from `755b5f9^`. That covers the token page Fee ledger and its route, Bond and burn (on curve and bonded), the ledger totals, the home Next to bond rail and the forced-bond pulse line, live `fee` events, and the new e2e and unit specs.

What holds up:
- Number formatting is sound. `ratioPct` and `ratio1000` floor from bigint base units, so the rail can never show 105% before the real trigger. `burnedPct` is bigint. `compact` and `feeSol` lose precision only in display strings.
- Links are safe. Every link prefix is fixed, and `imageUrl` only accepts alphanumeric CIDs.
- No polling was added, and every new server read goes through the 10 s `kept` cache.
- The public detail allowlist and the kind allowlist are applied on both the server read and the worker publish.

What is wrong:
- **Missing ledger rows (critical).** The ledger's first page comes from its own cache, separate from the hub id the page subscribes from. So a fee row can land in neither the server render nor the live replay.
- **Stale numbers from fee events.** Live `fee` events spread a whole coin snapshot over newer state.
- **Possible full-page crash.** An unknown ledger kind crashes the page, and there is no error boundary.
- **Tests that prove less than they claim.** Two specs do not actually test what their names say.

## Critical Issues

### CR-01: The ledger's first page is cached apart from the hub head, so a landed fee row can be lost

**File:** `apps/web/app/coin/[mint]/page.tsx:58-62,120-124,143`, `apps/web/lib/ledger.ts:83-84`, `apps/web/app/api/coin/[mint]/ledger/route.ts:23`, `apps/web/components/token-ledger.tsx:97-102`

**Issue:** The page subscribes to `/api/live?last=<head>`. Here `head` is taken inside `firstPage`'s cache entry, right before the trades read. The ledger rows come from `firstLedgerPage`, a different cache entry (`kept("ledger:<mint>")` in `lib/trades.ts`). The ledger route fills that entry too, on any request without `before`, which is exactly what every open page sends on `resync`. The two snapshots are therefore unrelated, and the ledger one can be older than the head.

Concrete failure:
1. The worker restarts. The hub fans out `resync`, and every open page of coin X GETs `/api/coin/X/ledger`. That caches X's ledger at T0.
2. The restarted fee engine lands a pending collect at T2 and publishes a `fee` event.
3. A new visitor loads `/coin/X` at T5. `firstPage` misses its cache, so `head` is at or after the T2 event, and the replay starts after it. The ledger is the T0 cache hit, which does not have the row.

The collect row is missing from this visitor's ledger. Neither Load more (it pages older than the oldest row) nor later events will bring it back, only a reload. Meanwhile the panel can say "That is every fee movement since launch." over an incomplete public audit trail.

The same gap hits a page that resyncs: `useLiveRows` merges the cached route page, which can predate rows that landed during that page's disconnect.

**Fix:** Take the ledger snapshot under the same head as the subscription, and key the route's cache on the hub position so a new event invalidates it:

```ts
// page.tsx: one snapshot, one head
const firstPage = kept(async (mint) => {
  const head = hub.head();
  const [t, ledger] = await Promise.all([tradesPage(mint), ledgerPage(mint).catch(() => null)]);
  return { ...t, ledger, head };
});

// ledger.ts: a page cached at an older hub position is never served after a newer event
export const firstLedgerPage = (mint: string) => kept(`ledger:${mint}:${hub.head() ?? ""}`, () => ledgerPage(mint));
```

A burst of resyncs at one head still shares one Neon read. A read only repeats after the hub has moved on.

## Warnings

### WR-01: A `fee` event's coin snapshot overwrites newer trade and bond state

**File:** `apps/web/components/coin-live.tsx:70`, `apps/web/components/home-live.tsx:197`

**Issue:** `publishFee` (worker `announce.ts:81`) reads `coinRow` after an await and then publishes. A trade or bond announce can read and publish in between, so the fee event's `coin` can be older than state the client already has.

Both handlers spread the whole snapshot:
- `coin-live.tsx:70`: `setCoin((p) => p && { ...p, ...c })`
- `home-live.tsx:197`: `applyTrade(l, { coin })`

That overwrites `venue`, `progress`, `mcapSol`, `lastTradeAt` and `holders`, not just `fees`. In the forced-bond case, a `bond` event (`venue: "complete"`) followed by a fee event read just before the bond commit reverts the venue tag to "On curve" and the gauge below 100%. A complete curve has no more curve trades, so nothing corrects it until migration or a reload.

**Fix:** A fee event changes only fee fields, so merge only those:

```ts
// coin-live.tsx
if (c?.fees) setCoin((p) => p && { ...p, fees: c.fees });
// home-live.tsx
if (coin?.fees) both((l) => patch(l, coin.mint, (x) => ({ ...x, fees: coin.fees })));  // export patch, or add applyFees
```

### WR-02: An unknown ledger kind crashes the whole token page (no error boundary)

**File:** `apps/web/lib/ledger-copy.ts:81-83`, `apps/web/components/token-ledger.tsx:84-88,184`

**Issue:** `ledgerCopy` reads `COPY[r.kind]` without checking it exists. Live rows reach it straight from the worker's `fee` event, filtered by the worker's build of `PUBLIC_KINDS`. Web and worker are separate Railway services and deploy at different times. If a worker adds a public kind before web is redeployed, `COPY[kind]` is `undefined`, and `e.value` throws during render.

`apps/web/app` has no `error.tsx` or `global-error.tsx`. So every open token page of that coin becomes Next's blank "Application error" screen, and it stays broken on reload for as long as the server page includes the row.

**Fix:** Drop rows web has no copy for, at every way rows enter the list:

```ts
// ledger-copy.ts
export const known = (r: { kind: string }): r is LedgerRow => Object.hasOwn(COPY, r.kind);
// token-ledger.tsx, in merge() and useOlder's setPage
addLedger(p.rows, rows.filter(known))
```

### WR-03: The keyset tie test never puts a tie on the page boundary

**File:** `apps/web/lib/ledger.test.ts:58-72`

**Issue:** `at(i) = floor(i / 2)` puts rows 18 and 19 together and rows 20 and 21 together. Page one ends at row 18, so the cursor sits between two different timestamps. The case the `(landed_ms, id)` keyset exists for, a tie across the cursor, is never run, despite the test name "ties ordered by id".

The seeds also use JS Dates (millisecond precision), so the microsecond truncation that `ledger.ts:34-37` depends on is never exercised either. A regression that drops the `id` tiebreak or the `date_trunc` would still pass.

**Fix:** Straddle the boundary and seed microseconds:

```ts
const at = (i: number) => new Date(Date.now() - 10 * 60_000 - Math.floor((i + 1) / 2) * 60_000); // rows 19 and 20 tie
// and seed one pair via SQL with landed_at = <ts> + interval '123 microseconds' / '456 microseconds'
```

### WR-04: The fee-live resync spec checks "no duplicate rows" on a coin with no fee rows

**File:** `apps/web/e2e/fee-live.e2e.ts:133-144`

**Issue:** The seeded coin (`trades: 2`) has no `fee_ledger` rows. The resync refetch returns `rows: []`, so `toHaveCount(1)` (the launch row) holds whether or not `addLedger` dedupes. The comment says "no duplicate launch or fee rows", but the dedupe path never runs.

**Fix:** Seed two landed rows in `beforeAll` with `seedLedger`, then assert the list is still exactly 3 entries after the resync refetch. Also check the merged order.

## Info

### IN-01: The rail's track label and ratio break when a live event clears `cost`

**File:** `apps/web/components/home-next.tsx:52-56`
**Issue:** A trade or fee event can patch a rail coin's `fees.cost` to `null`, and removal waits for the 60 s tick (longer while the rail is hovered). In that window `ratioPct` returns "–", so `pct.slice(0, -1)` gives "", the aria-label reads "Burn budget  percent ready", and the visible text reads "– ready".
**Fix:** Use the `r === null` branch the way `BudgetGauge` does ("Burn budget not measured yet.").

### IN-02: BONDR amounts under 1 read "0 BONDR"

**File:** `apps/web/lib/ledger-copy.ts:16`
**Issue:** `bondr()` floors to whole BONDR. A dust collect reads "Claimed 0 BONDR of creator fees..." next to a non-zero SOL cell.
**Fix:** Show "<1" when `0 < amount < 1_000_000`.

### IN-03: `seedCoin` is not atomic, so a failed seed leaks rows

**File:** `apps/web/e2e/fixtures.ts:72-80`
**Issue:** Wallet, vanity, launch, coin and trades are five separate inserts. If any later insert fails, `seedCoin` throws before returning a mint, so the earlier rows are never handed to `dropCoin` (for example `responsive-fee.e2e.ts:83`, `coins.test.ts` seeds). This predates Phase 5, but the new specs lean on it heavily.
**Fix:** Wrap the body in `sql.begin(async (tx) => ...)`.

### IN-04: The countdown assertion assumes a 24h window

**File:** `apps/web/e2e/fee-ledger.e2e.ts:172`
**Issue:** `/^\d+h \d+m$/` fails when the dev server runs with `FEE_WINDOW_MS=600000`, which `fee-devnet.e2e.ts:3` tells you to do (and `reuseExistingServer` may pick that server up).
**Fix:** Accept `/^(\d+h )?\d+m$|^<1m$/`, or assert against `feeWindowMs()`.

### IN-05: The home hero spec branches on rail presence

**File:** `apps/web/e2e/home.e2e.ts:28-31`
**Issue:** Either branch passes, so the spec no longer pins which CTA should show for a given DB state. `responsive-fee.e2e.ts` covers both states, so this is acceptable, but the hero spec itself is weaker than before.
**Fix:** None needed if the responsive spec stays. Otherwise seed a rail coin here.

### IN-06: A coin that just bonded stays "Next up" and the CTA target until the tick

**File:** `apps/web/components/home-hero.tsx:84-88,135-138`, `apps/web/components/home-live.tsx:191-198`
**Issue:** After a live forced bond, `forced` goes up straight away. But `rail.coins[0]` still shows the bonded coin as "Next up: SYM, 10x% ready", and "Watch a coin bond" still links to it, until the 60 s tick. That wait has no limit while the pointer is over the rail.
**Fix:** In `onBond`, drop non-curve coins from the rail right away: `s.setRail((r) => ({ ...r, coins: r.coins.filter((c) => c.mint !== d.mint) }))`.

### IN-07: The BONDR hop creator sub-row names the coin's fee wallet

**File:** `apps/web/components/trade-quote.tsx:145`
**Issue:** BONDR's creator fee does not go to the coin's fee wallet. It is masked to 0 today, so the row is hidden, but the copy would be wrong if it were ever shown.
**Fix:** Use the label "to the BONDR creator", or drop the creator row for the BONDR hop.

### IN-08: The devnet spec casts a possibly missing sweep

**File:** `apps/web/e2e/fee-devnet.e2e.ts:163-164`
**Issue:** If no `sweep_buyback` landed, `rows.find(...) as Row` gives `undefined`, and `sweep.id` throws a TypeError instead of a readable assertion.
**Fix:** `expect(sweep, "a landed sweep_buyback").toBeTruthy()` before using it.

---

_Reviewed: 2026-10-25T09:00:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
