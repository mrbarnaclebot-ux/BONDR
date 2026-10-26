---
phase: 06-admin-dashboard
plan: 25
subsystem: e2e
tags: [responsive, axe, accessibility, designer-review, screenshots]
requires:
  - 06-24 devnet console run (last console change before the matrix)
  - 06-18 simulation dialog, 06-21 inspector, 06-23 EVACUATE section
provides:
  - apps/web/e2e/admin-responsive.e2e.ts (Phase 6 accessibility matrix, 36 screenshots)
  - admin-stubs.ts INSPECT and EVAC fixtures
  - lib/format.ts plural (shared count helper)
affects: [06-26]
tech-stack:
  added: []
  patterns:
    - an admin spec that signs in in every test sends a per-test x-real-ip (the session route allows 10 calls per IP per 10 minutes)
    - gate() plus a sub-44px target sweep over main's buttons and inputs below 768px
key-files:
  created:
    - apps/web/e2e/admin-responsive.e2e.ts
  modified:
    - apps/web/e2e/admin-stubs.ts
    - apps/web/e2e/README.md
    - apps/web/e2e/admin-devnet.e2e.ts
    - apps/web/components/token-ledger.tsx
    - apps/web/components/token-bond.tsx
    - apps/web/components/admin-sim.tsx
    - apps/web/components/admin-evacuate.tsx
    - apps/web/lib/format.ts
    - apps/web/lib/admin-copy-health.ts
    - apps/web/lib/admin-copy-audit.ts
    - apps/web/lib/admin-copy-evac.ts
    - apps/web/lib/admin-copy-audit.test.ts
    - apps/web/lib/admin-copy-evac.test.ts
decisions:
  - "The simulation dialog eyebrow reads 'Simulated, then sent' in the sending and done phases; the UI-SPEC's constant 'Simulated, nothing sent yet' is false after a send (Designer blocker, small copy departure)"
  - "Wallet counts use the shared plural helper (now in lib/format.ts): '1 wallet', 'EVACUATE: 1 wallet', '1 W balance'"
  - "The audit-log-with-rows state is the console-healthy shot (the full page holds the audit table with the dev rows); no separate file"
  - "The matrix runs parallel, not serial: every test is independent and stubbed, and a serial run would stop at the first failure"
metrics:
  duration: 45 min
  completed: 2026-10-26
  tasks: 2
  files: 15
---

# Phase 6 Plan 25: Responsive and axe matrix, Designer sign-off Summary

Every UI-SPEC accessibility state of the console passed at 390, 768 and 1440. Each had 0 axe violations, no horizontal page scroll and no control under 44px below 768px. The first full run produced 36 screenshots. Both tables scroll only inside their own regions. The Designer review found two copy blockers (wrong plural counts, and a dialog line that stays false after a send) and both are fixed. The token page padding bug deferred from 06-12 is fixed and checked in the 1440 shot.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Responsive and axe matrix | a491d6a | admin-responsive.e2e.ts, admin-stubs.ts, e2e/README.md, 36 screenshots |
| 1 (deferred item) | 1100px panel padding on the token page | bfc65d6 | token-ledger.tsx, token-bond.tsx |
| 2 | Designer critique and audit fixes | baf0806 | admin-sim.tsx, admin-evacuate.tsx, format.ts, admin-copy-*.ts and tests, admin-devnet.e2e.ts, refreshed screenshots |
| 2 | Phase 5 token page shots refreshed after the padding fix | d598619 | 21 Phase 5 screenshots |

## Task 1: matrix result

Command: `pnpm exec playwright test apps/web/e2e/admin-responsive.e2e.ts --project=chromium --reporter=line`

- First run: 24 passed and 5 failed. All 5 failures were in the spec itself: an anchored `getByText` regex does not match a Callout's alert text, so the spec now uses `getByRole("alert").filter`. No gate() check failed on any component.
- Final run: **29 passed, 1 skipped**. The skip is the dialog at 768, which the UI-SPEC lists only at 390 and 1440.
- axe: **0 violations** in each of the 36 gated states. Horizontal scroll: none. Sub-44px controls below 768px: none.
- Component edits caused by a gate() failure: **none**. The admin components were review-only in Task 1.

Screenshots are in `.planning/phases/06-admin-dashboard/screenshots/`, named `admin-{state}-{width}.png`, 36 files:

| State | 390 | 768 | 1440 |
|-------|-----|-----|------|
| signin-connect | yes | yes | yes |
| signin-wrong | yes | yes | yes |
| signin-ended | yes | yes | yes |
| console-healthy (with the audit log rows) | yes | yes | yes |
| ops-low (stuck STUK selected) | yes | yes | yes |
| inspect (routed output) | yes | yes | yes |
| moderation-error ("No BONDR coin matches zzzzzz.") | yes | yes | yes |
| evacuate-disarmed | yes | yes | yes |
| evacuate-simulated (stubbed, "Sign and evacuate 12 wallets") | yes | yes | yes |
| sim-failed, sim-ready, sim-landed | yes | n/a | yes |
| coin-ledger (seeded Leftover burn and Emergency rows) | yes | yes | yes |

The not-configured sign-in card needs a server without ADMIN_WALLET. 06-26 gates it on staging, as the plan says.

**Deferred token-ledger item (06-12):** a new check asserts both token page panels' `padding-top` at every width. Before the fix it failed at 1440 (expected 24px, got 32px). That confirmed `md:p-8` was beating `min-[1100px]:p-6`. `token-bond.tsx` used the same class string, so both files now use `min-[68.75rem]:p-6`. The check passes at all three widths (16, 32 and 24px). It is marked fixed in deferred-items.md.

## Task 2: Designer critique and audit

This was a written review against 06-UI-SPEC.md and DESIGN-BRIEF section 5 order. The deterministic `impeccable` detector was skipped because it is not installed and installing it was out of scope.

**Critique, Nielsen heuristics (before fixes, then after)**

| # | Heuristic | Score | Note |
|---|-----------|-------|------|
| 1 | Visibility of system status | 3 then 4 | Health, Loaded and the result lines are clear. The dialog eyebrow said "nothing sent yet" after "Sent. 2 of 2 transactions landed." (fixed) |
| 2 | Match with the real world | 3 then 4 | Engine names are kept verbatim. "1 wallets" appeared in the real audit row "EVACUATE: 1 wallets" (fixed) |
| 3 | User control and freedom | 4 | Cancel takes focus first. Hold and Release, Hide and Unhide, Block and Unblock are each reversible |
| 4 | Consistency and standards | 4 | Same panel shell, tag tones and button sizes everywhere |
| 5 | Error prevention | 4 | Every money action simulates first. EVACUATE needs the exact phrase plus a signature, and Enter does not send |
| 6 | Recognition over recall | 3 | Greyed actions explain themselves on activation, but only through the hint line (non-blocking) |
| 7 | Flexibility and efficiency | 3 | Chips filter, stuck coins sort first and the first stuck coin is auto-selected. No shortcuts (none in scope) |
| 8 | Aesthetic and minimalist | 3 | Dense but ordered. Accent stays on its list |
| 9 | Error recovery | 4 | Every error says what happened and that nothing was sent, then offers Simulate again |
| 10 | Help and documentation | 3 | Inline prose per panel. The runbook link is out of scope |
| | **Total** | **34/40 before, 36/40 after** | Excellent band |

**Audit (accessibility, performance, theming, responsive, anti-patterns):** A11y 4 (axe 0 at every width, the dialog uses showModal, aria-disabled controls stay focusable, every state is a word), Performance 3 (no polling DB reads; full-page shots are heavy only in dev), Theming 4 (only existing tokens), Responsive 4 (no page scroll from 390 up, sticky Coin and Time columns, 44px targets), Anti-patterns 4 (it follows the project's own system, with no AI-template tells). **19/20.**

**Layout order:** At every width the order matches the mockup and section 5: Wallets, Kill switches, Health; W table; Timeline with the Inspector and Moderation stack; Audit log; EVACUATE last.

**Must-not-ship grep:** `rg -n "leader lock|lease|auto-paused|Pump contract check|title=\"Not valid in this state\"" -i apps/web/components/admin-*.tsx` matches the "Leader lock" label in admin-health.tsx. It also matches comments and `release_hold` identifiers, because "release" contains "lease". There is no lease copy and none of the other phrases appear.

**Blockers and fixes (commit baf0806)**

1. Plural counts. Before: "EVACUATE: 1 wallets" (visible in the real audit log), "Sign and evacuate 1 wallets", "Every W balance moves to the treasury, 1 wallets.", "1 W balances", "burned in 1 wallets". After: the shared `plural()` (moved from admin-copy-health.ts to lib/format.ts) produces "1 wallet". New unit checks were added to admin-copy-audit.test.ts and admin-copy-evac.test.ts. The admin-devnet button regex now accepts `wallets?`.
2. Dialog eyebrow after send. Before: "Simulated, nothing sent yet" above "Sent. 2 of 2 transactions landed." After: "Simulated, then sent" in the sending and done phases. The responsive spec asserts it in the landed state.

After the fixes the spec reran at 29 passed and 1 skipped, still with 0 axe violations.

**Non-blocking, listed and not built**

- At 390 the panel headings "Fee wallets (W)", "Timeline, STUK" and "Audit log" wrap to two or three lines beside their head notes. Stacking the note under the h2 below 768px would read better.
- Health "Last runs" packs five "not since boot" phrases into one mono value. A shorter "none since boot" would be clearer when every value is null.
- The EVACUATE intro counts every coin (overview rows), while the button counts W with balances from the simulation. Both follow the UI-SPEC, but the two numbers can differ. In the stubbed shot they read 4 and 12.
- The Moderation "Wallet address" placeholder is mono and "Symbol or mint" is sans. This is intended (addresses are mono), but it looks uneven.

## Gates

- `pnpm lint`: clean (427 files).
- `pnpm typecheck`: clean.
- Playwright, chromium: admin-responsive, admin-sim, admin-evacuate, fee-bonded, fee-ledger, fee-live and responsive-fee gave **79 passed and 10 skipped** (3.3m). The skips are the staging-only groups, home-norail because a dev curve coin has a budget, and the dialog at 768. No Neon cold-start retry was needed.
- `pnpm test`: **92 files, 690 passed, 2 skipped** (436 s).
- Playwright started and stopped its own dev servers. Ports 3000 and 8080 are free.

## Deviations from Plan

1. [Rule 1 - Bug] token-bond.tsx had the same deferred padding bug as token-ledger.tsx. It got the same fix (the orchestrator asked for token-ledger only). Commit bfc65d6.
2. [Rule 3 - Blocking] admin-responsive.e2e.ts went over 300 lines, so the INSPECT and EVAC fixtures moved into admin-stubs.ts.
3. [Rule 3 - Blocking] Each test sends its own x-real-ip. Without it, about 27 sign-ins from one IP would hit the admin session limit (10 per 10 minutes).
4. The Designer fixes touched files outside files_modified: lib/format.ts, admin-copy-health.ts, admin-copy-audit.ts, admin-copy-evac.ts, the two copy tests and admin-devnet.e2e.ts. The copy lives in lib, not in the components.
5. The plan said serial, but the spec runs in parallel because every test is independent and stubbed.
6. The audit-log state shares the console-healthy screenshots instead of having its own file.

## Known Stubs

None. All fixtures are test-only.

## Self-Check: PASSED

- FOUND: apps/web/e2e/admin-responsive.e2e.ts, 36 admin-*.png in screenshots/
- FOUND commits: bfc65d6, a491d6a, baf0806, d598619
