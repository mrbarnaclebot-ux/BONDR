---
phase: 05-fee-engine-and-public-ledger
reviewed: 2026-10-25T00:00:00Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - apps/worker/src/announce.ts
  - apps/worker/src/build.ts
  - apps/worker/src/env.ts
  - apps/worker/src/fee-batch.test.ts
  - apps/worker/src/fee-batch.ts
  - apps/worker/src/fee-burns.test.ts
  - apps/worker/src/fee-burns.ts
  - apps/worker/src/fee-config.ts
  - apps/worker/src/fee-engine.test.ts
  - apps/worker/src/fee-engine.ts
  - apps/worker/src/fee-finalize.test.ts
  - apps/worker/src/fee-finalize.ts
  - apps/worker/src/fee-ledger.test.ts
  - apps/worker/src/fee-ledger.ts
  - apps/worker/src/fee-prebond.test.ts
  - apps/worker/src/fee-prebond.ts
  - apps/worker/src/fee-reconcile.ts
  - apps/worker/src/fee-recover.test.ts
  - apps/worker/src/fee-recover.ts
  - apps/worker/src/fee-routes.ts
  - apps/worker/src/fee-send.test.ts
  - apps/worker/src/fee-send.ts
  - apps/worker/src/ingest.ts
  - apps/worker/src/main.ts
  - apps/worker/src/settle.ts
  - packages/core/src/api.ts
  - packages/core/src/bond.test.ts
  - packages/core/src/bond.ts
  - packages/core/src/coin-row.ts
  - packages/core/src/collect.ts
  - packages/core/src/curve-state.ts
  - packages/core/src/curve.test.ts
  - packages/core/src/curve.ts
  - packages/core/src/db.test.ts
  - packages/core/src/fees.test.ts
  - packages/core/src/fees.ts
  - packages/core/src/float.ts
  - packages/core/src/keys.test.ts
  - packages/core/src/keys.ts
  - packages/core/src/pump.ts
  - packages/core/src/schema.ts
  - packages/core/src/send.test.ts
  - packages/core/src/send.ts
  - packages/core/src/sharing.test.ts
  - packages/core/src/sharing.ts
  - packages/core/src/trade-error.ts
  - packages/core/src/trades.test.ts
  - packages/core/src/trades.ts
  - scripts/spike/nets/fork.ts
  - scripts/spike/stages/bond.ts
  - scripts/spike/stages/engine-bond.ts
  - scripts/spike/stages/engine-final.ts
findings:
  critical: 1
  warning: 9
  info: 5
  total: 15
status: issues_found
---

# Phase 5: Code Review Report (fee engine money path)

**Reviewed:** 2026-10-25
**Depth:** standard
**Files Reviewed:** 52
**Status:** issues_found

## Summary

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

## Critical Issues

### CR-01: The treasury tenth gets swept 90/10 or burned when an earlier collect or split is still pending

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

## Warnings

### WR-01: Pending rows are only re-checked at boot, so a coin's forced bond or finalize can stall indefinitely

**File:** `apps/worker/src/fee-send.ts:177`, `apps/worker/src/fee-recover.ts:121-133`, `apps/worker/src/fee-ledger.ts:49-50`
**Issue:** An `unknown` forced_bond, pool_burn, finalize_config or finalize_update row holds its `fee_ledger_once` / `fee_ledger_bond_burn` key while it is pending. Only `recover()` at boot moves it to expired or landed. If the tx was actually dropped, the coin never gets its forced bond, and its finalize hits `insertPending → null → "done"` on every batch until someone restarts the worker. The worker is designed to run for weeks. Every such row also shows up as a reconcile diff every night (WR-09).
**Fix:** After a row's `lastValidBlockHeight` passes, re-check it at runtime. Either run a single-flight `settleAll` over `ledger.pending()` from the daily batch, which already wakes Neon, or schedule one `setTimeout` per unknown signature (about 90 s plus recheck time) that runs `recoverAction` for that signature. This does not add a DB poll.

### WR-02: A pending pool_burn lets bondedJob finalize and closing-sweep the burn budget

**File:** `apps/worker/src/fee-burns.ts:112-117`
**Issue:** `ledger.has(mint, BOND_KINDS)` counts pending rows. If a `pool_burn` is unknown and was really dropped, `bondedJob` goes straight to `finalizeJob`, and `closing()` sweeps W's whole budget 90/10. D-17 says that budget is the PumpSwap child burn. Instead, 10% goes to the treasury and 90% becomes a BONDR buyback. Once the row expires the coin is already `done`, so the pool burn is never retried.
**Fix:** In `bondedJob`, continue to finalize only when a *landed* bond burn exists. If one is pending, return `unknown` and leave the coin for the next batch:
```ts
if (await d.ledger.pendingFor(mint, BOND_KINDS)) return [{ state: "unknown" }];
```

### WR-03: Boot recovery drops the job's facts for every kind except collect

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

### WR-04: The ops-floor pause latches until an urgent tx lands or the worker reboots

**File:** `apps/worker/src/fee-send.ts:87-92,182`, `apps/worker/src/fee-batch.ts:140,147`
**Issue:** Two places update `low`: the boot balance read, and `postBalances[0]` of a *landed* tx. Once ops drops below the floor, every non-urgent job is skipped and the batch skips all sends, so no landed tx ever refreshes the flag. Topping ops up by hand, which is the documented recovery, leaves every window, split, sweep, finalize and distribute paused until a forced bond happens to land or someone redeploys.
**Fix:** While `low` is set, re-read the balance on the RPC with no DB access. Do it in `land()` at most once a minute, or at the start of `runBatch`:
```ts
if (low && !job.urgent) {
  noteOps(await d.conn.getBalance(d.ops.publicKey));
  if (low) return { state: "skipped" };
}
```

### WR-05: Window timers read Postgres for every curve coin, including dead coins with nothing to do

**File:** `apps/worker/src/fee-prebond.ts:96`, `apps/worker/src/fee-ledger.ts:268-269`
**Issue:** The engine header says "Timers and hooks read memory only (D-03)". But `windowJob` calls `d.ledger.openCollects()` on every window end for every curve coin, even when `worthCollecting` was false and nothing was collected. The query also reads every open collect on the platform, not just this mint's. Windows are counted from each launch, so N coins mean N staggered Neon wake-ups a day. Once there are a few hundred dead coins, Neon never reaches its suspend timeout even with zero trading, which eats into the 500 CU-h quota.
**Fix:** Keep the open collects in memory: seed them from recovery's `openCollects()` at boot, add one when a collect lands (in `publish` / `Engine.landed`), and remove it when its split lands. Then query only when the in-memory set has an entry for this mint, or skip the query entirely when this job collected nothing and the set is empty.

### WR-06: A forced-bond trigger fires an urgent collect on every curve trade while memory and chain disagree

**File:** `apps/worker/src/fee-engine.ts:177-184`, `apps/worker/src/fee-burns.ts:24-30,59-65`
**Issue:** Suppose `force()` passes on memory (indexed cost, memory budget) but `forcedSend` reads a fresh cost and finds the coin not ready. The job returns `DONE`, `forcing` is cleared, and the next curve patch triggers it again. Each retrigger runs:
- `ledger.has` and `openCollects`: two DB reads.
- `collectJob(d, coin, true)`: no `worthCollecting` threshold, `urgent`, so it runs below the ops floor and ops pays the fee.
- A split.
- Several RPC reads.

Near the 105% boundary, where sells push the cost up, this repeats on every trade. In `dry` mode it still does the DB reads on every trade.
**Fix:** After a "not ready" result, record the chain verdict and do not retrigger until memory moves materially. For example, store `notReadyAt = {budget, cost}` on the coin and require the budget to grow or the cost to fall by at least 1% before forcing again. Also gate the urgent collect with `worthCollecting`.

### WR-07: Raw RPC error text, which can carry the Helius API key, is logged unredacted

**File:** `apps/worker/src/fee-burns.ts:81-83`, `apps/worker/src/fee-finalize.ts:135`
**Issue:** Both lines log `e.message` from RPC calls without `redact()`: `poolExactInBurnIxs` (simulate, getAccountInfo) and `getTokenAccountBalance`. On Node, web3.js network failures wrap node-fetch's `request to https://devnet.helius-rpc.com/?api-key=... failed`. `captureConsoleIntegration` sends warn and error lines to Sentry. `scrub` only masks base58 runs, and a UUID API key is not one. Every other log line in the fee engine goes through `redact`.
**Fix:**
```ts
console.warn(`pool burn exact-quote-in failed, using buy_v2: ${redact(e instanceof Error ? e.message : String(e))}`);
console.error(`finalize ${mint}: W read failed: ${redact(e instanceof Error ? e.message : String(e))}`);
```

### WR-08: Leftover child tokens in W are never burned, though the code says they are

**File:** `packages/core/src/bond.ts:100-101`, `apps/worker/src/fee-finalize.ts:116-137`
**Issue:** `buyAndBurn` burns `simOut`. If a front-run sell gives W more than the simulation predicted, the extra child tokens stay in W. The comment says "that remainder is burned by the next forced bond or the closing sweep", but neither happens:
- `fee_ledger_once` allows only one forced bond.
- `sweepIxs` moves only BONDR (`quoteMint`).

`checkEmpty` only logs an error, so the platform-held W keeps supply that was meant to be burned. The `buy_v2` fallback (`bond.ts:158`) burns exactly `baseOut` and also leaves any child balance W already held.
**Fix:** In `closing()`, add a `BurnChecked` of `wBondr(d, coin, coin.mint)` when it is > 0. Record it as a ledger row: a `pool_burn`-style detail, or a new kind if the once-index forbids reuse. Correct the comment in `bond.ts`.

### WR-09: Reconcile reports false diffs and re-inserts a diff row every night

**File:** `apps/worker/src/fee-reconcile.ts:69-91`, `apps/worker/src/fee-batch.ts:147-148`
**Issue:** `reconcile` reads the ledger-implied sums first and the chain balances afterwards. During that gap, other coins' window jobs keep landing on their own queues, which the batch does not pause. Any pending row whose tx landed on chain is excluded from `implied` (WR-01). Both cases produce `reconcile_diff` rows and Sentry errors that are not real. A diff that persists is inserted again every night with nothing to deduplicate it.
**Fix:**
- Skip any W that has a pending row, or any W whose queue is busy (`engine.queue.has(mint)`).
- Read the chain balances first, then the implied sums. Ledger rows only move after the chain, so a race then shows up as a later ledger rather than a phantom loss.
- Write a diff row only when the value differs from the last diff recorded for that mint.

## Info

### IN-01: FeeConfig.batchHourUtc is dead
**File:** `apps/worker/src/fee-config.ts:2,30,40`
**Issue:** The batch uses `env.feeBatchHourUtc`. `feeConfig().batchHourUtc` is never read, and the header comment about it being overridden is stale.
**Fix:** Delete the field and the comment.

### IN-02: Dry mode changes engine memory inconsistently
**File:** `apps/worker/src/fee-finalize.ts:34-41,107-108`
**Issue:** In dry mode, `lockedFinal` sets `coin.finalize = "done"` in memory. `hold()` does not set `held`, so in dry mode every daily batch runs preflight again and sends the same "finalize held" error to Sentry.
**Fix:** Guard the memory change in `lockedFinal` with `d.mode === "on"`, as `hold` does. In dry mode, set `coin.finalize = "held"` in memory only.

### IN-03: Engine.landed resets feesUnclaimed without the slot guard the DB uses
**File:** `apps/worker/src/fee-engine.ts:152`
**Issue:** `coinSet` only zeroes `fees_unclaimed` if no later trade has written it since the collect. Memory always zeroes it, so it under-reads until the next trade, which skews `worthCollecting` and `force()`.
**Fix:** Pass the landing slot and compare it with `this.slots.get(mint)`.

### IN-04: Collects with a zero treasury share stay "open" forever
**File:** `apps/worker/src/fee-prebond.ts:40-41`, `apps/worker/src/fee-recover.ts:65`
**Issue:** A collect under 10 base units, or a recovered collect whose coin was not in memory (`amount` null), returns `DONE` with no split row. `openCollects` keeps returning it on every window and every boot, and the set only grows.
**Fix:** Exclude `amount < 10 or amount is null` in the `openCollects` SQL, or write a zero-amount marker.

### IN-05: deployerOk does not exclude the ops or buyback keys
**File:** `packages/core/src/fees.ts:46-59`
**Issue:** The permanent 80% share could be locked to a platform key if a coin was ever launched from ops (for example during testing). The treasury and W are excluded, but ops and buyback are not.
**Fix:** Add `ops` and `buyback` to the distinctness check.

---

_Reviewed: 2026-10-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
