# Phase 3: Indexer, Lists and Token Page - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-10-23
**Phase:** 03-indexer-lists-and-token-page
**Areas discussed:** Later-phase sections, Live list behavior, Trade feed and chart, Share card

The owner picked the recommended option on every question.

---

## Later-phase sections

| Question | Options | Selected |
|----------|---------|----------|
| Next to bond rail | Hide until Phase 5; Rank by curve progress; Placeholder | Hide until Phase 5 |
| Hero line | Launched and bonded counts; Hide the line | Launched and bonded counts |
| Bond and burn panel | Curve progress only; Hide the whole panel; Full panel, empty states | Curve progress only |
| Trade panel spot | Nothing yet; Link out to trade (pump.fun); Placeholder | Nothing yet |

---

## Live list behavior

| Question | Options | Selected |
|----------|---------|----------|
| Re-sorting | Numbers live, re-rank each minute; Fully live; Numbers live, rank on reload | Numbers live, re-rank each minute |
| Empty Trending | Widen the window (24h, then latest); Hide Trending; Empty state | Widen the window |
| New coins | Slides in live; "N new coins" pill; On reload only | Slides in live |
| Trade cue | Brief flash (reduced-motion off); No cue | Brief flash |

---

## Trade feed and chart

| Question | Options | Selected |
|----------|---------|----------|
| Launch trades | Yes, labelled Launch; Chart only; Leave them out | Yes, labelled Launch |
| Chart default | Picked by age; Always 1m; Always 5m | Picked by age |
| Feed depth | Latest 50 then Load more; Latest 100 no paging; Infinite scroll | Latest 50 then Load more |
| Holders | Within 5 minutes; Every trade; Hourly | Within 5 minutes |

---

## Share card

| Question | Options | Selected |
|----------|---------|----------|
| Card content | Identity and proof; Add a market cap snapshot | Identity and proof |
| Card look | Site style, image left; Coin image full-bleed | Site style, image left |

---

## Claude's Discretion

Indexer design, event decoding reuse, DB schema, SSE architecture, search implementation, holder count method, BONDR to SOL price source, an optional site-level share card, and how e2e test coins appear on staging.

## Deferred Ideas

Next to bond rail, burn budget, window, ledger and totals (Phase 5); trade panel (Phase 4).
