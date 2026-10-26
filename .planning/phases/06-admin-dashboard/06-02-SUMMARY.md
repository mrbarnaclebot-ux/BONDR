---
phase: 06-admin-dashboard
plan: 02
subsystem: contracts, public ledger copy
tags: [contracts, types, public-copy, tdd]
requires: [06-01]
provides:
  - packages/core/src/api-admin.ts (every admin payload, action, job and audit type)
  - LedgerKind leftover_burn and evacuate, in PUBLIC_KINDS, totalsFor and ledger-copy
  - eight admin LaunchErrorCode members with worker HTTP statuses inside web's PASS set
  - SENTRY_READ_TOKEN in forbiddenEnv (web refuses to boot with it)
affects: [06-03 onward: every plan that crosses the worker/web admin boundary]
tech-stack:
  added: []
  patterns: [types-only contract file beside api.ts, table test restating web's PASS set]
key-files:
  created:
    - packages/core/src/api-admin.ts
  modified:
    - packages/core/src/api.ts
    - packages/core/src/fees.ts
    - packages/core/src/fees.test.ts
    - apps/web/lib/ledger-copy.ts
    - apps/web/lib/ledger-copy.test.ts
    - apps/worker/src/http.ts
    - apps/worker/src/http.test.ts
    - packages/core/src/scrub.ts
    - packages/core/src/scrub.test.ts
    - packages/core/src/README.md
    - apps/web/components/launch-sign.tsx
    - .planning/STATE.md
decisions:
  - "06-02: leftover_burn adds only bond_burned (child tokens, not BONDR); evacuate uses the sweep_treasury totals shape (fee_budget -, to_treasury +, to_treasury_sol +)"
  - "06-02: admin error statuses: forbidden, blocked, bad_intent_signature 403; intent_used, not_applicable 409; intent_expired 410; simulation_failed, destination_refused 422"
  - "06-02: the launch fault map sends the eight admin codes to Build failed until 06-20 gives blocked its own copy"
metrics:
  duration: 15 min
  completed: 2026-10-25
  tasks: 2
  files: 13
---

# Phase 6 Plan 02: Admin contracts, public ledger kinds and error codes Summary

One types-only `api-admin.ts` now defines every admin shape both apps exchange (switches, actions, health, balances, simulation and intent, inspector, audit, moderation), the public ledger renders "Leftover burn" and "Emergency" rows with partitioned totals, eight admin error codes map to statuses web passes through, and web refuses to boot holding `SENTRY_READ_TOKEN`.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Public ledger kinds, totals and copy for leftover_burn and evacuate | 54337b9 |
| 2 | Admin contract types, error codes, HTTP statuses and the web env guard | 4fbe5ee |

## Task 1 notes

- RED: 4 failing cases (PUBLIC_KINDS length, totalsFor for both kinds, both COPY entries) before the change; GREEN: fees.test.ts and ledger-copy.test.ts 21 passed.
- `evacuate` and `leftover_burn` use the default value cell (`{sol} SOL` from `feeSol`, none when sol is null), so neither needed a `value()` override.
- The other `LedgerKind` lists in the worker (`fee-reconcile.ts` IN/OUT, `fee-send.ts` W_IN/W_OUT, `fee-ledger.ts` ONCE/BURN/SWEEP, `fee-guard.ts` HOLDS) are plain arrays, not exhaustive, so typecheck stayed green. Whichever plans write these rows (06-09 leftover burns, the EVACUATE plan) must add them there. In particular, reconcile OUT must count `evacuate`, or the nightly diff will report every evacuated W.

## Task 2 notes

- RED: 9 failing cases (8 status rows, the forbiddenEnv list); GREEN: http, scrub and bond tests 21 passed.
- `api-admin.ts`: 19 `export type`s, no imports, 180 lines. A script compared `AdminAuditAction` with the `admin_audit_action` CHECK in 0007: 18 names each, identical sets.
- http.test.ts restates PASS (`apps/web/lib/worker.ts` line 10 imports server-only, so the worker test cannot import it).
- Pitfall 15: `packages/core/src/bond.ts` line 91 computes `minOut` with `minOutAfter(pre, simOut)`; bond.test.ts passes; bond.ts is untouched. The STATE.md todo now reads "WR-08 minOut fixed in a8758e1 (verified in 06-02); leftover burns ship in 06-09 (D-17)".

## Verification

- `pnpm lint`: clean (320 files)
- `pnpm typecheck`: pass
- Plan verification (fees, ledger-copy, http, scrub, bond tests): all pass
- `pnpm test`, run 1: 60 files, 1 failed, 448 passed, 2 skipped. Run 2 (to name the failure): 4 failed under parallel Neon load. Three 30 s timeouts (prepare.test.ts, vanity.test.ts, db-admin.test.ts) and a coins.test.ts heroCounts count off by one (`launched: 16` vs 15, another suite's seeded coin was visible at that moment). Rerun alone, each passes: prepare 8/8, vanity 6/6, coins 12/12, db-admin 6/6. None of these suites touches this plan's files. No `test-` rows leaked in coins, wallets, vanity_mints, launches, trades, fee_ledger or blocked_deployers; admin_audit is at 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] launch-sign.tsx fault map is an exhaustive Record over the launch codes**
- **Found during:** Task 2 (the plan predicted this)
- **Issue:** `FAULTS: Record<Code, Fault>` broke typecheck once LaunchErrorCode grew.
- **Fix:** the eight admin codes map to `BUILD_FAILED`, with a comment that 06-20 gives `blocked` its own copy. A code missing from the map already falls back to Build failed, so behavior is unchanged.
- **Commit:** 4fbe5ee

The README `scrub.ts` line also now names the read token. That is a docs-only touch alongside the planned api-admin.ts line.

## Requirements

ADMIN-01, 03, 04, 06, 10 and 11 are listed on this plan, but it only lays their contracts. None is marked complete.

## For the next plans

- Until 06-03 lands, Playwright runs still need `--grep-invert admin-signin`.
- Reconcile, send and guard kind lists do not know `leftover_burn` or `evacuate` yet (see Task 1 notes).
- `memoryLedger.keysOf` in fee-ledger.ts still keys on `(signature, kind)`, carried over from 06-01.
- `blocked` launch copy ("This wallet cannot launch coins on BONDR.") belongs to 06-20.

## Self-Check: PASSED

- FOUND: packages/core/src/api-admin.ts, .planning/phases/06-admin-dashboard/06-02-SUMMARY.md
- FOUND: commits 54337b9, 4fbe5ee
