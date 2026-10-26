---
phase: 06-admin-dashboard
reviewed: 2026-10-26
depth: standard (deep on money paths and auth)
files_reviewed: 174
status: fixed
---

# Phase 6 Code Review

The review ran in three slices. Each slice file lists every finding with its outcome and fix commit.

| Slice | File | Critical | Warning | Info | Outcome |
|---|---|---|---|---|---|
| Worker (apps/worker) | 06-REVIEW-worker.md | 1 | 10 | 5 | All Critical and Warning fixed; 2 Info fixed, 3 skipped |
| Web, core, root config | 06-REVIEW-web.md | 0 | 8 | 8 | All Warning fixed; 4 Info fixed, 4 skipped |
| e2e and fork stage | 06-REVIEW-e2e.md | 2 | 6 | 4 | All Critical and Warning fixed; 1 Info fixed, 3 skipped |

Headline fixes:
- CR-W-01: EVACUATE batches are urgent, so the ops floor never skips them after `pauseAll`.
- WR-B-03: the admin sign-in and every money intent carry a SIWS domain line from SITE_URL; the worker refuses intents without SITE_URL.
- WR-W-08: the legacy `POST /kill-switch` is audited and cannot re-enable launches after EVACUATE.
- CR-E-01, CR-E-02: the devnet console spec asserts this run's rows and runs in its own `devnet-admin` project.

Gates after the fixes: lint and typecheck clean; `pnpm test` 704 passed, 2 skipped; fork gate 99 ok, `spike:check` 123 passed.
