---
phase: 05-fee-engine-and-public-ledger
plan: 01
subsystem: fee-engine-contracts
tags: [contracts, schema, ledger, tdd, e2e-red]
requires: []
provides:
  - fee_ledger table with the D-08 partial unique indexes (migration 0005, applied to the dev branch)
  - coins fee total columns with coins_finalize and coins_fee_totals checks
  - api.ts LedgerKind, PublicKind, LedgerState, LedgerRow, CoinFees, CoinLive.fees, LiveEvent fee
  - fees.ts PUBLIC_KINDS, windowOf, windowEnd, budgetOf, sweepSplit, minOutAfter, deployerOk, distributeMin, totalsFor, reconcileDiff
  - coinRow().fees filled from the coin columns and landed ledger subselects
  - seedLedger e2e fixture and the red fee-ledger.e2e.ts spec
affects: [05-02, 05-03, 05-04, 05-05, 05-06, 05-07, 05-08, 05-09, 05-10, 05-11, 05-12, 05-13]
tech-stack:
  added: []
  patterns:
    - partial unique index per kind group over live states (pending, landed), never a nullable unique column
    - nested drizzle selection (COLUMNS.fee) so raw fee columns never leak into CoinRow
key-files:
  created:
    - apps/web/e2e/fee-ledger.e2e.ts
    - packages/core/migrations/0005_fee_ledger.sql
    - packages/core/migrations/meta/0005_snapshot.json
    - packages/core/src/fees.ts
    - packages/core/src/fees.test.ts
  modified:
    - apps/web/e2e/fixtures.ts
    - packages/core/src/schema.ts
    - packages/core/migrations/meta/_journal.json
    - packages/core/src/db.test.ts
    - packages/core/src/api.ts
    - packages/core/src/coin-row.ts
    - packages/core/src/README.md
decisions:
  - "D-23 discretion: no window-start column on coins; the window is derived from launched_at and FEE_WINDOW_MS (RESEARCH Pattern 3)"
  - "budgetOf uses split90_10(feesUnclaimed).burn (what W keeps after the split) rather than applyBps(x, 9000); equal on round amounts, never below the real budget"
  - "totalsFor distribute splits the row's SOL in proportion to deployerAmount/treasuryAmount (treasury takes rounding) so deployer_earned_sol and to_treasury_sol fill"
  - "totalsFor collect returns set.feesUnclaimed = 0n; the set shape is { feesUnclaimed?, finalize?, deployerBps? }"
  - "creator_fee_bps coin column (RESEARCH Coin columns) not added: the plan's column list omits it; add with the cost-to-complete plan if needed"
metrics:
  duration: 15 min
  completed: 2026-10-25
  tasks: 3
  files: 12
---

# Phase 5 Plan 01: Fee ledger contracts Summary

The `fee_ledger` table now has Postgres partial unique indexes that refuse a double bond burn, sweep, split or finalize. The coins table gained fee total columns. api.ts carries the public ledger and fee types, and `fees.ts` holds the pure bigint fee rules, unit-checked. `coinRow` returns `fees`. A red e2e spec pins what the Fee ledger panel must show.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Failing ledger spec on seeded rows | 755b5f9 | apps/web/e2e/fee-ledger.e2e.ts, apps/web/e2e/fixtures.ts |
| 2 | fee_ledger table, coin fee columns, D-08 constraints | a7259cc, 7830f80 (format) | schema.ts, 0005_fee_ledger.sql, meta/, db.test.ts |
| 3 | Contract types, pure fee rules, coin row fee fields | 5549b7d (RED), c86c750 (GREEN) | api.ts, fees.ts, fees.test.ts, coin-row.ts, db.test.ts, README.md |

## Verification

- `pnpm db:migrate`: "migrations applied" (0005 on the dev branch). A second `drizzle-kit generate` reports "No schema changes".
- `pnpm vitest run packages/core/src/fees.test.ts packages/core/src/math.test.ts packages/core/src/db.test.ts`: 33 passed. db.test.ts asserts 23505 for each D-08 double intent and 23514 for each shape check.
- Full `pnpm test`: 45 files, 315 passed, 2 skipped. `pnpm typecheck` and `pnpm lint` pass.
- Red spec recorded: `pnpm exec playwright test apps/web/e2e/fee-ledger.e2e.ts` gives 4 failed, every one on the missing panel: `getByRole('region', { name: 'Fee ledger' })` "element(s) not found", or the entries list "Expected: 5 / 20, Received: 0". Seeding and cleanup ran, and fee_ledger was left empty.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fee ledger DB tests nested inside the existing describe**
- **Found during:** Task 2
- **Issue:** As a sibling describe, its beforeAll ran after the outer afterAll had already deleted the test wallet and closed the pool, so the launch FK failed.
- **Fix:** Nested `describe("fee ledger")` inside "database constraints". It uses its own vanity mint and coin and clears the mint's rows per test.
- **Commit:** a7259cc

**2. [Rule 2 - Missing] distribute SOL totals**
- **Found during:** Task 3
- **Issue:** The plan's totalsFor for distribute named only deployer_earned and to_treasury, so deployer_earned_sol (shown as "Deployer earned {sol} SOL") would never fill.
- **Fix:** The row's sol is split in proportion to the two shares, with the treasury taking the rounding. Unit-checked.
- **Commit:** c86c750

**3. [Rule 3 - Blocking] Test-row leak from the RED run**
- **Issue:** The RED db.test run (before migration) failed its afterAll on the missing fee_ledger table. It left this run's own test wallet, 3 vanity mints and 7 launches behind.
- **Fix:** Deleted exactly those rows by name after the migration. No other rows were touched.

**4. Spec order pinned to realistic landing times**
- The plan lists tags as "Collect, Split 90/10, Sweep, Sweep, Launch burn". The seeded landed_at values (collect, then split a minute later, then the sweep pair) make the newest-first order Sweep, Sweep, Split 90/10, Collect, Launch burn, and the spec asserts that order.

**5. seedLedger returns `{ id, signature }[]`** rather than bare ids. The spec needs the signatures for the Solscan link check.

## Deferred Issues

- `apps/web/lib/coins.test.ts` "heroCounts counts coins" raced once in a full run (expected 16, got 15). db.test.ts was inserting coins on the shared dev DB at the same time. This race existed before this plan (db.test already seeded a coin), and the test passes alone and on rerun. Out of scope. A fix would be a per-run coin filter in that test.

## Requirements

FEE-01, FEE-04, FEE-05 and TOKEN-04 are left unchecked in REQUIREMENTS.md on purpose. This plan ships only their contracts. The jobs and the panel come in 05-02 onward.

## Known Stubs

- `CoinFees.budgetSol` and `costSol` are null until `coins.bondr_sol` is written. `cost_to_complete` stays null until a trade writes it. Both writers come in later Phase 5 plans (trade ingest and engine). This is intentional.

## Threat Flags

None. T-05-01-01 to 04 are mitigated as planned: the partial unique indexes have db.test cases, coins_fee_totals guards the totals, totalsFor is unit-tested, PublicKind excludes the internal kinds, the e2e asserts pending and held rows never render, and deployerOk is unit-tested.

## Self-Check: PASSED

- Files: fee-ledger.e2e.ts, 0005_fee_ledger.sql, 0005_snapshot.json, fees.ts, fees.test.ts exist.
- Commits: 755b5f9, a7259cc, 5549b7d, 7830f80, c86c750 are in git log.
