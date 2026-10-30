---
phase: 07-go-live
plan: 26
gate: G-1
status: partial
---

# 07-26 Summary: G-1 production environment (partial, waiting on the owner)

Owner reply: "set up what ever you can" (2026-10-27), given after G-1 was presented with its default and cost; taken as G-1 approved with every default.

## Done
- Railway `production`: the project's default environment already existed and was empty, so it was used. web and worker service settings were copied from staging's allow-listed config (build, start, pre-deploy migrate, healthchecks, restart policy, watch patterns) and committed with no source. Region us-east4-eqdc4a, 1 replica each.
- Neon: branch `production` from main, a fresh database `bondr`; the pooled URL was piped into both services, never printed.
- Variables: new WORKER_TOKEN (same on both) and SESSION_SECRET; SOLANA_NET=mainnet, SITE_URL=https://trybondr.fun on both; WORKER_URL reference on web; worker ALLOW_MAINNET=1, FEE_ENGINE=dry, ADMIN_EVACUATE=simulate, VANITY_LANE=production, VANITY_THREADS=2, PRIORITY_FEE_MICROLAMPORTS=10000, PORT=8080; PINATA_GATEWAY and the Sentry DSNs copied from staging by pipe; helius_api_key on the worker only. MASTER_SEED, TREASURY_PUBKEY and BONDR_QUOTE_MINT unset.
- env-diff g1: all checks passed for web and worker. Section 1b check: no repo source on either service.
- Domains attached: trybondr.fun and www.trybondr.fun (target port 8080).
- Web deployed from `1b9a845` with `deploy.sh production --only web --yes`: SUCCESS, "migrations applied". Worker deployments: 0.

## Done 2026-10-30
- DNS added by the owner; apex and www certificates valid. www was missing from Railway and was re-attached (new CNAME target, in PRODUCTION.md).
- ADMIN_WALLET (GWWb...ZVRe) set on web and worker. Web redeployed from `6098e98` (5eac3839); /admin shows the sign-in.
- Checks: /terms 200, www 308 to the apex, /api/status 503 worker_unavailable, env-diff g1 for both, no repo source.

## Waiting on the owner
- New Pinata JWT pasted as `pinata_jwt` on production web in the dashboard.

## Deviations
- Watch patterns removed from both production services (2026-10-30): Railway SKIPPED a same-commit deploy and `railway up --ci` hung. Staging keeps them.
- One web build failed with no error at the compile step; the identical retry passed. Cause unknown; a local build on the same Node 24.22 passed.
- Contact: the owner chose X over email (2026-10-27): `/terms` section 08 links @trybondrdotfun, PR #8 (6098e98), TERMS_VERSION 2026-10-27; deployed to production and staging web. No email forwarding is needed.
- `railway environment new production` refused (already exists); the existing empty environment was used. `railway environment edit` reported "No changes" for services absent from the environment, so the settings were staged and committed through the Railway API instead.
- The Neon production branch also carries a copy of main's `neondb` (staging rows). Nothing points at it; production uses `bondr`.
