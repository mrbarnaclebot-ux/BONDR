---
phase: 05-fee-engine-and-public-ledger
fixed_at: 2026-10-25T00:00:00Z
review_path: .planning/phases/05-fee-engine-and-public-ledger/05-REVIEW-engine.md
iteration: 1
findings_in_scope: 10
fixed: 9
skipped: 1
status: partial
---

# Phase 5: Code Review Fix Report (fee engine money path)

**Fixed at:** 2026-10-25
**Source review:** .planning/phases/05-fee-engine-and-public-ledger/05-REVIEW-engine.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (CR-01, WR-01 to WR-09; Info findings skipped as instructed)
- Fixed: 9
- Skipped: 1 (WR-08: only the misleading comment was corrected)

Work happened in the main working tree on `phase-05-fee-engine`, as instructed. Nothing under `apps/web` was touched.

## Fixed Issues

### CR-01: The treasury tenth gets swept 90/10 or burned when an earlier collect or split is still pending

**Files modified:** `apps/worker/src/fee-guard.ts` (new), `fee-prebond.ts`, `fee-burns.ts`, `fee-finalize.ts`, `fee-engine.ts`, `fee-ledger.ts`, `fee-recover.ts`, `fee-send.ts`, `README.md`, plus tests
**Commit:** 46068ea
**Applied fix:** Added one guard, `spend()` in the new `fee-guard.ts`. All four balance-sized sends go through it: the window sweep, the forced bond, the pool burn and finalize's closing sweep. The guard works in three steps:
1. It reads the mint's pending `collect`, `split_treasury`, `forced_bond` and `pool_burn` rows, using the new `ledger.pendingFor`.
2. It settles those rows from chain with the boot settle logic, now exported from `fee-recover.ts` as `settleRows`.
3. It splits every open collect of the mint, using `openCollects(mint)`, which is now scoped to the mint.

The send only goes out when every step settled and no row is still pending. Otherwise the guard returns a trailing `unknown` and logs that the send was deferred. `windowJob` moved to `fee-guard.ts` to avoid an import cycle. The old copy-pasted split loops in burns and finalize are gone.

The landed-without-meta case now retries: `metaOf` makes up to 3 `fetchTx` tries, about 30 s, and both `land` and recovery use it. If a signature confirmed but has no meta yet, it counts as still pending, so the guard keeps deferring.

Tests:
- A pending collect with unknown status defers the sweep.
- A pending collect that confirmed on chain is settled from its own meta, then split, then swept.
- A pending split defers the sweep.
- A confirmed tx whose meta lags lands instead of staying pending.
- The pg ledger test covers `pendingFor` and the scoped `openCollects`.

**Follow-up commit:** eddaa43. The new ledger methods pushed `fee-ledger.ts` past 300 lines, so the memory store's filters now share one helper.

### WR-02: A pending pool_burn lets bondedJob finalize and closing-sweep the burn budget

**Files modified:** `apps/worker/src/fee-burns.ts`, `fee-guard.ts`, `fee-burns.test.ts`
**Commit:** 876bcd7
**Applied fix:** `bondedJob` now runs the guard before it checks `has(BOND_KINDS)`. A pending bond burn is settled from chain first. If the burn expired or failed, it is sent again. While it stays pending, finalize waits. The closing sweep's own guard also defers on pending bond burns.

Tests:
- A pending `pool_burn` with unknown status does not reach finalize.
- A `pool_burn` that failed on chain is sent again, then finalize runs.
- One existing test now marks its forced bond as landed. It had used a pending row to stand for "after a forced bond".

### WR-05: Window timers read Postgres for every curve coin

**Files modified:** `apps/worker/src/fee-send.ts`, `fee-guard.ts`, `fee-prebond.ts`, `fee-burns.ts`, `fee-recover.ts`, plus tests
**Commit:** 5eb0886
**Applied fix:** `FeeCoin.open` is an in-memory flag, and no polling was added.
- **Set:** before any collect or bond burn is sent, and at boot for every coin that has a pending row or an open collect.
- **Read:** the guard reads Postgres only for an open coin, and only that mint's rows.
- **Cleared:** once nothing is pending and every split has settled.

An idle coin's window now costs no database read. It does one RPC balance read, which is 0, and stops.

Test: an idle coin's window makes zero `pendingFor` and `openCollects` calls. A collect opens the coin, and a clean guard closes it again. Recovery marks coins with pending rows as open.

### WR-03: Boot recovery drops the job's facts for every kind except collect

**Files modified:** `apps/worker/src/fee-send.ts`, `fee-recover.ts`, `fee-prebond.ts`, `fee-burns.ts`, `fee-finalize.ts`, `fee-batch.ts`, `fee-recover.test.ts`
**Commit:** 2dd594c
**Applied fix:** Added one pure function, `factsFor(rows, meta, Q, w?)`, in `fee-send.ts`. It computes each kind's landed amount:
- collect, finalize_config, finalize_update: W's delta
- forced_bond, pool_burn: minus W's delta
- distribute: the two named holders' deltas, merged into `detail`

Every job and boot recovery now use it, so a recovered row lands with the same facts its job would have written.

Test: recovery of pending pool_burn, finalize_update and distribute rows lands amounts 900, 300 and 100, and the distribute split is set in its detail.

### WR-01: Pending rows are only re-checked at boot

**Files modified:** `apps/worker/src/fee-recover.ts`, `fee-batch.ts`, `fee-recover.test.ts`
**Commit:** 82c002d
**Applied fix:** Added `settleStale()`. The daily batch runs it before its sends, since the batch already wakes Neon. It settles every pending row that is past its blockhash, using the boot logic. Rows still inside their blockhash are left to the send that is in flight. Settled coins are marked open, so their next guard reads the ledger. Rows of the guard's kinds are also settled at runtime by the CR-01 guard whenever a balance-sized send is due.

Test: `settleStale` settles the stale row only and leaves the fresh one pending. This is in `fee-recover.test.ts`, because `fee-batch.test.ts` is at the 300-line limit. The one-line `runBatch` wiring has no dedicated test.

### WR-04: The ops-floor pause latches

**Files modified:** `apps/worker/src/fee-send.ts`, `fee-batch.ts`, `fee-send.test.ts`
**Commit:** f4daeba
**Applied fix:** Added `refreshOps()`. While the pause is on, `land` (for non-urgent jobs) and `runBatch` re-read the ops balance on the RPC, at most once a minute and with no database access. A failed read keeps the pause on. `noteOps` now logs the below-floor error once per drop, not on every read.

Test: a paused floor clears on a top-up, and a second check within the minute does not re-read.

### WR-06: A forced-bond trigger fires an urgent collect on every curve trade

**Files modified:** `apps/worker/src/fee-burns.ts`, `fee-engine.ts`, `fee-send.ts`, `fee-burns.test.ts`, `fee-engine.test.ts`
**Commit:** 73853e4
**Applied fix:**
- When the chain returns "not ready", `forcedSend` records the memory budget and cost in `FeeCoin.notReady`.
- The new `forceDue()`, which replaces the inline trigger in `Engine.force`, holds off until the budget grows or the cost falls by at least 1%.
- `forcedJob`'s urgent collect is now gated by `worthCollecting`. `bondedJob` keeps its collect ungated, because memory `feesUnclaimed` may be stale after migration.

Test: after a not-ready verdict, the trigger waits until memory moves 1%. Fees under the minimum skip the collect.

### WR-09: Reconcile reports false diffs and re-inserts a diff row every night

**Files modified:** `apps/worker/src/fee-reconcile.ts`, `fee-reconcile.test.ts` (new), `fee-batch.ts`, `fee-batch.test.ts`, `fee-engine.ts`
**Commit:** 6d144d9
**Applied fix:**
- The reconcile skips any W that has a pending row or a busy queue. `Engine.busy` is new.
- A diff row and its error are written only when the value differs from the last diff recorded for that account. This is marked as a `ponytail:` shortcut: the memory is per process, so a restart writes one repeat row.

Not adopted: the "read chain first" part of the suggestion. The list of accounts to read comes from the implied sums. More importantly, reversing the order does not close the race: a tx landing between the two reads still produces a diff, only with the opposite sign. The pending and busy skips are what remove the false diffs.

Test: across two runs, only the account with no pending row and no busy queue writes a row, and it writes only once.

### WR-07: Raw RPC error text logged unredacted

**Files modified:** `apps/worker/src/fee-burns.ts`, `fee-finalize.ts`, `fee-burns.test.ts`, `fee-finalize.test.ts`
**Commit:** c203a2b
**Applied fix:** Both lines now go through `redact()`.

Tests: the buy_v2 fallback warning and the post-sweep W read failure both log `api-key=<redacted>`, never the key itself.

## Skipped Issues

### WR-08: Leftover child tokens in W are never burned

**File:** `packages/core/src/bond.ts:100-101`, `apps/worker/src/fee-finalize.ts:116-137`
**Reason:** The burn itself was skipped because it is a design change larger than the suggested fix. `pool_burn` is in both the once-index and the bond_burn index, so a closing burn row cannot reuse it. That leaves a new ledger kind, which needs:
- a migration that changes the `fee_ledger_kind` check
- `totalsFor` and reconcile handling
- probably public-ledger display in `apps/web`, which was off limits here

Only the false comment in `bond.ts` was corrected, in commit b644012. It now says the remainder stays in W and is logged by finalize's empty check.
**Original issue:** If a front-run sell gives W more child tokens than the simulation predicted, the extra stays in W. The comment claimed the next forced bond or the closing sweep burns it, but neither does.

## Notes

- **README:** the new helpers are listed in commit 12d7e3e.
- **Verification:**
  - `pnpm vitest run apps/worker packages/core --exclude '.claude/**'`: 45 files, 326 passed, 1 skipped.
  - `pnpm typecheck`: exit 0.
  - `pnpm biome ci apps packages scripts biome.json package.json`: clean.
- **Root `pnpm lint` fails for an environmental reason, not because of this code:** `biome ci .` finds the other fixer's worktree at `.claude/worktrees/agent-a598636ed4c637162/biome.json` and reports a nested root configuration. For the same reason, the unfiltered vitest path also picks up that worktree's copies of the tests, so I excluded `.claude/**`.
- **One transient Neon failure:** during the WR-02 run, the pgLedger "implied sums" test failed once with `BigInt(null)`. It passed when rerun alone, and the same test passes on the pre-change tree. It looked like a short-lived committed row from another process. `pgImplied` would throw on a mint whose landed rows all have a null amount. WR-03 removes the way recovery produced such rows, but `coalesce` in that SQL would make it robust. It was not changed, because it is outside the listed findings.
- **No leaked rows:** no `test-` rows were left in coins, fee_ledger, wallets or launches after the runs.
- **Nothing on chain:** no mainnet, no SOL spent, no worker or Surfpool fork started.

---

_Fixed: 2026-10-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
