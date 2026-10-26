---
phase: 07-go-live
verified: 2026-10-26T16:00:00Z
status: human_needed
score: 0/3 roadmap criteria fully true; 3/3 complete in code, each waiting on an owner gate or CI
overrides_applied: 0
human_verification:
  - test: "Fix GitHub billing, then rerun CI on phase-07-go-live"
    expected: "ci workflow green; the Phase 7 PR squash-merged to main"
    why_human: "Billing on the owner's GitHub account"
  - test: "Owner gates G-1..G-11 in the D-39 order (plans 07-26..07-36)"
    expected: "Production online dark, mainnet contract check passing, BONDR genesis landed on mainnet, child launches open"
    why_human: "Railway and Helius billing, the seed, the treasury address and real SOL"
  - test: "HV-05-02, HV-06-01, HV-06-02, DNS, hello@ forwarding"
    expected: "See 07-HUMAN-UAT.md"
    why_human: "Owner accounts and wallets"
---

# Phase 7: Go-Live Verification Report

**Phase Goal:** As the owner, I want BONDR live on mainnet with guardrails, so that strangers can launch without asking me.
**Mode:** mvp
**Verified:** 2026-10-26
**Status:** human_needed. Every autonomous check passes on one tree (f3ee764 plus this report). What is left needs the owner: GitHub billing for CI, then the eleven gates.

## Gate run on one tree (07-25 Task 1)

| Check | Result | Evidence |
|---|---|---|
| `pnpm lint` (Biome, includes the 40-line function rule on non-test files) | pass | scratchpad full-0725.log |
| `pnpm typecheck` | pass | same |
| Vitest, unit and DB projects (Neon dev branch) | pass: 109 files, 848 passed, 2 skipped | same |
| `next build` plus `check:bundle` | pass | same |
| @smoke against `next start` (the CI set) | pass: 32 passed | same |
| Full Playwright run (`pnpm e2e`, local worker plus dev DB) | pass: 402 passed, 26 skipped (devnet-only projects), 0 flaky, 11.4 min | same |
| Devnet contract check `scripts/contract-check.ts --net devnet` | pass, exit 0, slots pump 510657843, pump AMM 508659436, pump fees 508659783 | 07-25 run |
| Fork rows (mainnet profile, 07-21, re-run after the review) | 109 ok; genesis.create landed, genesis.tip, genesis.launch.table.burn, genesis.child landed, genesis.contract, genesis.verify, genesis.verify-neg all pass | scripts/spike/results/fork.json |
| CI on GitHub | NOT RUN: GitHub refuses to start jobs (account billing). Runs 40331597503, 40332148354, 40335057660, and 40357497362 on the PR head f3ee764 | `gh run list --branch phase-07-go-live` |
| CI emulated locally (fresh clone, no .env, PostgreSQL 18) | 818 passed, 2 skipped; smoke 32 passed (07-19) | 07-19-SUMMARY.md |
| Staging (devnet) on the Phase 7 build | deployed by deploy.sh at 5b26c35; 0008 applied; BBURN and BSELL landed; ticker cooldown refused a second launch | 07-24-SUMMARY.md |
| Size: changed source files at 300 lines or more | none (`.ts .tsx .sh .mjs .js .yml`) | 07-25 scan |
| Emoji (U+1F300-1FAFF, U+2600-27BF) in changed text files | none after f3ee764 replaced 8 check marks in 07-DISCUSSION-LOG.md | 07-25 scan |

Planning docs over 300 lines (ROADMAP, STATE, CONTEXT, RESEARCH, PATTERNS, UI-SPEC, REVIEW-ops) are GSD artifacts, not source, and are excluded as in every earlier phase.

## ROADMAP Phase 7 success criteria

| # | Criterion | In code | What remains | Status |
|---|---|---|---|---|
| 1 | The weekly contract check verifies pump program IDs, IDL account layouts and Global flags, and pauses jobs on a forced mismatch | Done. Worker runs it at boot, every Monday at FEE_BATCH_HOUR_UTC and on POST /admin/contract-check (07-10). contract-check.test "a forced mismatch turns every switch off once, with one contract_check audit row (D-21)". Devnet run passes against the devnet profile (today), fork run passes against the mainnet profile (genesis.contract) | The first run against real mainnet at G-3 boot (07-28) | Code complete, mainnet pass pending G-3 |
| 2 | Every push runs lint, tests and a Playwright smoke test in CI, and `scripts/` sets up, runs, tests and deploys BONDR with one command each | Done. ci.yml (07-19) green in local emulation; setup:local, dev:all, verify, deploy (07-20); deploy.sh staging ran for real (07-24, OPS-04 ticked) | A green GitHub run: blocked on the owner's GitHub billing | Blocked on owner (billing) |
| 3 | The BONDR token is launched on mainnet through BONDR (SOL pair, treasury as creator, insta burn), and child launches stay disabled until it exists | Done. buildGenesis (07-15), genesisOne owner-only, once, burn-only (07-16), genesis boot with every switch off and switch-on refused (07-17, switch-gate.test), owner page (07-18), fork rehearsal landed genesis then a child in the new mint (07-21) | The mainnet launch itself: G-1..G-5 (07-26..07-31) | Code complete, launch pending G-5 |

## Requirements

| ID | Requirement | In code | Remaining | REQUIREMENTS.md |
|---|---|---|---|---|
| OPS-02 | Weekly contract check, pauses jobs on mismatch | Complete (criterion 1 row) | First mainnet pass at G-3 (07-28) | Pending; 07-36 ticks |
| OPS-03 | CI runs lint, tests and a Playwright smoke test on every push | Complete (ci.yml, local emulation green) | GitHub billing, then a green run | Pending; 07-36 ticks |
| OPS-04 | One-command setup, dev, test and deploy | Complete | none | Complete (07-24) |
| OPS-05 | BONDR launched on mainnet through BONDR; child launches only after | Complete (criterion 3 row) | G-5 genesis, G-9 open launches | Pending; 07-36 ticks |
| LAUNCH-08 | Mainnet launches through Helius Sender, tip inside the dev-signed tx | Complete: build.test (tip is a static key, dropped with a warning past 1,232 bytes), submit.test (Sender first, one RPC resend, never failed on a timeout), fork genesis.tip (757 bytes tipped) | A live Sender relay at G-5; tip amount confirmed at G-6 | Pending; 07-36 ticks |
| LAUNCH-09 | 24h ticker cooldown, reserved tickers, First marker | Complete: ticker.test, rules.test reservedTicker, launch-ticker.e2e, search-first.e2e; proven live on staging (BBURN/BSELL cooldown, 07-24) | none in code; closed with the phase at 07-35/07-36 | Pending; 07-36 ticks |
| TOKEN-07 | Sniped % on the token page | Complete: ingest.test "a launch records its create slot, and only third-party window buys move sniped_bps", coin-sniped.e2e | none | Complete (07-07) |

## Phase code review

07-REVIEW.md: 8 Critical, 11 Warning, 19 Info across three slices. All Critical and Warning fixed except WR-O-05 (CI green on GitHub), which is the billing blocker above.

## Open items

- The Phase 7 PR (#7, https://github.com/mrbarnaclebot-ux/BONDR/pull/7) is open and NOT merged: CI has never run on GitHub. Merge after the owner fixes billing and the rerun is green. G-1 depends on it (deploy.sh production requires HEAD == origin/main and green CI for that SHA).
- EVACUATE answers not_ready in genesis mode (it needs the BONDR mint); usable after G-5. Flagged in 07-17.
- Owner question: awaiting_migration vs kill_switch order in the paused reason (07-15 note). Kept the 07-10 order.
- 07-SECURITY.md is written separately by the security auditor.

_Verifier: gsd-verifier role inside 07-25_
