---
phase: 01-chain-spike
plan: 02
subsystem: spike
tags: [walking-skeleton, results, evidence-page]
requires: [01-01]
provides:
  - "scripts/spike/results.ts: Net, Row, ResultsFile, Rule, Ctx, Stage contracts; loadResults, saveResults, recordRow, dropRow, resultsPath, netsFromEnv, emptyResults"
  - "packages/core/src/config.ts: readLiveConfig(conn) live Global, FeeConfig and AMM FeeConfig as JSON-safe facts"
  - "scripts/spike/run.ts: pnpm spike, crash-tolerant per-net stage runner"
  - "scripts/spike/check.ts: pnpm spike:check, strict rule gate plus secret scan"
  - "scripts/spike/page.ts: pnpm spike:page, static results/index.html independent of check"
  - "scripts/spike/results/devnet.json: live devnet config row with drift"
affects: [01-03, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10]
tech-stack:
  added: []
  patterns:
    - "One stage file plus one line in nets/<net>.ts per new spike step"
    - "Save after every recorded row; exit code decided only after saving"
    - "redact() over the whole serialized results file before it touches disk"
    - "Effective fee schedule: exotic schedule unless all zero, then flat"
key-files:
  created:
    - packages/core/src/config.ts
    - scripts/spike/results.ts
    - scripts/spike/run.ts
    - scripts/spike/check.ts
    - scripts/spike/page.ts
    - scripts/spike/README.md
    - scripts/spike/nets/devnet.ts
    - scripts/spike/stages/config.ts
    - scripts/spike/results/devnet.json
  modified:
    - package.json
decisions:
  - "Drift compares the effective schedule a BONDR-quoted coin pays: the exotic schedule, falling back to flat when it is all zero"
  - "A rerun that succeeds drops the stale <stage>.error or <net>.error row, so old crashes do not fail the check forever"
  - "The page evaluates stage rules itself, so a row that is ok but fails its rule shows as FAIL with the reason; it never imports check.ts"
metrics:
  duration: "about 9 min"
  completed: 2026-10-19
  tasks: 2
  files: 10
---

# Phase 1 Plan 02: Spike pipe, live devnet config, check and page Summary

The spike pipe now runs end to end on devnet: run, then results JSON, then check, then a static page. The first stage reads live pump Global, FeeConfig and AMM FeeConfig through `@bondr/core/config` and flags drift from PROJECT.md. It sent no transactions.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Results contract, run loop and live devnet config stage | 5f9c6a5 |
| 2 | Checker and the failure-tolerant static page | 5240402 |

## Live devnet config (results/devnet.json)

- creatorFeeConfigurable false, maxConfigurableCreatorFeeBps 0, maxCurveDepth 2
- initialVirtualSolReserves 0.3 SOL, globalBytes 1088, createV2Enabled true
- Curve flat 95 protocol / 30 creator. Curve exotic is 0/0.
- AMM flat 25 LP / 5 protocol / 0 creator. AMM exotic is 0/0/0. AMM tier 0 is 2 / 93 / 30.
- Drift: "creator fee not configurable, assumed 150 bps per coin; AMM LP 25 bps, assumed 20". This matches RESEARCH Pitfall 7 and is expected on devnet.

## Verification

- `SPIKE_NET=devnet pnpm spike` exits 0 and writes the config row. A second run skips the stage, which is the devnet skip rule.
- With a missing seed dir, the run records `devnet.error` ("run pnpm spike:keys first") and exits 1. The next good run drops that row and exits 0.
- `SPIKE_NET=devnet pnpm spike:check` exits 0. `SPIKE_NET=fork pnpm spike:check` exits 1 (no results file).
- `pnpm spike:page` writes results/index.html. It contains "Devnet", the config key/value table, the drift list, and the summary line "PASS 1, FAIL 0, EXPECTED FAIL 0, NOT RUN 0". It has 0 `<script` tags.
- Page tolerance, tested against a temporary devnet.json that was restored afterwards: a missing config row showed NOT RUN, an `ok: false` row showed FAIL with "code 6077: ...", and an expectFail row showed EXPECTED FAIL with its link, "700 / 1232", "1000 / 2000" and "TOP-UP: n". A `<script>` step label and quotes were escaped. Check exited 1 on the same file.
- The Helius key appears 0 times in devnet.json and index.html. `api-key=` appears 0 times.
- `pnpm lint`, `pnpm typecheck` and `pnpm vitest run packages/core` (5 tests) pass. Every new file is under 110 lines.

## Package freshness

No dependencies were added. The plan only uses packages pinned in 01-01.

## Deviations from Plan

1. **[Rule 2] Stale crash rows are cleared.** `dropRow()` removes `<stage>.error` after the stage succeeds and `<net>.error` after the net loads. Without this, one transient devnet RPC failure would leave a permanent not-ok row, and the check would fail forever. Commit 5f9c6a5.
2. **[Rule 2] Redaction at the save point.** `saveResults()` runs `redact()` over the whole serialized file, not only over `err`. Notes or facts that someday carry an RPC URL get redacted too (T-01-01b). Commit 5f9c6a5.
3. **[Rule 2] Seed length check in run.ts.** The seed loader rejects a file that is not 32 bytes, matching keygen. Commit 5f9c6a5.
4. **Page renders facts for any row with them.** The plan asked only for the config row, but the same key/value table works for any row with facts, so later stages need no page change. Drift renders as a list when `facts.drift` is present. Commit 5240402.

## Notes for later plans

- The stage crash path (`<stage>.error`, remaining stages skipped) is not exercised live yet. Only the net-level abort path was tested. The first stage that sends a transaction (01-03) will exercise it naturally.
- The secret scan fails on any `api-key=` text, including an already-redacted `api-key=<redacted>`. An error message carrying a redacted RPC URL therefore fails the check, which is the strict reading of the plan.
- `nets/fork.ts` does not exist yet. A fork run records `fork.error` until plan 01-04 adds it.
- Node prints "bigint: Failed to load bindings, pure JS will be used" on stderr when it loads web3.js. This is harmless.

## Known Stubs

None.

## Self-Check: PASSED

- All 9 created files and package.json are present.
- Commits 5f9c6a5 and 5240402 are on phase-01-chain-spike.
