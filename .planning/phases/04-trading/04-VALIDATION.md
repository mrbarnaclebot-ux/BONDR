---
phase: 4
slug: trading
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-24
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 04-RESEARCH.md, Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (units), Playwright 1.63.0 (e2e) |
| **Config file** | none for Vitest (colocated `*.test.ts`); `playwright.config.ts` at the root |
| **Quick run command** | `pnpm vitest run <touched test files>` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` |
| **Estimated runtime** | about 90 s for units, about 4 min for e2e |

---

## Sampling Rate

- **After every task commit:** the quick run command for the files the task touched
- **After every plan wave:** `pnpm lint && pnpm typecheck && pnpm test` plus the stubbed `trade.e2e.ts`
- **Before `/gsd:verify-work`:** full suite green, the devnet group and the fork rows passed
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

The planner fills task ids. Requirement-to-test map from research:

### Plan and task map
| Test | Created in | Run by |
|------|------------|--------|
| `packages/core/src/quote.test.ts` | 04-01 T2 | 04-01 T2, 04-08 T2 |
| `apps/web/e2e/trade-stubs.ts`, `trade.e2e.ts` (quote preview, red) | 04-01 T1 | 04-02 T3 (green), 04-03 T1-T3, 04-07 T3, 04-09 T1-T2 |
| `apps/worker/src/trade-state.test.ts` | 04-02 T1 | 04-02 T1-T2 |
| `apps/worker/src/trade-quote.test.ts` (request parsing, maxSolIn, balance) | 04-02 T2 | 04-02 T2 |
| `trade.e2e.ts -g "devnet quote"` (no spend) | 04-02 T3 | 04-02 T3 |
| `packages/core/src/trade-error.test.ts` | 04-04 T1 | 04-04 T1 |
| `apps/worker/src/trade-store.test.ts`, `trade-prepare.test.ts` (CU, priority clamp, devnet cap, message shape; `TRADE_LIVE=1` devnet simulation) | 04-04 T2-T3 | 04-04 T2-T3 |
| `apps/web/e2e/trade-sheet.e2e.ts` | 04-05 T2 | 04-05 T2, 04-07 T3, 04-11 T2 |
| `apps/worker/src/trade-submit.test.ts` | 04-06 T1 | 04-06 T1-T2 |
| `apps/web/lib/trade-button.test.ts` | 04-07 T2 | 04-07 T2 |
| `trade.e2e.ts -g devnet` (real buy and sell, at most 0.05 SOL) | 04-07 T3 | 04-07 T3, 04-11 T2 (staging) |
| Fork rows `bonded.multihop.*`, `pooled.multihop.*` with `pureQuote` | 04-08 T1 | 04-08 T2 |
| `apps/web/e2e/responsive-trade.e2e.ts` | 04-10 T1 | 04-10 T1-T2, 04-11 T2 (staging) |
| Bundle gate `pnpm check:bundle` | exists | 04-02 T3, 04-06 T2, 04-10 T2 |

Note: the request-parsing row below lives in `trade-quote.test.ts` (04-02), because `parseTrade` is shared by quote and prepare; the devnet `maxSolIn` refusal is in `trade-prepare.test.ts` (04-04).

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRADE-03 | Masked curve hop reproduces fixture hops exactly (buy and sell), pre-state rebuilt from TradeEvent post reserves via `innerEvents` | unit | `pnpm vitest run packages/core/src/quote.test.ts` | no, Wave 0 |
| TRADE-03 | Route quote: protocol only on the SOL hop, creator only on the coin hop, LP only on a coin pool hop, for buy and sell and all four venue combinations | unit | same | no, Wave 0 |
| TRADE-03 | Price impact near 0 for 1 lamport, increasing with size; minimum received equals `applyBps(out, 10000 - slippage)` | unit | same | no, Wave 0 |
| TRADE-03 | Cache: concurrent quotes in one 2 s window cost one read; a failed read is not cached | unit | `pnpm vitest run apps/worker/src/trade-state.test.ts` | no, Wave 0 |
| TRADE-01/02 | Submit refuses a changed byte, a wrong signer, another session wallet, an expired entry; a repeat submit returns the same view | unit | `pnpm vitest run apps/worker/src/trade-submit.test.ts` | no, Wave 0 |
| TRADE-01/02 | Error map: 6004, custom 1 + "insufficient lamports", AccountNotFound, 6107, 6005, unknown code (fed the verified probe shapes) | unit | `pnpm vitest run packages/core/src/trade-error.test.ts` | no, Wave 0 |
| TRADE-01/02 | CU limit is `ceil(units * 1.1)`; priority clamp keeps price x limit at or under 500,000 lamports; devnet uses the env value; estimate failure falls back | unit | `pnpm vitest run apps/worker/src/trade-prepare.test.ts` | no, Wave 0 |
| TRADE-01/02 | Request parsing: side, amount bounds, slippage 10-5000 bps, unknown mint 404, BONDR mint refused, devnet buy above `maxSolIn` refused, mainnet uncapped | unit | same | no, Wave 0 |
| TRADE-01..03 | Web routes: same-origin 403, no session 403 consent_required, body wallet ignored, 429 after the limit | unit + e2e | `pnpm vitest run apps/web/lib/guard.test.ts` and `pnpm e2e apps/web/e2e/trade.e2e.ts` | partial (guard.test.ts exists) |
| TRADE-03 | Panel states with stubbed `/api/trade/*`: not connected full quote, ready buy and sell, impact 5% and 15% states, migration pause, quote paused after 60 s (`page.clock`), every result callout, rejected signature (`injectPhantom(..., { reject: true })`) | e2e | `pnpm e2e apps/web/e2e/trade.e2e.ts` | no, Wave 0 (`trade-stubs.ts`) |
| TRADE-01/02 | Real devnet buy 0.01 SOL then sell 100% on the newest curve coin, signed by the fake Phantom with the sim dev key; the row appears in the feed within 15 s; spend at most 0.05 SOL | e2e (devnet) | `E2E_DEVNET=1 pnpm e2e apps/web/e2e/trade.e2e.ts -g devnet` | no, Wave 0 |
| TRADE-04 | Fork: SOL to Q curve to C2 pool, and SOL to Q pool to C2 pool, buy and sell land; facts record `pureQuote` next to `expectedOut` (simulation) and `outAmount`; rule: `pureQuote == outAmount` within 1 base unit | fork spike rows | `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike` (add `multihopStage("C2", "bonded.")` after `finalizeStage` and `multihopStage("C2", "pooled.")` last in nets/fork.ts) | no, Wave 0 |
| TRADE-04 | No BONDR program, account or transfer in the built message beyond the route (platform fee 0): `checkMessage` allowlist plus a test that the instruction list equals `[budget..., ...routeIxs]` | unit | `pnpm vitest run apps/worker/src/trade-prepare.test.ts` | no, Wave 0 |
| UI | 390, 768, 1440 screenshots, 0 axe violations for the UI-SPEC state list | e2e | `pnpm e2e apps/web/e2e/responsive-trade.e2e.ts` (through `shoot.ts gate`) | no, Wave 0 |
| Bundle | No pump SDK or web3.js in the client bundle | script | `pnpm --filter @bondr/web build && pnpm check:bundle` | yes |

*Status: pending until the executor runs each command*

---

## Wave 0 Requirements

- [ ] `packages/core/src/quote.test.ts` with a fixture helper that rebuilds pre-trade curve state from `multihop-buy.json` / `multihop-sell.json` events
- [ ] `packages/core/src/trade-error.test.ts` with the probe's error shapes as literals
- [ ] `apps/worker/src/trade-state.test.ts`, `trade-prepare.test.ts`, `trade-submit.test.ts` (stub `Connection` like `prepare.test.ts` and `submit.test.ts` do)
- [ ] `apps/web/e2e/trade-stubs.ts` (page.route stubs for quote, balance, prepare, submit, view) and `trade.e2e.ts`
- [ ] Fork rows `bonded.multihop.*` and `pooled.multihop.*` with a `pureQuote` fact; `tokenDelta`/`lamportDelta` moved to core

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One devnet trade through the real Phantom extension on staging | TRADE-01, TRADE-02 | The Playwright mock cannot prove the real extension leaves the message bytes unchanged (research A5) | On staging, connect Phantom (devnet), buy 0.01 SOL of a curve coin, then sell 100%; both rows appear in the feed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
