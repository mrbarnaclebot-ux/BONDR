---
phase: 05-fee-engine-and-public-ledger
plan: 10
subsystem: web-token-page
tags: [web, ui, bonded, live, sse]
requires:
  - 05-06 token-bond shell, bond-budget, token-ledger totals, Supply burned stat
  - 05-05 the worker's `fee` SSE event
provides:
  - bond-after.tsx BondAfter (moment, bond burn gauge, fee shares gauge)
  - ledger-totals.tsx Totals (pre-bond and bonded columns)
  - use-live onFee; CoinLiveProvider subscribeFees (rows and resync)
  - live-list addLedger (fee rows merged by id, newest first)
  - trade-quote creator row per coin state
affects: [05-11]
tech-stack:
  added: []
  patterns:
    - a second subscriber set on the one coin stream (useSubs), so the ledger gets fee rows and resyncs with no new reads
    - live ledger rows batched per animation frame, one polite announcement per burst
key-files:
  created:
    - apps/web/components/bond-after.tsx
    - apps/web/components/ledger-totals.tsx
    - apps/web/e2e/fee-bonded.e2e.ts
    - apps/web/e2e/fee-live.e2e.ts
  modified:
    - apps/web/components/token-bond.tsx
    - apps/web/components/token-ledger.tsx
    - apps/web/components/coin-live.tsx
    - apps/web/components/trade-quote.tsx
    - apps/web/lib/use-live.ts
    - apps/web/lib/live-list.ts
    - apps/web/lib/live-list.test.ts
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/e2e/coin.e2e.ts
    - apps/web/e2e/trade.e2e.ts
    - apps/web/components/README.md
    - apps/web/lib/README.md
    - apps/web/e2e/README.md
decisions:
  - "Totals moved to ledger-totals.tsx so token-ledger.tsx stays under 300 lines once the live insert is added"
  - "The bond tx link moved into the bond moment body: the bond is not a fee movement, so the panel links it, not the ledger"
  - "Bond burn shows Pending only while finalize is none and the budget is above zero; otherwise None"
  - "The BONDR hop's creator sub-row keeps its Phase 4 copy; only the coin hop follows the coin's fee state"
metrics:
  duration: 16 min
  completed: 2026-10-25
  tasks: 3
  files: 17
---

# Phase 5 Plan 10: Bonded panel, bonded totals and live fee events Summary

A bonded coin now shows:
- the bond moment: forced by its own fees, or bonded by its traders, with the bond tx
- the bond burn gauge: forced-bond buy, fallback buy, pending, or none
- the fee shares gauge: pending, a plain "Pending review" when held, or the finalized split with its tx
- the bonded totals column

Fee events on the live stream now insert rows at the top of the ledger. They also update the panel, the totals and the Supply burned stat, and each burst is announced once. The trade panel's creator row says where the creator fee goes for the coin's state.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | BondAfter and the bonded totals | b494273 | bond-after.tsx, ledger-totals.tsx, token-bond.tsx, token-ledger.tsx, page.tsx, coin.e2e.ts, README.md |
| 2 | Live fee events; trade creator copy | e991e0f | use-live.ts, coin-live.tsx, token-ledger.tsx, live-list.ts (+test), trade-quote.tsx, trade.e2e.ts, READMEs |
| 3 | Bonded and live specs | 377463a | fee-bonded.e2e.ts, fee-live.e2e.ts, e2e/README.md |

## Verification

- `pnpm exec playwright test` on fee-bonded, fee-live, fee-ledger, coin, live and trade: 49 passed. The 3 skipped tests are the devnet groups.
- responsive-lists coin-curve and coin-bonded at 390, 768 and 1440: 6 passed, with 0 axe violations. The overwritten Phase 3 screenshots were restored, not committed.
- `pnpm vitest run apps/web/lib`: 100 passed, 1 skipped. This includes the new addLedger check.
- `pnpm typecheck` and `pnpm lint` are clean.
- File sizes: bond-after 217, token-bond 176, token-ledger 230, ledger-totals 94, trade-quote 268, coin-live 105, fee-bonded.e2e 152, fee-live.e2e 144.

## Deviations from Plan

**1. [Rule 3 - Blocking] The totals were split into ledger-totals.tsx**
- **Found during:** Task 1
- **Issue:** With the bonded column and the live insert, token-ledger.tsx would have gone past 300 lines.
- **Fix:** Totals now lives in ledger-totals.tsx. The acceptance grep for "Pending review" in token-ledger.tsx therefore matches ledger-totals.tsx instead.

**2. [Rule 3 - Blocking] page.tsx now passes the coin image to BondPanel**
- **Issue:** The moment's orb needs the coin image. pinata's imageUrl is server-side, so page.tsx computes it.

**3. [Rule 1 - Bug] Existing specs updated to the new copy**
- coin.e2e asserted the Phase 3 bonded state: Curve filled 100%, the Bonded tag and the glyph. It now checks the moment, the age label, the traders heading and the bond tx.
- trade.e2e asserted "to the {SYMBOL} fee wallet". It now checks the burn budget copy on curve and the 80/20 copy on PumpSwap.

**4. [Rule 2] Merging by id is a tested pure helper**
- addLedger in live-list.ts is used by the live insert, the resync merge and Load more, and is unit-tested.

## Known Stubs

None.

## Notes

- fee-live.e2e.ts carries its own `sse` and `stubLive` copy, the same as live.e2e.ts and home-live.e2e.ts. A shared helper would mean editing those two specs as well, so it was not done here.
- Repeated identical announcement text is not re-read by screen readers. Fee events are a few a day, so this was accepted.

## Requirements

- TOKEN-03 and FEE-05 are done on the page.
- TOKEN-04 now includes live rows.
- TOKEN-05 now includes the bonded totals.

## Threat Flags

None. As planned:
- T-05-10-01: a held finalize renders only "Pending review", and the spec checks that the reason is absent from the HTML.
- T-05-10-03: rows are batched per frame and merged by id.

## Self-Check: PASSED

- FOUND: bond-after.tsx, ledger-totals.tsx, fee-bonded.e2e.ts, fee-live.e2e.ts
- FOUND commits: b494273, e991e0f, 377463a
