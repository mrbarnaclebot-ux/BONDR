---
phase: 02-launch-flow
plan: 18
subsystem: ops
tags: [staging, redeploy, sign-off, checkpoint]
requires:
  - phase: 02-17
    provides: responsive.e2e.ts, Designer fixes, the lookup table slot fix (ef8cf3b)
provides:
  - "Staging redeployed at ef8cf3b: worker 4a0f6b31, web fc083332"
  - "36 staging screenshots refreshed on the deployed build, 37 of 37 passed"
affects: [phase-2 sign-off]
key-decisions:
  - "Worker deployed first, then web, because the fix is in packages/core (the worker's prepare path)"
  - "One responsive run with E2E_COIN_MINT covered both the 02-17 coin gap and this plan's post-redeploy pass"
status: awaiting-owner-sign-off
---

# Phase 2 Plan 18: Staging Redeploy and Owner Sign-off Summary

**Staging runs HEAD ef8cf3b. One real devnet launch landed on it, and its responsive and axe pass is 37 of 37. Task 3, the owner's sign-off, is open.**

## Task 1: owner approval

The orchestrator relayed the owner's approval: "one redeploy of staging, worker then web (one `railway up --service <name> --environment staging --detach` each, from the current HEAD), in Railway project bondr only." It covered no variable, setting or domain change, and no other project. None was made.

## Task 2: redeploy and staging pass

| Service | Deployment | Result |
|---|---|---|
| worker | 4a0f6b31-fd56-4dce-bf4b-bcd43ba0c4cc | SUCCESS 19:10 UTC 10-22, after a 27 min build. Railway's builder fetched npm tarballs at 2 to 43 KiB/s. The log reads "worker listening on devnet". |
| web | fc083332-3e99-47ac-b618-1a644114f54a | SUCCESS 19:15 UTC 10-22 |

- Each service needed one `railway up` and no retries.
- **`/api/health`:** `{"ok":true}`.
- **`/api/status`:** net devnet, fees 95/30 bps, `paused: null`.
- **Staging launch on this build:** it landed, and the record is in 02-17-SUMMARY.md.
  - Mint: `CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr`.
  - Signature: `5VFhiFFR…fM8E`.
  - The success screen showed 2.4 s after blockTime.
- **Responsive matrix:** `E2E_COIN_MINT=<mint> E2E_BASE_URL=https://web-staging-72bad.up.railway.app pnpm exec playwright test apps/web/e2e/responsive.e2e.ts --project chromium --workers 2` gave **37 passed**.
  - 0 axe violations and no horizontal scroll across 12 surfaces at 3 widths, and the header fits at 320.
  - All 36 `-staging.png` files were rewritten after the web deploy. 20 changed, 3 are new (the coin page) and 13 are byte-identical.

## Task 3: owner sign-off (OPEN)

The owner's checklist is in the plan's Task 3 and the executor's return message. Still to record here:

- The owner's "approved" and any copy changes.
- The owner's Phantom launch signature.
- The Phantom warning text.
- The Sentry check.

## Findings for the owner

- **IPFS gateway:** ipfs.io answers 429 "switching to a service worker gateway only" for our image CID, while the Pinata gateway serves it. As a result, the coin image is blank on staging, and the on-chain metadata URI points at ipfs.io. Details are in 02-17-SUMMARY.md. This is not fixed and needs an owner decision.

## Deviations from Plan

- **Deploy order:** worker, then web. The plan defaults to web first, but it allows the worker first when a worker file changed. `packages/core/src/alt.ts` changed.
