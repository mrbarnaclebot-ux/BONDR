---
phase: 04-trading
fixed_at: 2026-10-25T00:00:00Z
review_path: .planning/phases/04-trading/04-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report (server half)

Scope: S-CR-01, S-WR-01..05, and the two one-line S-IN items. The brief called the priority-cap item "S-IN-01", but in the review it is S-IN-02 (S-IN-01 is the unreachable Helius path). I fixed S-IN-02 and S-IN-05 (routeQuote over 40 lines). S-IN-01, 03, 04, 06 and 07 are out of scope.

I worked in the main tree, not a worktree, because the client fixer commits to the same branch. Each commit lists only my own paths.

Verification: `pnpm -s lint`, `pnpm -s typecheck` and `pnpm -s test` (44 files, 297 passed, 2 skipped) all pass. I did not run Playwright.

## Fixed

### S-CR-01: "Sold for" came from the wallet's SOL delta
**Commit:** 9e133a6
- New `soldLamports(tx, bondrMint, user)` in `packages/core/src/trade.ts`. It reads the BONDR to SOL leg's event:
  - on a curve, `quoteAmount - fee - creatorFee` from the TradeEvent;
  - on a pool, `userQuoteAmountOut` from the SellEvent.
- `settleTrade` now uses `fetchTx`, reads the sell from the event, and falls back to `lamportDelta` only when there is no event.
- The spike multihop sell row uses the same figure (`scripts/spike/stages/multihop.ts`).
- The bought amount has no rent problem: it is a token-balance delta, so it is unchanged.
- Test: `packages/core/src/trade.test.ts` loads `multihop-sell.json` and adds a closed ATA's rent to the payer. It asserts `soldLamports` is 9,754,865 while `lamportDelta` is inflated by the rent.

### S-WR-01: error codes mapped without the program that raised them
**Commit:** 10bfb63
- Codes are now keyed `program:code`. The raiser comes from the first `Program <id> failed: custom program error` log line, because the runtime logs the innermost program first.
- Slippage: AMM 6004 and 6040, pump 6002 and 6003. Paused: pump 6107 and 6005.
- On-chain settle maps from the landed tx's logs instead of `r.code === 6004`.
- Launch now uses its own `launchError`, which keeps its old codes: pump 6107 is paused, low funds is insufficient_balance, everything else is build_failed.
- Tests cover both programs, the same code from the other program, and the launch map. The fixture tests now include raiser log lines.
- Limit: with no "failed" log line, a custom code no longer maps and becomes build_failed.

### S-WR-02: preflight rejection mapped from a cut, redacted message
**Commit:** 7d77856
- `thrown()` now keeps the preflight's `transactionError.message` and its logs, unsliced, in `SendResult.preflight`. This field stays in the worker. web3.js does not expose the err JSON on `SendTransactionError`, so the message and logs are the structured parts available.
- Trade submit maps them with `tradeError`.
- "no record of a prior credit" now maps to insufficient_balance.
- Tests in `send.test.ts`, `trade-error.test.ts` and `trade-submit.test.ts`.
- Side effect: a spike row from a preflight-rejected `sendTx` now also records `preflight` (logs only, no secrets).

### S-WR-03: no runtime check that the trade message is only the route
**Commit:** f1d99d8
- New `routeOnly(msg, user)` in `apps/worker/src/trade-prepare.ts`, run after `checkMessage`. It requires:
  - exactly the two compute-budget instructions first;
  - exactly one multi_hop_swap, checked with the tag exported from `cosign.ts`;
  - otherwise only the instructions `multiHopSwapInstructions` builds: idempotent ATA creates paid by the user, and the System transfer, SyncNative and CloseAccount on the user's own WSOL ATA.
- Any other instruction is refused with build_failed.
- `ponytail:` note: an ATA create for another owner (the buyback ATA) is still allowed.
- Tests: the SDK's route shape passes. A stray transfer, a second swap, a missing swap, a late budget instruction and a foreign close are refused, plus one prepare-level build_failed.
- I checked the allowed shape against the pinned SDK 4.1.0 source, not a live build. Run `TRADE_LIVE=1 pnpm vitest run apps/worker/src/trade-prepare.test.ts -t live` once to confirm it on devnet.

### S-WR-04: devnet cap did not protect the coin's own curve
**Commit:** 927477b
- `maxSolIn(net, bondr, coin, cfg)` also computes the coin's cost to complete in BONDR, priced on BONDR's curve. It keeps the same 10% margin and takes the smaller of the two caps.
- Prepare reads the coin's cached `mintState`, so there are no new reads.
- The cap errs slightly high because each hop's fees are counted.
- `ponytail:` note: a devnet BONDR on its pool stays uncapped.
- Tests in `trade-quote.test.ts` and `trade-prepare.test.ts`.

### S-WR-05: no test for the double-submit race
**Commit:** a1c3f32
- New test: two concurrent `submitTrade` calls wait on one deferred `getBlockHeight`. It asserts exactly one broadcast, with states `sent` and `signed`.
- Mutation check: with the re-read after the await removed, the test fails.

### S-IN-02: the D-08 priority cap was defined twice
**Commit:** 74ca75b
- `MAX_PRIORITY_LAMPORTS` is now exported from `trade-quote.ts`. Prepare imports it, and `NETWORK_MAX` derives from it.

### S-IN-05: routeQuote over 40 lines
**Commit:** 3a284a8
- The fee breakdown moved into `feesFor(a, bondrRates, coinRates, mid, out)`. routeQuote is now 34 lines.

## Client follow-ups for the orchestrator (not edited: client files)

- `apps/web/components/trade-amount.tsx:92` and `apps/web/e2e/trade.e2e.ts:192` say "so BONDR stays on its curve". After S-WR-04 the cap can come from the coin's own curve. Suggested copy: "On devnet, buys stay under {max} SOL so the curves stay open."
- S-WR-01 adds no new error codes. Trades can now answer `slippage` for pump 6002/6003 and AMM 6040, and launches never get `slippage`. That matches the existing copy.

---

_Fixed: 2026-10-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
