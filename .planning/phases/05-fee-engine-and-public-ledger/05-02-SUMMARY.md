---
phase: 05-fee-engine-and-public-ledger
plan: 02
subsystem: web-ledger
tags: [ledger, web, read, ui]
requires:
  - 05-01 fee_ledger table, PUBLIC_KINDS, LedgerRow, CoinRow.fees.w, seedLedger and the red fee-ledger.e2e.ts
provides:
  - lib/ledger.ts ledgerPage, parseLedgerCursor, firstLedgerPage (server-only, kept 10 s)
  - lib/ledger-copy.ts COPY, ledgerCopy, launchCopy
  - GET /api/coin/[mint]/ledger
  - components/token-ledger.tsx FeeLedger, placed after Bond and burn
  - format.ts feeSol, utcStamp; Tag tone plain
affects: [05-10, 05-11, 05-13]
tech-stack:
  added: []
  patterns:
    - kind allowlist (inArray PUBLIC_KINDS) plus state = 'landed' on every public ledger read
    - jsonb detail copied key by key, never passed through
    - keyset on (date_trunc ms of landed_at, id) so the ms cursor matches microsecond timestamps
key-files:
  created:
    - apps/web/lib/ledger.ts
    - apps/web/lib/ledger.test.ts
    - apps/web/lib/ledger-copy.ts
    - apps/web/lib/ledger-copy.test.ts
    - apps/web/app/api/coin/[mint]/ledger/route.ts
    - apps/web/components/token-ledger.tsx
  modified:
    - apps/web/lib/format.ts
    - apps/web/lib/format.test.ts
    - apps/web/lib/trades.ts
    - apps/web/lib/README.md
    - apps/web/components/tag.tsx
    - apps/web/components/token-trades.tsx
    - apps/web/components/README.md
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/e2e/coin.e2e.ts
    - biome.json
decisions:
  - "Ledger keyset orders and compares on date_trunc('milliseconds', landed_at): the cursor carries ms, Postgres keeps microseconds, so plain landed_at would repeat or skip rows"
  - "The ledger page's next cursor comes from the server (`next`), the client never builds one"
  - "token-trades exports LoadMore (with a copy prop) and useClock (tick arg) for the ledger instead of copying them; trades.ts exports kept for firstLedgerPage"
  - "biome D-15 allowlist gains @bondr/core/fees (pure module, as its header says)"
  - "Amount cell shows the short signature visibly with sr-only 'Transaction ' prefix, so the link reads 'Transaction {sigShort} (opens Solscan)'"
metrics:
  duration: 14 min
  completed: 2026-10-25
  tasks: 3
  files: 16
---

# Phase 5 Plan 02: Fee ledger read and panel Summary

The token page now has a Fee ledger panel. It lists landed public fee rows newest first, each with its tag, description, SOL value, relative time and Solscan link. It pages 20 at a time through `/api/coin/[mint]/ledger`, and the synthesized launch row comes last. Pending, failed, held, reconcile_diff and buyback_burn rows never leave the server.

## Tasks

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Ledger copy and fee formatters | 77587c6 (RED), 695d47b (GREEN) | ledger-copy.ts, ledger-copy.test.ts, format.ts, format.test.ts, biome.json |
| 2 | Server-only ledger read and route | 48360ce | ledger.ts, ledger.test.ts, ledger/route.ts, trades.ts, lib/README.md |
| 3 | Fee ledger panel on the token page | 2910592 | token-ledger.tsx, tag.tsx, token-trades.tsx, page.tsx, components/README.md, coin.e2e.ts |

## Verification

- `pnpm vitest run apps/web/lib/ledger-copy.test.ts apps/web/lib/format.test.ts`: 18 passed. `ledger.test.ts`: 3 passed against the Neon dev branch. It covers the cursor rules, a seeded coin whose pending, held and failed rows (plus another coin's row and a platform buyback_burn) are excluded with the held reason key stripped, and 25 rows paging as 20 then 5 with no duplicate.
- Full `pnpm test`: 47 files, 326 passed, 2 skipped. `pnpm typecheck` and `pnpm lint` pass.
- `pnpm exec playwright test apps/web/e2e/fee-ledger.e2e.ts apps/web/e2e/coin.e2e.ts`: 21 passed. The 05-01 red spec is now green (4 of 4).
- Route checks with curl against the dev server: a bad mint gave `404 {"error":"not_found"}`, `?before=abc` gave `400 {"error":"invalid_input"}`, and a valid mint with no rows gave `200 {"rows":[],"more":false,"next":null}`.
- A throwaway Playwright screenshot of a seeded coin (removed after) at 390 and 1440 rendered the panel with no horizontal scroll (scrollWidth 390 and 1440).
- `rg -n "arrives in a later BONDR update" apps/web` finds nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] biome refused `@bondr/core/fees` in web**
- **Found during:** Task 1
- **Issue:** The D-15 restricted-imports allowlist did not list `fees`, so the lint failed on the plan's own import.
- **Fix:** Added `!@bondr/core/fees` to the allowlist. The module is pure (api and math imports only).
- **Commit:** 695d47b

**2. [Rule 1 - Bug] Millisecond cursor against microsecond timestamps**
- **Found during:** Task 2
- **Issue:** The plan's cursor is epoch ms, but `landed_at` keeps microseconds. A plain `(landed_at, id) <` comparison would return the cursor row again on the next page.
- **Fix:** The query orders and compares on `date_trunc('milliseconds', landed_at)`. The ms value converts exactly as `'epoch' + ms * 1 ms`, with no float.
- **Commit:** 48360ce

**3. [Rule 3 - Blocking] coin.e2e.ts asserted the removed note**
- **Found during:** Task 3
- **Fix:** The test now asserts that the Fee ledger region is visible and the old note is absent.
- **Commit:** 2910592

**4. Reuse over copy.** `LoadMore` and `useClock` are exported from token-trades.tsx with a copy prop and a tick arg. `kept` is exported from trades.ts. Nothing is duplicated.

**5. The platform buyback_burn test row has a null mint.** The `fee_ledger_platform` check forbids a mint on buyback_burn, so the test inserts one directly and deletes it by id.

## Deferred Issues

None.

## Requirements

TOKEN-04 is left unchecked in REQUIREMENTS.md on purpose. The panel is done, but no real row exists until the engine writes them (05-05 onward), and 05-10, 05-12 and 05-13 also claim TOKEN-04. Check it once 05-13 verifies it on staging.

## Known Stubs

- The totals block (UI-SPEC Fee ledger receipt) and the live `fee` insert and announce region are not in this plan. They belong to 05-10, and the panel renders head plus entries until then.

## Threat Flags

None. T-05-02-01 to 04 are mitigated as planned: inArray(PUBLIC_KINDS) plus state = 'landed', detail key-by-key (unit-checked), BASE58_KEY 404 and the strict cursor 400 (curl-checked), PAGE 20 with the first page kept 10 s, and links only through TxLink and explorer().

## Self-Check: PASSED

- Files: ledger.ts, ledger.test.ts, ledger-copy.ts, ledger-copy.test.ts, ledger/route.ts, token-ledger.tsx exist.
- Commits: 77587c6, 695d47b, 48360ce, 2910592 are in git log.
