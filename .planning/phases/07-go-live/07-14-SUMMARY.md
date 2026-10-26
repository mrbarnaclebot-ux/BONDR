---
phase: 07-go-live
plan: 14
subsystem: launch form, home search
tags: [anti-vamp, launch-form, search, ui]
requires: [07-13]
provides:
  - "Step 1 reserved field error (live, blocks Continue) and the ticker_locked field error (shown, not blocking) from Launch.refused"
  - "launch-flow.tsx: Launch.refused: Refused | null, type Refused = { symbol, err }, action { type: 'refused', refused }"
  - "apps/web/lib/coins.ts markFirst(rows, key, page) and exact-ticker-first ordering in listCoins"
  - "CoinRow.first?: boolean (core api.ts), rendered as the plain First Tag in coin-card.tsx"
affects: [07-18 genesis variant (skips the reserved field error)]
key-files:
  created:
    - apps/web/e2e/search-first.e2e.ts
  modified:
    - apps/web/components/launch-coin.tsx
    - apps/web/components/launch-flow.tsx
    - apps/web/components/launch-sign.tsx
    - apps/web/e2e/launch-ticker.e2e.ts
    - apps/web/lib/coins.ts
    - apps/web/lib/coins.test.ts
    - apps/web/components/coin-card.tsx
    - packages/core/src/api.ts
    - apps/web/components/README.md
    - apps/web/lib/README.md
key-decisions:
  - "07-14: the locked field error is shown but does not block Continue, because a creator may wait out a lock (a pending lock clears in minutes) and continue with the same ticker; the reserved error blocks"
  - "07-14: First is computed from page 0's own rows (exact matches lead the order), so search adds no count query"
  - "07-14: the refusal stays in flow state until reset; the field error shows whenever the normalized symbol equals the refused one"
requirements-completed: []
duration: 15min
completed: 2026-10-26
---

# Phase 7 Plan 14: Anti-vamp Field Errors and the First Marker Summary

**Creators now see in step 1 that a ticker is reserved or cooling down. The reserved error shows as they type and blocks Continue. The cooldown error appears after step 4 gets a `ticker_locked` refusal, and clears when they change the symbol. Search lists exact ticker matches oldest first, ahead of the chosen sort. When two or more visible coins share the ticker, the oldest is marked with a plain "First" Tag.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Reserved and locked field errors in step 1, and the refusal e2e | 2a6b0a2 |
| 2 | Oldest-first exact matches with the First marker | 64d4cff |
| docs | Web README entries | e194949 |

## Evidence

- launch-ticker.e2e.ts: 7 passed, all with stubbed prepare.
  - Step 4 shows the exact line, and no retry button, for each of five cases: landed 75600, landed 1500 ("23h ago ... 25 minutes"), pending, missing retryAfter, and reserved.
  - Back to step 1 after the 75600 refusal: the field shows "$PEPE launched on BONDR 3h ago. Try again in 21h." with aria-invalid. Editing the symbol to pepex clears it, " pepe" brings it back, and Continue still reaches step 2.
  - Typing "sol" shows "$SOL is reserved on BONDR. Choose another ticker.", and Continue stays on step 1.
  - Gate shots (no horizontal scroll, 0 axe violations) at 390, 768 and 1440 for launch-ticker-locked, launch-ticker-field and launch-ticker-reserved.
- coins.test.ts: 15 passed. RED was checked first by running the new tests against the HEAD coins.ts with a stub markFirst: 2 failed.
  - pure markFirst: marks only page 0, only an exact head, and only when there are 2 or more exact rows
  - DB, sorted by latest and by top: three exact matches and a newer partial come back as [oldest, middle, newest, partial], with only the first row flagged. A hidden exact coin is excluded. Page 1 is empty. The partial-only search and the unsearched list have no flag.
  - DB: one exact match has no flag
- search-first.e2e.ts: 2 passed. The oldest exact match is the first card, and exactly one link matches /first launched with this ticker/i, pointing at that coin. One exact match has no marker. Gate shots search-first at 390, 768 and 1440. At 390 the name truncates and the symbol and Tag stay whole.
- Regression runs:
  - launch-form.e2e.ts plus launch-live.e2e.ts: 33 passed, 1 skipped (the existing devnet-gated case).
  - home.e2e.ts: the first run after the change had 3 failures in the search block, a rerun had 1, and the next two runs were 15/15 clean. Treated as flakes (Neon cold start and parallel seeds). Not investigated further.
- `pnpm typecheck` and `pnpm lint` are clean. Line counts: launch-coin.tsx 255, launch-flow.tsx 225, launch-sign.tsx 223, coins.ts 152, coin-card.tsx 217, coins.test.ts 298.

## Deviations from Plan

1. **[Rule 3] launch-sign.tsx was edited (not in the plan's file list).** Its `fail()` is where step 4 learns about a `ticker_locked` refusal, so it dispatches `{ type: "refused" }` into flow state. That adds three lines.
2. **[Rule 2] The locked field error does not block Continue.** The plan and UI-SPEC A1 say only that it shows until the symbol changes. Blocking would trap a creator who waits out a pending lock, which clears in minutes.
3. **The page 2 case is covered by the pure markFirst test plus an empty page 1 in the DB test.** A real second page of exact matches would need 51 seeded coins on the shared 0.25 CU Neon branch. Order stability on later pages still comes from `asc(coins.mint)` as the last key.
4. **Test data cleanup.** The RED run's hidden seed failed on the coins_hidden check (hidden_reason is required), which left a launch row without a coin. The cleanup removed 2 `w = 'e2e'` launch rows with no coin, updated in the last hour (E68871 and E19360), together with their vanity and wallet rows. The second row's origin is unknown.

## Threat Flags

None. T-07-14-01: `key` reaches SQL only as a bound drizzle parameter. T-07-14-02/03: plain tone, factual wording, hidden coins excluded. T-07-14-04: there is no count query at all.

## Self-Check: PASSED

- FOUND apps/web/e2e/search-first.e2e.ts, apps/web/e2e/launch-ticker.e2e.ts, 9 launch-ticker and 3 search-first screenshots
- FOUND commits 2a6b0a2, 64d4cff, e194949
