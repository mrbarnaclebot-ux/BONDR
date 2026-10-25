---
phase: 05-fee-engine-and-public-ledger
fixed_at: 2026-10-25T09:15:50Z
review_path: .planning/phases/05-fee-engine-and-public-ledger/05-REVIEW-web.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report (web)

**Fixed at:** 2026-10-25T09:15:50Z
**Source review:** .planning/phases/05-fee-engine-and-public-ledger/05-REVIEW-web.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (CR-01, WR-01 to WR-04). The 8 Info findings were out of scope and not touched.
- Fixed: 5
- Skipped: 0

Only apps/web and this note changed.

## Fixed Issues

### CR-01: The ledger's first page is cached apart from the hub head

**Files modified:** `apps/web/app/coin/[mint]/page.tsx`, `apps/web/lib/ledger.ts`, `apps/web/app/api/coin/[mint]/ledger/route.ts`, `apps/web/lib/README.md`
**Commit:** 9cc53c2
**Applied fix:**
- The token page now reads the ledger's first page in the same `firstPage` cache entry as the trades and the hub head. The head is taken before both reads.
- The ledger route caches its first page under `ledger:<mint>:<hub.head()>`. A burst of resyncs at one head still shares one Neon read. A page read before a newer event is never served after it.
- No polling and no extra reads per request. The page does the same two reads as before, now in one entry.
- One side effect: a failed ledger read (`null`) is now held for the page's 10 s TTL, the same as the trades page. Before, it was retried on the next view.

**Status:** fixed: requires human verification. This is a consistency (logic) fix. The e2e specs pass, but no spec reproduces the restart race itself.

### WR-01: A `fee` event's coin snapshot overwrites newer trade and bond state

**Files modified:** `apps/web/components/coin-live.tsx`, `apps/web/components/home-live.tsx`, `apps/web/lib/live-list.ts`, `apps/web/lib/live-list.test.ts`, `apps/web/lib/README.md`
**Commit:** 7bf6bea
**Applied fix:**
- The token page's `onFee` now sets only `fees`.
- Home uses a new pure `applyFees` in live-list.ts, which patches only `fees` and returns the same array when there are none.
- A unit check applies an older curve snapshot after a bond. The venue and progress hold, and only the fees change.

### WR-02: An unknown ledger kind crashes the whole token page

**Files modified:** `apps/web/lib/ledger-copy.ts`, `apps/web/lib/ledger-copy.test.ts`, `apps/web/components/token-ledger.tsx`, `apps/web/lib/README.md`
**Commit:** 048eed8
**Applied fix:**
- New `known(row)` uses `Object.hasOwn(COPY, kind)`, so inherited names like `toString` do not count.
- Live `fee` event rows are filtered through `known` before they reach the list or the announcement.
- The server paths (first page, resync, Load more) are not filtered. They read through web's own `PUBLIC_KINDS`, and `COPY` is typed `Record<PublicKind, Entry>`, so every kind they can return has copy in the same build.
- A unit check covers this.

### WR-03: The keyset tie test never puts a tie on the page boundary

**Files modified:** `apps/web/lib/ledger.test.ts`
**Commit:** 82ec7bc
**Applied fix:**
- Rows 19 and 20 now share a millisecond, so the page boundary falls inside the tie.
- They also get different microseconds: the lower id gets +456 µs and the higher id gets +123 µs.
- The test asserts that page one ends with the higher id and page two starts with the lower id.

Mutation checked:
- Without `date_trunc`, it fails (wrong id at the boundary).
- Without the id tiebreak in the cursor, it fails (4 rows instead of 5).

### WR-04: The fee-live resync spec checks "no duplicate rows" on a coin with no fee rows

**Files modified:** `apps/web/e2e/fee-live.e2e.ts`
**Commit:** d660224
**Applied fix:**
- `beforeAll` seeds two landed rows: a collect and a sweep_treasury. A split_treasury needs a ref, so a sweep is used instead.
- The resync spec holds the stream until the server render shows 3 entries. Then it releases the resync and checks that the refetch returns the same 2 rows.
- It asserts 3 entries in the order Sweep, Collect, Launch burn, and exactly one refetch.
- The live-event spec's counts changed from 1 and 3 to 3 and 5.
- Mutation checked: with `addLedger`'s dedupe removed, the spec fails (5 entries instead of 3).

## Verification

- `pnpm vitest run apps/web`: 14 files, 106 passed, 1 skipped.
- `pnpm typecheck` and `pnpm lint` pass.
- `pnpm exec playwright test apps/web/e2e/fee-ledger.e2e.ts apps/web/e2e/fee-live.e2e.ts apps/web/e2e/coin.e2e.ts --workers=3`: 28 passed.
- The e2e run used this worktree's own `next dev` on port 3100 (`E2E_BASE_URL`), with `WORKER_URL` pointed at an unused port. It did not reuse a server from the main tree, where another fixer was working at the same time. No worker was started.
- Committed screenshots were not changed.

Leaked-row check after the runs:
- 0 `e2e` launches, 0 `test-` wallets, and 0 orphan fee_ledger rows.
- Three `e2e` wallets with no launches remain. Their consents are from 2026-10-23 to 2026-10-25 05:52Z, before this run, so they were left in place.

---

_Fixed: 2026-10-25T09:15:50Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
