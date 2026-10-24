---
phase: 04-trading
plan: 06
subsystem: trading
tags: [submit, byte-compare, send, settle, worker-routes]
requires:
  - "04-04 trade-store (getTrade, updateTrade), prepareTrade (TradeCtx), trade-error textError"
  - "core cosign.ts sameMessage, slot, signatureOk, signatureOf; send.ts broadcast, fetchMeta"
provides:
  - "worker trade-submit.ts: submitTrade, viewTrade, background settleTrade"
  - "core send.ts: settle exported"
  - "core trade.ts: tokenDelta, lamportDelta (moved from the spike)"
  - "worker routes POST /trade/prepare, /trade/submit, /trade/view"
affects: [04-07]
tech-stack:
  added: []
  patterns: ["re-read the store entry after every await, then mark signed synchronously, so a concurrent submit only reads"]
key-files:
  created:
    - apps/worker/src/trade-submit.ts
    - apps/worker/src/trade-submit.test.ts
  modified:
    - packages/core/src/send.ts
    - packages/core/src/trade.ts
    - packages/core/src/README.md
    - scripts/spike/stages/multihop.ts
    - scripts/spike/stages/prebond.ts
    - scripts/spike/stages/finalize.ts
    - apps/worker/src/main.ts
    - apps/worker/src/README.md
    - apps/worker/src/trade-prepare.test.ts
decisions:
  - "A refused submit (expired or message_changed) also fails the store entry with that code, so a later view tells the same story"
  - "submitTrade and prepareTrade are routed with tctx (Ctx & { net }), not pctx: submit needs only conn, prepare needs net (04-04 decision)"
  - "A preflight rejection maps r.err through textError (the hex custom code in the text gives 6004 slippage); an on-chain failure maps r.code 6004 to slippage, anything else to onchain"
metrics:
  duration: 10 min
  completed: 2026-10-24
  tasks: 2
  files: 11
---

# Phase 4 Plan 06: Trade submit, settle and worker routes Summary

The worker now sends only the exact transaction it prepared, signed by the wallet that asked for it, exactly once. It settles that transaction in the background and serves the result (landed amount, failure code or unknown signature) from memory through three new routes. A live devnet prepare simulates clean.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Submit, settle and view in the worker | e4b0bae | trade-submit.ts and its test, send.ts, trade.ts, core README, multihop/prebond/finalize spike stages |
| 2 | Worker trade routes and a live devnet prepare | 1c93eda | main.ts, worker README, trade-prepare.test.ts |

## submitTrade gate order

1. Parse: tradeId must match `/^[0-9a-f]{32}$/`, `walletOf(wallet)` must pass, and the base64 wire must be 1 to 1,232 bytes. Anything else is 400 invalid_input.
2. Ownership: a missing or swept entry, or another wallet's entry, is 404 not_found. An entry that is no longer `prepared` returns its view, so a repeat submit only reads.
3. `getBlockHeight`, then the entry is read again. A concurrent submit may have moved it during the await. Past `lastValidBlockHeight` the entry is failed with `expired` and the answer is 410.
4. `sameMessage(e.message, wire, 1)` and `signatureOk(e.message, slot(wire, 0), e.wallet)`. If either fails, the entry is failed with `message_changed` and the answer is 422.
5. The entry is marked `signed`, then `broadcast` runs with a 1,100 ms pace. A preflight `failed` maps its error to a code through `textError`. Otherwise the state is `sent` and a logged `void settleTrade` runs.
6. settleTrade runs core `settle`. `unknown` keeps its signature and is never resent. `failed` becomes 6004 slippage or else onchain. `landed` calls `fetchMeta` once and records `amountOut`: `tokenDelta` for a buy, `lamportDelta` for a sell.

## Live devnet prepare (TRADE_LIVE=1)

Coin `GoJKjYdyaGwNs82NrMM2xRJm19U5ZRLkx16Rbcjpbndr` (newest landed real curve coin), 0.01 SOL buy for the sim dev wallet, simulated with `sigVerify: false`. Nothing was signed or sent.

| Fact | Value |
|------|-------|
| sim err | null |
| CU limit | 174,059 |
| units consumed (re-simulation of the returned wire) | 158,235 |
| priority price | 1,000 micro-lamports |
| wire bytes | 1,110 (message 1,045) |

## Verification

- `pnpm vitest run apps/worker/src/trade-submit.test.ts packages/core/src`: 15 files, 119 passed
- `pnpm vitest run apps/worker/src packages/core/src`: 31 files, 201 passed, 1 skipped (the live test)
- `TRADE_LIVE=1 pnpm vitest run apps/worker/src/trade-prepare.test.ts -t live`: passed
- `pnpm typecheck`, `pnpm lint`: pass
- Acceptance: 1 `export async function settle` in send.ts; no `function tokenDelta|const lamportDelta` in multihop.ts and 1 `@bondr/core/trade` import; no `sendRawTransaction` in trade-submit.ts; core README diff 1+/1-; worker README diff 1+; 3 trade routes in main.ts. trade-submit.ts is 104 lines.

## Deviations from Plan

1. **[Rule 3 - Blocking] The spike's prebond.ts and finalize.ts imported tokenDelta from multihop.ts.** Both now import it from `@bondr/core/trade`. Without that change, deleting the local copy breaks them.
2. **[Rule 1 - Bug] Live test coin pick.** "Newest curve coin" by `launched_at` returned a fake row on the dev branch (mint `pD4p9z...` decodes to 33 bytes, bonding_curve `curve`, pool `pool`). The live test now uses the e2e query instead (landed launch, curve venue, name not `E2E %`, newest `created_at`). The fake row was left in place: deleting data is not routine.
3. **[Rule 1 - Bug] Concurrent submit race.** Pattern 5 checks the state before the `getBlockHeight` await only. The entry is now read again after the await, so two concurrent submits cannot both broadcast.
4. **Worker README:** 04-04 already added lines for trade-store.ts and trade-prepare.ts, so the single new line names trade-submit.ts only.
5. **Routes use tctx, not pctx** (see decisions). Submit needs only `conn`, and prepareTrade's type is `Ctx & { net }`.

## TDD Gate Compliance

RED ran and failed for Task 1 (module missing) before the implementation. The failing test was not committed separately: AGENTS.md forbids commits that leave tests red, the same choice as 04-04. Task 1 is one `feat(04-06)` commit.

## Notes for the orchestrator

- On the first full run, one test file in `packages/core/src` failed and 6 tests were skipped. Three reruns passed 15/15. It looks like a timing flake in a slow core test, not caused by this plan.
- The dev branch `coins` table holds a fake row (`pD4p9z...`, launched 2026-10-23T23:43Z) that any "newest coin" query without the launches join will pick.

## Known Stubs

None. The web routes are 04-07, as planned.

## Threat Flags

None. Every new surface (the submit relay, settle, view) is in the plan's threat register.

## Self-Check: PASSED
