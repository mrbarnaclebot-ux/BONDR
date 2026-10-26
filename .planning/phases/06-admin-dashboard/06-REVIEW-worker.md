---
phase: 06-admin-dashboard
slice: worker
reviewed: 2026-10-26T00:00:00Z
depth: standard (deep on money paths)
files_reviewed: 40
files_reviewed_list:
  - apps/worker/src/admin-act.ts
  - apps/worker/src/admin-actions.ts
  - apps/worker/src/admin-audit.ts
  - apps/worker/src/admin-dest.ts
  - apps/worker/src/admin-evacuate.ts
  - apps/worker/src/admin-inspect.ts
  - apps/worker/src/admin-intent.ts
  - apps/worker/src/admin-leftover.ts
  - apps/worker/src/admin-moderate.ts
  - apps/worker/src/admin-money.ts
  - apps/worker/src/admin-overview.ts
  - apps/worker/src/admin-routes.ts
  - apps/worker/src/admin-send.ts
  - apps/worker/src/admin-sim.ts
  - apps/worker/src/announce.ts
  - apps/worker/src/env.ts
  - apps/worker/src/fee-batch.ts
  - apps/worker/src/fee-boot.ts
  - apps/worker/src/fee-burns.ts
  - apps/worker/src/fee-engine.ts
  - apps/worker/src/fee-finalize.ts
  - apps/worker/src/fee-guard.ts
  - apps/worker/src/fee-ledger-memory.ts
  - apps/worker/src/fee-ledger.ts
  - apps/worker/src/fee-reconcile.ts
  - apps/worker/src/fee-recover.ts
  - apps/worker/src/fee-routes.ts
  - apps/worker/src/fee-send.ts
  - apps/worker/src/fee-stuck.ts
  - apps/worker/src/health.ts
  - apps/worker/src/http.ts
  - apps/worker/src/ingest.ts
  - apps/worker/src/main.ts
  - apps/worker/src/prepare.ts
  - apps/worker/src/rpc-stats.ts
  - apps/worker/src/sentry-count.ts
  - apps/worker/src/settle.ts
  - apps/worker/src/status.ts
  - apps/worker/src/stream.ts
  - apps/worker/src/switches.ts
findings:
  critical: 1
  warning: 10
  info: 5
  total: 16
status: issues_found
fix_status: CR-W-01, WR-W-01..10, IN-W-01, IN-W-02 fixed; IN-W-03, 04, 05 skipped
---

# Phase 6: Code Review Report (worker slice)

**Reviewed:** 2026-10-26
**Depth:** standard, deep on the money paths
**Files Reviewed:** 40 non-test files (the 35 test files were read only to judge money-path coverage)
**Status:** issues_found

## Summary

The core money-path guarantees hold. I traced each one and they check out:

- **Actor gate.** `gated` wraps every route in `adminRoutes`. An unset `ADMIN_WALLET` gets a 403.
- **Fresh signature.** `take` checks the owner's signature against the stored intent bytes and uses the intent once, with no await between the check and `used = true`.
- **Audit first.** The pending audit row is written before any send, on both the coin path (`begin`) and EVACUATE (`beginEvacuate`).
- **Destination lock.** Every send passes through the gated `land`, which uses the allowlist the owner signed.
- **No resends.** Unknown results are never resent.
- **EVACUATE refusal.** EVACUATE refuses when the mode is not `on` or the net is not devnet, before any pause.
- **Double-send protection.** With FEE_ENGINE=off there is no queue, so two admin runs can race. The fee_ledger unique indexes (once, bond_burn, sweep, split) still stop a second send, or the second balance-sized tx fails on chain. I found no double-send path.

The defects are around these guarantees:

- **EVACUATE blocked by the ops floor (Critical).** EVACUATE's transactions count as non-urgent. So below the ops floor every batch is skipped after every switch has been paused.
- **Abort on first error.** One thrown RPC or database error aborts the whole drain.
- **Switch race.** A race on the in-memory switches can undo a pause, including EVACUATE's.
- **Unverified finalize claim.** The dashboard's finalize skips the on-chain launch-signer proof, but the dialog says the check passed.
- **Audit gaps.** Pending audit rows are never settled after a restart. Session-only actions write "landed" before the change runs.

Test coverage of the money paths is good. Covered: the intent binding, single use, a wrong key, the destination lock cases, audit-first, unknown never resent, the queue, and the EVACUATE mode and net refusal. Not covered: the ops floor, a thrown batch, the switch race, and System instructions other than Transfer.

## Critical Issues

### CR-W-01: EVACUATE does nothing below the ops floor, after pausing every switch

**Outcome:** Fixed in dd2de21 (format 480b8da). `buildBatch` returns `urgent: true`. The capture deps now preview a non-urgent step below the ops floor as failed with code `ops_low` and stop there, as base land would (`codeOf` passes `ops_low` through). Tests: an EVACUATE batch reaches base land's blockhash read with ops low while the same job non-urgent is skipped; a captured non-urgent step reads ops_low and an urgent one stays dry.

**File:** `apps/worker/src/admin-evacuate.ts:132` (with `apps/worker/src/fee-send.ts:252`, `apps/worker/src/admin-evacuate.ts:216-225`)

**Issue:** `buildBatch` returns a `Job` without `urgent`. `land` begins with `if (!job.urgent && (await refreshOps(d))) return { state: "skipped" }`.

Scenario: ops is under `OPS_FLOOR_LAMPORTS` (0.05 SOL), the existing low-ops alert state. A leaked seed makes this likely, because ops is the first wallet an attacker drains.

1. The simulation passes. `simulateJob` never consults `opsLow`, and the dialog shows a clean preview.
2. The owner signs.
3. `executeEvacuate` runs `pauseAll()`, which turns every switch off and sets `evacuated_at`.
4. Every batch comes back `skipped`. `moveBatch` counts every wallet as failed, and the audit settles `failed / ops_low`.

Zero W are drained, even though there may be enough SOL for the fees. The break-glass path (ADMIN-11) fails in the state where it matters most. The ops floor exists to keep fee money for urgent sends, and EVACUATE is the most urgent send the worker has.

The same gap means a coin action's preview (for example Sweep now) shows success while the send would be skipped.

**Fix:**
```ts
// admin-evacuate.ts buildBatch
return {
  rows,
  ixs: [...head(d), ...batch.flatMap((b) => wIxs(d, b))],
  signers: batch.map((b) => b.w),
  urgent: true, // break-glass: never paused by the ops floor
};
```
Also return `opsLow()` in `AdminSimResult` (or refuse the intent with `ops_low` for non-urgent actions) so the preview matches what execute will do. Add one test: with `opsLow()` true, an EVACUATE batch still reaches base `land`.

## Warnings

### WR-W-01: A public prepare or submit can undo a switch flip or EVACUATE's pause in memory

**Outcome:** Fixed in 3c7580e. switches.ts counts committed writes, and a `loadSwitches` read that started before a write returns memory instead of overwriting it. This covers every reader, including prepare and submit. `pauseAll` sets memory from the values it wrote and does not re-read. Test: a held-open read resolving after `setJob` or `pauseAll` leaves the switch off.

**File:** `apps/worker/src/status.ts:193`, `apps/worker/src/switches.ts:31-41`, `apps/worker/src/switches.ts:44-63`

**Issue:** `liveStatus(ctx, true)` runs on every prepare and submit. Both are public routes. It calls `loadSwitches()`, which replaces all five switches in memory with whatever its SELECT returned.

Scenario:
1. A prepare's SELECT starts on one pooled connection.
2. The owner's `setJob("sweeps", false)` (or `pauseAll()`) UPDATE commits on another connection and sets memory to off.
3. The prepare's SELECT, which read the row before the commit, resolves and assigns `state` with the old "on" values and `evacuatedAt: null`.

Memory now says on while the database says off. The engine keeps sweeping or forcing bonds, and the health panel shows the switch back on, until the next fresh read. During EVACUATE this re-enables automation while the W are being drained.

A related gap: in `pauseAll`, if the UPDATE succeeds but the follow-up `loadSwitches()` throws, memory keeps every switch on.

**Fix:** The prepare and submit freshness check needs only the launches column. Read it into a local and never overwrite the shared state:
```ts
// status.ts
fresh ? readLaunchesFromDb() : switchesLoaded() ? switchOn("launches") : loadSwitches().then((s) => s.launches)
```
In `pauseAll`, set `state` from the values just written (`{ all false, evacuatedAt }`) instead of re-reading. Alternatively, add a write counter in switches.ts and drop any load that started before the latest write.

### WR-W-02: One thrown batch aborts the whole EVACUATE

**Outcome:** Fixed in d417bd5 (format 480b8da). Each batch is caught. Its W not yet counted are added to `failed`, the run is marked as thrown and the loop continues. Test: the first land throws, later batches still land, and the intent and audit settle `failed / build_failed` with the right moved and failed counts.

**File:** `apps/worker/src/admin-evacuate.ts:216-225`, `apps/worker/src/admin-evacuate.ts:237-248`

**Issue:** `moveBatch` awaits `evacuateBalances` (RPC) and `d.land` with no catch. `land` throws on:
- a `getLatestBlockhash` error, such as a 429 or a timeout
- an `insertPending` database error, such as a Neon cold-start or a reset connection
- a meta or settle failure

Any one of these escapes to the loop's single try/catch, which stops the loop. Every later W stays undrained while every switch is already paused, and the audit settles `build_failed`. The header comment ("A failed batch leaves later W to go") is true only for failures reported on chain.

**Fix:** Catch each batch, count it as failed, and continue:
```ts
for (const [i, p] of plan.entries()) {
  if (i) await pace(feeConfig(d.net).paceMs);
  try {
    await moveBatch(ctx, d, p.batch, r);
  } catch (err) {
    r.failed += p.batch.length;
    r.threw = true;
    logged("evacuate batch")(err);
  }
  if (r.refused) break;
}
```

### WR-W-03: Dashboard finalize skips the launch-signer proof, but the dialog says it passed

**Outcome:** Fixed in fee1b7d (tests trimmed in 5edb17d). `finalize_split` passes the override only for a held coin. Any other coin runs the automatic preflight, which proves the launch signer. A held coin's allowlist carries `recorded`, and `passedLines` then reads "deployer is the recorded launch wallet". Fork gate re-run: 99 ok, 123 checks passed (1a10d19).

**File:** `apps/worker/src/admin-actions.ts:162-165`, `apps/worker/src/fee-finalize.ts:50-67`, `apps/worker/src/admin-dest.ts:106`

**Issue:** `finalizeSplit.run` always calls `finalizeJob(d, coin, coin.wallet)`. With `override` set, `preflight` skips the launch tx fetch and the CreateEvent `user` check. It then compares `wallet: override ? deployer : coin.wallet`, which is always equal.

This applies to coins that were never held (`finalize: "none"`), where the automatic path would have proved `launches.wallet` against the chain. Meanwhile `passedLines` tells the owner "deployer matches the launch signer", a check that never ran.

Scenario: a `launches.wallet` that does not match the real launch signer, from a bad row or a manual DB edit. The dashboard locks the permanent 80% share (`update_fee_shares`, irreversible) to that wallet, and the dialog claims it was verified. D-15 accepts this only for a held coin whose hold reason the owner has read.

**Fix:** Override only for a held coin, and let the normal preflight prove the deployer otherwise:
```ts
run: (d, v) => {
  const coin = need(v);
  return finalizeJob(d, coin, coin.finalize === "held" ? coin.wallet : undefined);
},
```
For held coins, change the dialog line to say the deployer is the recorded launch wallet, not that it matches the signer.

### WR-W-04: The destination lock lets every System instruction through except Transfer

**Outcome:** Fixed in ec2bf7b. Any System instruction other than Transfer or TransferWithSeed is refused, naming its first account. Tests cover CreateAccount funded by W, Assign and WithdrawNonceAccount.

**File:** `apps/worker/src/admin-dest.ts:55-64`, `apps/worker/src/admin-dest.ts:92-94`

**Issue:** `systemRecipient` returns null for anything other than Transfer and TransferWithSeed, and a null recipient passes. `CreateAccount` or `CreateAccountWithSeed` funded by W, `WithdrawNonceAccount` and `Assign` all pass `refusedDestination`. `Assign` would hand W's lamports and signing authority to another program.

The token side refuses anything it does not recognise (`tokenRefusal` returns the account), so the two halves of D-14 disagree. A future job, or a change to `configTx` or `bond.ts`, that builds one of these from W would pass both the simulate check and the execute check. No current job builds any System instruction other than Transfer at top level. ATA creation is a CPI, and `tipIxs` is added after the check and paid by ops. So deny-by-default costs nothing.

**Fix:**
```ts
if (p.equals(SystemProgram.programId)) {
  const to = systemRecipient(ix)?.toBase58();
  if (!to) return ix.keys[0]?.pubkey.toBase58() ?? p.toBase58(); // only transfers are allowed
  if (!a.owners.has(to)) return to;
}
```
Add CreateAccount and Assign cases to `admin-dest.test.ts`.

### WR-W-05: Admin simulations stamp "last run per job" and the engine heartbeat

**Outcome:** Fixed in 9db372c. `FeeDeps.sim` is set only by `captureDeps`, and the five `mark()` calls skip when it is set. Real admin sends still mark. Test: a windowJob capture leaves the split mark unset.

**File:** `apps/worker/src/fee-guard.ts:49,52`, `apps/worker/src/fee-burns.ts:68`, `apps/worker/src/fee-batch.ts:59,105` (reached from `apps/worker/src/admin-sim.ts:93-105`)

**Issue:** `mark()` is called inside the job functions, and `captureDeps` runs those same functions to build a preview. Each simulation therefore marks its job as just run:

- Sweep now marks split and sweep.
- Retry forced bond marks bondCheck.
- Distribute now marks distribute.
- Burn buyback now marks buyback.

`healthSnapshot.lastEngine` is the newest of these marks. With FEE_ENGINE=off, or with a stalled engine, opening one preview makes the health panel (ADMIN-06) show a live engine and a fresh buyback burn that never happened.

**Fix:** Move the marks to the engine's job wrappers (`Engine.fire`, `forced`, `bonded`, and the batch `sends`). Or skip them in capture deps, for example with a `sim?: true` flag on `FeeDeps` that `captureDeps` sets and `mark` callers check.

### WR-W-06: Admin audit rows stay pending forever after a restart mid-send

**Outcome:** Fixed in c6f676a. `settleStale(bootAt)` in admin-audit.ts is a single UPDATE from main.ts at listen. It sets pending rows with `at < bootAt` to `failed`, error `worker restarted`. Rows this process writes are left alone, and nothing polls. A DB test runs inside a rolled-back transaction.

**File:** `apps/worker/src/admin-money.ts:122-168`, `apps/worker/src/admin-evacuate.ts:230-253`, `apps/worker/src/admin-audit.ts:34-53`

**Issue:** Execute answers 202 and sends in the background. If the worker restarts or crashes between `insertPending` and `settle`, the `admin_audit` row stays `pending` forever. A long EVACUATE is the likeliest case.

Fee ledger rows are recovered at boot, but no code ever settles an audit row, and the in-memory intent is gone. The audit log (ADMIN-10, D-33) then shows a money action as pending with no signatures, even though transactions may have landed.

**Fix:** At boot, before serving `/admin/*`, settle every pending `admin_audit` row to `failed` with `error: "worker_restarted"`. The guard trigger allows pending to failed. The owner can match signatures through the fee_ledger rows written in that window.

### WR-W-07: Session-only actions write a "landed" audit row before the change, so a failed change still reads as done

**Outcome:** Fixed in 328907b (typing follow-up e59cf43). New helper `audited(audit, row, change)`: it inserts a pending row (session rows pass no simulation or intent, which the CHECK allows), runs the change, then settles `landed`, or `failed / change_failed` and rethrows. Used by switch, hold, release, hide, unhide, block and unblock. Re-check still writes one landed row, because it records the chain outcome it observed. Test: a switch whose write throws leaves a failed row.

**File:** `apps/worker/src/admin-act.ts:39-45,63-65,73-76`, `apps/worker/src/admin-moderate.ts:129-130,143-144,150-151`

**Issue:** `switchRoute`, `hold`, `release`, hide, unhide, block and unblock each call `insertLanded` first, then run the change. If `setJob`, `exec.update(coins)` or the moderation write throws, the route answers 500, but the audit permanently says the switch flipped or the coin was held, hidden or unblocked.

For a kill switch during an incident, the log then claims a pause that did not happen.

**Fix:** Use the two-step model the money path already uses. `insertPending` (null simulation and intent are allowed by `admin_audit_intent`), run the change, then `settle(id, "landed")`. On a throw, `settle(id, "failed", { error })` and rethrow.

### WR-W-08: The bearer-only `POST /kill-switch` still flips the launches switch, unaudited and without the actor gate

**Outcome:** Fixed in f3f23cd. The route stays because `paused.e2e.ts` uses it. It now goes through the same audit writer with actor `runbook`, and answers 409 `not_applicable` (reason `evacuated`) to a re-enable while `evacuated_at` is set. Pausing still works. The audit table prints short actors such as `runbook` in full. READMEs updated. Tests: the audited flip, and the refused re-enable with no write and no row.

**File:** `apps/worker/src/main.ts:69`, `apps/worker/src/status.ts:181-185`

**Issue:** Phase 6 rewired `setSwitch` onto `setJob("launches")`, the same switch the console controls. Two rules break:

- D-34 says there is one write path and one audit writer.
- D-36 says switches stay off after EVACUATE until the owner turns them back on.

Through this route, anyone with WORKER_TOKEN can re-enable launches after EVACUATE with no `admin_audit` row and no actor check.

**Fix:** Delete the route (the console's `/admin/switch` replaces it). Or route it through `switchRoute` with an audit row whose actor is `"runbook"`.

### WR-W-09: Any landed job clears a coin's stuck state, including an unrelated admin run

**Outcome:** Fixed in e7ae3b1. `note` clears only when the landed job's step equals the stuck step. Runs through `exclusive` never count a failure. Money retries pass their automatic job's label (`STEP_LABEL`: fee window, forced bond, fee finalize, fee distribute), so a landed retry still clears its own step. Test: another step landing, an unlabelled admin landing and admin failures all leave the stuck forced bond as it was, and a labelled retry that lands clears it.

**File:** `apps/worker/src/fee-engine.ts:175-177`, `apps/worker/src/fee-stuck.ts:24-31`

**Issue:** `note` deletes the coin's failure entry whenever `verdict` is `"clear"`, which means any landed tx, whatever the step.

Scenario: forced bond fails three times and the coin shows as stuck (D-20). Then that coin's window sweep lands, or the owner runs Burn W token balance (`exclusive` reports through the same `note`). The stuck flag and its count are wiped while the forced bond is still broken. An admin run that fails also restarts the automatic step's count under the step name "admin".

**Fix:** Clear only when the failing step itself lands:
```ts
const step = stepOf(what, mint);
const prev = this.failures.get(mint);
if (v === "clear") { if (prev?.step === step) this.failures.delete(mint); return; }
```
Keep admin runs out of the stuck count, for example by not passing a `what` that maps to a step.

### WR-W-10: EVACUATE leaves unsplit collects open, so after resume their split comes out of W's new budget or blocks the coin

**Outcome:** Fixed in 91504b2. `evacuateBalances` makes one `openCollects()` read and attaches each W's oldest unsplit collect. `buildBatch` writes a `split_treasury` row (ref = that collect, amount = its treasury tenth, own sol) when W holds at least the tenth, and lowers the evacuate amount by it. Limit: fee_ledger_sig_kind allows one split per mint per tx, so a W with several unsplit collects closes only one per EVACUATE (marked `ponytail:`). Test: the batch rows match, and after landing the collect is no longer open.

**File:** `apps/worker/src/admin-evacuate.ts:120-133`, `apps/worker/src/fee-guard.ts:17-30`, `apps/worker/src/fee-prebond.ts:34-43`

**Issue:** EVACUATE moves W's whole BONDR balance to the treasury but writes no `split_treasury` rows. Any landed collect without a live split stays in `openCollects`. This happens when the split was skipped by the ops floor, failed, or the worker crashed between collect and split.

When the owner turns sweeps or forced bond back on (D-36), `guard` runs `splitJob` for that old collect. If the window's fresh collect gave W enough BONDR, the split pays the treasury a tenth it already received through EVACUATE, taken from the coin's budget. If W holds less, the split fails, the collect stays open, and `spend` never reaches the sweep or the forced bond for that coin again.

**Fix:** In `buildBatch`, read the W's open collects. For each one, put a `split_treasury` row (ref = collect id, amount = treasury tenth) in the same tx, and reduce the `evacuate` row's amount by those tenths. The funds go to the treasury either way, and the ledger then closes those collects.

## Info

### IN-W-01: EVACUATE writes a public "Moved 0 BONDR" row for every W that holds only SOL

**Outcome:** Fixed in b3fc5f7. A W with no BONDR writes the SOL-only Emergency row (no amount, sol = lamports moved), which the web's ledger copy already renders. A W with only child tokens writes just its leftover_burn.

**File:** `apps/worker/src/admin-evacuate.ts:122-131`

**Issue:** `move` is pushed for every W in the batch, so a W that only held its SOL float writes a public `evacuate` row with amount 0. Nearly every finalized coin's W holds a float. The SOL actually moved appears nowhere on the public ledger.

**Fix:** Push the evacuate row only when `b.bondr > 0n`. If the public record should name the SOL, put the lamports in `detail`.

### IN-W-02: finalize's `checkEmpty` hides a leftover burn that throws after broadcast

**Outcome:** Fixed in a49a4cb. Only the two balance reads stay in the try. A burn that throws is logged as `leftover burn failed`, not as a failed W read. The burn's signature is still lost when land throws after broadcast; boot recovery settles the row.

**File:** `apps/worker/src/fee-finalize.ts:126-141`

**Issue:** `leftoverBurnJob` runs inside the read's try. If `land` throws after the broadcast (a `ledger.settle` database error), the catch logs "W read failed" and returns `[]`. The burn's signature then never reaches the admin outcome or the audit sigs. The ledger row is recovered at boot.

**Fix:** Keep only the two balance reads inside the try, and let a burn error propagate or log it under its own name.

### IN-W-03: A deferred guard reads as "unknown, unconfirmed" when nothing was sent

**Outcome:** Skipped. It needs a new deferred outcome through `settled`, `outcome` and the web copy (worker and web), which is more than a one-liner.

**File:** `apps/worker/src/fee-guard.ts:13,28-29`, `apps/worker/src/admin-send.ts:51-52`

**Issue:** `guard` returns `DEFERRED = { state: "unknown" }`, with no signature, when collect or split rows are still pending after settling. `outcome` maps this to intent state `unknown` and audit `failed / unconfirmed`, as if a tx might still land. The owner may wait for a confirmation that will never come.

**Fix:** Give the deferral its own state or code (for example `deferred`) and map it to `failed / pending_rows`.

### IN-W-04: Simulate spam can evict the owner's pending intent

**Outcome:** Skipped. The eviction-order change plus a 429 refusal is a small design change, not a one-liner. It cannot move funds.

**File:** `apps/worker/src/admin-intent.ts:61-63`

**Issue:** When the store is full, `putIntent` drops the oldest entry whatever its state. The actor is a public key, so a WORKER_TOKEN holder can call `/admin/simulate` 200 times and evict an intent the owner is about to sign. The same eviction can drop a running intent's poll view. This is not fund-moving, but it blocks the owner during an incident.

**Fix:** Evict expired entries first, then executed ones, and refuse a new simulate (429) rather than evicting a live unused intent.

### IN-W-05: The Sentry org slug is hardcoded

**Outcome:** Skipped. It needs a new env var or DSN parsing. Deferred to Phase 7 with the production Sentry setup.

**File:** `apps/worker/src/sentry-count.ts:9`

**Issue:** `organizations/mrbarnacle` is baked into `ISSUES_URL`. Renaming the org or moving projects breaks the health row silently (it shows "failed").

**Fix:** Read the slug from env next to `SENTRY_READ_TOKEN`, or derive it from the DSN.

---

_Reviewed: 2026-10-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (deep on money paths)_
