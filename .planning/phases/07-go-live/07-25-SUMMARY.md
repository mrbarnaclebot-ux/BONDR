---
phase: 07-go-live
plan: 25
subsystem: phase verification and PR
tags: [verification, gates, pr]
requires: [07-24, 07-19, 07-21]
provides:
  - "Every autonomous Phase 7 gate green on one tree except the GitHub CI run (billing)"
  - "Evidence map: 3 ROADMAP criteria, 7 requirements, D-01..D-44"
  - "PR #7 (Phase 7: Go-Live) open; merge blocked on the owner's GitHub billing"
affects: [07-26 G-1 (starts from merged main with green CI), 07-36 (ticks the requirements)]
key-files:
  created:
    - .planning/phases/07-go-live/07-25-SUMMARY.md
    - .planning/phases/07-go-live/07-VERIFICATION.md
    - .planning/phases/07-go-live/07-HUMAN-UAT.md
  modified:
    - .planning/phases/07-go-live/07-DISCUSSION-LOG.md
key-decisions:
  - "07-25: the PR is not merged while CI has never run on GitHub; the merge waits for the owner's billing fix and a green rerun (never merge with red or missing CI)"
  - "07-25: no requirement ticked here; 07-36 ticks OPS-02, OPS-03, OPS-05, LAUNCH-08 and LAUNCH-09 per the plan set"
requirements-completed: []  # all seven are complete in code; OPS-04 and TOKEN-07 were ticked earlier; the rest close at 07-36
duration: 45min
completed: 2026-10-26
---

# Phase 7 Plan 25: Final verification and PR Summary

**Every autonomous Phase 7 gate passes on one tree: lint, typecheck, Vitest (848 passed, 2 skipped), the web build and bundle check, 32 @smoke specs, the full Playwright run (402 passed, 26 skipped), the devnet contract check and the 109 fork rows. No changed source file reaches 300 lines and no changed text file holds an emoji (8 check marks in the discussion log became "Chosen"). The PR "Phase 7: Go-Live" (#7) is open, but it is not merged: GitHub refuses to start any Actions job until the owner fixes the account billing, and the plan never merges without green CI.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Full gates, size and emoji checks | f3ee764 |
| 2 | Evidence map, the PR (merge blocked) | the docs(07-25) commit |

## Gate results

See 07-VERIFICATION.md "Gate run on one tree". Summary: On f3ee764: lint and typecheck clean; Vitest 109 files, 848 passed, 2 skipped; build and bundle check pass; @smoke 32 passed; full Playwright 402 passed, 26 skipped (devnet-only projects, no flaky).

## Evidence map: ROADMAP criteria

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Weekly contract check, pauses jobs on a forced mismatch | contract-check.test "a forced mismatch turns every switch off once, with one contract_check audit row (D-21)"; devnet run passes (07-25); fork genesis.contract (mainnet profile) | Code complete; mainnet pass at G-3 (07-28) |
| 2 | CI on every push; one-command scripts | ci.yml local emulation 818 passed, smoke 32 (07-19); test.sh --full (07-25); deploy.sh staging (07-24) | Blocked: GitHub billing |
| 3 | BONDR on mainnet through BONDR; children disabled until then | fork genesis.create and genesis.child landed (07-21); switch-gate.test "in genesis every switch-on is refused"; genesis.test | Gate G-5, plan 07-31 |

## Evidence map: requirements

| ID | Evidence | Status |
|---|---|---|
| OPS-02 | as criterion 1 | Code complete; 07-28 / 07-36 |
| OPS-03 | ci.yml; runs 40331597503, 40332148354, 40335057660, 40357497362 (f3ee764, the PR head) refused (billing) | Owner billing |
| OPS-04 | package.json setup:local, dev:all, verify, deploy; staging deploy 07-24 | Complete |
| OPS-05 | as criterion 3 | Gate G-5 (07-31), G-9 (07-35) |
| LAUNCH-08 | build.test "mainnet: the tip transfer is in the message and its account is a static key"; submit.test "a tipped launch goes out through Sender"; fork genesis.tip | Code complete; live relay at G-5, tip G-6 (07-33) |
| LAUNCH-09 | ticker.test; rules.test reservedTicker; launch-ticker.e2e; search-first.e2e; staging cooldown refusal (07-24) | Code complete; ticked at 07-36 |
| TOKEN-07 | ingest.test "only third-party window buys move sniped_bps"; db-admin.test sniped_bps check; coin-sniped.e2e | Complete (07-07) |

## Evidence map: decisions

| D | Evidence (test, fork row, log line, screenshot) or gate | Plan |
|---|---|---|
| D-01 | env.test "mainnet needs ALLOW_MAINNET=1; fork and unknown nets still refuse"; status.test launchNet | 07-04 |
| D-02 | per-net values only in fee-config.ts: fee-config.test; review found no new mainnet branch | 07-05 |
| D-03 | net.test "mainnet refuses a devnet genesis", connect("mainnet") refuses a local host; spike Net excludes mainnet | 07-04 |
| D-04 | fork.json 109 rows ok, mainnet profile | 07-21 |
| D-05 | mainnet web build serves /, /terms, /launch with no web flag | 07-06 |
| D-06 | gate G-1 | 07-26 |
| D-07 | proxy.test "www answers 308 to the apex"; DNS is an owner action | 07-03, 07-26 |
| D-08 | PRODUCTION.md section 3; gates G-1, G-11 | 07-26, 07-36 |
| D-09 | keys.test mainnet key ids separate; seed is gate G-3 | 07-04, 07-28 |
| D-10 | env.test "mainnet refuses a missing, malformed, off-curve or derivable TREASURY_PUBKEY"; address is gate G-2 | 07-04, 07-27 |
| D-11 | grind.test "production refills to 150 below 100" | 07-06 |
| D-12 | env-diff.test (hash-only, staging values never copied); applied at G-1/G-3 | 07-20 |
| D-13 | genesis-boot.test "a seeded all-on settings row ends all off ... one genesis audit row"; PRODUCTION.md section 5 | 07-17 |
| D-14 | PRODUCTION.md section 8; gate G-10 | 07-34 |
| D-15 | ingest-retry.test "-32015 ... dropped after one call"; v1-bondr-sell fixture in trades.test | 07-01 |
| D-16 | db-admin.test TRUNCATE 42501 and trigger; admin-intent.test "a store full of live unused intents answers 429"; admin-signin.e2e "a replayed sign-in signature is refused with 401" | 07-02 |
| D-17 | terms.e2e (#t08 contact); forwarding is an owner action | 07-03 |
| D-18 | contract-check.test (boot, Monday timer, admin route); log `contract check passed: pump=...` | 07-10 |
| D-19 | contract.test "the fork profile is the mainnet profile"; devnet run passes (07-25) | 07-08 |
| D-20 | contract-check.test "after a mismatch, contractFailed stays true until a later run passes" | 07-10 |
| D-21 | contract-check.test forced mismatch; devnet and fork runs pass; admin-contract.e2e mismatch callout | 07-10, 07-11 |
| D-22 | status.test "a failed contract check names itself ahead of every other reason"; launch-paused.e2e | 07-10 |
| D-23 | .github/workflows/ci.yml; GitHub run blocked on billing | 07-19 |
| D-24 | ci.yml has no secrets and no .env | 07-19 |
| D-25 | 32 @smoke specs pass against next start (07-25 test.sh) | 07-19 |
| D-26 | package.json setup:local, dev:all, verify, deploy; scripts/README.md | 07-20 |
| D-27 | deploy.sh production guards (typed word or --yes, clean tree, main, HEAD == origin/main, green CI) run before --dry-run exits | 07-20, review CR-O |
| D-28 | launch-genesis.e2e (owner fills /launch); genesis.test | 07-18 |
| D-29 | status.test "/status in genesis mode"; genesis-boot.test | 07-15, 07-17 |
| D-30 | switch-gate.test "on mainnet launches needs a passing contract check, then 100 free mints (D-30)" | 07-17, review WR-W-02 |
| D-31 | genesis.test "the owner's genesis builds with the treasury as creator"; fork genesis.verify | 07-16, 07-21 |
| D-32 | genesis.test "the genesis ticker is pinned to BONDR"; copy swap is optional at G-5 | 07-16, 07-31 |
| D-33 | fork genesis.create landed, genesis.child landed | 07-21 |
| D-34 | build.test, submit.test, fork genesis.tip; status.test Sender tip on mainnet only; launch-tip.e2e; amount is gate G-6 | 07-09, 07-33 |
| D-35 | ingest.test sniped_bps; db-admin.test check | 07-07 |
| D-36 | coin-sniped.e2e and screenshots coin-sniped-{390,768,1440} | 07-07 |
| D-37 | env.test "EVACUATE on: devnet, or mainnet with the external treasury"; admin-evacuate.test D-37; unlock is gate G-7 | 07-04, 07-29 |
| D-38 | PRODUCTION.md section 10 (seed leak runbook) | 07-22 |
| D-39 | PRODUCTION.md section 7, plans 07-26..07-36 in order | 07-22 |
| D-40 | ticker.test; staging second BBURN refused 409 ticker_locked | 07-13, 07-24 |
| D-41 | ticker.test "a hidden coin keeps its lock and the key is checkSymbol's normalized value" | 07-13 |
| D-42 | ticker.test "signed, sent and unknown rows hold with a pending lock"; 0008 launches_symbol_live index | 07-02, 07-13 |
| D-43 | ticker-copy.test; launch-ticker.e2e step 4; terms section 04 sentence | 07-12, 07-14, 07-03 |
| D-44 | rules.test "reservedTicker covers BONDR and the base tickers"; search-first.e2e; golive-search-first screenshots | 07-13, 07-14 |

## Open gates in order

1. Owner: GitHub billing, then CI rerun and the PR merge (blocks G-1).
2. G-1 (07-26), G-2 (07-27), G-3 (07-28), G-7 (07-29), G-4 (07-30), G-5 (07-31), G-8 (07-32), G-6 (07-33), G-10 (07-34), G-9 (07-35), G-11 (07-36).
3. Non-money owner items: DNS, hello@ forwarding, production ADMIN_WALLET, SENTRY_READ_TOKEN, HV-06-01, HV-06-02; HV-05-02 at the first mainnet forced bond. All in 07-HUMAN-UAT.md.

## Deviations from Plan

1. [Rule 1 - house rule] The emoji scan found 8 U+2713 check marks in 07-DISCUSSION-LOG.md (the GSD table's Selected column). Replaced with "Chosen". Commit f3ee764.
2. [Blocked] Task 2's merge and its verify command (`gh pr list --state merged`, CI success) cannot pass: GitHub refuses every Actions job until the owner fixes billing. The PR is open, the merge is recorded as blocked, the orchestrator merges once CI is green.
3. Added 07-VERIFICATION.md and 07-HUMAN-UAT.md (the orchestrator's verifier role) next to the SUMMARY.

## Self-Check

PASSED: 07-25-SUMMARY.md, 07-VERIFICATION.md and 07-HUMAN-UAT.md exist; commit f3ee764 exists; PR #7 is open. Task 2's verify command (merged PR, CI success) fails as expected until the owner fixes GitHub billing.
