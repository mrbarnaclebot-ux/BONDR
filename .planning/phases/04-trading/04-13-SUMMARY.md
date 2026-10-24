---
phase: 04-trading
plan: 13
subsystem: ops
tags: [staging, deploy, railway, devnet, sign-off]
requires:
  - phase: 04-09
    provides: "fork rows for the PumpSwap routes"
  - phase: 04-12
    provides: "responsive-trade.e2e.ts and the staging-aware trade-sheet.e2e.ts"
provides:
  - "Staging runs the Phase 4 build at f1a6949: worker 7c6377e9, web 389cdab8"
  - "23 Phase 4 -staging screenshots"
  - "trade.e2e.ts devnet group runs against staging (E2E_BASE_URL)"
affects: [phase-4 sign-off, phase-7 economics]
key-files:
  modified:
    - apps/worker/README.md
    - apps/web/e2e/trade.e2e.ts
    - apps/web/e2e/trade-sheet.e2e.ts
  created:
    - .planning/phases/04-trading/screenshots/ (23 -staging.png)
key-decisions:
  - "04-13: the worker deploys before web (no new migration), and staging runs exactly one worker replica because trades live in worker memory (D-07)"
  - "04-13: on staging the devnet trade group takes the first curve coin of /api/coins?sort=top, and the sim wallet keeps its staging consent row"
  - "04-13: the seeded trade panel group in trade.e2e.ts is local only, because -g devnet also matched its devnet cap test"
requirements-completed: [TRADE-01, TRADE-02, TRADE-03, TRADE-04]
duration: 12min
completed: 2026-10-24
---

# Phase 4 Plan 13: Staging Deploy and Sign-off Summary

**Staging runs the Phase 4 build on devnet. The worker and web both deployed on the first try. All 29 tests in the staging trade matrix passed. A real 0.01 SOL buy and a 100% sell went through the staging panel, and each row showed in the staging feed within 3 s of blockTime. The sim wallet ended up with more SOL than it started with.**

## Task 1: deploy and smoke

| Step | Id | Result |
|---|---|---|
| worker | 7c6377e9-a31f-4c92-bf0b-874a0cd7c4ad | SUCCESS, about 2.7 min (16:13:48 to 16:16:29 UTC). Log: "worker listening on devnet", "backfilled 0 launches", "stream subscribed" |
| web | 389cdab8-0905-41ba-a39c-1139acf5f8ea | SUCCESS, about 2 min (16:16:38 to 16:18:31 UTC). Pre-deploy said "migrations applied" (none were new), then Next 16.3.8 was ready |

- The order was worker first, then web. No migration is new, and web's trade routes call new worker endpoints.
- `/api/health` returned `{"ok":true}`. `/api/status` returned net devnet, fees 95/30 bps and `paused: null`.
- Quote smoke: `POST /api/trade/quote` with the staging Origin, EX8EUJ, buy, 10,000,000 lamports and 100 bps. It returned **HTTP 200 in 0.46 s**: `amountOut` 64994897587225, impact 0.10%, route `{bondr: curve, coin: curve}`, bondrHop protocol 95 / creator 0, coinHop creator 30, **`platformFee` "0"**, totalSol 122895 and `maxSolIn` 738169628.
- Only the staging `worker` and `web` services were deployed. No variable was changed or printed. No other Railway project or environment was touched.
- README: added the five `/trade/*` worker routes. Trade routes need no new variable and no migration. Staging must run exactly one worker replica, because prepared trades live in that worker's memory (D-07).

## Task 2: staging responsive and sheet matrix

- `responsive-trade.e2e.ts` and `trade-sheet.e2e.ts` with `E2E_BASE_URL=https://web-staging-72bad.up.railway.app`: **29 passed, 0 skipped**.
- Each state passed at 390, 768 and 1440 with 0 axe violations and no horizontal scroll. The panel layout shift check also passed on staging.
- 23 `-staging.png` screenshots were written (`rg -c "staging\.png$"` = 23).
- The in-flight sheet test was skipped on staging, citing "consent needs the local stubs". `preConsent` is a browser route stub, so the test does not need that skip. It passed 3 of 3 on staging, so the skip was removed (see Deviations).

## Task 3: real devnet buy and sell on staging

Coin: EX8EUJ `CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr`, the first curve coin of staging `/api/coins?sort=top`. Signer: the sim dev wallet 9Hm1...wQM6, through the fake Phantom, with a real staging consent session.

| Run | Trade | Signature | Landed | Feed row after blockTime |
|---|---|---|---|---|
| 1 | Buy 0.01 SOL | 2sfXqGDVduDXGo8tJyucw3iDUBg2J9vPfxaFLDgJFr7YeagvuRLjim4JhEQ5bswzBn7GzZJW3sD7BNtZkuSBbviw | Bought 64,994,897 EX8EUJ | 2.87 s |
| 1 | Sell 100% | 3T58KPgLcbDZ4YRYeJjpvaXFGBazwTexyLu17S7GMP5spJmfk62Jgn9smxv7GvLvFjaTYeijv1YJsXHeXj156pyn | Sold for 0.0281 SOL | 2.44 s |
| 2 | Buy 0.01 SOL | 2z4Tkas4Mtk8U2SsZCCTTT9m5LWKbxXqwvrjK63vRcU2fZjXqV7B7JtmqppZonaFuAPx2Nxyb9D45rmaEb9mMshM | Bought 101,582,154 EX8EUJ | 2.27 s |
| 2 | Sell 100% | 2Qdm2BS8T9L8NdAYAQuwP3vDkJxdekxBow8YCRzm5dNCMZVeD7uYecdBrPPueWJxov5nwRTz5FtiVHcBF9evf6E6 | Sold for 0.0098 SOL | 2.92 s |

- In run 1, both devnet tests passed. `-g devnet` also matched the seeded `trade panel › devnet cap` test, which cannot seed staging, so that test failed. That group is now local only. Run 2 is the plan's exact verify command: **2 passed, 1 skipped** (the run-2 table rows above).
- Run 1's sell returned 0.0281 SOL because it also sold the EX8EUJ left over from the 03-15 live buy. It also includes the token account rent refund (see the 04-10 note on `lamportDelta`).
- Balances: the sim wallet held 0.069693 SOL before, 0.087791 SOL after run 1 and 0.087536 SOL after run 2. Net spend was **-0.017843 SOL**, a gain, against the 0.05 cap. Gross outlay was 2 buys of about 0.010005 SOL each. No top-up was needed, because the sim held at least 0.03 SOL. Ops held **2.750788 SOL** before and after, unchanged.
- The sim wallet keeps its staging consent row. It is a devnet test wallet, and the runner cannot reach the staging database.
- Local regression check: `trade.e2e.ts` and `trade-sheet.e2e.ts` gave 14 passed and 2 skipped (the devnet group). Nothing is left listening on 3000 or 8080.
- Neon: both endpoints showed `active` at 16:24:49 UTC, right after the runs, at 0.25 CU max. Nothing reads the database on a timer, so they suspend on the default timeout. That was not re-polled.

## ROADMAP Phase 4 criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Buy routed SOL to BONDR to coin in one Phantom signature, shown in the feed | Staging buys 2sfXqGDV and 2z4Tkas4: one signTransaction each, feed rows at 2.9 s and 2.3 s. 04-10 devnet buys 5kPDWXxA and 3fdXMTv7 |
| 2 | Sell back to SOL the same way | Staging sells 3T58KPgL and 2Qdm2BS8, feed rows at 2.4 s and 2.9 s. 04-10 devnet sell 4YUeoUEX |
| 3 | Quote preview (tokens out, impact, fees) and slippage before signing | The staging quote smoke and the 29-test staging matrix (trade-buy and the fee breakdown, both impact states, slippage chips). Locally, trade.e2e.ts covers the preview, slippage persistence and fee rows |
| 4 | Curve and migrated PumpSwap coins, fees match live FeeConfig, no platform fee | Curve: the staging and 04-10 devnet trades, plus the quote's masked rates (95/0 and 0/30). PumpSwap: the 04-09 Surfpool mainnet fork rows `bonded.multihop.buy/sell` and `pooled.multihop.buy/sell`, where the quote equals the landed amount to the base unit and the live pool creator 150 bps and LP 20 bps were charged as quoted. `platformFee` is "0" everywhere |

## For the owner

1. **HV-04-01 (manual, does not block the phase).** Make one devnet trade through the real Phantom extension on staging. Steps: open https://web-staging-72bad.up.railway.app with Phantom set to devnet and connect. Open a curve coin, for example https://web-staging-72bad.up.railway.app/coin/CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr. Buy 0.01 SOL, then sell 100%, and check that both rows appear in the feed. This proves the real extension leaves the message bytes unchanged, which the Playwright mock cannot (research A5). If Phantom does rewrite a message, the worker refuses to submit and shows the "did not match" copy.
2. **Flag (RESEARCH Open Question 2): BONDR earns no creator fee on routed trades.** Under pump's multi-hop fee rules, the SOL to BONDR hop charges only the protocol fee (95 bps) and no BONDR creator fee. The staging quote shows it: `bondrHop.creatorBps` is 0. PROJECT.md economics for BONDR's own launch (Phase 7) should therefore not count routed coin volume toward BONDR's creator fee income. Only direct BONDR trades pay it. Not Phase 4 scope.

## Deviations from Plan

1. **[Rule 1 - Bug] `-g devnet` matched the seeded `devnet cap` test.** On staging, that test's seeded coin does not exist, so the plan's verify command failed. The seeded `trade panel` group now skips when `E2E_BASE_URL` is set. `STAGING` moved to the top of the module because the describe callback reads it. Commit d68f025.
2. **[Rule 1 - Bug] Stale staging skip in `trade-sheet.e2e.ts`.** The in-flight test was skipped on staging, but its consent is a browser route stub. It passed 3 of 3 on staging, so the skip was removed. `trade-sheet.e2e.ts` is not in the plan's file list. Commit 9489a0d.
3. **The devnet group ran twice.** Run 1 landed both trades, but the run also included the failing seeded test. Run 2 is the clean, exact verify. Both runs together stayed far under the 0.05 SOL cap, at a net gain.
4. `trade.e2e.ts` is 299 lines, under the AGENTS.md 300 limit. To fit, the staging coin pick shares a `Coin` type with the SQL path, and the cleanup comment is one line.

## Known Stubs

None.

## Threat Flags

None. T-04-13-01: only the staging web and worker were deployed. T-04-13-02: no variable was changed or printed. T-04-13-03: no top-up was needed, and net spend was negative. T-04-13-05: deployment ids, signatures, timings and balances are recorded above.

## Self-Check: PASSED

- FOUND: e7a9d09, 9489a0d, d68f025; 23 -staging screenshots; apps/worker/README.md, apps/web/e2e/trade.e2e.ts, apps/web/e2e/trade-sheet.e2e.ts
