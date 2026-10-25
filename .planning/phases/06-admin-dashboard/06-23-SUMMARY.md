---
phase: 06-admin-dashboard
plan: 23
subsystem: web
tags: [web, evacuate, phrase-arm, fresh-signature, tdd]
requires: [06-18, 06-22]
provides:
  - "admin-evacuate.tsx: Evacuate({overview, evacuate, onChanged}), mounted last in the console Grid"
  - "admin-copy-evac.ts: EVAC_PHRASE, phraseMatches, EVAC_HINT, evacSummary, evacDone, evacProgress"
  - "use-evacuate.ts: useEvacuate(onUnauthorized, onChanged), EVACUATE's run over the admin-run.ts money path"
  - "admin-run.ts pollIntent(id, signal, onView?): sending views to onView; the 90 s deadline restarts on each answer"
  - "e2e/admin-evacuate.e2e.ts: stubbed EVACUATE spec (7 tests)"
affects: [06-24, 06-25]
tech-stack:
  added: []
  patterns: [event-driven auto-simulate on an exact phrase match, simulate-only derived from the health poll plus the intent]
key-files:
  created:
    - apps/web/components/admin-evacuate.tsx
    - apps/web/lib/admin-copy-evac.ts
    - apps/web/lib/admin-copy-evac.test.ts
    - apps/web/lib/use-evacuate.ts
    - apps/web/e2e/admin-evacuate.e2e.ts
  modified:
    - apps/web/components/admin-console.tsx
    - apps/web/lib/admin-run.ts
    - apps/web/components/README.md
    - apps/web/lib/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-23: simulate-only is `health.evacuate !== \"on\" || !sim.intent`, so an unknown health poll or a worker that issued no intent never offers a send. A 409 not_applicable on execute (simulate_only or devnet_only) drops the intent and turns the button simulate-only, so web worker.ts does not need to pass `reason` through"
  - "06-23: the ready state shows Connect Phantom (quiet lg) before 'Sign and evacuate {n} wallets' when Phantom is not connected, as the dialog does (06-18); signMessage needs a connected account, so connect and sign cannot share one click"
  - "06-23: pollIntent's 90 s deadline now runs from the last answer, as its comment always said, so a long paced EVACUATE run is not reported as lost contact while the worker keeps answering"
  - "06-23: a failed or refused settled intent goes back to 'Simulate again' with the sentFailedCopy line (switches are already paused, so a fresh simulate moves what is left); unknown is lost contact and is never resent"
  - "06-23: progress while evacuating is 'Moved {m} of {n} wallets so far, {f} failed.' from the intent view's W counts (UI-SPEC gave no progress copy; the intent's total is transactions sent so far, not planned)"
metrics:
  duration: 25 min
  completed: 2026-10-26
  tasks: 2
  files: 10
---

# Phase 6 Plan 23: EVACUATE section Summary

The console now ends with EVACUATE. Typing `EVACUATE ALL W TO TREASURY` exactly arms it and starts `simulateAdmin("evacuate", null)` on its own. The section then shows the worker's totals line and "Sign and evacuate {n} wallets". Signing uses Phantom over the worker's intent text verbatim, then execute, then the intent poll with a W progress line. It ends on "Evacuated. {m} of {n} wallets moved to the treasury, {f} failed. Every job is paused." and reloads the console. When the health poll says ADMIN_EVACUATE is not on, the section still simulates and shows the totals, but the button reads "Simulation only on this deploy" and is disabled. There is no dialog: the phrase plus the signature is the confirmation (D-35).

## Tasks

| Task | Name | Commits |
|------|------|---------|
| 1 | EVACUATE copy and the section | 3683a80 (RED), 4a8d9fa (GREEN) |
| 2 | Stubbed EVACUATE spec | 203864f |

## What was built

- `admin-copy-evac.ts`: the exact-match phrase check (no trim, no case fold), every hint from the UI-SPEC state table, the totals line as mono `Part`s (`whole` BONDR, `feeSol` for bondrSol and SOL), the done line and the progress line.
- `use-evacuate.ts` (138 lines): phases disarmed, simulating, again, nothing, ready, signing, evacuating, done and lost. A match simulates and editing away aborts and discards the result. The ready phase expires on the intent's `expiresAt`. Send follows the dialog's path: phantom_rejected or phantom_failed goes back to ready with the error, bad_intent_signature keeps the intent, a 409 not_applicable drops the intent, other refusals go to "Simulate again", and worker_unavailable is polled. It reloads the console once the poll settles.
- `admin-evacuate.tsx` (180 lines): the striped destructive block (one column with 24/16px padding below 768px, two columns with 32px from 768px). It has the Heading L h2, the prose, the three-line list with the overview W count, and the label with the `select-all` phrase chip. The mono input has autocomplete, autocorrect and spellcheck off, autocapitalize characters, aria-describedby on the hint, readonly while locked, and Enter prevented. Below it come the hint (`role="status"`, or `role="alert"` for errors), the totals and progress lines, and one full-width lg button chosen by `buttonOf`.
- `admin-console.tsx`: one import and one element in the last slot (127 lines).

## Verification

- `pnpm vitest run apps/web/lib/admin-copy-evac.test.ts`: 4 passed. The RED run failed first because the module was missing.
- `pnpm exec playwright test apps/web/e2e/admin-evacuate.e2e.ts --project=chromium`: 7 passed on the first run, with no Neon retry needed. The tests cover: the near miss with no simulate; one simulate `{action: "evacuate", mint: null}` plus Enter sending nothing and a trailing space disarming; the signed bytes equal the fixture message and verify against the admin key, then the done line and a cleared input; Phantom rejected; simulate-only; nothing to move; and the 390px layout with both controls at least 44px tall and no sideways scroll.
- `admin-sim.e2e.ts`, rerun after the pollIntent change: 6 passed.
- `pnpm typecheck`: pass. `pnpm lint`: clean (423 files).
- Full `pnpm test`: 92 files passed, 690 passed, 2 skipped (692).
- Acceptance: `rg "<dialog|confirm\(" admin-evacuate.tsx` finds nothing, and every file is under 300 lines with every function under 40.
- I checked screenshots at 390 and 1440 (disarmed and ready) against the mockup myself. The formal screenshots, axe and Designer critique are 06-25's job.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pollIntent cut long runs off at 90 s total**
- **Found during:** Task 1
- **Issue:** the deadline counted from the first poll, not from the last answer (its comment says "90 s with no answer"). An EVACUATE of many paced batches would have shown "Lost contact" while the worker was still answering "sending".
- **Fix:** the deadline restarts on each answer, and an optional `onView` receives each sending view for the progress line. The dialog spec still passes.
- **Commit:** 4a8d9fa

**2. [Rule 3 - Blocking] Connect Phantom step**
- The UI-SPEC table has no "not connected" state, but `signMessage` needs a connected account and the console sign-in is cookie-only. The ready state therefore shows Connect Phantom first, as SimFoot does, and the e2e clicks it before signing.

**3. The run lives in lib/use-evacuate.ts**
- The plan's fallback name was admin-evacuate-state.ts. I used the `use-sim.ts` convention instead, so the key-link `simulateAdmin("evacuate"` is in use-evacuate.ts and not in the component. The component is 180 lines.

**4. Extra e2e test: Phantom rejected**
- The UI-SPEC lists the rejected state, so the spec checks it as well (7 tests, not 6).

### Not done (by design)

- I did not change worker.ts to pass `reason` through (the 06-22 note). The UI maps every execute `not_applicable` for EVACUATE to the simulate-only state, so the copy does not depend on `reason`.

## Threat mitigations

| Threat | How |
|--------|-----|
| T-06-23-01 | Exact match, plus autocorrect/autocapitalize/spellcheck settings and Enter prevented. The unit test covers near misses and the e2e covers Enter and the trailing space. |
| T-06-23-02 | `signMessage(new TextEncoder().encode(intent.message))` only. The e2e compares the signed bytes and verifies the signature. |
| T-06-23-03 | stubSim answers every simulate, execute and intent call, and health is overridden. No real EVACUATE was sent. |
| T-06-23-04 | The button is disabled when health is not "on" or there is no intent, and the worker issues no intent in simulate mode (06-22). |

## Requirements

ADMIN-11 now has its worker half (06-22) and its UI (this plan). The devnet proof is 06-24, so I have not ticked ADMIN-11 yet. ADMIN-01 and ADMIN-04 also stay unticked until 06-24.

## Known Stubs

None.

## Self-Check: PASSED

All five created files exist; commits 3683a80, 4a8d9fa and 203864f are in the log.
