---
phase: 05-fee-engine-and-public-ledger
depth: standard
files_reviewed: 93
findings:
  critical: 2
  warning: 13
  info: 13
  total: 28
status: issues_found
parts: [05-REVIEW-engine.md, 05-REVIEW-web.md]
---

# Phase 5: Code Review Report


## Phase 5: Code Review Report (fee engine money path)

**Reviewed:** 2026-10-25
**Depth:** standard
**Files Reviewed:** 52
**Status:** issues_found

### Summary

Reviewed the Phase 5 fee engine at diff base `755b5f9^`: the send path, ledger, recovery, collect/split/sweep, forced bond, pool burn, finalize, daily batch, reconcile, owner routes, the core helpers they call, and the fork spike stages.

What holds up:
- Every engine tx is recorded as pending before it is broadcast.
- An "unknown" send is never resent.
- The partial unique indexes match the code's `keysOf` mirror.
- The 8000/2000 update only happens after a CreateEvent.user == launches.wallet check, and an already-revoked config is only accepted when its holders are ours.
- Bearer auth covers `/fee/*`.
- Rounding goes to the burn budget, as documented.
- On-chain token balances block most double spends.

The weak spot is how pending rows interact with balance-sized txs. A collect or split whose status is unknown stays pending until the next boot, because nothing re-checks it at runtime. That includes a confirmed tx whose `getTransaction` returned null for 10 s. Meanwhile the next window sweep, forced bond or pool burn spends W's whole live balance, including the treasury tenth that was never split. On the next reboot, recovery splits it again out of W's later budget. That is a burn of the treasury share (CR-01). Several warnings come from the same gap. Recovery also drops the tx facts for every kind except collect, so the public ledger and coin totals go wrong after any restart that settles a pending bond, finalize or distribute row.

### Critical Issues

#### CR-01: The treasury tenth gets swept 90/10 or burned when an earlier collect or split is still pending

**File:** `apps/worker/src/fee-prebond.ts:92-100`, `apps/worker/src/fee-burns.ts:24-30,43-57,91-104`, `apps/worker/src/fee-finalize.ts:116-124` (root causes: `apps/worker/src/fee-send.ts:160-165,177`, `apps/worker/src/fee-ledger.ts:268-269`, `apps/worker/src/fee-recover.ts:114-119`)

**Issue:** `sweepJob`, `forcedSend` and `poolBurnJob` size their tx from W's live BONDR balance (`wBondr`). The only thing protecting the unsplit treasury tenth is `out.every(settled)`, and that only looks at the steps of the current job. `openCollects()` returns only *landed* collects, and only those with no *live* split. So the following never get split before the sweep or burn:
- a collect that is still pending, and
- a collect whose split is still pending.

Nothing re-checks pending rows at runtime (`conclude` returns `unknown`, and recovery runs only at boot).

Concrete scenario on devnet Helius:
1. Window N: the collect confirms, but `fetchTx` gets null 20 times (`fee-send.ts:162`, "landed without meta, left pending"). The row stays pending, so window N skips its sweep. Correct so far.
2. Window N+1: a new collect lands and is split. `openCollects` does not return the window-N collect, because that row is still pending. All steps report settled, so `sweepJob` sweeps W's whole balance 90/10.
3. Result: 9% of the window-N collect, which belongs to the treasury, goes to the buyback wallet, and the next `buybackBurnJob` burns it.
4. The forced bond (`forcedJob`) and pool burn (`bondedJob`) have the same hole, and there the whole tenth is spent on the child buy and burned.
5. On the next reboot, `recover` lands the old collect and `splitOpen` sends its split from W again. Either it takes the treasury tenth out of the *current* burn budget (the treasury is overpaid and the buyback underpaid), or W does not hold enough and the split fails. A failed split is not `settled`, so from then on every window skips its sweep and every forced bond is blocked for that coin until W refills.

A `ledger.settle` that throws after the tx landed (a transient Neon error) leaves the same pending collect and causes the same failure.

**Fix:** Refuse any balance-sized send while the mint has pending collect or split rows. Better still, settle the mint's pending signatures from chain first, using the same `getSignatureStatuses` and `nextState` logic recovery uses. Minimal version:
```ts
// fee-ledger.ts: LedgerStore
pendingFor(mint: string, kinds: LedgerKind[]): Promise<boolean>; // state = 'pending' only

// fee-prebond.ts windowJob, fee-burns.ts collectSplit callers, fee-finalize.ts closing — before sweepJob / forcedSend / poolBurnJob:
if (await d.ledger.pendingFor(mint, ["collect", "split_treasury"])) {
  console.error(`fee ${mint}: pending collect/split, balance-sized send deferred`);
  return [...out, { state: "unknown" }];
}
```
Also treat `landed()` "without meta" as retryable inside the job: call `fetchTx` again after a delay before giving up. A confirmed signature is known to have landed.

### Warnings

#### WR-01: Pending rows are only re-checked at boot, so a coin's forced bond or finalize can stall indefinitely

**File:** `apps/worker/src/fee-send.ts:177`, `apps/worker/src/fee-recover.ts:121-133`, `apps/worker/src/fee-ledger.ts:49-50`
**Issue:** An `unknown` forced_bond, pool_burn, finalize_config or finalize_update row holds its `fee_ledger_once` / `fee_ledger_bond_burn` key while it is pending. Only `recover()` at boot moves it to expired or landed. If the tx was actually dropped, the coin never gets its forced bond, and its finalize hits `insertPending → null → "done"` on every batch until someone restarts the worker. The worker is designed to run for weeks. Every such row also shows up as a reconcile diff every night (WR-09).
**Fix:** After a row's `lastValidBlockHeight` passes, re-check it at runtime. Either run a single-flight `settleAll` over `ledger.pending()` from the daily batch, which already wakes Neon, or schedule one `setTimeout` per unknown signature (about 90 s plus recheck time) that runs `recoverAction` for that signature. This does not add a DB poll.

#### WR-02: A pending pool_burn lets bondedJob finalize and closing-sweep the burn budget

**File:** `apps/worker/src/fee-burns.ts:112-117`
**Issue:** `ledger.has(mint, BOND_KINDS)` counts pending rows. If a `pool_burn` is unknown and was really dropped, `bondedJob` goes straight to `finalizeJob`, and `closing()` sweeps W's whole budget 90/10. D-17 says that budget is the PumpSwap child burn. Instead, 10% goes to the treasury and 90% becomes a BONDR buyback. Once the row expires the coin is already `done`, so the pool burn is never retried.
**Fix:** In `bondedJob`, continue to finalize only when a *landed* bond burn exists. If one is pending, return `unknown` and leave the coin for the next batch:
```ts
if (await d.ledger.pendingFor(mint, BOND_KINDS)) return [{ state: "unknown" }];
```

#### WR-03: Boot recovery drops the job's facts for every kind except collect

**File:** `apps/worker/src/fee-recover.ts:62-66`
**Issue:** `Job.facts` is not persisted, and `landed()` in recovery rebuilds facts for `collect` only. What happens to each recovered kind:
- **forced_bond / pool_burn:** keeps the *intent* amount (W's whole balance) and the simulated `burned`.
- **finalize_config / finalize_update:** keeps `amount = null`, so their W inflow drops out of `implied`.
- **distribute:** lands with no `amount`, `deployerAmount` or `treasuryAmount`, so `deployer_earned` and `to_treasury` get +0.

The public ledger rows and coin totals are then permanently wrong, and reconcile reports a diff for that W every night.
**Fix:** Rebuild facts per kind from the recovered meta with the same formulas the jobs use:
- forced_bond / pool_burn: `-tokenDelta(meta, Q, W)`
- finalize_*: `tokenDelta(meta, Q, W)`
- distribute: holder deltas from `detail.deployer` / `detail.treasury`

Or move each job's `facts` into one pure function keyed by row kind (`factsFor(kind, meta, row, coin, Q)`) and use it in both `fee-send.landed` and `fee-recover.landed`.

#### WR-04: The ops-floor pause latches until an urgent tx lands or the worker reboots

**File:** `apps/worker/src/fee-send.ts:87-92,182`, `apps/worker/src/fee-batch.ts:140,147`
**Issue:** Two places update `low`: the boot balance read, and `postBalances[0]` of a *landed* tx. Once ops drops below the floor, every non-urgent job is skipped and the batch skips all sends, so no landed tx ever refreshes the flag. Topping ops up by hand, which is the documented recovery, leaves every window, split, sweep, finalize and distribute paused until a forced bond happens to land or someone redeploys.
**Fix:** While `low` is set, re-read the balance on the RPC with no DB access. Do it in `land()` at most once a minute, or at the start of `runBatch`:
```ts
if (low && !job.urgent) {
  noteOps(await d.conn.getBalance(d.ops.publicKey));
  if (low) return { state: "skipped" };
}
```

#### WR-05: Window timers read Postgres for every curve coin, including dead coins with nothing to do

**File:** `apps/worker/src/fee-prebond.ts:96`, `apps/worker/src/fee-ledger.ts:268-269`
**Issue:** The engine header says "Timers and hooks read memory only (D-03)". But `windowJob` calls `d.ledger.openCollects()` on every window end for every curve coin, even when `worthCollecting` was false and nothing was collected. The query also reads every open collect on the platform, not just this mint's. Windows are counted from each launch, so N coins mean N staggered Neon wake-ups a day. Once there are a few hundred dead coins, Neon never reaches its suspend timeout even with zero trading, which eats into the 500 CU-h quota.
**Fix:** Keep the open collects in memory: seed them from recovery's `openCollects()` at boot, add one when a collect lands (in `publish` / `Engine.landed`), and remove it when its split lands. Then query only when the in-memory set has an entry for this mint, or skip the query entirely when this job collected nothing and the set is empty.

#### WR-06: A forced-bond trigger fires an urgent collect on every curve trade while memory and chain disagree

**File:** `apps/worker/src/fee-engine.ts:177-184`, `apps/worker/src/fee-burns.ts:24-30,59-65`
**Issue:** Suppose `force()` passes on memory (indexed cost, memory budget) but `forcedSend` reads a fresh cost and finds the coin not ready. The job returns `DONE`, `forcing` is cleared, and the next curve patch triggers it again. Each retrigger runs:
- `ledger.has` and `openCollects`: two DB reads.
- `collectJob(d, coin, true)`: no `worthCollecting` threshold, `urgent`, so it runs below the ops floor and ops pays the fee.
- A split.
- Several RPC reads.

Near the 105% boundary, where sells push the cost up, this repeats on every trade. In `dry` mode it still does the DB reads on every trade.
**Fix:** After a "not ready" result, record the chain verdict and do not retrigger until memory moves materially. For example, store `notReadyAt = {budget, cost}` on the coin and require the budget to grow or the cost to fall by at least 1% before forcing again. Also gate the urgent collect with `worthCollecting`.

#### WR-07: Raw RPC error text, which can carry the Helius API key, is logged unredacted

**File:** `apps/worker/src/fee-burns.ts:81-83`, `apps/worker/src/fee-finalize.ts:135`
**Issue:** Both lines log `e.message` from RPC calls without `redact()`: `poolExactInBurnIxs` (simulate, getAccountInfo) and `getTokenAccountBalance`. On Node, web3.js network failures wrap node-fetch's `request to https://devnet.helius-rpc.com/?api-key=... failed`. `captureConsoleIntegration` sends warn and error lines to Sentry. `scrub` only masks base58 runs, and a UUID API key is not one. Every other log line in the fee engine goes through `redact`.
**Fix:**
```ts
console.warn(`pool burn exact-quote-in failed, using buy_v2: ${redact(e instanceof Error ? e.message : String(e))}`);
console.error(`finalize ${mint}: W read failed: ${redact(e instanceof Error ? e.message : String(e))}`);
```

#### WR-08: Leftover child tokens in W are never burned, though the code says they are

**File:** `packages/core/src/bond.ts:100-101`, `apps/worker/src/fee-finalize.ts:116-137`
**Issue:** `buyAndBurn` burns `simOut`. If a front-run sell gives W more than the simulation predicted, the extra child tokens stay in W. The comment says "that remainder is burned by the next forced bond or the closing sweep", but neither happens:
- `fee_ledger_once` allows only one forced bond.
- `sweepIxs` moves only BONDR (`quoteMint`).

`checkEmpty` only logs an error, so the platform-held W keeps supply that was meant to be burned. The `buy_v2` fallback (`bond.ts:158`) burns exactly `baseOut` and also leaves any child balance W already held.
**Fix:** In `closing()`, add a `BurnChecked` of `wBondr(d, coin, coin.mint)` when it is > 0. Record it as a ledger row: a `pool_burn`-style detail, or a new kind if the once-index forbids reuse. Correct the comment in `bond.ts`.

#### WR-09: Reconcile reports false diffs and re-inserts a diff row every night

**File:** `apps/worker/src/fee-reconcile.ts:69-91`, `apps/worker/src/fee-batch.ts:147-148`
**Issue:** `reconcile` reads the ledger-implied sums first and the chain balances afterwards. During that gap, other coins' window jobs keep landing on their own queues, which the batch does not pause. Any pending row whose tx landed on chain is excluded from `implied` (WR-01). Both cases produce `reconcile_diff` rows and Sentry errors that are not real. A diff that persists is inserted again every night with nothing to deduplicate it.
**Fix:**
- Skip any W that has a pending row, or any W whose queue is busy (`engine.queue.has(mint)`).
- Read the chain balances first, then the implied sums. Ledger rows only move after the chain, so a race then shows up as a later ledger rather than a phantom loss.
- Write a diff row only when the value differs from the last diff recorded for that mint.

### Info

#### IN-01: FeeConfig.batchHourUtc is dead
**File:** `apps/worker/src/fee-config.ts:2,30,40`
**Issue:** The batch uses `env.feeBatchHourUtc`. `feeConfig().batchHourUtc` is never read, and the header comment about it being overridden is stale.
**Fix:** Delete the field and the comment.

#### IN-02: Dry mode changes engine memory inconsistently
**File:** `apps/worker/src/fee-finalize.ts:34-41,107-108`
**Issue:** In dry mode, `lockedFinal` sets `coin.finalize = "done"` in memory. `hold()` does not set `held`, so in dry mode every daily batch runs preflight again and sends the same "finalize held" error to Sentry.
**Fix:** Guard the memory change in `lockedFinal` with `d.mode === "on"`, as `hold` does. In dry mode, set `coin.finalize = "held"` in memory only.

#### IN-03: Engine.landed resets feesUnclaimed without the slot guard the DB uses
**File:** `apps/worker/src/fee-engine.ts:152`
**Issue:** `coinSet` only zeroes `fees_unclaimed` if no later trade has written it since the collect. Memory always zeroes it, so it under-reads until the next trade, which skews `worthCollecting` and `force()`.
**Fix:** Pass the landing slot and compare it with `this.slots.get(mint)`.

#### IN-04: Collects with a zero treasury share stay "open" forever
**File:** `apps/worker/src/fee-prebond.ts:40-41`, `apps/worker/src/fee-recover.ts:65`
**Issue:** A collect under 10 base units, or a recovered collect whose coin was not in memory (`amount` null), returns `DONE` with no split row. `openCollects` keeps returning it on every window and every boot, and the set only grows.
**Fix:** Exclude `amount < 10 or amount is null` in the `openCollects` SQL, or write a zero-amount marker.

#### IN-05: deployerOk does not exclude the ops or buyback keys
**File:** `packages/core/src/fees.ts:46-59`
**Issue:** The permanent 80% share could be locked to a platform key if a coin was ever launched from ops (for example during testing). The treasury and W are excluded, but ops and buyback are not.
**Fix:** Add `ops` and `buyback` to the distinctness check.

---

_Reviewed: 2026-10-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_


## Phase 5: Code Review Report (web)

**Reviewed:** 2026-10-25T09:00:05Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

### Summary

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

### Critical Issues

#### CR-01: The ledger's first page is cached apart from the hub head, so a landed fee row can be lost

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

### Warnings

#### WR-01: A `fee` event's coin snapshot overwrites newer trade and bond state

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

#### WR-02: An unknown ledger kind crashes the whole token page (no error boundary)

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

#### WR-03: The keyset tie test never puts a tie on the page boundary

**File:** `apps/web/lib/ledger.test.ts:58-72`

**Issue:** `at(i) = floor(i / 2)` puts rows 18 and 19 together and rows 20 and 21 together. Page one ends at row 18, so the cursor sits between two different timestamps. The case the `(landed_ms, id)` keyset exists for, a tie across the cursor, is never run, despite the test name "ties ordered by id".

The seeds also use JS Dates (millisecond precision), so the microsecond truncation that `ledger.ts:34-37` depends on is never exercised either. A regression that drops the `id` tiebreak or the `date_trunc` would still pass.

**Fix:** Straddle the boundary and seed microseconds:

```ts
const at = (i: number) => new Date(Date.now() - 10 * 60_000 - Math.floor((i + 1) / 2) * 60_000); // rows 19 and 20 tie
// and seed one pair via SQL with landed_at = <ts> + interval '123 microseconds' / '456 microseconds'
```

#### WR-04: The fee-live resync spec checks "no duplicate rows" on a coin with no fee rows

**File:** `apps/web/e2e/fee-live.e2e.ts:133-144`

**Issue:** The seeded coin (`trades: 2`) has no `fee_ledger` rows. The resync refetch returns `rows: []`, so `toHaveCount(1)` (the launch row) holds whether or not `addLedger` dedupes. The comment says "no duplicate launch or fee rows", but the dedupe path never runs.

**Fix:** Seed two landed rows in `beforeAll` with `seedLedger`, then assert the list is still exactly 3 entries after the resync refetch. Also check the merged order.

### Info

#### IN-01: The rail's track label and ratio break when a live event clears `cost`

**File:** `apps/web/components/home-next.tsx:52-56`
**Issue:** A trade or fee event can patch a rail coin's `fees.cost` to `null`, and removal waits for the 60 s tick (longer while the rail is hovered). In that window `ratioPct` returns "–", so `pct.slice(0, -1)` gives "", the aria-label reads "Burn budget  percent ready", and the visible text reads "– ready".
**Fix:** Use the `r === null` branch the way `BudgetGauge` does ("Burn budget not measured yet.").

#### IN-02: BONDR amounts under 1 read "0 BONDR"

**File:** `apps/web/lib/ledger-copy.ts:16`
**Issue:** `bondr()` floors to whole BONDR. A dust collect reads "Claimed 0 BONDR of creator fees..." next to a non-zero SOL cell.
**Fix:** Show "<1" when `0 < amount < 1_000_000`.

#### IN-03: `seedCoin` is not atomic, so a failed seed leaks rows

**File:** `apps/web/e2e/fixtures.ts:72-80`
**Issue:** Wallet, vanity, launch, coin and trades are five separate inserts. If any later insert fails, `seedCoin` throws before returning a mint, so the earlier rows are never handed to `dropCoin` (for example `responsive-fee.e2e.ts:83`, `coins.test.ts` seeds). This predates Phase 5, but the new specs lean on it heavily.
**Fix:** Wrap the body in `sql.begin(async (tx) => ...)`.

#### IN-04: The countdown assertion assumes a 24h window

**File:** `apps/web/e2e/fee-ledger.e2e.ts:172`
**Issue:** `/^\d+h \d+m$/` fails when the dev server runs with `FEE_WINDOW_MS=600000`, which `fee-devnet.e2e.ts:3` tells you to do (and `reuseExistingServer` may pick that server up).
**Fix:** Accept `/^(\d+h )?\d+m$|^<1m$/`, or assert against `feeWindowMs()`.

#### IN-05: The home hero spec branches on rail presence

**File:** `apps/web/e2e/home.e2e.ts:28-31`
**Issue:** Either branch passes, so the spec no longer pins which CTA should show for a given DB state. `responsive-fee.e2e.ts` covers both states, so this is acceptable, but the hero spec itself is weaker than before.
**Fix:** None needed if the responsive spec stays. Otherwise seed a rail coin here.

#### IN-06: A coin that just bonded stays "Next up" and the CTA target until the tick

**File:** `apps/web/components/home-hero.tsx:84-88,135-138`, `apps/web/components/home-live.tsx:191-198`
**Issue:** After a live forced bond, `forced` goes up straight away. But `rail.coins[0]` still shows the bonded coin as "Next up: SYM, 10x% ready", and "Watch a coin bond" still links to it, until the 60 s tick. That wait has no limit while the pointer is over the rail.
**Fix:** In `onBond`, drop non-curve coins from the rail right away: `s.setRail((r) => ({ ...r, coins: r.coins.filter((c) => c.mint !== d.mint) }))`.

#### IN-07: The BONDR hop creator sub-row names the coin's fee wallet

**File:** `apps/web/components/trade-quote.tsx:145`
**Issue:** BONDR's creator fee does not go to the coin's fee wallet. It is masked to 0 today, so the row is hidden, but the copy would be wrong if it were ever shown.
**Fix:** Use the label "to the BONDR creator", or drop the creator row for the BONDR hop.

#### IN-08: The devnet spec casts a possibly missing sweep

**File:** `apps/web/e2e/fee-devnet.e2e.ts:163-164`
**Issue:** If no `sweep_buyback` landed, `rows.find(...) as Row` gives `undefined`, and `sweep.id` throws a TypeError instead of a readable assertion.
**Fix:** `expect(sweep, "a landed sweep_buyback").toBeTruthy()` before using it.

---

_Reviewed: 2026-10-25T09:00:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

