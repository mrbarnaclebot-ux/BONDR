---
phase: 05-fee-engine-and-public-ledger
plan: 05
subsystem: worker-fee-engine
tags: [worker, engine, flag, timers, recovery, wiring, tdd]
requires:
  - 05-02 web ledger read and LedgerRow shape
  - 05-03 costFromReserves, feesUnclaimed on curve patches
  - 05-04 land, LedgerStore, collect/split/sweep/window jobs, noteOps
provides:
  - fee-recover.ts recover, recoverAction (boot settle of pending rows, split of open collects)
  - fee-engine.ts Engine, startEngine, onIngest, withCost, coinFrom
  - announce.ts arm, publishFee, ledgerRow, Inserted, Written (moved out of ingest.ts)
  - env.ts feeEngine, feeWindowMs, feeBatchHourUtc, buyback(seed, net, lane)
affects: [05-07, 05-08, 05-09, 05-10, 05-12]
tech-stack:
  added: []
  patterns:
    - Engine class (methods under 40 lines) holding coins, a per-mint promise chain and one timer per coin
    - module-level engine and cost context set by startEngine; onIngest and withCost are no-ops before it
    - window re-arm at max(index + 1, current window), so a late timer catches up one window and never fires a past one
key-files:
  created:
    - apps/worker/src/fee-recover.ts
    - apps/worker/src/fee-recover.test.ts
    - apps/worker/src/fee-engine.ts
    - apps/worker/src/fee-engine.test.ts
    - apps/worker/src/announce.ts
  modified:
    - apps/worker/src/env.ts
    - apps/worker/src/main.ts
    - apps/worker/src/ingest.ts
    - apps/worker/src/build.ts
    - apps/worker/src/fee-config.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/settle.ts
    - .env.example
    - apps/worker/README.md
    - apps/worker/src/README.md
decisions:
  - "onIngest takes one Ingested object (patches, inserted trades with their slot, bonded, launched) instead of three positional args; the engine applies fee numbers only from a trade at least as new as the last applied slot, and venue only advances"
  - "A new launch reaches the engine as Launched { mint, launchedAt, launchSig, wallet }; ingestLaunch's row now carries wallet (settle's Row already had it, backfillLaunches selects it)"
  - "A launched coin joins engine memory before ready but is armed only at start(); start() arms every curve coin in memory"
  - "Engine.landed applies totalsFor in memory (fee_budget clamped at 0, fees_unclaimed reset on collect), so a quiet coin does not re-collect an empty bucket every window"
  - "withCost(conn, parsed) reads net, Q and W from a cost context startEngine sets in every mode; a cost failure is logged and never fails the trade write; only curve patches (no venue) with all four reserves are priced"
  - "Boot recovery in dry mode settles nothing (dry writes nothing); it logs the pending count and still splits open collects through d.land, which only simulates"
  - "An RPC error during recovery stops the loop and leaves every remaining row pending for the next boot, instead of polling a stale height forever"
  - "A retried index boot keeps an engine that already reached ready, so no window is armed twice"
  - "env.ts changes went in with Task 2 because startEngine reads them; announce.ts started in Task 2 with publishFee and took arm/announce/tradeRow in Task 3"
metrics:
  duration: 25 min
  completed: 2026-10-25
  tasks: 3
  files: 15
---

# Phase 5 Plan 05: Fee engine wiring Summary

The fee engine now runs inside the worker behind `FEE_ENGINE`. It boots in this order: one read of every coin, boot recovery, then one in-memory timer per unbonded coin for its current window's end. Each coin has its own serial queue. A trade hook keeps fee state in memory, `cost_to_complete` is written on every curve patch, and landed public rows go out as `fee` events. It is off by default. A zero-spend devnet dry run showed windows firing and writing nothing.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Boot recovery of pending rows and open collects | c80d660 (RED), 06b7676 (GREEN) | fee-recover.ts, fee-recover.test.ts, settle.ts (exports), fee-send.ts (withSol export) |
| 2 | Engine: flag, ready gate, per-coin queue, window timers, trade hook | 2fb734b (RED), 3860c23 (GREEN) | fee-engine.ts, fee-engine.test.ts, announce.ts (publishFee), env.ts |
| 3 | Wire into boot, ingest and the event stream; devnet dry run | 3824c5c | main.ts, ingest.ts, announce.ts, build.ts, fee-config.ts, .env.example, READMEs |

## Verification

- `pnpm vitest run apps/worker/src/fee-recover.test.ts apps/worker/src/settle.test.ts`: 8 passed.
- `pnpm vitest run apps/worker/src/fee-engine.test.ts`: 9 passed, using fake timers and fake deps. It covers every behavior bullet plus a withCost check.
- `pnpm vitest run apps/worker/src`: 22 files, 135 passed, 1 skipped.
- Full `pnpm test`: 53 files, 375 passed, 2 skipped, exit 0.
  - One earlier run reported 1 failed file with 0 failed tests, and the next two runs were clean, so it looks flaky.
  - `pnpm typecheck` passes and `pnpm lint` (biome ci) is clean.
- Acceptance greps:
  - `nextState` is in fee-recover.ts.
  - fee-recover.ts has no `sendRaw`, `broadcast(` or `sendTx`.
  - The only `db()` in fee-engine.ts is inside `loadRows`, which only `startEngine` calls.
  - `OPS_FLOOR_LAMPORTS = ` is only in fee-config.ts.
  - `FEE_ENGINE` is in .env.example.
- File sizes: fee-engine.ts 257 lines, ingest.ts 258, fee-recover.ts 133, announce.ts 83, env.ts 90.
- Boot with `FEE_ENGINE` unset (`.cache/fee-off.log`): the worker logs `fee engine off`, then `backfilled 0 launches` and `stream subscribed`.
- **Devnet dry run.** Log at `/Users/uzi/Documents/Git Projects.nosync/BONDR/.cache/fee-dry.log`. Command: `FEE_ENGINE=dry FEE_WINDOW_MS=60000 WORKER_PORT=8090 VANITY_THREADS=0 perl -e 'alarm shift; exec @ARGV' 150 node --env-file=.env apps/worker/src/main.ts`.
  - The log has `fee recover: 0 pending, left as is in dry mode` and `fee engine dry: 6 coins armed`.
  - It has 15 `fee window` lines, every one ending in `done`, and no `fee window ... failed`.
  - fee_ledger row count was 0 before and 0 after. Pending rows were 0 before and 0 after.
  - Every window ended `done` with no simulation because each coin's `fees_unclaimed` is 0 in the dev DB (no trade since 05-03), and no W has a BONDR ATA. So no collect ran and the sweep found 0.
  - To exercise the simulate path, a one-off probe (removed after) ran `collectJob` in dry mode on F9DVpqKq...bndr with the real devnet deps. It printed `fee dry collect F9DVpqKq: ok 131590 CU`, at zero spend.
- Devnet spend: 0 SOL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Recovery could poll forever on a dead RPC**
- **Found during:** Task 1
- **Issue:** nextState answers "poll" for an RPC error inside the blockhash window. If `getBlockHeight` also fails, the height never moves, so the loop would never end.
- **Fix:** `recoverAction` maps any RPC error to `pending`. The loop also stops on a status or height failure and leaves the remaining rows for the next boot, with one `console.error`.
- **Commit:** 06b7676

**2. [Rule 1 - Bug] A gap fill could move engine memory back**
- **Found during:** Task 2
- **Issue:** Gap-filled trades can be older than live ones already applied (Pitfall 10).
- **Fix:** The engine keeps the newest applied trade slot per coin and ignores fee numbers from an older slot. Venue only advances.
- **Commit:** 3860c23

**3. [Rule 1 - Bug] A quiet coin would re-collect an empty bucket every window**
- **Found during:** Task 2
- **Issue:** Without a memory update on landing, `feesUnclaimed` stays stale after a collect. Each window would then spend an ops fee on a collect of 0.
- **Fix:** `FeeDeps.publish` also calls `Engine.landed`, which applies `totalsFor` in memory.
- **Commit:** 3860c23

**4. [Rule 2 - Missing] A cost failure must not fail the trade write**
- **Found during:** Task 2
- **Issue:** `withCost` runs before the write transaction. If a configs read or the SDK quote threw, the trade would be kept for retry and could be lost after 20 tries.
- **Fix:** `withCost` catches and logs, and the patch goes out without a cost.
- **Commit:** 3860c23

**5. [Rule 1 - Bug] A retried index boot would arm a second set of timers**
- **Found during:** Task 2
- **Issue:** `bootIndex` retries the whole try block, and that block now includes `startEngine`.
- **Fix:** `startEngine` returns early once an engine has reached ready.
- **Commit:** 3860c23

**6. [Rule 3 - Blocking] Task ordering**
- `startEngine` needs the env fields and `publishFee`, so env.ts and the `publishFee` half of announce.ts went into the Task 2 commit. Task 3 moved `arm`, `announce` and `tradeRow` into announce.ts.
- Small exports were added outside the plan's file list:
  - settle.ts: `POLL_MS`, `RECHECK_MS`, `RECHECKS`, `HEIGHT_EVERY`, `Obs`
  - fee-send.ts: `withSol`, now typed on `Pick<Job, "rows">`

**7. [Rule 3 - Blocking] Leaked seeded test coins in the dev DB broke coins.test.ts**
- **Found during:** Task 3 (full `pnpm test`)
- **Issue:** 13 seeded coins were left in the Neon dev branch from an earlier interrupted run, before this plan started. Their launch rows were created 05:22-05:23 UTC, they have non-bndr mints, and their W does not derive from the seed. `apps/web/lib/coins.test.ts` failed because one of them (Vxy7oEPT...) sorted into its Top list. They are also the 13 coins the dry run skipped with "W does not derive from this seed".
- **Fix:** Following the project note on leaked test rows, I deleted them the way the e2e `dropCoin` fixture does. That removed their fee_ledger, trades, coins, launches and vanity_mints rows, plus wallets left with no launch. All 6 real bndr coins were kept.
- **Commit:** none (database only)

## Known limits

- `windowJob` (05-04) reads `ledger.openCollects()` once per coin per window. With the default 24 h window this is a few reads a day, not a short timer (D-03 is about short timers). Move open collects into memory if Neon usage ever shows it.
- A launch that settles during boot, after the engine's coin read but before `start()`, joins memory through `onIngest` and is armed at `start()`. A launch settled by `resumeLaunches` before `startEngine` runs at all is picked up from the coin read, because its coin row already exists by then.
- New launches skip the W check: their W comes from this worker's own prepare with this seed.

## Deferred Issues

- In the dry-run log, the boot gap fill failed with "Invalid public key input" for the 13 leaked coins. Those coins are now deleted, and the error came from the bad rows, not from this plan.
- `backfill 07b0c060...: WrongSize` comes from an older launch row with a malformed signature. It was already handled and skipped as before.

## TDD Gate Compliance

Task 1 and Task 2 each have a `test(...)` commit followed by a `feat(...)` commit. Both RED runs failed on the missing module.

## Known Stubs

None. Forced bond and migration triggers belong to 05-07, next to the jobs they call, as the plan says.

## Requirements

FEE-01, FEE-04, FEE-08 and TOKEN-04 are left unchecked. The engine ships dark here and is proven only in a dry run. As in 05-02 and 05-04, they get checked once the real devnet run (05-12) and the staging check (05-13) show fees moving. TOKEN-03 was already complete.

## Threat Flags

None. T-05-05-01 to 06 are mitigated as planned:
- recover runs before ready, and hooks enqueue nothing until then
- the W derivation check skips the coin
- there is one boot read, and timers and hooks touch memory only
- FEE_ENGINE defaults to off and refuses unknown values, and the dry run's row count did not change
- publishFee filters to landed PUBLIC_KINDS and copies detail key by key
- buyback is derived per lane

## Self-Check: PASSED

- FOUND: fee-recover.ts, fee-recover.test.ts, fee-engine.ts, fee-engine.test.ts, announce.ts, .cache/fee-dry.log
- FOUND commits: c80d660, 06b7676, 2fb734b, 3860c23, 3824c5c
