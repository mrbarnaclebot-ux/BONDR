---
phase: 07-go-live
plan: 06
subsystem: worker vanity, status; web chrome
tags: [vanity, production-lane, status, mainnet-web, tdd]
requires: [07-04]
provides:
  - "Lane = local | staging | production (vanity.ts); VANITY_LANE accepts the three"
  - "grind.ts REFILL per lane and exported refillNeed(lane, ready): production 100/150, local and staging 10/20"
  - "status Ctx.net ('devnet' | 'mainnet'); /status reports it"
  - "main.ts logs `wallets: ops=... buyback=... treasury=...` (public keys) at listening"
affects: [07-xx production runbook (G-3/G-4 read the ops address from the logs), any status Ctx literal]
key-files:
  created:
    - apps/worker/src/grind.test.ts
  modified:
    - apps/worker/src/vanity.ts
    - apps/worker/src/env.ts
    - apps/worker/src/env.test.ts
    - apps/worker/src/grind.ts
    - apps/worker/src/status.ts
    - apps/worker/src/status.test.ts
    - apps/worker/src/main.ts
    - apps/worker/src/admin-money.ts
    - scripts/devnet-launch.ts
    - apps/web/components/wallet.tsx
    - apps/worker/README.md
key-decisions:
  - "07-06: the status Ctx carries net, so the trade routes reuse the one ctx (tctx removed)"
  - "07-06: production refill targets are fixed 100/150 in code (ponytail: env-tunable if demand varies)"
requirements-completed: []
duration: 25min
completed: 2026-10-26
---

# Phase 7 Plan 06: Production Vanity Lane, Real Net in /status, Mainnet Web Chrome Summary

**VANITY_LANE accepts `production`. That pool refills to 150 whenever fewer than 100 mints are ready, so it can reach the 100 free mints the child-launch gate needs. /status reports the worker's real net. A web build with SOLANA_NET=mainnet serves `/`, `/terms` and `/launch` with no Devnet badge and no `cluster=devnet` link.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Production vanity lane and per-lane refill targets | 6fe777e |
| 2 | Real net in /status and the mainnet web chrome check | 8f361d1 |

## Evidence

- grind.test.ts (new, unit): refillNeed production 99 gives 51, production 100 gives 0, staging 9 gives 11, local 10 gives 0. env.test.ts: production is accepted and "prod" is refused, naming VANITY_LANE. Red was checked before each change.
- status.test.ts: liveStatus reports net "mainnet", then "devnet" once the 5 s cache has passed. The switches module is mocked and the chain read fails on purpose. Red was checked (it returned "devnet").
- `! rg 'net: "devnet" as const' apps/worker/src/status.ts`: passes. `production: [100, 150]` and a `ponytail:` comment are in grind.ts. grind.ts is 157 lines and env.ts is 152.
- **Mainnet web chrome check.** The build ran in apps/web with every WEB_ENV name set explicitly, so nothing came from the root .env: SOLANA_NET=mainnet, DATABASE_URL pointing at a dead 127.0.0.1:1, SITE_URL http://127.0.0.1:3100, WORKER_URL http://127.0.0.1:1, dummy WORKER_TOKEN and SESSION_SECRET, the rest empty. Then `pnpm exec next build` (exit 0) and `next start -p 3100`.
  - `curl` results: `/` 200, `/terms` 200, `/launch` 200. Each had 0 matches for `>Devnet<` and 0 for `cluster=devnet`.
  - Control: the same build restarted with SOLANA_NET=devnet gave `/` 1 Devnet badge and 1 `cluster=devnet`, so the probe detects devnet chrome. `/terms` is prerendered, so it carries the build-time net.
  - The server was stopped and apps/web/.next deleted, so later local runs use a dev build.
- `pnpm typecheck`, `pnpm lint`: clean.

## Deviations from Plan

1. **[Rule 3 - Blocking] status Ctx gained a required `net`, so two other Ctx builders had to set it:** admin-money.ts `adminBase` and scripts/devnet-launch.ts.
2. **[Docs] The worker README env line now describes SOLANA_NET as devnet, or mainnet with ALLOW_MAINNET=1 and TREASURY_PUBKEY**, and names TREASURY_PUBKEY. This was a 07-04 leftover, fixed together with the Vanity lanes paragraph.

## Notes for later plans

- The production runbook can read the ops, buyback and treasury public keys from the `wallets:` line in the production worker logs.
- Any new status `Ctx` literal needs `net`.

## Threat Flags

None. T-07-06-01..04 are handled as planned.

## Self-Check: PASSED

- FOUND apps/worker/src/grind.test.ts
- FOUND commits 6fe777e, 8f361d1
