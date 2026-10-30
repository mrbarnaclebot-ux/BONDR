---
status: pending
phase: 07-go-live
source: [07-VERIFICATION.md]
started: 2026-10-26T16:00:00Z
updated: 2026-10-30T09:40:00Z
---

## Current Test

10. G-7: EVACUATE on (owner)

## Tests

Order matters: items 1-6 need no real money and unblock the gates. Items 7-17 are the owner gates in the D-39 order, each run by its own plan (07-26..07-36) only after the owner says go. Every gate's record goes in apps/worker/PRODUCTION.md section 7.

### 1. GitHub billing, then a green CI run on phase-07-go-live
GitHub refuses to start every Actions job on the private repo ("recent account payments have failed or your spending limit needs to be increased"). Fix the payment method or spending limit at github.com/settings/billing for the account that owns mrbarnaclebot-ux/BONDR. Then tell the agents; they run `gh run rerun <newest ci run id>` (or push a commit) and merge the Phase 7 PR once it is green.
expected: The ci workflow run on phase-07-go-live completes with success (install, migrate, lint, typecheck, test, web build, bundle check, 32 @smoke specs). The PR "Phase 7: Go-Live" is squash-merged to main.
why_human: Billing settings on the owner's GitHub account. Agents never touch billing.
result: pass (CI green on main at 6098e98; PR #7 merged)

### 2. HV-06-01: staging console with the owner's Phantom
Carried from 06-HUMAN-UAT.md. On Railway (bondr, staging) set ADMIN_WALLET on web and worker to the owner's Phantom public key, and SITE_URL on both to https://web-staging-72bad.up.railway.app. Open /admin, sign in, run the inspector, simulate Burn buyback now and simulate EVACUATE. Sign nothing. Since Phase 7 the Health panel also has the Pump contract check cell: press Run check now and read the result.
expected: 30-minute console, inspector decodes a signature with a Solscan link, both simulations show their totals, nothing is sent. The contract cell reads "Passed" with the time.
result: [pending]

### 3. HV-06-02: Sentry issue count on staging
Carried from 06-HUMAN-UAT.md. Create a read-only Sentry token (event:read) and set SENTRY_READ_TOKEN on the staging worker only.
expected: The Health panel's Sentry cell shows the unresolved issue counts instead of "Not configured".
result: [pending]

### 4. DNS for trybondr.fun
Add the records Railway shows for the production web custom domain (G-1, plan 07-26): the apex trybondr.fun and www.trybondr.fun. www answers 308 to the apex in the app (proxy.ts), so it only needs to reach the web service.
expected: https://trybondr.fun serves the dark production web; https://www.trybondr.fun/terms answers 308 to https://trybondr.fun/terms.
why_human: Registrar account.
result: pass (2026-10-30)

### 5. Contact line (D-17)
The owner chose X over email (2026-10-27): the terms page links @trybondrdotfun since PR #8.
expected: The owner controls the X account @trybondrdotfun.
result: pass (owner named the handle; no email forwarding needed)

### 6. Production values the agents cannot know
The production ADMIN_WALLET (owner's Phantom) and SENTRY_READ_TOKEN for the production worker. Optional: swap the BONDR genesis copy or image (D-32) before G-5.
result: partial (ADMIN_WALLET and pinata_jwt set 2026-10-30; SENTRY_READ_TOKEN open)

### 7. G-1: create Railway production, deploy web dark (plan 07-26)
Adds Railway billing (about +$5-15/month). Needs item 1 first: deploy.sh production requires HEAD == origin/main and green CI for that SHA.
result: pass (2026-10-30)

### 8. G-2: treasury address TREASURY_PUBKEY (plan 07-27)
A new owner-only wallet, not derived from the seed and not the admin wallet. It is locked permanently into every coin's sharing config.
result: pass (2026-10-30)

### 9. G-3: production seed, mainnet worker boots dark in genesis (plan 07-28)
Owner generates the seed on their own device and keeps an offline copy. The worker boots with every switch off and runs the mainnet contract check (OPS-02 closes on its first mainnet pass).
result: pass (2026-10-30, seed generated on the Mac by owner decision)

### 10. G-7: EVACUATE on for production (plan 07-29)
Read PRODUCTION.md section 10 first. Note: in genesis mode EVACUATE answers not_ready (it needs the BONDR mint); it works once genesis is left.
result: [pending]

### 11. G-4: fund production ops, 0.5 SOL (plan 07-30)
Real SOL. Ops floor on mainnet is 0.1 SOL.
result: [pending]

### 12. G-5: the BONDR genesis launch on mainnet (plan 07-31)
Real SOL: 0.25 SOL dev buy, insta burned, plus the Sender tip, from the owner's Phantom at /launch. Then set BONDR_QUOTE_MINT and leave genesis. Closes ROADMAP criterion 3 with criterion 2's merge, and LAUNCH-08 on the first Sender-delivered launch.
result: [pending]

### 13. G-8: fee engine on for mainnet (plan 07-32)
Before the first child launch, so no coin runs unmanaged. HV-05-02 (Sender on the first mainnet forced bond) is checked when the first forced bond happens.
result: [pending]

### 14. G-6: confirm the launch Sender tip (plan 07-33)
Default 0.001 SOL per launch, paid by the creator inside their transaction.
result: [pending]

### 15. G-10: Helius plan (plan 07-34)
Decide from the dark-period numbers (PRODUCTION.md section 8). Upgrade to Developer ($49/month) before public child launches, or earlier on 429s or credits above 80%.
result: [pending]

### 16. G-9: open child launches (plan 07-35)
After G-8, at least 100 free mints and one owner or friend test launch on mainnet.
result: [pending]

### 17. G-11: Neon plan review, close the phase (plan 07-36)
No upgrade unless projected usage passes 400 CU-h/month. 07-36 ticks OPS-02, OPS-03, OPS-05, LAUNCH-08 and LAUNCH-09.
result: [pending]

### 18. HV-05-02: mainnet Helius Sender on the first forced bond
Carried from 05-HUMAN-UAT.md. On the first mainnet forced bond after G-8, check the Sender response and the tip transfer on Solscan (PRODUCTION.md section 9).
expected: The buy and burn land through Sender with a 0.001 SOL tip paid by ops.
result: [pending]

## Open questions for the owner (no gate)

- Should awaiting_migration outrank kill_switch in the launch paused reason (UI-SPEC order) or stay below it (07-10 test order)? Kept as built in 07-10.

## Summary

total: 18
passed: 6
issues: 0
pending: 12
skipped: 0
blocked: 0

## Gaps
