---
phase: 04-trading
plan: 04
subsystem: trading
tags: [prepare, simulate, compute-budget, priority-fee, error-map, tdd]
requires:
  - "04-02 parseTrade, maxSolIn, trade-state mintState and configs, walletOf"
  - "core route.ts routeBuy / routeSell, send.ts budget, checkMessage, messageSize"
provides:
  - "core trade-error.ts: tradeError(err, logs), textError(message), the one launch and trade error map"
  - "worker trade-store.ts: putTrade, getTrade, updateTrade (120 s TTL, 5,000 cap)"
  - "worker trade-prepare.ts: prepareTrade, cuLimitFor, priorityMicroLamports, TradeCtx"
affects: [04-06, 04-07]
tech-stack:
  added: []
  patterns: ["one compile after the blockhash, stored bytes equal returned message", "Map-ordered TTL store with sweep on insert"]
key-files:
  created:
    - packages/core/src/trade-error.ts
    - packages/core/src/trade-error.test.ts
    - apps/worker/src/trade-store.ts
    - apps/worker/src/trade-store.test.ts
    - apps/worker/src/trade-prepare.ts
    - apps/worker/src/trade-prepare.test.ts
  modified:
    - packages/core/src/send.ts
    - packages/core/src/README.md
    - apps/worker/src/build.ts
    - apps/worker/src/trade-quote.ts
    - apps/worker/src/README.md
decisions:
  - "prepareTrade takes TradeCtx = Ctx & { net } (main.ts tctx shape), not PrepareCtx: it needs only priorityFee and net, both already on tctx"
  - "The 1.4M CU simulation carries the env priority fee (capped); the estimator is called once, after the CU limit is known, so the clamp uses the final limit"
  - "tradeError falls back to the log-parsed code (send.ts fromLogs) when err has no Custom code, so a text error that only carries 'custom program error: 0x1774' still maps"
  - "Launch simulation now maps a dead blockhash to expired and 6004 to slippage (web launch copy already handles both: expired has its own copy, slippage falls to Build failed)"
metrics:
  duration: 8 min
  completed: 2026-10-24
  tasks: 2
  files: 11
---

# Phase 4 Plan 04: Trade prepare Summary

The worker can now turn a validated buy or sell into one unsigned, simulated, compute-budgeted v0 transaction with the wallet as fee payer, and it keeps the exact message bytes for submit's byte compare. Launch and trade share one tested error map in core.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | One error map for simulation, preflight and on-chain failures | c561256 | trade-error.ts, trade-error.test.ts, send.ts, build.ts, core README |
| 2 | Trade store and prepareTrade | 303662b | trade-store.ts, trade-prepare.ts, both tests, trade-quote.ts, worker README |

## What prepareTrade does

1. `parseTrade` plus `walletOf(body.wallet)` (400 without one).
2. On devnet, a buy above `maxSolIn` (from the cached BONDR state) is refused with `invalid_input` before any route call (Pitfall 4).
3. `routeBuy` / `routeSell` on `[SOL, Q, C]` or `[C, Q, SOL]`; a throw goes through `textError`.
4. Simulates `budget(1_400_000, env price) + route ixs` with `sigVerify: false, replaceRecentBlockhash: true`; `err` goes through `tradeError` (6004 is 409 slippage, custom 1 low lamports is 402).
5. `cuLimit = ceil(units * 11 / 10)` (integer math), priority from `priorityMicroLamports` (devnet: env, mainnet: Helius `getPriorityFeeEstimate` Medium on the route's writable keys, env on any error, clamped so price x limit <= 500,000 lamports).
6. `getLatestBlockhash`, one compile of `budget(cuLimit, price) + route ixs`, `checkMessage` and `PACKET_LIMIT` (else `build_failed`), `putTrade` of `msg.serialize()`, returns `{ tradeId, tx, signBy, expectedOut, minAmountOut }`.

## Verification

- `pnpm vitest run packages/core/src/trade-error.test.ts apps/worker/src`: 15 files, 76 passed (after Task 1)
- `pnpm vitest run apps/worker/src/trade-store.test.ts apps/worker/src/trade-prepare.test.ts`: 12 passed
- `pnpm test`: 40 files, 256 passed, 1 skipped
- `pnpm typecheck`, `pnpm lint`: pass
- Acceptance: no `function simError` in build.ts; send.ts 281 lines; ponytail line in trade-store.ts; no `prepare(pctx|singleFlight|queue` in trade-prepare.ts; trade-prepare.ts 166 lines, trade-store.ts 55, prepareTrade 32 lines
- Not run live: no devnet simulation in this plan (the live devnet check is 04-06)

## Deviations from Plan

1. **[Rule 3 - Blocking] TradeCtx instead of PrepareCtx.** `PrepareCtx.env.net` is typed `"devnet"` only, so the mainnet branch of the cap and the estimator could not be typed or tested through it. `prepareTrade` takes `Ctx & { net: TradeNet }`, which main.ts already builds as `tctx`; `TradeNet` is now exported from trade-quote.ts.
2. **[Rule 2 - Correctness] updateTrade patches only the outcome** (`state`, `signature`, `amountOut`, `code`), so no later caller can change a stored wallet or message bytes.
3. **[Rule 2 - Correctness] Extra prepare test:** a route ix outside the program allowlist is refused with `build_failed`.
4. **Worker README** gained lines for trade-store.ts and trade-prepare.ts (AGENTS.md directory README rule); not in files_modified.

## TDD Gate Compliance

RED was run and failed for both tasks (modules missing) before implementation, but the failing tests were not committed on their own: AGENTS.md forbids commits that leave tests red (same as the Phase 1 choice). Each task is one `feat(04-04)` commit holding tests and code.

## Known Stubs

None. prepareTrade is not routed yet; 04-06 adds the worker route and 04-07 the web route, as planned.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: outbound-rpc | apps/worker/src/trade-prepare.ts | Mainnet-only POST of getPriorityFeeEstimate to the connection endpoint (carries the Helius key in its URL); errors are logged through redact and never returned. Covered by T-04-04-07; mainnet is off until Phase 7. |

## Self-Check: PASSED
