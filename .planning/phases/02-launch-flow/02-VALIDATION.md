---
phase: 2
slug: launch-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 2 - Validation Strategy

> Per-phase validation contract. Status words are plain text (no emoji, per AGENTS.md). The source table is 02-RESEARCH.md, "Validation Architecture"; the planner fills task IDs.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (units); @playwright/test 1.63.0 + @axe-core/playwright 4.13.0 (e2e with a fake Phantom fixture) |
| **Config file** | `playwright.config.ts` at the root (Wave 0); Vitest uses its defaults |
| **Quick run command** | `pnpm test && pnpm lint && pnpm typecheck` |
| **Full suite command** | quick + `pnpm --filter @bondr/web build && sh scripts/check-client-bundle.sh && pnpm exec playwright test` |
| **Devnet integration** | `node --env-file=.env scripts/devnet-launch.ts` (gated; about 0.0085 SOL per run) plus `--tamper`, `--size-only` |
| **Fork proof (D-18)** | Pool-route launch on the Surfpool fork with the BONDR stand-in migrated |

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite against local web + worker on devnet
- **Before `/gsd:verify-work`:** full suite green, devnet integration green, fork pool-route proof green, Playwright against the staging URL
- **Max feedback latency:** 15 seconds for the quick run

## Per-Task Verification Map

| Requirement | Behavior asserted | Test Type | Automated Command | Status |
|-------------|-------------------|-----------|-------------------|--------|
| PLAT-01 | Connect, disconnect and account switch on /launch and /terms | e2e | `pnpm exec playwright test e2e/wallet.e2e.ts` | pending |
| PLAT-02 | No request carries the address before Accept; Accept stores the row; decline disconnects | e2e | `pnpm exec playwright test e2e/consent.e2e.ts` | pending |
| PLAT-03 | /terms renders and is linked from the footer and the consent prompt | e2e | `pnpm exec playwright test e2e/terms.e2e.ts` | pending |
| PLAT-04 | 390/768/1440 screenshots, no horizontal scroll, axe 0 violations | e2e | `pnpm exec playwright test e2e/responsive.e2e.ts` | pending |
| LAUNCH-01 | Field rules (bytes, symbol charset, links, image magic bytes) | unit | `pnpm vitest run packages/core/src/rules.test.ts` | pending |
| LAUNCH-02 | Button disabled until the exit is chosen and the live minimum is met; minimum scales with reserves | unit + e2e | `rules.test.ts`; `e2e/launch-form.e2e.ts` | pending |
| LAUNCH-03 | One tx lands on devnet: bndr mint, creator W, dev holds 0; max-length fields fit 1232 B for both exits and both BONDR routes | integration | `scripts/devnet-launch.ts`, `--size-only`; fork pool-route proof | pending |
| LAUNCH-04 | Tampered, wrong-signer, missing, extra-signature and missing-exit txs are refused and nothing is sent | unit + integration | `packages/core/src/cosign.test.ts`; `scripts/devnet-launch.ts --tamper` | pending |
| LAUNCH-05 | Landed visible within 5 s; copy address; tx link | e2e (devnet) | `e2e/launch-live.e2e.ts` | pending |
| LAUNCH-06 | Kill switch and 6107 window pause: banner, button disabled, form fillable, server refuses | unit + e2e | `apps/worker/src/status.test.ts`; `e2e/paused.e2e.ts` | pending |
| LAUNCH-07 | Pin returns a CID; URI at most 200 chars; JSON shape | unit + gated integration | `apps/web/lib/pinata.test.ts` | pending |
| FEE-10 | No chain lib or program id in client chunks; web refuses to boot with a seed; Biome blocks imports | static | `sh scripts/check-client-bundle.sh`; `pnpm lint` | pending |
| OPS-01 | A thrown error reaches Sentry from both services; scrub removes wallet addresses | unit + manual | `apps/worker/src/sentry.test.ts` | pending |
| pool | Derived vanity key matches; suffix rule; reservation SQL | unit | `apps/worker/src/vanity.test.ts` | pending |
| state | Launch state transitions; unknown never resent before expiry | unit | `apps/worker/src/settle.test.ts` | pending |

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One real Phantom launch on staging | LAUNCH-03, LAUNCH-05 | Needs the real extension and the owner's wallet | Owner launches on the staging URL with a small devnet dev buy; records any Phantom warning |
| Terms and consent copy review | PLAT-02, PLAT-03 | Owner approval | Read /terms and the consent prompt on staging |
| Sentry events arrive | OPS-01 | Needs the live DSNs | Trigger the test route on web and worker, then confirm both events in Sentry with addresses scrubbed |

## Validation Sign-Off

- [ ] All tasks have an automated verify step or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency under 15 s for the quick run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
