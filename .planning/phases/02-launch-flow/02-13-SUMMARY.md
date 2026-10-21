---
phase: 02-launch-flow
plan: 13
subsystem: web
tags: [sign-step, success-screen, copy-ca, e2e, devnet]
requires:
  - phase: 02-10
    provides: POST /api/launch/pin
  - phase: 02-11
    provides: POST /api/launch/prepare, PrepareResult, the sim dev and devnet budgets
  - phase: 02-12
    provides: worker POST /submit, settle state machine, facts on landed rows
provides:
  - "POST /api/launch/submit (sameOrigin, JSON, 20 per 10 min per IP, workerPost passthrough)"
  - "GET /api/launch/{id}: LaunchView from the DB, 404 not_found, no-store"
  - "lib/launches.ts: launchView(id), launchByMint(mint) (landed row only); error text mapped to a code"
  - "lib/launch-run.ts: getView, launch, poll (the step 4 network sequence)"
  - "components: launch-sign (step 4), launch-live (step 5), proof-stamp, ca-row, tx-link"
  - "e2e/phantom.ts: real Ed25519 signing in the fake (signWire, accountFromSeed, simDevAccount, reject option)"
  - "worker.ts passes 410 expired and 422 cosign_refused through (02-12 carry-over)"
affects: [02-14, 02-15, 02-16, 02-17, 02-18]
tech-stack:
  added: []
  patterns:
    - "One failure table keyed by LaunchErrorCode plus rejected, switched, onchain; a fault marks the running row unless it names one; unknown codes fall back to Build failed"
    - "The launch id goes to sessionStorage just before the signed wire is posted; a reload restores step 4 (signed, sent, unknown) or step 5 (landed) and never re-signs"
    - "A lost submit answer is settled by polling; a row still prepared gets the same wire again (the worker treats it as a read)"
    - "Reducer carries pin (cleared on any field or image change), launchId, mint, view, notice, focus"
key-decisions:
  - "The network sequence lives in lib/launch-run.ts so launch-sign.tsx stays under 300 lines; the failure table, sessionStorage and rendering stay in launch-sign.tsx"
  - "The GET route maps the error column to a contract code, or 'onchain' for raw preflight and on-chain text, so no worker text reaches the browser"
  - "A paused refusal calls useStatus().refresh() so the paused callout shows at once instead of at the next 10 s poll"
  - "consent_required calls a new wallet.forgetConsent(), which clears the local mark and forces a re-render so the consent dialog reopens on step 3"
  - "Back to review shows until submit, and again after a row 1-4 fault (nothing was sent); it stays hidden after a row 5 outcome"
requirements-completed: [LAUNCH-03, LAUNCH-05, LAUNCH-07, PLAT-04]
duration: ~70 min
completed: 2026-10-21
---

# Phase 2 Plan 13: Sign and live steps Summary

**A dev now launches from the browser with one Phantom signature. Step 4 shows the five rows (pin, build, sign, co-sign, confirm) and every UI-SPEC failure state. Step 5 shows the proof, the full contract address with Copy, and Open {SYMBOL}. One real devnet launch from the UI reached the success screen 3.7 s after the block time.**

## Performance

- **Duration:** about 70 min
- **Completed:** 2026-10-21
- **Tasks:** 2
- **Files:** 24 (13 created, 11 modified)

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Submit and launch-status routes, shared proof components | 68032af |
| 2 | Step 4 sign and step 5 live, fake Phantom signing, launch e2e on devnet | f50b339 |

## Devnet evidence (2026-10-21)

`E2E_DEVNET=1 pnpm exec playwright test apps/web/e2e/launch-live.e2e.ts -g devnet` passed (1 test, 31 s). The fake Phantom signed slot 0 with the sim dev key `9Hm1YEfX...TjwQM6`.

| Item | Value |
|------|-------|
| Signature | [2MSpmyPh...WujaDSi](https://solscan.io/tx/2MSpmyPhe7hmfMgX8NzEngTTjd1kmceQ4BRYwRrz4N95AGqi4hARZSkE8rVvKWpRAAg9EamtCjWXBxHrwWujaDSi?cluster=devnet) |
| Mint | `9i3M3j6Zz3UVoTHEFugLdPAfmAvdnkYsUKjTq4ygbndr` (ends in bndr; it matched the clipboard after Copy address) |
| Launch id | `75fe588a5d13c531cee55be15b90a326`, state `landed` |
| Facts | tokens 30,934,211,073,306; devChildAfter 0 |
| Success screen | 3,674 ms after the tx blockTime from the public devnet RPC (limit 6,000 ms) |
| Exit | Insta burn, minimum dev buy 0.0025 SOL |

What the test asserted:
- the heading "{SYMBOL} is live."
- "Dev holds 0 launch supply"
- the tx link carries cluster=devnet
- "Copied" after Copy address
- Open {SYMBOL} links to `/coin/{mint}`

**Ops balance (floor 2.40 SOL):**

| Run | Ops before | Ops after | Funded | Run spend |
|-----|-----------|-----------|--------|-----------|
| `--fund` (beforeAll) | 2.898989 | 2.898989 | 0 (sim dev held 0.032418, above the 0.03 top-up line) | 0 |
| UI launch | 2.898989 | 2.898989 | 0 | 0 |

The launch reused the sim dev's held mint and lookup table from 02-12's tamper run, so ops paid for no new table. The sim dev went from 0.032418 to 0.021089 SOL (0.011329 for the launch). The next `--fund` will top it up to 0.06.

## Verification

- `pnpm exec playwright test` (all specs): 57 passed, 1 skipped (the devnet group without E2E_DEVNET).
- **The stubbed group in launch-live.e2e.ts (17 tests) covers:**
  - **Happy path:**
    - rows show "CID bafk…cccc" and "769 of 1,232 bytes, create + buy + burn"
    - the signed wire's slot 0 verifies against the account
    - the success heading gets focus
    - the proof sentence fills from facts ("31.1M tokens")
    - the tx link href
    - clipboard equals the mint and the label reads "Copied"
    - the Open GRUB href
  - **Back to review and reload:** Back to review shows during row 2 and hides after submit. A reload restores step 4 with row 5 spinning and polling continues. Prepare and submit each ran exactly once.
  - **Phantom rejection (code 4001):** row 3 fails with the copy, Try again and Back to review, and submit is never called.
  - **Account switch during row 2:** shows the switch copy with Try again.
  - **Error codes (one test each):** each asserts its row, its copy and the right action (or none):
    - pin_failed (row 1)
    - worker_unavailable and invalid_input (Build failed, row 2)
    - pool_empty (row 2)
    - rate_limited (row 2, no action)
    - expired (row 3, Build again)
    - cosign_refused (row 4)
    - paused (row 4, no action)
    - failed on-chain (row 5, Try again plus tx link)
  - **Paused before send:** also shows the page-level "Launches are paused." callout.
  - **Unknown:** row 5 keeps spinning with the copy and tx link, and there is no retry.
  - **insufficient_balance:** returns to step 2 with Dev buy focused.
  - **consent_required:** reopens the consent dialog on step 3.
  - **Stored launch id answering 404:** shows "We could not find that launch. Start again." on step 1.
- **Vitest:** 90 passed, 1 skipped. New: `apps/web/lib/worker.test.ts` (4 tests). The 410 and 422 cases fail without the passthrough fix and pass with it.
- **Lint, typecheck and build:** `pnpm lint` and `pnpm typecheck` exit 0. `pnpm --filter @bondr/web build` passes.
- **Screenshots and axe:** taken at 390, 768 and 1440 (stubbed flow, reduced motion), not committed. Location: `/private/tmp/claude-501/-Users-uzi-Documents-Git-Projects-nosync-BONDR/d687734b-6449-4b7a-b964-43fdb973692f/scratchpad/shots/`.
  - Shots: step 4 in progress, step 5, step 5 copied, and step 4 rejected.
  - axe found 0 violations on every one, and there is no horizontal scroll at any width.
- **Acceptance greps:**
  - These match: `workerPost("/submit"` in the submit route, `rel="noopener"` in tx-link, `clipboard.writeText` in ca-row, and `sessionStorage` and `aria-live` in launch-sign.
  - Every listed code is in launch-sign's FAULTS table.
  - `@solana|bs58|bn.js` in apps/web/components finds nothing.
  - launches.ts selects neither `message` nor `signedTx`.
- **File sizes:** launch-sign.tsx 264, launch-run.ts 151, launch-flow.tsx 200, launch-live.tsx 96, launch-live.e2e.ts 270, launch-stubs.ts 79, phantom.ts 162 lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 410 and 422 passthrough (02-12 carry-over)**
- **Issue:** `apps/web/lib/worker.ts` turned `expired` and `cosign_refused` into `worker_unavailable`.
- **Fix:** both statuses were added to the passthrough set, and `worker.test.ts` covers them.
- **Commits:** 68032af (fix), f50b339 (test)

**2. [Rule 3 - Blocking] The network sequence moved to `apps/web/lib/launch-run.ts`**
- **Issue:** launch-sign.tsx reached 380 lines, over the 300-line limit.
- **Fix:** pin, prepare, sign, submit, poll and getView moved to launch-run.ts. The failure table, the sessionStorage store and the rendering stay in launch-sign.tsx, so its acceptance greps still hold.
- **Commit:** f50b339

**3. [Rule 2 - Correctness] Small changes outside the listed files**
- `wallet.tsx` gains `forgetConsent()`. consent_required needs it to reopen the dialog, and it forces a re-render because consent read from storage alone left nothing to change.
- `use-status.ts` gains `refresh()`, so the paused callout appears at once.
- `globals.css` gains the `orb` keyframes for the success rings, hidden under reduced motion.
- `launch-receipt.tsx` shows the reserved mint after prepare.
- `e2e/coin.ts` `toStep2` takes an optional name and symbol, for the devnet run.
- **Commit:** f50b339

**4. [Rule 2 - Correctness] A lost submit answer polls instead of offering a retry**
- **Issue:** The plan maps `worker_unavailable` to Build failed with Try again. At submit (row 4) that answer can mean the tx was sent, so offering a fresh sign there would break D-16.
- **Fix:** At submit, `worker_unavailable` moves to row 5 polling. A row still `prepared` is re-posted with the same wire, which the worker treats as a read.
- **Commit:** f50b339

**5. [Rule 2 - Security] The launch status route exposes a code, not raw error text**
- **Issue:** The `error` column holds raw preflight and on-chain text.
- **Fix:** The route returns a contract code, or `onchain` for that raw text.
- **Commit:** 68032af

**6. [Test infra] `e2e/launch-stubs.ts` split out of the spec**
- **Issue:** The spec would have been over 300 lines.
- **Fix:** The page.route stubs and `toSign` moved to their own file.
- **Also:** The fake's signing feature is now a separate init script (`fakeSign`), so `fakePhantom` stays under 40 lines.
- **Commit:** f50b339

### Notes

- **Restored launch without its form:** a launch restored after a reload has no form data left. Try again after a failed on-chain result there resets to step 1.
- **Success sentence formats:** the sell sentence uses `sol(solBack, 4)`, and both exits use `compact(tokens)`.

## TDD Gate Compliance

There is no separate RED commit, per the orchestrator rule never to commit a failing test. RED was observed before implementation: the spec ran against the unimplemented step 4 and failed at the Phantom-rejected alert. GREEN is in f50b339.

## Known Stubs

None. "Open {SYMBOL}" links to `/coin/{mint}`, which 02-15 builds. Until then it is a 404, as planned.

## Requirements

- LAUNCH-03, LAUNCH-05, LAUNCH-07 and PLAT-04 are delivered in the real UI.
- The devnet run proves the 5 s window: 3,674 ms.

## Notes for later plans

- **02-15 (token page):**
  - `launchByMint(mint)` returns the landed LaunchView.
  - `ProofStamp` takes `{ signature, net, children }`, where `children` is the exit sentence.
  - `TxLink` and `CaRow` are ready to reuse.
- **02-14 (Sentry):** send the launch read failures from the GET route (`launch read failed`) to Sentry.
- **02-16 (a11y and design):** no spec runs axe yet. These checks were ad hoc in this plan; add a committed axe check for steps 4 and 5 there.
- **sessionStorage key:** `bondr:launch` holds the posted launch id. "Launch another" clears it.

## Threat Flags

None beyond the plan's threat model:
- **T-02-13-01:** public columns only, the error mapped to a code, a 32-hex id, and the wallet never in a URL.
- **T-02-13-02:** sameOrigin, JSON-only with a 4 KB cap, and a rate limit.
- **T-02-13-03:** the stored id restores the launch and never re-signs it.
- **T-02-13-04:** the 02-01 framing headers are unchanged.
- **T-02-13-05:** React escaping only.

## Self-Check: PASSED

- **Files present:**
  - apps/web/app/api/launch/submit/route.ts and apps/web/app/api/launch/[id]/route.ts
  - apps/web/lib/launches.ts, apps/web/lib/launch-run.ts and apps/web/lib/worker.test.ts
  - apps/web/components/launch-sign.tsx, launch-live.tsx, proof-stamp.tsx, ca-row.tsx and tx-link.tsx
  - apps/web/public/art/hero-bond-960.jpg
  - apps/web/e2e/launch-live.e2e.ts, launch-stubs.ts and README.md
- **Commits on phase-02-launch-flow:** 68032af and f50b339.
