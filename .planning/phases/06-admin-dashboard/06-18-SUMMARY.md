---
phase: 06-admin-dashboard
plan: 18
subsystem: web
tags: [web, simulation-dialog, fresh-signature, phantom, tdd]
requires: [06-13, 06-17]
provides:
  - admin-run.ts simulateAdmin, executeAdmin, pollIntent, type Reply
  - admin-copy-sim.ts adminErrorCopy, refusedCopy, sentFailedCopy, simResultLine, estimatedNote, type Part
  - use-sim.ts useSim (dialog run and phases)
  - SimDialog (admin-sim.tsx), SimFoot and SimOutcome (admin-sim-foot.tsx)
  - TopBar moved to admin-topbar.tsx
  - use-console.ts sim, openSim(action, mint), closeSim(sent)
  - AdminWallets onTx prop and "Burn buyback now"
  - e2e/admin-stubs.ts stubSim, simFixture, MESSAGE, stubConsole; e2e/admin-sim.e2e.ts
affects: [06-23 EVACUATE (reuse admin-run.ts and the signing pattern), 06-24, 06-25 phase gate]
tech-stack:
  added: []
  patterns:
    - native dialog with showModal, focus on Cancel, focus back to the opener on unmount
    - one AbortController per mount; a signature that resolves after close or session end is never executed
key-files:
  created:
    - apps/web/lib/admin-run.ts
    - apps/web/lib/admin-copy-sim.ts
    - apps/web/lib/admin-copy-sim.test.ts
    - apps/web/lib/use-sim.ts
    - apps/web/components/admin-sim.tsx
    - apps/web/components/admin-sim-foot.tsx
    - apps/web/components/admin-topbar.tsx
    - apps/web/e2e/admin-stubs.ts
    - apps/web/e2e/admin-sim.e2e.ts
  modified:
    - apps/web/components/admin-console.tsx
    - apps/web/components/admin-wallets.tsx
    - apps/web/lib/use-console.ts
    - apps/web/e2e/admin-timeline.e2e.ts
    - apps/web/lib/README.md
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-18: OQ1 copy 'Later transactions are simulated again by the RPC before they are sent.' shows when any step is estimated (Claude's discretion, owner may override)"
  - "06-18: the dialog shows 'Connect Phantom' in place of the send button while no wallet is connected; the console session is a cookie only, so Phantom may be disconnected after a reload"
  - "06-18: a wrong signer is not pre-checked in the browser; the worker answers 403 bad_intent_signature, the intent stays usable, and the dialog returns to ready with 'That signature is not from the admin wallet. Nothing was sent.'"
  - "06-18: an execute answer lost to the network or a forwarder timeout (worker_unavailable) is polled, and a missing intent or 90 s without a final state reads 'Sent, not confirmed yet', never 'nothing was sent'"
  - "06-18: a failure after send reads 'Sending stopped: {words}. {landed} of {total} transactions landed.' (UI-SPEC gave no exact line); the refusal reason from a 409 is not passed through worker.ts because the not_applicable copy does not use it"
  - "06-18: three dialog-side copy lines added: phantom_rejected, phantom_failed ('Phantom could not sign the message. Nothing was sent.') and nothing_to_send ('There is nothing to send for this action now. Nothing was sent.')"
metrics:
  duration: 23 min
  completed: 2026-10-25
---

# Phase 6 Plan 18: Simulation dialog and client run Summary

Every transaction action on the console (the grid, the stuck box retry, the held box Finalize split and Burn buyback now on the Wallets panel) now opens a native modal that simulates first, shows result, compute, fee, the net balance table and the destination check, and sends only after the owner signs the worker's intent text verbatim in Phantom.

## What was built

- `lib/admin-run.ts`: `simulateAdmin`, `executeAdmin` (intent id plus base64 signature only), `pollIntent` (worker memory every 1.5 s after a user send, unknown after 90 s or a lost intent). Every call answers `{ ok, body } | { ok: false, status, code }`.
- `lib/admin-copy-sim.ts`: every contract code to its UI-SPEC line, unknown codes to the worker_unavailable line; the result line parts; the OQ1 note. Pinned by `admin-copy-sim.test.ts` (4 tests).
- `lib/use-sim.ts`: the run: simulate on open, the ready phase ends when the client clock passes `intent.expiresAt`, `signMessage(new TextEncoder().encode(intent.message))`, execute, poll. Phases: simulating, again, refused, ready, signing, sending, done.
- `components/admin-sim.tsx` and `admin-sim-foot.tsx`: the dialog (bottom sheet below 768px, 640px card from 768px, Before column hidden below 768px), every UI-SPEC phase row, Escape, backdrop and Cancel ignored while signing or sending, TxLinks for every signature after send.
- Wiring: `use-console.ts` holds `sim`, `openSim`, `closeSim(sent)` (one reload when anything may have been sent); `admin-console.tsx` mounts the dialog and passes `onTx` to AdminTimeline and AdminWallets; the Wallets panel gains "Burn buyback now" (aria-disabled with its reason when the buyback holds no BONDR).
- e2e: `admin-stubs.ts` answers every simulate, execute and intent call in the browser; `admin-sim.e2e.ts` has six tests (preview and focus, byte-for-byte signing with a signature verified against the admin key, refused, intent_used, expiry on the fake clock, Burn buyback now with no coin selected).

## Verification

- `pnpm vitest run apps/web/lib/admin-copy-sim.test.ts`: 4 passed
- `pnpm typecheck`: clean. `pnpm lint`: 406 files, no errors
- `pnpm --filter @bondr/web build` then `bash scripts/check-client-bundle.sh`: passes (no program ids in client chunks)
- `pnpm exec playwright test apps/web/e2e/admin-sim.e2e.ts apps/web/e2e/admin-timeline.e2e.ts --project=chromium`: 10 passed; with `--repeat-each=2`: 20 passed
- `pnpm test`: 87 files, 654 passed, 2 skipped

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] admin-console.tsx was at 199/200 lines**
- **Fix:** moved TopBar, useLeft and minutes into new `admin-topbar.tsx`; admin-console.tsx is now 148 lines.
- **Commit:** e40a42d

**2. [Rule 2 - Missing] No way to sign when Phantom is not connected**
- **Issue:** the console session is a cookie; after a reload (and always in e2e) Phantom is not connected, and `signMessage` would throw.
- **Fix:** the send slot shows "Connect Phantom" (the wallet's own connect) until an address is present.
- **Commit:** e40a42d

**3. [Rule 3 - Structure] The run lives in `lib/use-sim.ts`, the footer in `admin-sim-foot.tsx`**
- **Issue:** the dialog plus its state machine would not fit the 300-line and 40-function limits in one file.
- **Effect:** the `signMessage(new TextEncoder().encode(intent.message))` call is in `lib/use-sim.ts`, not `admin-sim.tsx`. The plan's `rg signMessage apps/web/components/admin-sim.tsx` check matches nothing; the one call in the codebase takes `intent.message` exactly.
- **Commit:** e40a42d

**4. [Rule 1 - Test] admin-timeline.e2e.ts updated**
- The "no tx buttons without onTx" test no longer holds. It now asserts the stuck box's "Retry finalize split" renders and that the aria-disabled Run migrate (reached by keyboard: Playwright will not click an aria-disabled button) writes its reason to the hint.
- Both admin specs now `unrouteAll({ behavior: "ignoreErrors" })` after each test (an action's overview reload in flight at test end failed the run), and wait up to 30 s for the stubbed overview after Refresh (the real overview read behind the stub hit a Neon cold start once and timed out at 5 s).
- **Commit:** e40a42d

**5. [Rule 2 - Copy] Three dialog-side copy lines** (phantom_rejected, phantom_failed, nothing_to_send) and the failed-after-send line, tested in admin-copy-sim.test.ts.

### Not done

- `workerPost` still drops the 409 `reason`: the UI-SPEC `not_applicable` copy does not use it, so it was not passed through.
- `pollIntent` takes no `onView` callback: the dialog shows only the final state, so per-poll progress had no consumer.
- No screenshots or axe pass for the dialog in this plan; the UI-SPEC accessibility matrix (dialog ready, failed and landed at 390 and 1440) belongs to the 06-25 gate.

## Known Stubs

None. Every value in the dialog comes from the worker's simulation or intent view.

## Requirements

- ADMIN-03 ticked: every recovery action, including Burn buyback now, runs from the console.
- ADMIN-08 ticked: the stuck step's retry now renders and opens the dialog (it waited only on `onTx`).
- ADMIN-01 and ADMIN-04 not ticked: EVACUATE (06-22, 06-23) still needs its fresh signature and simulation preview.

## TDD Gate Compliance

RED `5f48166 test(06-18)`, GREEN `f9577d1 feat(06-18)`. No refactor commit.

## Self-Check: PASSED

- Files: all nine created files exist.
- Commits: 5f48166, f9577d1, e40a42d present on phase-06-admin-dashboard.
