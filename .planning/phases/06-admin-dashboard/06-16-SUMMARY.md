---
phase: 06-admin-dashboard
plan: 16
subsystem: web
tags: [web, w-table, state-machine, tdd]
requires: [06-14]
provides:
  - admin-state.ts wState, sortRows, chipCounts, firstStuck, nextStepCopy, budgetSol, windowMsLeft, triggerReady, wItems, CHIPS, types WState/WKey/WChip/WItem
  - admin-wtable.tsx WTable
  - Tag tone danger; Chips wrap prop
  - useConsole selected/select (third arg windowMs); AdminConsole windowMs prop
  - WRow.bondrSol
  - e2e/admin-wtable.e2e.ts
affects: [06-17 timeline, 06-18 dialog, 06-25 phase gate]
tech-stack:
  added: []
  patterns: [one pure state function feeding tag, chip, sort and next step; server-equal first render keyed on overview.loadedAt]
key-files:
  created:
    - apps/web/lib/admin-state.ts
    - apps/web/lib/admin-state.test.ts
    - apps/web/components/admin-wtable.tsx
    - apps/web/e2e/admin-wtable.e2e.ts
  modified:
    - apps/web/lib/admin-data.ts
    - apps/web/lib/use-console.ts
    - apps/web/components/admin-console.tsx
    - apps/web/app/admin/page.tsx
    - apps/web/components/tag.tsx
    - apps/web/components/trade-amount.tsx
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-16: WRow gains bondrSol so the burn budget shows SOL (D-07) via toSol(budgetOf(...)); a budget with no stored price reads a muted dash"
  - "06-16: after any overview load the selection is kept while its coin is listed, else it falls back to the first stuck coin (or none)"
  - "06-16: stuck step names come from the engine's job labels (finalize, forced bond, sweep, distribute, bonded); unknown steps read '{Step} stuck' / 'Retry {step}'"
  - "06-16: the danger Tag text is destructive lifted 15% toward foreground; plain destructive on the wash over a selected surface-2 row failed axe contrast"
metrics:
  duration: 40 min
  completed: 2026-10-25
  tasks: 2
  files: 13
---

# Phase 6 Plan 16: Fee wallets (W) table Summary

The console now lists every coin's fee wallet from the one overview load. Each row shows the coin's state, next step, burn budget in SOL, ratio to cost, window left, last collect and a Solscan link for W. Stuck coins sort first, and the first stuck coin is selected when the console opens. All of it comes from one pure, tested function, `wState`.

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | The W state function | 3ae2dc0 (RED), 886b9c2 (GREEN) |
| 2 | W table component, shared tweaks and the spec | 793f1fe |

## What was built

- `admin-state.ts` (158 lines, pure). `wState(row, mem, now, windowMs)` applies the Pattern 6 order: stuck, launch unconfirmed, held (held_at, finalize held or a memory hold), bond sent, awaiting migration, bonded, finalized, trigger ready, collecting. Trigger ready means `trigger105(budgetOf(feeBudget, feesUnclaimed), cost)` on a curve coin with a cost above 0. `sortRows` orders stuck and unconfirmed first, then trigger, held, bond sent, awaiting, bonded, collecting by ratio (highest first, unknown last), then finalized by newest bond. It does not mutate its input. The file also exports `chipCounts` (zero counts included), `firstStuck`, `nextStepCopy`, `budgetSol`, `windowMsLeft` and `wItems` (joins memory by mint, then sorts).
- `admin-wtable.tsx` (226 lines):
  - Header: the h2 and head note, then the wrapped Chips (legend "Filter coins by state") with live counts. Filtering happens client-side.
  - Scroll region: a `<section aria-label tabIndex=0>`, the 06-14 pattern. It is `relative` so absolutely positioned sr-only text cannot widen the page. Its caption reads "Fee wallets, {filter}, {n} coins".
  - Coin column: sticky on `surface` with a right rule. It holds a 24px image (alt empty) and a "{SYMBOL}, open timeline" button with `aria-current`. The selected row uses `surface-2`.
  - Data columns: Burn budget uses `feeSol` and shows "0" muted. vs cost turns leaf at 105% or more. vs cost and Window left read a muted "–" off the curve or for an unconfirmed launch.
  - Rows: the first 50, then "Show all {n} coins".
  - Empty, filter-empty and load-failed text follows the UI-SPEC copy.
  - Time cells: they render from `overview.loadedAt` on the server and the first client pass, then from the viewer's clock after mount, so hydration matches. No timer.
- `use-console.ts`: `useConsole(initial, onUnauthorized, windowMs)` adds `selected` and `select`. `admin-console.tsx` (173 lines) mounts WTable below the top row and passes `con.select` to Health's stuck-coin button. `page.tsx` passes `windowMs={feeWindowMs()}`.
- Tag `danger` tone. Chips `wrap` prop (flex-wrap, auto width, `px-3`, 44px tall below md and 32px from md). Existing callers are unchanged.

## Verification

- `pnpm vitest run apps/web/lib/admin-state.test.ts`: 11 passed. The RED run failed first because the module was missing.
- `pnpm exec playwright test apps/web/e2e/admin-wtable.e2e.ts --project=chromium`: 2 passed, none skipped. Re-run together with trade-sheet.e2e.ts and admin-console.e2e.ts: 12 passed.
- Gate at 390, 768 and 1440 with the seven-coin stub through `shoot.ts gate` from a temporary spec (deleted afterwards). No horizontal scroll and 0 axe violations once the danger tone fix was in. Screenshots are in scratch and were not committed.
- `pnpm lint`: clean (386 files). `pnpm typecheck`: pass.
- Full `pnpm test`: 83 files passed, 631 passed, 2 skipped (633).
- Acceptance greps: there is no `fetch`, `db(` or `useEffect` in admin-state.ts. There is no `getBalance`, `getMultipleAccounts`, `coin-live` or `dangerouslySetInnerHTML` in admin-wtable.tsx. admin-console.tsx is under 200 lines. Every touched file is under 300 lines and every function under 40.

## Deviations from Plan

**1. [Rule 3 - Blocking] `WRow.bondrSol` added.** `fee_budget` is stored in BONDR base units, and the UI-SPEC wants the budget shown in SOL. The coin row's stored `bondrSol` now rides along in WRow (null for unconfirmed launches), and `budgetSol` converts with `@bondr/core/price` `toSol`.

**2. [Rule 1 - Bug] Engine step names differ from the plan.** The engine's `stepOf` yields "forced bond" (with a space) and also "bonded". The plan wrote "forcedBond". Both spellings map to "Forced bond stuck". "bonded" falls through to the generic "Bonded stuck" / "Retry bonded". Distribute's retry reads "Distribute now", following the UI-SPEC retry mapping.

**3. Selection after a load.** The plan only says the first stuck coin is selected on open. After a load, the selection is now kept while its coin is listed, and otherwise falls back to the first stuck coin. The stubbed spec depends on this, and a coin that vanishes, such as a hidden one, no longer leaves a dangling selection.

**4. [Rule 2 - Accessibility] Danger tone contrast.** Axe flagged destructive text on `danger-wash` over the selected `surface-2` row. The danger tone's text is now `color-mix(destructive, foreground 15%)`. Border and fill are as specified.

**5. [Rule 1 - Bug] Page-wide horizontal scroll at 390.** The W column's sr-only "(opens Solscan)" is absolutely positioned and escaped the unpositioned scroll region, which made the page 890px wide. The region is now `relative`.

**6. "Bond sent" next step** reads "Bond sent, confirming". The UI-SPEC's next-step table has no row for it.

**7. Focus to the Timeline h2 on select** is left to 06-17, because the timeline does not exist yet.

## Deferred Issues

- admin-audit.tsx has the same latent sr-only escape. TxLink's sr-only text sits inside an unpositioned `overflow-x-auto` section, so audit rows with signatures could widen the page at 390. The fix is the same one word, `relative`, on that section. This is out of scope here and logged for 06-17 or 06-25.

## Requirements

ADMIN-02 is complete: the balances and totals (06-12) and every W with its state (this plan). ADMIN-08 is not ticked: this plan ships the next-step column, while the timeline and retry ship in 06-17.

## Known Stubs

None. The timeline that a selection opens is 06-17. The `06-17` slot comment remains in admin-console.tsx.

## Threat Flags

None. No new endpoint. The table renders React text only (T-06-16-03) and caps the first render at 50 rows (T-06-16-02).

## Self-Check: PASSED

- The created files exist: admin-state.ts, admin-state.test.ts, admin-wtable.tsx and admin-wtable.e2e.ts. Commits 3ae2dc0, 886b9c2 and 793f1fe are in `git log`.
