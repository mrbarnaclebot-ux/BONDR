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

## Waiting on the owner
- ADMIN_WALLET public key (web and worker); admin stays closed until then.
- New Pinata JWT pasted as `pinata_jwt` on production web in the dashboard.
- Porkbun DNS records (PRODUCTION.md G-1 record), then Task 3's dig and curl checks.
- hello@trybondr.fun forwarding confirmed.

## Deviations
- `railway environment new production` refused (already exists); the existing empty environment was used. `railway environment edit` reported "No changes" for services absent from the environment, so the settings were staged and committed through the Railway API instead.
- The Neon production branch also carries a copy of main's `neondb` (staging rows). Nothing points at it; production uses `bondr`.
