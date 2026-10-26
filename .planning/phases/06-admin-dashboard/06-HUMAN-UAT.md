---
status: pending
phase: 06-admin-dashboard
source: [06-VERIFICATION.md]
started: 2026-10-26T07:30:00Z
updated: 2026-10-26T07:30:00Z
---

## Current Test

1. HV-06-01 (owner-gated: needs the owner's Phantom address and Railway variables)

## Tests

### 1. HV-06-01: staging console with the owner's Phantom
Run this after staging carries the post-review build. The separate redeploy agent is doing that now; 06-26's worker 1a9b6aa9 predates the review fixes.

On Railway (bondr, staging), set:
- ADMIN_WALLET on **web and worker**, to the same address: the owner's Phantom public key.
- SITE_URL on **web and worker**, to `https://web-staging-72bad.up.railway.app`. This is required by review fix WR-B-03: the sign-in message and every money intent carry a domain line from SITE_URL. If SITE_URL is unset on web, sign-in answers 403 `not_configured`. If it is unset on the worker, every simulate and execute answers 403 `forbidden`.
- Leave ADMIN_EVACUATE unset (simulate only).

Then in a desktop browser with Phantom:
1. Open https://web-staging-72bad.up.railway.app/admin, connect Phantom and sign the admin sign-in message. Check that the message starts with `web-staging-72bad.up.railway.app wants you to sign in`.
2. Inspector: paste a staging transaction signature (for example a launch or trade signature from a staging coin page) and run it.
3. Wallets panel: click Burn buyback now. Read the simulation dialog, then close it **without** signing.
4. EVACUATE: type `EVACUATE ALL W TO TREASURY` exactly. Read the totals. Do **not** sign.
5. Audit log: confirm no money row was added (simulations write no audit row).

expected: The console opens with a 30-minute countdown, and a second wallet is refused with "This wallet is not the admin wallet". The inspector shows the status, slot, decoded instructions and an "Open in Solscan" link. Burn buyback now shows balance changes and "Destinations check passed:", or a plain "nothing to burn" line when the buyback holds 0 BONDR. EVACUATE shows its wallets, BONDR and SOL totals, and the button reads "Simulation only on this deploy" (disabled). Nothing is signed, nothing is sent, and the ops balance is unchanged.
result: [pending]

### 2. HV-06-02: Sentry issue count on staging
Create a read-only Sentry token (event:read) for the mrbarnacle org and set SENTRY_READ_TOKEN on the staging **worker** only. Reopen /admin (after HV-06-01) and read the Health panel.
expected: The Sentry cell shows the unresolved issue count for bondr-web and bondr-worker instead of "Not configured". The count is cached for 60 s, and nothing else in the panel changes.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
