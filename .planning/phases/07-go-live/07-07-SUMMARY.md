---
phase: 07-go-live
plan: 07
subsystem: worker ingest, web token page
tags: [sniped, ingest, token-page, tdd]
requires: [07-01, 07-02]
provides:
  - "NewCoin.createSlot (launch tx slot) and snipedBps 0 on every new coin; KnownCoin.createSlot?: string | null"
  - "apps/worker/src/sniped.ts: windowMints(inserted, known), snipedBps(bought), recomputeSniped(exec, mint)"
  - "CoinRow.createSlot and CoinRow.snipedBps (coinRow select list)"
  - "Token page Sniped line; e2e PHASE7_SHOTS export in shoot.ts"
affects: [07-xx UI screenshots (PHASE7_SHOTS), any CoinRow literal]
key-files:
  created:
    - apps/worker/src/sniped.ts
    - apps/web/e2e/coin-sniped.e2e.ts
    - .planning/phases/07-go-live/screenshots/coin-sniped-{390,768,1440}.png
  modified:
    - packages/core/src/trades.ts
    - apps/worker/src/ingest.ts
    - apps/worker/src/ingest.test.ts
    - packages/core/src/api.ts
    - packages/core/src/coin-row.ts
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/e2e/shoot.ts
    - apps/web/lib/live-list.test.ts
key-decisions:
  - "07-07: sniped_bps uses a select aggregate plus a guarded update (is distinct from, create_slot not null) in the ingest transaction; it runs only when an inserted non-launch buy is at or below createSlot + 2"
  - "07-07: recomputeSniped does not catch: a failed statement aborts the ingest transaction anyway, so ingestOrKeep's keep-and-retry is the error path"
requirements-completed: [TOKEN-07]
duration: 30min
completed: 2026-10-26
---

# Phase 7 Plan 07: Sniped % Summary

**Every coin launched from now on records its create slot. The share of supply bought by anyone other than the dev and W in slots createSlot to createSlot + 2 is rounded up to whole bps and written in the same ingest transaction, only when a buy inside that window is inserted. The token page shows it as a muted disclosure under the proof stamp and outside it.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Create slot on new coins and sniped_bps written on window trades | 4ea95b6 |
| 2 | Sniped line on the token page | f51a79a |

## Evidence

- ingest.test.ts (Neon dev branch, rolled back): 4 passed. Red was checked first; the createSlot assertion failed. The new case covers:
  - the launch writes createSlot = the fixture slot and snipedBps 0
  - a 1-base-unit third-party buy at +1 reads 1 bps
  - none of these move it: a dev-wallet buy, a W buy, a sell, a launch row, a buy at +3
  - a buy at +2 brings the total to exactly 320 bps
  - a coin with createSlot null is never recomputed (it stays null)
- trades.test.ts: green, 20 passed together with ingest.test.ts.
- coin-sniped.e2e.ts plus coin.e2e.ts (chromium): 19 passed. The new spec checks the verbatim copy for 320 bps ("Sniped 3.2% of supply. ..."), that "Sniped" is absent inside the "Launch supply proof" aside, that the body text matches none of the forbidden phrases, and that a coin with no create slot shows no "Sniped" text. It also runs the axe and no-horizontal-scroll gate and takes screenshots at 390, 768 and 1440.
- Screenshots reviewed. At 1440 the line sits under the stamp in the right column. At 390 it sits under the full-width stamp. The figure is foreground semibold and the rest muted, with no leaf, warn or destructive colour.
- `rg -in "<forbidden phrases>" apps/web`: only the test's regex. `rg "setInterval|setTimeout" sniped.ts`: none.
- Sizes: ingest.ts 275 lines, trades.ts 284, sniped.ts 50, page.tsx 207. `pnpm typecheck` and `pnpm lint` are clean.

## Deviations from Plan

1. **[Rule 3 / AGENTS size rule] The e2e cases are in a new file, apps/web/e2e/coin-sniped.e2e.ts.** coin.e2e.ts is 295 lines, so adding two tests would break the 300-line limit.
2. **[Rule 3 - Blocking] `CoinRow` in packages/core/src/api.ts gains `createSlot` and `snipedBps`**, and the live-list.test.ts literal now sets both to null. Without this the new select fields fail the type.
3. **The window-check helper `windowMints` lives in sniped.ts and takes knownCoins as an argument.** Importing it from ingest.ts would create an import cycle.
4. **recomputeSniped does not catch errors.** In Postgres a failed statement aborts the surrounding transaction, so catching and logging would only hide the real failure. The ingest keep-and-retry path handles it, as for any write error.
5. **[AGENTS section 7] PHASE7_SHOTS was added to shoot.ts**, along with the axe and screenshot gate for this surface (UI-SPEC verification item 5).

## Notes for later plans

- Coins launched before this plan have create_slot null and never show the line. Backfilling them is not planned.
- The figure is read at page load, not streamed (UI-SPEC ponytail).

## Threat Flags

None. T-07-07-01..04 are mitigated as planned.

## Self-Check: PASSED

- FOUND apps/worker/src/sniped.ts, apps/web/e2e/coin-sniped.e2e.ts, the three screenshots
- FOUND commits 4ea95b6, f51a79a
