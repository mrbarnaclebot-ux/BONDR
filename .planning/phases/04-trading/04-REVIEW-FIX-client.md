---
phase: 04-trading
fixed_at: 2026-10-25T00:00:00Z
review_path: .planning/phases/04-trading/04-REVIEW.md
iteration: 1
scope: client half (C-CR, C-WR, one- or two-line C-IN)
findings_in_scope: 17
fixed: 16
skipped: 1
status: partial
---

# Phase 4: Code Review Fix Report (client half)

**Fixed at:** 2026-10-25
**Source review:** .planning/phases/04-trading/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 17 (C-CR-01, C-CR-02, C-WR-01..10, C-IN-01..06)
- Fixed: 16
- Skipped: 1 (C-IN-01, as instructed)
- One coordinator request on top: neutral devnet cap copy (commit 9a5194e)

**Verification:** biome check, `pnpm lint`, `pnpm typecheck` and `pnpm test` (44 files, 297 passed, 2 skipped) are green. The Playwright trade, responsive-trade and coin specs pass: 84 passed and 2 skipped (the devnet group needs E2E_DEVNET=1). Regenerated Phase 4 screenshots changed only in seeded data. The disabled button look with data-off matches the old native disabled look pixel for pixel, so all screenshots were restored.

**Process note:** fixes were made in the main working tree on `phase-04-trading` with explicit staging, not in a temporary worktree. The server fixer committed to the same branch at the same time.

## Fixed Issues

### C-CR-01: A quote for an older amount drives the ready label, the over-15% gate and the shown minimum

**Commit:** f900d73. **Status:** fixed (logic, requires human verification).
`currentQuote(quote, side, units, loading)` in `trade-button.ts` accepts a quote only when its side and `amountIn` match the input and no newer quote is loading. The button table uses it, so the ready label, the "anyway" label and the action all depend on it, and so does the provider's `submit()` guard. A stale quote reads "Getting quote…" with `action: null`, so Enter and a click do nothing. The quote list and the callouts still show the last quote for the side, dimmed while it loads (UI-SPEC). The e2e stub now echoes `amountIn` from the request, as the worker does. New tests: a unit row in `trade-button.test.ts` that fails without the fix, and `trade-run.e2e.ts` "a quote for an older amount never arms the button".

### C-CR-02: The trade poll never ends while the worker is unreachable, and nothing aborts it

**Commit:** 8736d3a. **Status:** fixed.
The poll now stops at a 150 s deadline. A row still `prepared` at that point is `expired`, because the wire never reached the worker. Anything else becomes `unknown`, never failed. Every request and the poll take the run's `AbortSignal`, and `useRun` aborts it on unmount. The trader's slot 0 signature is the transaction id. It is base58-encoded with `bs58`, which moved from the web devDependencies to dependencies (no new package, lockfile updated). With it, an unknown result always links Solscan. New test: `trade-run.test.ts`, covering the deadline and the abort.

### C-WR-01: The sheet can close mid-trade, and reopening it wipes the result and changes the side

**Commit:** ceec287. **Status:** fixed.
While a trade is in flight, `onClose` reopens the dialog with `showModal()`. This covers a repeated Escape or Android back. A resize to 1100px waits until the trade ends. The result is no longer cleared when the sheet closes. Reopening calls `setSide` only when the side changes, no trade is in flight and the result is not unknown. **UI-SPEC departure:** "The result stays until … the sheet closing" now reads "until the next panel input or a side change", as the fix brief asks. Test: `trade-sheet.e2e.ts` adds a resize during the flight and checks the result after close and reopen.

### C-WR-02: Over the devnet cap the field shows an error, but the button stays ready

**Commit:** 267079f. **Status:** fixed.
`devnetCap(side, quote)` is shared by the field and a new button row, "Enter an amount", that comes before the balance row. A unit row was added.

### C-WR-03: The impact callouts re-announce on every 2 s refresh, and the quote-failed callout flaps

**Commit:** 768893f. **Status:** fixed.
The live percentage sits in `<span aria-live="off">`, and the visible copy is unchanged. The no-op `key` props are gone. A failed refresh keeps the shown quote and only sets `quoteError`. Because of C-CR-01, that kept quote still never arms a trade for another amount. The e2e asserts the `aria-live="off"` span.

### C-WR-04: `useRouteQuote` can write a stale "failed" state after its request was aborted

**Commit:** 6414917. **Status:** fixed.
`fetchQuote(req, signal)` returns one answer. The effect drops that answer once its signal is aborted, which covers an abort during `r.json()`. This also brings `useRouteQuote` under 40 lines (part of C-WR-10).

### C-WR-05: Failure copy says "Nothing was sent" or "failed on-chain" when the outcome is unknown

**Commit:** dc8be95. **Status:** fixed (logic, requires human verification).
Once the signed wire is posted, only answers that prove the worker never sent it end as failures: `slippage`, `insufficient_balance`, `paused`, `expired`, `rate_limited`, `message_changed` and `consent_required`. Any other submit error polls the row, the same as `worker_unavailable`. A lost row (`not_found`) and the deadline both give `unknown`. `toResult` maps only `state: "failed"` to a failure. Every settled row carries the slot 0 signature, so the existing UI-SPEC row "Your trade was sent but is not confirmed yet. Check Solscan before you trade again." always has its Solscan link. **No new copy was needed.** Tests: two `trade-results.e2e.ts` rows, a worker that lost the trade and a submit error without its own copy. Each expects the warning, a slot 0 Solscan link and no "nothing was sent".

### C-WR-06: An account switch during signing reports "Signature declined"

**Commit:** f94a37f. **Status:** fixed.
`runTrade` reads the live address through `RunInput.address()`, a ref in `useRun`, instead of `onAccountChange`. A sign error after a switch, or after a disconnect (address null), throws `switched`. The check after the signature uses the same rule. Unit test in `trade-run.test.ts`. Residual risk: if Phantom rejects before React re-renders the new address, the result still reads "declined".

### C-WR-07: The submit button loses keyboard focus on the Enter path and after a landed trade

**Commit:** d95fe45. **Status:** fixed.
`onSubmit` focuses the button before the fieldset locks. Off states are never natively disabled: they render `aria-disabled` and a new `data-off:` variant in `ui-button.tsx` that draws the same disabled look. The e2e checks focus through an Enter-started trade to "Enter an amount".

### C-WR-08: The sell error tells users to type "1,000", but the parser rejects commas

**Commit:** b2c4b6a. **Status:** fixed.
`toUnits` strips commas and reads a leading "." as "0.". The e2e covers ".5" and "1,000".

### C-WR-09: e2e flakiness: single post-buy balance read, real-time timer-absence check

**Commit:** 0700191. **Status:** fixed.
A landed trade rereads the balance once more after 2 s, a bounded retry and not a timer loop (D-16). The devnet sell waits for a non-zero coin balance before pressing 100%. The pause check now asserts the announced "Quote paused." and drops the `waitForTimeout` sleeps.

### C-WR-10: Nine functions exceed the 40-line limit

**Commit:** d67e0cd, plus 6414917 for `useRouteQuote`. **Status:** fixed.
The splits:
- `useSheet` and `BarMcap` from the sheet.
- `PhantomLink`, `PanelInputs` and `PanelFooter` from the panel.
- `FeesSummary`, `PercentInput` (with `customBps`) and `SlippageRow` from the quote.
- `LabelRow` from the amount field.
- The provider's `setters()`.
- `useRun` moves to the new `lib/use-run.ts`, listed in `lib/README.md`. `use-trade.ts` is now 242 lines.

Every function in the trade client files is now 40 lines or less (`useRun` is 39). No behavior change.

### C-IN-02: The custom slippage error and the applied value disagree at the edges

**Commit:** afdb6c1. **Status:** fixed. Both the error and the applied value come from the rounded bps. The C-WR-10 split later turned this into `customBps()`.

### C-IN-03: A landed row without a signature renders a broken Solscan link

**Commit:** dc8be95, with C-WR-05. **Status:** fixed. Every settled row now carries the slot 0 signature, so `signature ?? ""` is gone.

### C-IN-04: The 2 s tick can fire a debounced quote early

**Commit:** 6940734. **Status:** fixed. A tick within 400 ms of an input is skipped.

### C-IN-05: The 0.01 SOL reserve is defined twice

**Commit:** d2c76e2. **Status:** fixed. `RESERVE` is exported from `trade-button.ts`.

### C-IN-06: Route step keys collide when the coin's symbol is "BONDR"

**Commit:** d4078e0. **Status:** fixed. Steps are keyed by position.

### Coordinator request: neutral devnet cap copy

**Commit:** 9a5194e.
The server's `maxSolIn` is now the smaller of the BONDR curve cap and the coin's own curve cap (S-WR-04). The field error now reads "On devnet, buys stay under {max} SOL so the curves stay open." The `trade.e2e.ts` assertion and the UI-SPEC 04-03 note were updated to match.

## Skipped Issues

### C-IN-01: `globals.css` is 406 lines

**File:** `apps/web/app/globals.css:1-406`
**Reason:** skipped as instructed. The file was over the limit before this phase, so it should be split by surface when it is next touched.

## Server notes

- None of these fixes needs a server change. C-WR-05 assumes a submit refusal (`message_changed`, `expired`, `rate_limited`, preflight `slippage`, `insufficient_balance` or `paused`) means the worker did not broadcast. If the worker can broadcast and still return one of those codes, `REFUSED` in `apps/web/lib/trade-run.ts` must shrink.
- S-IN-07 (restart and submit timeout) is handled on the client by C-WR-05: `not_found` and `worker_unavailable` after posting now end unknown, with the slot 0 Solscan link.

---

_Fixed: 2026-10-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
