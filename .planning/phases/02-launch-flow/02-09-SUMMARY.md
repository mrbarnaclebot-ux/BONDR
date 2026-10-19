---
phase: 02-launch-flow
plan: 09
subsystem: worker
tags: [vanity, worker-threads, key-derivation, pool]
requires: [02-04, 02-06]
provides:
  - "@bondr/core/keys: Role now includes \"mint\" (existing ids unchanged)"
  - "apps/worker/src/vanity.ts: mintKey, mintPub, tail4, isBndr, BNDR, ALPHABET, mintKeyFor, reserve, release, markUsed, poolSize, types Lane and Exec"
  - "apps/worker/src/grind.ts: grind(env, count, threads), startRefill(env), CLI --count/--threads and --check"
  - "env.ts loadEnv: vanityThreads (VANITY_THREADS, default 1); lane typed \"local\" | \"staging\""
  - "Local lane pool (Neon dev branch): 6 ready bndr mints, idx 49081954 to 102297076"
affects: [02-11, 02-12, 02-13, 02-14, 02-16]
tech-stack:
  added: []
  patterns:
    - "Mint key = derive(seed, \"mint\", net, lane + \".\" + idx); the database holds (idx, pubkey) only"
    - "Reservation SQL takes an Exec (db or transaction), so tests run inside a rolled-back transaction"
    - "Claim the row with a scalar \"idx = (select ... limit 1 for update skip locked)\", never IN (subquery)"
    - "Refill on demand (boot, after each reservation), never on a timer (Pitfall 6)"
key-files:
  created:
    - apps/worker/src/vanity.ts
    - apps/worker/src/vanity.test.ts
    - apps/worker/src/grind.ts
    - apps/worker/README.md (moved from apps/worker/src/README.md)
  modified:
    - packages/core/src/keys.ts
    - packages/core/src/keys.test.ts
    - apps/worker/src/env.ts
    - apps/worker/src/main.ts
    - apps/worker/package.json
    - .env.example
decisions:
  - "reserve never hands out a mint whose launch is signed, sent, unknown or landed, even after its 10-minute window expired"
  - "release throws for any state other than prepared or failed, so a misuse is loud"
  - "4 grinder threads on the M4 (its performance cores): worker_threads stop scaling past that because of OpenSSL lock contention"
  - "--check also re-derives every stored row from the seed and lane, not only the bndr suffix"
  - "One README at apps/worker/README.md instead of a second one in src"
metrics:
  duration: ~75 min (about 30 of them the pre-fill grind)
  completed: 2026-10-19
  tasks: 2
  files: 11
---

# Phase 2 Plan 09: bndr vanity pool Summary

The worker can now hand out bndr mints. Each mint key is derived from the master seed, a lane and an index, so the database holds only `(idx, pubkey)`. A reservation claims one mint atomically, gives the same wallet the same mint inside 10 minutes, and never returns a used mint or one whose launch may still land. A worker_threads grinder refills the pool on demand, and the owner can pre-fill any lane from the Mac with one command. The local pool holds 6 ready mints.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Mint role, vanity derivation, suffix fast path and reservation SQL | aaa7d06 |
| 2 | worker_threads grinder with background refill, CLI pre-fill, local pool filled | 83c07bc |

## Verification

- `pnpm vitest run`: 56 passed in 11 files, run 4 times in a row with the DB cases executing against the Neon dev branch. `pnpm lint` and `pnpm typecheck` exit 0.
- `node --env-file=.env apps/worker/src/grind.ts --check 6` gives `vanity local: 6 ready, 6 stored, 0 bad` and exits 0. On the empty pool before the pre-fill it exited 1.
- Acceptance greps:
  - `"mint"` is in the Role union.
  - `skipLocked` is in vanity.ts.
  - `secretKey|privateKey` finds nothing in vanity.ts.
  - `worker_threads` is in grind.ts.
  - `setInterval` finds nothing in apps/worker/src.
  - apps/worker/README.md exists.
- Mutation checks:
  - Without the in-flight guard, the reservation test fails.
  - With `IN (subquery)` in place of the scalar `=`, it fails as well.
- Worker boot smoke on WORKER_PORT 18080 with VANITY_THREADS=1: it logged `worker listening on devnet` and started the refill. The pool held 6, which is below 10, and one thread ran at about 100% CPU. On SIGTERM it exited 0.

## Pre-fill (local lane)

`VANITY_LANE=local node --env-file=.env apps/worker/src/grind.ts --count 6 --threads 4`

- 6 new mints in 1738 s (29 min) on 4 threads, at 14,713 keys/s per thread.
- The first hit came only at idx 49,081,954, about 4 times the expected gap. That is luck: the next 5 came at the expected rate.
- Stored, all ending in bndr:
  - 49081954 `4xEfLsmWx8o89XA9iWtf2T5KESn3hLjT4sLK7kBJbndr`
  - 62249989 `APrDvPFcz7qBssiG1Mdv6e9LSJz8KUCpy4TayCG2bndr`
  - 77036032 `9i3M3j6Zz3UVoTHEFugLdPAfmAvdnkYsUKjTq4ygbndr`
  - 98479463 `GybxLBA6ondpQxCzr2XdWB75gxfEPgaRYnntLxcqbndr`
  - 99378435 `F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr`
  - 102297076 `GoJKjYdyaGwNs82NrMM2xRJm19U5ZRLkx16Rbcjpbndr`

**Throughput.** A single thread does 34,171 keys/s, which matches the research figure of 33.9k. The aggregate stops scaling with threads:

| Threads | Total keys/s |
|---------|--------------|
| 1 | 31k |
| 4 | 73k |
| 10 | 50k |

Four separate processes reach about 90k. OpenSSL serializes part of key decoding across threads of one process. The 14.7k per thread during the pre-fill was also lowered by test runs I made at the same time. On Railway one refill thread has no contention, so assumption A2 (6-12 min per key per vCPU) still stands.

**A5 holds.** Node 24 runs the `.ts` file as a worker_threads entry (`new Worker(new URL(import.meta.url))`), so no eval worker was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The reservation UPDATE claimed every free mint**
- **Found during:** Task 1, the full-suite run
- **Issue:** `UPDATE ... WHERE idx IN (SELECT ... LIMIT 1 FOR UPDATE SKIP LOCKED)` let Postgres re-run the subquery per row. Under some plans, one `reserve(w1)` reserved all three test rows for w1. The single-file run passed and the parallel run failed. My first fix (repeatable read) was aimed at the wrong cause.
- **Fix:** Code Example 8's scalar form, `idx = (subquery)`. Postgres evaluates it once, as an InitPlan.
- **Commit:** aaa7d06

**2. [Rule 1 - Process] A failing test was committed, then amended**
- **Issue:** My first Task 1 commit (75d3b1f) ran after `pnpm vitest run | tail`, and the pipe hid the failing exit code. Fix 1 above was then amended into that commit, which was never pushed.
- **Fix:** No commit on the branch has a failing test now. Every later gate checked real exit codes.
- **Commit:** aaa7d06 (replaces 75d3b1f)

**3. [Rule 2 - Correctness] In-flight guard on reserve (T-02-09-02)**
- **Issue:** Code Example 8 reuses any expired reservation. If a launch was signed, sent or unknown past its 10-minute window, its mint would go to the next wallet and could still land. That is the research anti-pattern.
- **Fix:** The ready set excludes mints with a launch in signed, sent, unknown or landed (`NOT EXISTS` on launches). `poolSize` uses the same set. The reservation test covers it.
- **Commit:** aaa7d06

**4. [Rule 3 - Test isolation] Table lock in the reservation test**
- **Issue:** db.test.ts inserts and deletes a pool row in parallel. That can shift the `poolSize` delta. Repeatable read made it worse: `FOR UPDATE` on that concurrently deleted row raised a serialization error.
- **Fix:** The test transaction takes `lock table vanity_mints in exclusive mode` at read committed, the same level production uses. Reads still go through, and db.test.ts writes wait about 7 s until the rollback.
- **Commit:** aaa7d06

**5. [Rule 2] Stronger `--check`**
- `--check` also re-derives each row with `mintKeyFor`. A row from the other lane or another seed counts as bad.
- **Commit:** 83c07bc

**6. Files outside files_modified**
- env.ts: `VANITY_THREADS` is validated at boot. The integer parser is shared with `PRIORITY_FEE_MICROLAMPORTS`. `lane` is typed as the literal union, because the guard did not narrow it.
- apps/worker/src/README.md moved to apps/worker/README.md, so there is one README rather than two. src now has 10 files, and AGENTS.md wants a README for any directory with more than five.
- **Commit:** 83c07bc

### Simplifications

- **No yield in the thread loop.** `worker.terminate()` interrupts a busy loop, and the thread never handles messages. Add a yield if a thread ever needs to receive one.
- **No `next_idx` row.** A restart starts at max(idx) + 1, as the plan's ponytail note says.

## TDD Gate Compliance

There are no separate RED commits, per the orchestrator: never commit a failing test.
- The new keys test and vanity.test.ts were written against the planned API, and the hit index was ground for a fixed test seed. The implementation followed in the same commit.
- The two mutation checks above prove the DB test fails without the in-flight guard, and fails with the IN form.

## Known Stubs

None. `startRefill` runs on boot. 02-11 calls it again after each reservation, and on `pool_empty`.

## Notes for later plans

- **02-11.** `reserve(exec, wallet)` returns `{ idx, pubkey }` or null. On null, return `pool_empty` and call `void startRefill(env)`. Also call it after each successful reserve.
- **02-12.** `mintKeyFor(row, seed, net, lane)` before signing. `release(exec, idx, state)` throws unless the state is prepared or failed. `markUsed(exec, pubkey)` on landed.
- **02-14.** Route the `vanity pool low: N ready` warning and `vanity refill failed:` to Sentry.
- **02-16.** Set VANITY_LANE=staging on Railway, and VANITY_THREADS (1, or 0 to rely on the Mac). Pre-fill staging from the Mac with DATABASE_URL set to the staging URL in the shell (see apps/worker/README.md). The staging pool is empty now.
- **Worker boot.** If the pool holds fewer than 10 mints, one thread grinds at 100% CPU until it reaches 20. For local dev, set `VANITY_THREADS=0` in .env if that gets in the way.

## Requirements

None ticked. LAUNCH-03 is also covered by 02-11, 02-12, 02-13, 02-17 and 02-18. FEE-10 is also covered by 02-11, 02-14, 02-16 and 02-18.

## Threat Flags

None beyond the plan's threat model:
- **T-02-09-01:** only `(idx, pubkey)` is written. The seed went to threads in memory and was never printed.
- **T-02-09-02:** single UPDATE with a scalar SKIP LOCKED subquery, per-wallet reuse and the in-flight guard.
- **T-02-09-03:** `mintKeyFor` is tested against the wrong lane and the wrong seed.
- **T-02-09-04:** refill below 10 and a warning below 3.

## Self-Check: PASSED

- Files present: apps/worker/src/vanity.ts, apps/worker/src/vanity.test.ts, apps/worker/src/grind.ts, apps/worker/README.md.
- Commits aaa7d06 and 83c07bc are on phase-02-launch-flow.
