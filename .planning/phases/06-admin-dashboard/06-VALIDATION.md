---
phase: 6
slug: admin-dashboard
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-25
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Built from 06-RESEARCH.md, Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 for units (DB-backed tests skip without DATABASE_URL). Playwright 1.63.0 with axe 4.13.0 for UI (`*.e2e.ts`), devnet e2e behind `E2E_DEVNET=1`. Spike runner on Surfpool 1.6.1 for the fork rows |
| **Config file** | No Vitest config (defaults, `*.test.ts`). `playwright.config.ts` (projects `chromium`, serial `paused`, plus a serial admin project). `scripts/spike/nets/fork.ts` |
| **Quick run command** | `pnpm vitest run <touched test files>` and `pnpm lint` |
| **Full suite command** | `pnpm test && pnpm lint && pnpm typecheck`, plus `pnpm --filter @bondr/web build && pnpm check:bundle` after any client change |
| **Fork gate** | `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` (adds `admin.*` rows) |
| **Estimated runtime** | About 60 s for units, 5 min for the full e2e, 75 s for the fork gate |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run <touched test files>` and `pnpm lint`
- **After every plan wave:** the full suite command. After a wave that touches chain code, also the fork gate
- **Before `/gsd:verify-work`:** all of these must be green:
  - the full suite and `pnpm check:bundle`
  - the fork gate, with every `admin.*` row passing
  - the local admin e2e (`pnpm exec playwright test apps/web/e2e/admin*.e2e.ts`)
  - the local devnet admin run with ops spend printed (phase total under 0.1 SOL)
  - the staging locked-state matrix
  - the Neon idle checks (no browser open, and console tab open about 8 minutes)
- **Max feedback latency:** 60 s for units

---

## Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command |
|-------------|----------|-----------|-------------------|
| ADMIN-01 | Admin sign-in text domain-separated; tagged cookie; public cookie refused; 30 min expiry; wrong wallet gets no cookie; nonce single use | unit + DB + e2e | `pnpm vitest run apps/web/lib/session.test.ts`; `pnpm exec playwright test apps/web/e2e/admin-signin.e2e.ts` |
| ADMIN-01 | Intent binds action, coin, id, expiry; single use; wrong wallet, tampered text and expired intent refused | unit | `pnpm vitest run apps/worker/src/admin-intent.test.ts` |
| ADMIN-01 | Worker 403 on every `/admin/*` with ADMIN_WALLET unset or invalid, or actor mismatch | unit | `pnpm vitest run apps/worker/src/admin-routes.test.ts` |
| ADMIN-02 | W state derivation; trigger ready; totals; balances payload | unit + e2e | `pnpm vitest run apps/web/lib/admin-copy.test.ts`; `admin-console.e2e.ts` |
| ADMIN-03 | Registry: every action has applies/allow/run and a reason; not-applicable codes | unit | `pnpm vitest run apps/worker/src/admin-actions.test.ts` |
| ADMIN-03 | Retry forced bond, Burn W token balance, Run migrate, Finalize split, Distribute now land on the fork through simulate then execute | fork | `SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` (rows `admin.*`) |
| ADMIN-03 | Sweep now, Burn buyback now, Re-check launch on devnet | devnet | local devnet admin run (`E2E_DEVNET=1`) |
| ADMIN-04 | Outflow decoder: transfers, CloseAccount, Burn allowed; unknown recipient refused as a 200 sim result | unit | `pnpm vitest run apps/worker/src/admin-dest.test.ts` |
| ADMIN-04 | Simulated balance diff equals landed delta for single-tx actions | fork | fork rows assert sim delta equals landed delta |
| ADMIN-05 | Each job skips when its switch is off; admin deps bypass; reconcile ungated | unit | `pnpm vitest run apps/worker/src/switches.test.ts apps/worker/src/fee-engine.test.ts` |
| ADMIN-05 | Flip in UI persists (DB + memory), audit row, revert on failure | e2e (serial) | serial admin Playwright project |
| ADMIN-06 | RPC ring p50/p95/errors/429 over 1 h; Sentry count cache and no-token path; health never touches DB | unit | `pnpm vitest run apps/worker/src/rpc-stats.test.ts apps/worker/src/sentry-count.test.ts apps/worker/src/health.test.ts` |
| ADMIN-07 | `coinRows` excludes hidden; token page still 200; prepare refuses blocked deployer | unit + DB + e2e | `pnpm vitest run apps/web/lib/coins.test.ts apps/worker/src/prepare.test.ts`; `admin-moderation.e2e.ts` |
| ADMIN-08 | Timeline steps and next-step copy; stuck after 3 failures | unit | `pnpm vitest run apps/web/lib/admin-copy.test.ts` |
| ADMIN-09 | Decode fixture txs offline: program labels, ix names, error name | unit | `pnpm vitest run apps/worker/src/admin-inspect.test.ts` |
| ADMIN-10 | Audit insert before send, settle once, CHECKs refuse bad combos; keyset page | DB | `pnpm vitest run packages/core/src/db.test.ts apps/worker/src/admin-audit.test.ts` |
| ADMIN-11 | Phrase exact match; packing within 1232 bytes; switches off before first send; per-W evacuate rows; two-mint tx insert; reconcile counts evacuate | unit + DB | `pnpm vitest run apps/worker/src/admin-evacuate.test.ts apps/worker/src/fee-ledger.test.ts apps/worker/src/fee-reconcile.test.ts` |
| ADMIN-11 | EVACUATE drains dev-database coins on devnet | devnet (local) | scripted run, then a balance printout of every W |
| UI | 390/768/1440 axe 0, no horizontal scroll, screenshots | e2e | `admin-responsive.e2e.ts` via `shoot.ts gate()` |

Plan and task IDs: see each 06-NN-PLAN.md `<verify>` block (26 plans).

---

## Wave 0 Requirements

- [ ] Worker unit test files: `admin-intent`, `admin-dest`, `admin-actions`, `admin-routes`, `admin-evacuate`, `admin-inspect`, `admin-audit`, `rpc-stats`, `sentry-count`, `health`, `switches`
- [ ] `apps/web/lib/admin-copy.test.ts`; extend `session.test.ts`, `ledger-copy.test.ts`, `coins.test.ts`, `scrub.test.ts`
- [ ] `scripts/spike/stages/admin.ts` with its fork entry
- [ ] `apps/web/e2e/admin-*.e2e.ts`, an admin key helper in `phantom.ts`, admin stubs, a serial Playwright project, `PHASE6_SHOTS`
- [ ] `playwright.config.ts` injects the test `ADMIN_WALLET` into local webServer envs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner signs in on staging with the real Phantom | ADMIN-01 | Needs the owner's wallet; staging stays locked until `ADMIN_WALLET` is set | Set `ADMIN_WALLET` on staging web and worker, sign in, inspect a signature, simulate Burn buyback now and EVACUATE |
| Sentry issue count cell | ADMIN-06 | Needs an owner-created `SENTRY_READ_TOKEN` | Set the token on the staging worker, confirm the Health cell shows a count |
| Neon suspends with the console open | ADMIN-06 | Wall-clock check | Leave the console tab visible about 8 minutes, confirm with `neonctl` the compute suspends |

---

## Validation Sign-Off

- [x] All tasks have an automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency under 60 s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** plan-checker passed 2026-10-25 (iteration 3); Wave 0 files are created during execution
