---
phase: 07-go-live
reviewed: 2026-10-26
depth: standard (deep on mainnet enablement, genesis, contract check, deploy scripts)
files_reviewed: 147
status: fixed (WR-O-05 owner-blocked on GitHub billing)
---

# Phase 7 Code Review

Three slices; each file lists every finding with its outcome and fix commit.

| Slice | File | Critical | Warning | Info | Outcome |
|---|---|---|---|---|---|
| Worker | 07-REVIEW-worker.md | 3 | 3 | 6 | All Critical and Warning fixed; 3 Info fixed |
| Web and core | 07-REVIEW-web.md | 0 | 2 | 6 | All Warning fixed; 5 Info fixed |
| Scripts, CI, runbook, e2e | 07-REVIEW-ops.md | 5 | 6 | 7 | All fixed except WR-O-05 (CI blocked by GitHub billing, owner) |

Headline fixes:
- CR-W-01: a Sender-delivered launch whose RPC resend is rejected stays `sent` until settle reads its signature status; never marked failed.
- CR-W-02/03, WR-W-01: the contract check fails closed on layout changes, retries the switches-off write until it lands, and blocks automatic money jobs and launches on mainnet until a run passes.
- WR-W-02: no switch can be turned on during genesis; launches open on mainnet only with a passing check and at least 100 free vanity mints.
- CR-O-01..05: no runbook step or script prints a variable value; the production seed is generated on the owner's phone and never stored on the Mac; every Railway call is pinned to the bondr project; production deploys require HEAD == origin/main, a clean tree and green CI for that SHA.

Gates after the fixes: lint and typecheck clean; `pnpm test` 848 passed, 2 skipped; fork 109 rows ok.
