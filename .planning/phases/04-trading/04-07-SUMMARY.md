---
phase: 04-trading
plan: 07
subsystem: trading
tags: [web-routes, session, csrf, rate-limit, unstubbed-e2e]
requires:
  - "04-06 worker routes POST /trade/prepare, /trade/submit, /trade/view"
  - "web lib guard.ts (sameOrigin, json, rateLimited), session.ts (sessionWallet, consentRequired), worker.ts (workerPost)"
provides:
  - "POST /api/trade/prepare: session-wallet prepare proxy"
  - "POST /api/trade/submit: session-wallet submit proxy"
  - "GET /api/trade/{id}: poll proxy to worker /trade/view, worker memory only"
  - "apps/web/e2e/trade-routes.e2e.ts: four unstubbed guard tests"
affects: [04-08]
tech-stack:
  added: []
  patterns: ["GET routes refuse only a present, foreign Origin (same-origin browser GETs carry none)"]
key-files:
  created:
    - apps/web/app/api/trade/prepare/route.ts
    - apps/web/app/api/trade/submit/route.ts
    - apps/web/app/api/trade/[id]/route.ts
    - apps/web/e2e/trade-routes.e2e.ts
  modified:
    - apps/web/e2e/README.md
decisions:
  - "Trade submit has no web-side ownership read (unlike launch submit): the session wallet is forwarded and the worker's 404 for another wallet's trade plus its signer check decide, so web touches no database"
  - "The poll counts the IP before the session check, so an unauthenticated poll loop is still rate limited"
metrics:
  duration: 8 min
  completed: 2026-10-24
  tasks: 2
  files: 5
---

# Phase 4 Plan 07: Trade web routes Summary

Consented browsers can now prepare, submit and poll a trade through three guarded web routes. Each takes the wallet from the session cookie only. An unstubbed Playwright spec shows the CSRF, session, body-wallet and rate-limit guards working against the real local web and worker on devnet.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Prepare, submit and poll routes | e8e21b0 | trade/prepare, trade/submit, trade/[id] route.ts |
| 2 | Unstubbed guard spec for the trade routes | 71ae6b2 | trade-routes.e2e.ts, e2e README |

## Guard order

- prepare: sameOrigin (403), then rateLimited "trade-prepare" at 30 per 10 min (per IP, then per wallet), then consent_required, then json(1 KB) (400), then whitelist side, mint, amount and slippageBps, then workerPost /trade/prepare with the session wallet (15 s).
- submit: the same order with "trade-submit" at 30 per 10 min and json(4 KB). tradeId and signed must be strings. Then workerPost /trade/submit with { tradeId, signed, wallet } (20 s).
- GET {id}: force-dynamic. A present, foreign Origin is 403. An id that does not match /^[0-9a-f]{32}$/ is 404 not_found. Then "trade-view" at 240 per minute, then consent_required, then workerPost /trade/view. No database or chain read (D-04). Every reply is no-store.

## Verification

- `pnpm exec playwright test apps/web/e2e/trade-routes.e2e.ts`: 4 passed (20 s). Tests: cross-origin 403 on all four routes; no session gives consent_required on prepare, submit and poll; body wallet ignored (402 insufficient_balance for a 0 SOL session wallet while the body names the funded sim dev); 30 consent_required answers, then 429 rate_limited.
- `pnpm typecheck`, `pnpm lint`: pass.
- Acceptance greps: 3 `sessionWallet(req)` lines; no `body.wallet` under api/trade; no `@/lib/db|launchView` in the poll route; no `page.route|stubTrade` in the spec; 8 lines match the status and error code pattern.
- No Phase 2 or Phase 3 screenshots changed (this spec takes none).

## Deviations from Plan

None. The plan was executed as written. The spec was run through `biome format` once to pass lint.

## Notes for the orchestrator

- TRADE-01..03 are not marked complete. The routes exist, but the panel does not call them yet (signing UI is a later plan), so per the owner rule the UI does not ship them yet.
- During the run the worker logged `backfill 07b0c060... failed: Invalid param: WrongSize` / `tx not found`. That is indexer backfill noise on a stored id, unrelated to this plan.

## Known Stubs

None.

## Threat Flags

None. All three routes are in the plan's threat register (T-04-07-01..05).

## Self-Check: PASSED
