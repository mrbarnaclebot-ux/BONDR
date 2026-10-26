---
phase: 07-go-live
plan: 01
subsystem: ingest
tags: [v1, ingest, rpc, tdd]
requires: []
provides:
  - "Every getTransaction read asks for maxSupportedTransactionVersion 1 (fetchTx, admin inspector, capture-tx, e2e fixtures, pool-launch spike)"
  - "packages/core/src/fixtures/v1-bondr-sell.json: real devnet v1 tx AQ5D3WBU... (slot 515272717)"
  - "ingestOrKeep drops SolanaJSONRPCError -32015 after one call with one console.warn"
affects: [07-21 fork rehearsal, staging logs, mainnet ingest]
key-files:
  created:
    - packages/core/src/fixtures/v1-bondr-sell.json
    - apps/worker/src/ingest-retry.test.ts
  modified:
    - packages/core/src/send.ts
    - apps/worker/src/admin-inspect.ts
    - apps/worker/src/ingest.ts
    - scripts/capture-tx.ts
    - apps/web/e2e/fixtures.ts
    - scripts/spike/stages/pool-launch.ts
    - packages/core/src/trades.test.ts
    - apps/worker/README.md
key-decisions:
  - "07-01: v1 handled by raising maxSupportedTransactionVersion to the integer 1 (web3.js 1.99.0 decodes v1); checkMessage still refuses non-v0 for every message BONDR builds"
  - "07-01: -32015 is dropped, not retried; a future v2 would need the version raised again"
requirements-completed: []
duration: 15min
completed: 2026-10-26
---

# Phase 7 Plan 01: v1 Transaction Ingest Summary

**Ingest, settle, trade submit, fee meta, finalize and the admin inspector now read version 1 transactions. A real devnet v1 transaction is committed as a fixture and decodes through parseTx, a v1-shaped copy of two v0 fixtures parses identically, and an unreadable version costs one RPC call instead of twenty.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Version 1 at every transaction read, the v1 fixture and the parser proof | 9432d83 |
| 2 | Drop -32015 without retrying, with its unit check | fd89b21 |

## Evidence

- Red: before the change, `capture-tx.ts` against Helius devnet failed with `Transaction version (1) is not supported by the requesting client` (the -32015 path). After the change it wrote `fixtures/v1-bondr-sell.json (slot 515272717)`: `"version": 1`, 38 static keys, empty loadedAddresses, 157 log lines, no api key or URL.
- `trades.test.ts`: 16 passed. New cases: v1-bondr-sell gives 4 inner events, a BONDR price, 0 trades, 0 patches; `asV1(curve-buy)` and `asV1(launch-burn)` parse deep-equal to their v0 originals.
- `ingest-retry.test.ts` red (signature stayed in failedSigs) then green: 2 passed. Unit project: 81 files, 605 passed, 1 skipped.
- `rg "maxSupportedTransactionVersion: 0" packages apps scripts`: no match. send.ts still 294 lines with `not v0` in checkMessage. ingest.ts 265 lines.
- `pnpm lint` and `pnpm typecheck` clean.

## Deviations from Plan

1. **[Rule 2 - Stronger proof] The derived v1 test also covers launch-burn.** curve-buy has empty loadedAddresses, so flattening it proves nothing about index preservation. launch-burn has 16 writable and 10 readonly loaded keys, so it is added to the same test.
2. **Behavior case 2 and 3 merged into one test.** The transient-error case and the success case share one signature: a plain Error keeps it in failedSigs (try count is not exported; membership is the observable), and a resolving ingest then removes it.
3. The fixture holds 157 log lines, not the 192 RESEARCH recorded; the transaction and its 4 events match.

## Notes for later plans

- Staging still runs the old worker; the "Transaction version (1) is not supported" log lines stop only after the next staging worker deploy.

## Self-Check: PASSED

- FOUND packages/core/src/fixtures/v1-bondr-sell.json, apps/worker/src/ingest-retry.test.ts
- FOUND commits 9432d83, fd89b21
