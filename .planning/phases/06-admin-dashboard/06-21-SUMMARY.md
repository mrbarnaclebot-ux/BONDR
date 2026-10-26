---
phase: 06-admin-dashboard
plan: 21
subsystem: worker, web
tags: [inspector, decode, idl, worker, web, tdd]
requires: [06-20]
provides:
  - "apps/worker/src/admin-inspect.ts: inspect(conn, sig, known) -> AdminInspect, decodeIx(ix) -> {program, name, args}, knownKeys(env, engine) -> Known"
  - "POST /admin/inspect {actor, signature} in the gated map: 400 invalid_input for a non-signature (before any RPC call), 200 {found:false}, 503 rpc_failed"
  - "packages/core/src/pump.ts: getPumpProgram (pump-sdk) and getPumpAmmProgram (pump-swap-sdk 2.1.0)"
  - "AdminInspect.feePayer.mint?; contract code rpc_failed (HTTP 503)"
  - "apps/web/components/admin-inspect.tsx: AdminInspect({overview}), stacked with AdminModeration in the Timeline row's right column"
  - "Refresh moved to admin-topbar.tsx (exported); admin-console.tsx now 126 lines"
affects: [06-22, 06-23, 06-25, 06-26]
tech-stack:
  added: []
  patterns: [program-id map to decoder in the worker only, web renders labelled strings as React text]
key-files:
  created:
    - apps/worker/src/admin-inspect.ts
    - apps/worker/src/admin-inspect.test.ts
    - apps/web/components/admin-inspect.tsx
    - apps/web/e2e/admin-inspect.e2e.ts
  modified:
    - packages/core/src/pump.ts
    - packages/core/src/api-admin.ts
    - packages/core/src/api.ts
    - apps/worker/src/http.ts
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/README.md
    - apps/web/components/launch-sign.tsx
    - apps/web/components/admin-console.tsx
    - apps/web/components/admin-topbar.tsx
    - apps/web/components/README.md
    - apps/web/e2e/README.md
decisions:
  - "06-21: a bad signature answers 400 invalid_input (the existing contract code), not a new bad_request code; rpc_failed is a new code at 503 and launch-sign maps it to Build failed like the other admin codes"
  - "06-21: the SDK program coders are built once per process from an offline Connection: decode and format never read the chain, so decodeIx needs no connection argument"
  - "06-21: instruction index is 1-based (#1 is the first top-level instruction) in the lines and in the error's '#n'; inner (CPI) instructions are not decoded"
  - "06-21: the error line is '{contract code} (#n, code N Name)' or '{contract code} (#n, Kind)'; the name comes only from anchor's 'Error Code: X' log and a kind only if it is a bare identifier, so no raw log text reaches the browser"
  - "06-21: the web labels a W fee payer 'W {SYMBOL}' from the worker's mint or from overview.rows' w column, so it works with FEE_ENGINE off (the worker only knows engine coins' W)"
  - "06-21: Token and Token-2022 lines list the decoded keys (account, mint, owner, destination...) before the data fields; ATA creates list payer, account, owner, mint"
metrics:
  duration: 17 min
  completed: 2026-10-26
  tasks: 2
  files: 16
---

# Phase 6 Plan 21: Transaction inspector Summary

The owner pastes any devnet signature in the console and reads its status, slot, labelled fee payer, every top-level instruction decoded by program (System, Token, Token-2022, ATA, Compute Budget, pump, pump-amm, pump-fees through the pinned SDK coders) with its arguments, the mapped error and a Solscan link; the worker reads RPC only and the client bundle carries no program id.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 RED | c77a111 | admin-inspect.test.ts: curve-buy, forced-bond, crafted failures, unknown and garbage programs, null and dead RPC, fee payer labels |
| 1 GREEN | f394690 | admin-inspect.ts, the two pump.ts getters, feePayer.mint, rpc_failed, POST /admin/inspect with route tests |
| 2 | 055d6d9 | AdminInspect panel above Moderation, Refresh moved to admin-topbar.tsx, admin-inspect.e2e.ts |

## Verification

- `pnpm vitest run apps/worker/src/admin-inspect.test.ts apps/worker/src/admin-routes.test.ts`: 15 passed (8 + 7)
- `pnpm exec playwright test apps/web/e2e/admin-inspect.e2e.ts --project=chromium`: 4 passed, none skipped (the devnet RPC still has the curve-buy transaction; it decoded through the real local worker)
- `pnpm exec playwright test apps/web/e2e/admin-console.e2e.ts apps/web/e2e/admin-timeline.e2e.ts --project=chromium`: 8 passed (Refresh moved)
- `pnpm --filter @bondr/web build && bash scripts/check-client-bundle.sh`: exit 0
- `rg "db\(|drizzle" apps/worker/src/admin-inspect.ts`: no match
- `pnpm lint`, `pnpm typecheck`: clean
- Full `pnpm test`: 89 files, 671 passed, 2 skipped
- Sizes: admin-inspect.ts 183, admin-routes.ts 125, api-admin.ts 180, admin-inspect.tsx 145, admin-console.tsx 126 lines

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] launch-sign FAULTS needed the new code**
- **Found during:** Task 1
- **Issue:** adding `rpc_failed` to LaunchErrorCode broke the web typecheck (`FAULTS: Record<Code, Fault>`).
- **Fix:** `rpc_failed: BUILD_FAILED`, like the other admin codes a launch never gets.
- **Files modified:** apps/web/components/launch-sign.tsx
- **Commit:** f394690

**2. [Plan wording] 400 invalid_input instead of bad_request**
- The worker's 400 contract code is `invalid_input` everywhere; a second spelling would need a web copy entry for no gain. Status is 400 as planned.

**3. [Plan wording] Fixture tests use `new Connection(url, { fetch })`, not `connect(net, { fetch })`**
- `connect` needs helius_api_key for devnet and its Surfpool probe for fork uses the global fetch; a Connection with the fake fetch parses the fixture through the same web3.js code path.

**4. [Layout] Refresh moved from admin-console.tsx to admin-topbar.tsx**
- Freed the lines the 150-line console limit needed before wrapping the inspector and Moderation in `grid gap-8 [&>*]:min-w-0`.

## Known Stubs

None.

## Deferred

- Inspector screenshots at 390/768/1440 and axe for "the inspector with output" belong to 06-25 (UI-SPEC accessibility list).
- Inner (CPI) instructions are not listed; add from `meta.innerInstructions` if the owner needs them.

## Self-Check: PASSED

- FOUND: apps/worker/src/admin-inspect.ts, apps/worker/src/admin-inspect.test.ts, apps/web/components/admin-inspect.tsx, apps/web/e2e/admin-inspect.e2e.ts
- FOUND commits: c77a111, f394690, 055d6d9
