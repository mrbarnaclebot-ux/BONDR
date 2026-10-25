---
phase: 5
slug: fee-engine-and-public-ledger
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-25
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Built from 05-RESEARCH.md, Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 for units (DB-backed tests skip without DATABASE_URL). Playwright 1.63.0 with axe 4.13.0 for UI and the devnet e2e (`E2E_DEVNET=1`). The spike runner for the fork rows (`pnpm spike:check`) |
| **Config file** | No Vitest config (defaults, `*.test.ts`). `playwright.config.ts` (`*.e2e.ts`). `scripts/spike/nets/fork.ts` |
| **Quick run command** | `pnpm vitest run <touched test files>` |
| **Full suite command** | `pnpm test && pnpm lint && pnpm typecheck` |
| **Fork gate** | `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` (about 75 s) |
| **Estimated runtime** | About 60 s for units, 5 min for the full e2e, 75 s for the fork gate |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run <touched test files>` and `pnpm lint`
- **After every plan wave:** the full suite command. After a wave that touches chain code, also the fork gate
- **Before `/gsd:verify-work`:** all of these must be green:
  - the full suite
  - the fork gate, with every `engine.*` row passing and W at 0 child tokens
  - `E2E_DEVNET=1 FEE_WINDOW_MS=600000` locally
  - the staging matrix
  - an ops spend printout under 0.1 SOL
- **Max feedback latency:** 60 s for units

---

## Requirement Verification Map

The planner fills task IDs. Each plan's tasks must point to one of these commands.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| FEE-01 | split = floor(delta / 10) from the collect meta; no split without a collect; unique ref | unit + devnet e2e | `pnpm vitest run packages/core/src/fees.test.ts apps/worker/src/fee/ledger.test.ts` | No (W0) |
| FEE-02 | trigger at 105% on budget plus 90% of unclaimed fees; costFromReserves equals the SDK cost; WR-08 minOut | unit + fork | `pnpm vitest run packages/core/src/curve.test.ts packages/core/src/math.test.ts`; fork row `engine.forced` | Partial |
| FEE-02 | Sender path: plain send on devnet; on mainnet, the tip, price and allowlist | unit | `pnpm vitest run apps/worker/src/fee/send.test.ts` | No (W0) |
| FEE-03 | fallback burn on migration; W ends at 0 child tokens | fork | fork row `engine.pool.burn` | No |
| FEE-04 | window index and next end from launchedAt; no retroactive window; a zero budget writes no row | unit + devnet e2e | `pnpm vitest run packages/core/src/fees.test.ts` | No (W0) |
| FEE-05 | deployer pre-flight; finalize state read from chain; closing sweep | unit + fork | `pnpm vitest run packages/core/src/fees.test.ts`; fork rows `engine.finalize.config` and `engine.finalize.update` | No |
| FEE-06 | buyback burn row; supply drops by exactly the amount burned | devnet e2e | `E2E_DEVNET=1 pnpm e2e apps/web/e2e/fee-devnet.e2e.ts` | No |
| FEE-07 | distribute above the minimum, 80:20 within 1 unit | fork | fork row `engine.distribute` | No |
| FEE-08 | the ops floor, from `postBalances[0]`, pauses non-urgent jobs only | unit | `pnpm vitest run apps/worker/src/fee/engine.test.ts` | No (W0) |
| FEE-09 | a difference between implied and chain balances writes reconcile_diff | unit + DB | `pnpm vitest run apps/worker/src/fee/batch.test.ts` | No (W0) |
| D-08 | pending recovery (landed, expired, poll); the index refuses a second intent | unit + DB | `pnpm vitest run apps/worker/src/fee/recover.test.ts packages/core/src/db.test.ts` | Partial (extend db.test) |
| TOKEN-03/04/05 | panel, ledger, totals, rail and hero; axe 0 at 390, 768 and 1440 | e2e (seeded) | `pnpm e2e apps/web/e2e/fee-ledger.e2e.ts apps/web/e2e/responsive-fee.e2e.ts` | No |
| TOKEN-04 | every public kind maps to copy; held and buyback_burn rows never render on a coin ledger | unit | `pnpm vitest run apps/web/lib/ledger-copy.test.ts` | No |

---

## Wave 0 Requirements

- [ ] `packages/core/src/fees.test.ts`: window math, the 90/10 sweep floor, deployer pre-flight, the distribution minimum, the totals map
- [ ] `packages/core/src/curve.test.ts`: costFromReserves against fixture curves
- [ ] `packages/core/src/trades.test.ts`: extend it with `feesUnclaimed` from the fixtures
- [ ] `packages/core/src/send.test.ts`: extend it with `signTx` (a refused program, an oversize message, the signature in slot 0)
- [ ] `apps/worker/src/fee/*.test.ts`: an in-memory LedgerStore; the DB-backed parts skip without DATABASE_URL
- [ ] `scripts/spike/stages/engine.ts` and its rules, wired in after `finalizeStage` in `nets/fork.ts`
- [ ] `apps/web/e2e/fee-ledger.e2e.ts`, `fee-devnet.e2e.ts`, `responsive-fee.e2e.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Helius Sender on mainnet with a real tip | FEE-02, FEE-03 | Mainnet costs real SOL and is gated by the owner (Phase 7) | First forced bond after go-live: check the Sender response and the tip transfer on Solscan |
| A real 24h window sweep on staging | FEE-04 | Staging keeps the 24h window | Next day: confirm the sweep rows appear on the staging coin ledger |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers every missing reference
- [ ] No watch-mode flags
- [ ] Feedback latency under 60 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
