---
phase: 02-launch-flow
plan: 11
subsystem: worker
tags: [prepare, lookup-table, simulate, worker]
requires:
  - phase: 02-03
    provides: venue-aware buildLaunch, AwaitingMigration, minSolOut
  - phase: 02-09
    provides: reserve, the bndr pool (6 local mints)
  - phase: 02-10
    provides: sameOrigin, json, rateLimited, workerPost
provides:
  - "apps/worker/src/prepare.ts: prepare (single-flight), prepareGuard, parseRequest, signBy, sellFloor, TABLE_CAP 30, PrepareCtx"
  - "apps/worker/src/build.ts: unionTableKeys, ensureTable, compileLaunch, buildMessage, simulateLaunch, simError, previewCosts"
  - "apps/worker/src/launches.ts: newId, insertPrepared, insertFailed, advance (guarded), getLaunch, tableFor(wallet, mint?), newTablesLastHour, consented, Exec"
  - "http.ts fail(ApiError): the contract error to HTTP status map (409, 403, 400, 503, 429, 402, 500)"
  - "Worker POST /prepare; web POST /api/launch/prepare (10 per 10 min per IP and per wallet, 30 s worker timeout)"
  - "scripts/devnet-launch.ts: OPS_FLOOR_SOL 2.40, RUN_BUDGET_SOL, fundSimDev; --size-only, --fund, --prepare-only"
  - "LaunchOpts.priorityFee (core): the launch's ComputeBudget price"
affects: [02-12, 02-13, 02-14, 02-16, 02-17, 02-18]
tech-stack:
  added: []
  patterns:
    - "Prepare order: status, consent, guard, reserve, W, balance, union keys, table, blockhash, build, simulate, store"
    - "solBack = burn spend minus sell spend of the same launch, both simulated on the dev's post lamports"
    - "A prepare that fails after creating a table stores a failed row, so the retry reuses the table and the hourly cap counts it"
    - "Worker contract errors are thrown as fail({ error }), and http.ts owns the status map"
key-files:
  created:
    - apps/worker/src/prepare.ts
    - apps/worker/src/prepare.test.ts
    - apps/worker/src/build.ts
    - apps/worker/src/launches.ts
    - apps/web/app/api/launch/prepare/route.ts
    - scripts/devnet-launch.ts
  modified:
    - apps/worker/src/http.ts
    - apps/worker/src/main.ts
    - apps/worker/src/status.ts
    - apps/worker/README.md
    - apps/web/lib/worker.ts
    - packages/core/src/launch.ts
key-decisions:
  - "solBack for the insta-sell floor comes from two simulations (burn and sell of the same launch). Their difference is the SOL that comes back, and the floor is that less 300 bps. The floored sell is simulated again before it is stored"
  - "tableFor without a mint follows the wallet's live reservation (used by the guard before reserving). With a mint it finds that mint's table even after the hold expired, so the same mint never pays for a second table"
  - "prepareGuard checks in this order: paused, then live config unavailable (build_failed), then invalid_input, then consent_required, then the table cap. A malformed wallet therefore gets invalid_input, not consent_required"
  - "Web passes 402, 403 and 503 through from the worker; the prepare call has its own 30 s timeout (measured 10-11 s with a reused table, about 18 s with a new one)"
requirements-completed: []
duration: ~20 min
completed: 2026-10-19
---

# Phase 2 Plan 11: Worker prepare Summary

**The worker now builds the one-tx launch where the seed lives. It reserves a bndr mint, derives W, reuses or creates an ops-paid lookup table that holds both exits' keys, builds with the venue-aware builder, simulates, puts a real SOL floor on the insta sell, and stores the exact message bytes. The result goes back as an unsigned v0 wire (dev at signature 0, mint at 1) through a guarded web route.**

## Performance

- **Duration:** about 20 min
- **Completed:** 2026-10-19T16:58Z
- **Tasks:** 2
- **Files:** 12 (6 created, 6 modified)

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Launch rows, table and build helpers, prepare with guards | a2035b6 |
| 2 | Prepare routes on worker and web, devnet size and prepare proof | 2d90c84 |

## Devnet evidence (2026-10-19)

**--size-only** (32-byte name, 13-character symbol, 80-character ipfs.io URI, in-memory union table, nothing sent):

| Exit | Bytes | Table keys |
|------|-------|------------|
| insta burn | 789 | 32 |
| insta sell | 890 | 32 |

These match 02-03's curve maxFieldBytes rows (789, 890). The union of both exits is 32 keys, so table creation takes 2 txs (CHUNK 25).

**--prepare-only** (sim dev `9Hm1YEfX...TjwQM6`, minimum dev buy 2,500,000 lamports, placeholder CID; nothing pinned):

| Run | Exit | Bytes | signBy | createCost | solBack | tokensOut | ms |
|-----|------|-------|--------|------------|---------|-----------|----|
| 1 | burn | 769 | 56 | 8,834,120 | null | 31,120,363,129,478 | (incl. table) |
| 1 | sell | 870 | 54 | 8,834,120 | 2,342,790 | 31,120,363,129,478 | |
| 4 | burn | 769 | 58 | 8,834,120 | null | 31,120,363,129,478 | 10,198 |
| 4 | sell | 870 | 53 | 8,834,120 | 2,342,790 | 31,120,363,129,478 | 11,493 |

- Mint `4xEfLsmWx8o89XA9iWtf2T5KESn3hLjT4sLK7kBJbndr` (pool idx 49081954) and table `6NTJpEsU2uBgL4KVm1XXnJaQzw9P1aY39AeZG1LBHTmi` were the same for both prepares of every run. The script asserts this and exits 1 otherwise. Runs 2 to 4 reused that same table, and run 4 was after the 10-minute hold had likely expired, which the lookup by mint covers.
- The sell floor sent was `sellFloor(2,342,790)` = 2,272,506 lamports. The fee-only estimate from /quote was 2,377,323.
- The simulated createCost (8,834,120) is about 3.08M lower than /status createCostEstimate (11,917,680). The estimate is the one the balance guard uses, so the guard errs on the safe side. 02-12 can check both numbers against the landed launch.
- No pump step failed.

**Ops balance (floor 2.40 SOL):**

| Run | Ops before | Ops after | Funded | Run spend | Budget |
|-----|-----------|-----------|--------|-----------|--------|
| --size-only | 2.917429 | 2.917429 | 0 | 0 | 0 |
| --fund | 2.917429 | 2.917429 | 0 (sim dev held 0.052755, above 0.03) | 0 | 0.06 |
| --prepare-only (1, new table) | 2.917429 | 2.911282 | 0 | 0.006147 | 0.01 |
| --prepare-only (2 to 4, reused table) | 2.911282 | 2.911282 | 0 | 0 | 0.01 |
| verify chain (size, fund, prepare) | 2.911282 | 2.911282 | 0 | 0 | as above |

The sim dev stayed at 0.052755 SOL, because prepare only simulates. Ops ends at 2.911282 SOL, 0.511 above the floor. fundSimDev's transfer branch did not run this plan, because no top-up was needed.

**HTTP smoke** (worker on 8080 with VANITY_THREADS=0, `next dev` on 3000, random unconsented wallet, no spend):
- Worker: no token gave 401, an unconsented wallet gave 403 `consent_required`, and exit "lock" gave 400 `invalid_input`.
- Web: a cross-site origin gave 403, a bad wallet gave 400 `invalid_input`, and an unconsented wallet gave 403 `consent_required`, passed through from the worker.

## Verification

- `pnpm vitest run`: 74 passed, 1 skipped (the live Pinata case). `pnpm lint` and `pnpm typecheck` exit 0 after each commit.
- `prepare.test.ts` has 7 tests: prepareGuard, parseRequest, signBy, sellFloor, simError, previewCosts, and a rolled-back DB case. The DB case covers advance (the second `prepared -> signed` returns null), newTablesLastHour, tableFor by live hold, and tableFor by mint after expiry.
- Mutation check: with the `state = from` condition removed from advance, the DB case fails.
- The three driver modes exit 0 when run without pipes.
- Acceptance greps all match:
  - `sigVerify: false` and `replaceRecentBlockhash: false` in build.ts.
  - `eq(launches.state` in launches.ts.
  - `minSolOut` in prepare.ts.
  - `workerPost("/prepare"` and `rateLimited` in the web route.
  - `OPS_FLOOR_SOL`, `RUN_BUDGET_SOL` and `export async function fundSimDev` in the script.
- Call order in prepareOne: `reserveMint` (reserve), then the balance check, then `ensureTable`. Confirmed by reading the file.
- File sizes: prepare.ts 259 lines, build.ts 145, launches.ts 87, devnet-launch.ts 163. Biome enforces functions under 40 lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] LaunchOpts.priorityFee in core**
- buildLaunch hard-coded `budget(cuLimit)` at 1000 micro-lamports, so the plan's `budget(600_000, priorityFee)` had nowhere to go. One optional field fixes that, and the spike keeps the default.
- Files: packages/core/src/launch.ts. Commit: a2035b6

**2. [Rule 3 - Blocking] Web passes 402, 403 and 503 through**
- `workerPost` passed only 400, 404, 409, 413, 429 and 500. `consent_required`, `insufficient_balance` and `pool_empty` would have reached the browser as `worker_unavailable`. The smoke shows the 403 passing through now.
- Files: apps/web/lib/worker.ts. Commit: 2d90c84

**3. [Rule 1 - Bug] The 15 s web timeout was shorter than a real prepare**
- worker.ts assumed about 6 s. Measured from the Mac: 9.6 to 11.5 s when the table is reused, and about 18 s for a first prepare that creates the table.
- `workerPost` now takes a per-call timeout, and the prepare route passes 30 s. Status and quote keep 15 s.
- I also ran the two union builds and the admit reads in parallel. That did not measurably change the total: the cold `liveStatus` read and Neon round trips from the Mac dominate.
- Commit: 2d90c84

**4. [Rule 2 - Correctness, T-02-11-01] Failed prepares keep their paid table**
- Without this, a prepare that failed after creating a table (simulation error, low balance found by the simulation) left no row. Every retry would then pay ops for another table.
- Such a prepare now stores a `failed` row with the table and `newTable` true. tableFor finds it, and the hourly cap counts it.
- Commit: a2035b6

**5. [Rule 2 - Correctness] Signer layout check in compileLaunch**
- compileLaunch refuses unless the message has exactly 2 required signatures and the mint is static key 1. Submit (02-12) relies on that slot order.
- Commit: a2035b6

**6. [Rule 1 - Ops spend] tableFor also takes the mint**
- The first version followed only the live hold. If the hold expired and reserve handed the same mint back to the same wallet, its still-valid table would have been replaced.
- `tableFor(exec, wallet, mint)` (the plan's signature) now finds that mint's table. The guard still uses the hold-only form, because it runs before reserve.
- Commit: 2d90c84

**7. [Design] Exports and helpers the plan did not name**
- `parseRequest` is separate from `prepareGuard`, so prepare stores the normalized fields: an uppercased symbol and https links.
- `simError` and `previewCosts` are pure and tested.
- `insertFailed` and `consented` are in launches.ts.
- `MAX_SOL_IN` is exported from status.ts.
- `fail()` is in http.ts.

### Notes

- **Sell flow.** The sell is simulated three times: the burn probe and the sell probe in parallel, then the floored sell. The probes use the union builds, which are priced again after a new table, because creating one takes about 5 s.
- **createCost and solBack on the pool venue.** On the pool venue, burn may spend less than solIn (exact-out), so createCost is then slightly understated. solBack is unaffected.
- **Database state left on the dev branch.**
  - A `wallets` consent row for the sim dev.
  - 9 `prepared` launches and 0 `failed` launches for mint 4xEf...bndr.
  - That mint's sim dev hold, which expires on its own.
  - `prepared` rows never block the pool's in-flight guard. 02-12 reuses this mint and table.

## Deferred Issues

- `status.ts createCost` makes 7 `getMinimumBalanceForRentExemption` calls in parallel on every cold `/status`. Rent is linear in size, so one call over the summed sizes plus `128 * (n - 1)` gives the same total. That would cut the cold read and the Helius 429 risk. The file is outside this plan.

## TDD Gate Compliance

There are no separate RED commits, per the orchestrator rule never to commit a failing test. The tests were written with the code in a2035b6, and the mutation check above shows the DB case catches a broken guard.

## Requirements

None ticked. LAUNCH-03 is also covered by 02-12, 02-13, 02-17 and 02-18. FEE-10 is also covered by 02-14, 02-16 and 02-18.

## Notes for later plans

- **02-12, the stored row.** `getLaunch(id)` returns `message` (the exact serialized v0 message), `blockhash`, `lastValidBlockHeight`, `exit`, `mint` and `w`.
  - Mint key: `mintKeyFor({ idx, pubkey }, seed, net, lane)`. The idx comes from vanity_mints by pubkey.
  - State changes: `advance(db(), id, "prepared", "signed", { signedTx })`. It returns null on a double submit.
- **02-12, the driver.** Add the default launch mode and `--tamper` to scripts/devnet-launch.ts. Both call fundSimDev first, then check RUN_BUDGET_SOL.launch (0.03) and RUN_BUDGET_SOL.tamper (0.01).
- **02-13.** Show "{bytes} of 1,232 bytes": burn is 769 B and sell 870 B with short fields, at most 789 and 890 B with the longest. Expect row 2 to take 10-20 s on devnet.
- **02-14.** Send the `ops low:` warning (ensureTable, below 0.05 SOL) and `prepare build failed:` to Sentry.

## Threat Flags

None beyond the plan's threat model:
- **T-02-11-01:** these all run before any table spend:
  - the pause, consent and rules checks
  - the hourly cap of 30
  - the balance check
  - per-wallet reuse, plus failed rows that keep the table
  - the web limit of 10 per 10 min per IP and per wallet
  - the low-ops warning
- **T-02-11-02:** checkMessage allowlist and the signer layout check.
- **T-02-11-03:** W and the mint are derived only in the worker. The response carries the public wire only.
- **T-02-11-04:** creatorFeeBps is set only from the live `Global.creatorFeeConfigurable`.
- **T-02-11-05:** the sell floor is the simulated solBack less 300 bps.

## Self-Check: PASSED

- Files present: apps/worker/src/prepare.ts, apps/worker/src/prepare.test.ts, apps/worker/src/build.ts, apps/worker/src/launches.ts, apps/web/app/api/launch/prepare/route.ts, scripts/devnet-launch.ts.
- Commits a2035b6 and 2d90c84 are on phase-02-launch-flow.
