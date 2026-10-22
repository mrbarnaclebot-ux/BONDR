---
phase: 02-launch-flow
plan: 16
subsystem: ops
tags: [railway, staging, deploy, private-networking, sentry]
requires:
  - phase: 02-14
    provides: Sentry projects bondr-web and bondr-worker, the web boot guard, the sentry-test routes
  - phase: 02-15
    provides: the last web feature before staging
provides:
  - "Railway project bondr, environment staging: web (public) and worker (private only)"
  - "Staging URL https://web-staging-72bad.up.railway.app on devnet"
  - "Staging Neon branch migrated (0000, 0001) with 10 staging-lane bndr mints"
  - ".railwayignore keeping .planning out of railway up"
affects: [02-17, 02-18, phase-03]
tech-stack:
  added: []
  patterns:
    - "Railway service settings set by environment config patch (railway environment edit, JSON on stdin); railway.json is not read for new services"
    - "Secrets set one name per call through --stdin from a scratchpad script that prints names and exit codes only"
key-files:
  created:
    - .railwayignore
  modified:
    - apps/worker/README.md
    - .env.example
key-decisions:
  - "Both services run in US East (us-east4-eqdc4a, Virginia), next to Neon aws-us-east-1, instead of the US West default"
  - "Migrations ran from the Mac against the staging branch while Railway was down; the web pre-deploy then ran them again as a no-op ('migrations applied')"
  - "Staging WORKER_TOKEN and SESSION_SECRET were generated fresh, never copied from local"
requirements-completed: [OPS-01, FEE-10, PLAT-04]
duration: ~9 h wall clock (mostly Railway outage); ~1.5 h active
completed: 2026-10-22
---

# Phase 2 Plan 16: Staging on Railway Summary

**BONDR staging is live at https://web-staging-72bad.up.railway.app on devnet. Web is public, and the worker is reachable only over Railway's private network. The seed and the Helius key exist only on the worker. Both services send errors to Sentry tagged staging, with addresses scrubbed. The staging pool holds 10 ready bndr mints, and the e2e smoke passes against the real URL.**

## Owner approval (Task 1)

The owner approved exactly four steps, through the orchestrator:
1. Create the Railway project.
2. Copy the devnet seed to the worker only.
3. Run the first deploy plus migrations on the staging Neon branch.
4. Run the Sentry test toggle.

The first two runs were blocked: one by the Railway outage, and one by an invalid CLI login, which the owner fixed with `railway login`. No other Railway project (vice-demo, HoodRoyale, rigs or others) was touched.

## What exists on Railway

- **Project `bondr`** (`cf985056-2099-4497-a2c1-1aa639343af4`):
  - **Environment `staging`** (`a6342637-…`). Railway also auto-created an empty `production` environment, which is unused.
  - **`web`** (`bc7c8e5b-…`) has the public domain `web-staging-72bad.up.railway.app`.
  - **`worker`** (`15299d39-…`) has **no domain**. `railway domain list` returns `[]`.
- **Region:** both services run in **US East** (`us-east4-eqdc4a`), moved from the US West default so database calls stay next to Neon in us-east-1.

### Service settings as set on Railway

`railway.json` is no longer read for new services. The files were deleted in a949ca6 with owner approval, so these settings live on the services:

| Setting | web | worker |
|---|---|---|
| Builder | RAILPACK | RAILPACK |
| Build command | `pnpm --filter @bondr/web build` | none (runs from the workspace checkout) |
| Watch patterns | `apps/web/**`, `packages/core/**`, `pnpm-lock.yaml` | `apps/worker/**`, `packages/core/**`, `pnpm-lock.yaml` |
| Start | `pnpm --filter @bondr/web start` | `node apps/worker/src/main.ts` |
| Pre-deploy | `node packages/core/src/migrate.ts` | none |
| Healthcheck | `/api/health`, 120 s | `/healthz`, 120 s |
| Restart policy | ALWAYS | ALWAYS |
| Region | us-east4-eqdc4a, 1 replica | us-east4-eqdc4a, 1 replica |

### Variables (names only; values never printed)

- **worker:** `MASTER_SEED` (base64 of the devnet seed, stdin), `helius_api_key`, `DATABASE_URL` (staging branch), `WORKER_TOKEN`, `SENTRY_DSN`, `SOLANA_NET=devnet`, `VANITY_LANE=staging`, `VANITY_THREADS=1`, `PORT=8080`, `BONDR_QUOTE_MINT`.
- **web:** `DATABASE_URL`, `WORKER_TOKEN`, `SESSION_SECRET`, `pinata_jwt`, `NEXT_PUBLIC_SENTRY_DSN`, `SOLANA_NET=devnet`, `WORKER_URL=http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:${{worker.PORT}}`.
  - A key-only listing of web shows no `MASTER_SEED`, no `helius_api_key` and no `*_SEED`.
  - `SENTRY_TEST_ROUTE` is gone.
- **Fresh values:** `WORKER_TOKEN` (32 random bytes, hex) and `SESSION_SECRET` (48 random bytes, base64url) were generated for staging.
- **Not set:** `PINATA_GATEWAY` is not in `.env`, so the coin image uses the public gateway as it does locally. `PRIORITY_FEE_MICROLAMPORTS` is left at the code default of 1000.

## Step outcomes

1. **Project and services:** done.
2. **Seed to worker only:** done, through stdin. The seed is not on web, in any file, or in any output.
3. **First deploy and migrations:** done.
   - **Migrations:** 0000 and 0001 were applied from the Mac to the staging branch first. A readback showed 2 migrations, `launches_enabled = true` and the `launches_inflight_mint` index present.
   - **Worker deploy:** 9ba395a9, SUCCESS at 15:48 UTC. Its log reads "worker listening on devnet".
   - **Web deploy:** ed054988, SUCCESS at 16:01 UTC. The pre-deploy log reads "migrations applied", then Next 16.3.8 reports ready.
   - **Failed attempts before that:** one upload 520, then four "Failed to snapshot repository" errors (08:05, 08:10, 08:24 and 09:41 UTC) during Railway's platform outage.
4. **Sentry toggle:** done. `SENTRY_TEST_ROUTE=1` was set, and `/api/sentry-test` answered 500 by design.
   - **Events:** both arrived with environment staging and `[addr]`, the raw address absent from the full event JSON, and `ip_address` null.
     - bondr-web `6ca0649bb2164a1681ecf3888846fb93`
     - bondr-worker `e859bd21d7df4f198c7290627caa0fe1`
   - **Removal:** the variable was deleted. The route now answers **404** after the redeploy e977df47.
   - **Second hit:** deleting a variable does not redeploy, so my first 404 check hit the route a second time. That produced one extra web event, `1da960c7d4244a838bb9bb9b70f86aa5`.
   - **Geo:** `user.geo` is filled on these server events. It is the Railway host's location, as noted in 02-14.

## Verification

- **`/api/health`:** `{"ok":true}`.
- **`/api/status`:** net devnet, fees `{"protocolBps":95,"creatorBps":30}`, `paused: null`. It goes through the worker over private networking, so `WORKER_URL` resolves. `launches_enabled` is true, so the `/kill-switch` route was not needed.
- **Client bundle:** 1 of 10 chunks on `/launch` contains the web DSN (string match against `.env`, value not printed), and the client Sentry environment is `staging`.
- **Staging pool:** 10 bndr mints ground from the Mac (4 threads, 1387 s). `grind.ts --check 8` reports "10 ready, 10 stored, 0 bad".
- **e2e smoke:** `E2E_BASE_URL=<staging> pnpm exec playwright test terms wallet launch-form --project chromium` gave **26 passed**.
  - launch-form's afterAll deletes its consent rows from the local dev database, not staging. I deleted the one staging `wallets` row created after the run started; staging had no other rows.
- **WR-03, forged X-Real-IP:** inconclusive.
  - **Request:** one `POST /api/consent` with `X-Real-IP: 203.0.113.77` and an empty body. It got 400 as expected; the rate limit counts before the body is read, and the request touched no database or worker.
  - **Edge log:** Railway's HTTP log for that request records `srcIp` as the Mac's real public address, not the forged one.
  - **Gap:** that shows what the edge saw, but from outside one request cannot show which value reached the app's `clientIp`. Settling it takes 11 consent POSTs with different forged values within 10 minutes: if the 11th gets 429, the forged header is ignored. That is beyond the single curl allowed here.

## Deviations from Plan

1. **[Rule 3 - Blocking] Railway no longer reads railway.json for new services.** The plan's fallback applied: the same settings were set on the services through an environment config patch. The owner later approved deleting the files (a949ca6).
2. **[Rule 3 - Blocking] The upload failed at 54 MB.** I added `.railwayignore` with `.planning/`, which brings the upload to about 1 MB. Commit fe48e24.
3. **Migrations ran from the Mac before the deploy.** This was inside approved step 3, done while Railway was down. The pre-deploy repeated them as a no-op.
4. **Region moved to US East.** Not in the plan; it is a setting on the new services only.
5. **Extra Sentry test hit.** Caused by the variable delete not redeploying (see step 4). The web was then redeployed once by hand. The worker README now notes this.
6. **Staging consent row cleanup by hand.** The e2e cleanup targets the local database (see Verification). For later plans, the specs could read the database URL from the process env when `E2E_BASE_URL` is set.

## Known Stubs

None.

## Open items

- **WR-03** X-Real-IP is unconfirmed from outside (see Verification).
- **`production` environment:** empty and unused. It stays for Phase 7.
- **`PINATA_GATEWAY`** is unset on staging (Phase 3 note from 02-15).

## Threat Flags

None beyond the plan's threat model:
- **T-02-16-01:** stdin, one name per call, and web holds no seed.
- **T-02-16-02:** the worker has no public domain.
- **T-02-16-03:** devnet on both services.
- **T-02-16-04:** staging lane.
- **T-02-16-05:** the test route is back to 404.

## Self-Check: PASSED

- **Files:** `.railwayignore`, `apps/worker/README.md` (staging section) and `.env.example` (staging URL comment) exist.
- **Commits:** fe48e24 and f6faf77 are on phase-02-launch-flow.
