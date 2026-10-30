---
phase: 07-go-live
plan: 27
gate: G-2
status: complete
---

# 07-27 Summary: G-2 treasury address

Owner reply (2026-10-30): "use this wallet for the treasury" with the public key; taken as G-2 approved.

## Done
- TREASURY_PUBKEY (HSor...BXwt) set on the production worker with --skip-deploys. The key parses, is on curve, and differs from ADMIN_WALLET. It has no on-chain account yet, which is fine: it needs no balance before it receives funds.
- env-diff g2 for the worker: all checks passed. Worker deployments: 0.

## Waiting
- G-3 boot refuses the treasury if it collides with ops or a derived role; that check runs on the first worker boot.
