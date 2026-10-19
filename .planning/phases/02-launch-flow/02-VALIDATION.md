---
phase: 2
slug: launch-flow
status: draft
nyquist_compliant: true
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
| **Devnet integration** | `node --env-file=.env scripts/devnet-launch.ts` plus `--fund`, `--size-only`, `--prepare-only`, `--tamper`; per-run ops budgets and a floor of 2.40 SOL derived from the phase budget (about 0.28 SOL planned plus 0.22 SOL margin from 2.917 SOL) |
| **Fork proof (D-18)** | Pool-route launch on the Surfpool fork with the BONDR stand-in migrated |

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite against local web + worker on devnet
- **Before `/gsd:verify-work`:** full suite green, devnet integration green, fork pool-route proof green, Playwright against the staging URL
- **Max feedback latency:** 15 seconds for the quick run

## Per-Task Verification Map

Task IDs are `{phase}-{plan}-T{task}`. Status words are plain text.

| Requirement | Behavior asserted | Test Type | Automated Command | Task ID | Status |
|-------------|-------------------|-----------|-------------------|---------|--------|
| PLAT-01 | Connect, disconnect and account switch on /terms and /launch; Phantom-only; missing-wallet popover | e2e | `pnpm exec playwright test apps/web/e2e/wallet.e2e.ts` | 02-05-T1, 02-07-T2 | pending |
| PLAT-02 | No request carries the address before Accept; Accept stores the row; decline disconnects; cross-site consent POST refused | e2e | `pnpm exec playwright test apps/web/e2e/consent.e2e.ts` | 02-05-T2 | pending |
| PLAT-02, LAUNCH-06 | DB constraints (state, exit, single settings row, unique landed mint) | unit (DB) | `pnpm vitest run packages/core/src/db.test.ts` | 02-04-T3 | pending |
| PLAT-03 | /terms renders sections 01-08 and is linked from the footer and the consent prompt | e2e | `pnpm exec playwright test apps/web/e2e/terms.e2e.ts` | 02-02-T2, 02-05-T2 | pending |
| PLAT-04 | 390/768/1440 screenshots, no horizontal scroll, axe 0 violations, locally and on staging | e2e | `pnpm exec playwright test apps/web/e2e/responsive.e2e.ts` | 02-17-T1, 02-18-T2 | pending |
| LAUNCH-01 | Field rules (bytes, symbol charset, links, image magic bytes, URI, SOL parsing) | unit | `pnpm vitest run packages/core/src/rules.test.ts` | 02-06-T2 | pending |
| LAUNCH-01 | Step 1 errors, focus on first invalid field, advance to step 2 | e2e | `pnpm exec playwright test apps/web/e2e/launch-form.e2e.ts` | 02-07-T2 | pending |
| LAUNCH-02 | Minimum scales with live reserves (0.25 SOL mainnet, 0.0025 devnet) | unit | `pnpm vitest run packages/core/src/math.test.ts` | 02-06-T1 | pending |
| LAUNCH-02 | Button disabled until an exit is chosen and the live minimum is met; receipt fees equal live status | e2e | `pnpm exec playwright test apps/web/e2e/launch-form.e2e.ts` | 02-08-T2 | pending |
| LAUNCH-03 | Pool-route launches (BONDR migrated) land on the fork for both exits within 1232 B, max-length fields included; curve route still passes | integration (fork) | `SPIKE_NET=fork pnpm spike && SPIKE_NET=all pnpm spike:check` | 02-03-T2 | pending |
| LAUNCH-03 | Max-length fields fit 1232 B for both exits (nothing sent); real prepare reuses mint and table | integration (devnet) | `node --env-file=.env scripts/devnet-launch.ts --size-only` and `--prepare-only` | 02-11-T2 | pending |
| LAUNCH-03 | One tx per exit lands on devnet through the worker: bndr mint, creator W, dev holds 0 | integration (devnet) | `node --env-file=.env scripts/devnet-launch.ts` | 02-12-T3 | pending |
| LAUNCH-04 | Tampered byte, wrong signer, missing signature, extra signature slot and missing exit refused; pool-venue sell fixture passes exitPresent("sell") | unit | `pnpm vitest run packages/core/src/cosign.test.ts` | 02-12-T1 | pending |
| LAUNCH-04 | Tampered wire refused on devnet, nothing sent | integration (devnet) | `node --env-file=.env scripts/devnet-launch.ts --tamper` | 02-12-T3 | pending |
| LAUNCH-05 | Success screen within 5 s of confirmation (blockTime check), copy address, tx link, Open {SYMBOL}; failure states | e2e (stubbed + devnet) | `pnpm exec playwright test apps/web/e2e/launch-live.e2e.ts` (devnet group with `E2E_DEVNET=1`) | 02-13-T2 | pending |
| LAUNCH-05 | Token page proof and contract address; 404 for unknown mints | e2e | `pnpm exec playwright test apps/web/e2e/coin.e2e.ts` | 02-15-T1, 02-15-T2 | pending |
| LAUNCH-06 | pauseReason: kill switch and awaiting migration pause, migrated BONDR does not (D-18); mainnet guard | unit | `pnpm vitest run apps/worker/src/status.test.ts` | 02-06-T3 | pending |
| LAUNCH-06 | Kill switch: banner, button disabled, form fillable, clears without reload | e2e | `pnpm exec playwright test apps/web/e2e/paused.e2e.ts` | 02-08-T2 | pending |
| LAUNCH-06 | Prepare refuses while paused (server-side) | unit | `pnpm vitest run apps/worker/src/prepare.test.ts` | 02-11-T1 | pending |
| LAUNCH-07 | Metadata JSON shape; URI 80 chars and at most 200; upload request shape; live pin (gated) | unit + gated integration | `pnpm vitest run apps/web/lib/pinata.test.ts` (`PINATA_LIVE=1` for live) | 02-10-T1, 02-10-T2 | pending |
| FEE-10 | Biome blocks chain imports in web | static | `pnpm lint` | 02-01-T1 | pending |
| FEE-10 | Web process gets only WEB_ENV names locally; Playwright web server likewise; web refuses to boot with a seed, the Helius key, the Sentry token or the staging DB URL | static + unit | `rg -n WEB_ENV apps/web/next.config.ts playwright.config.ts`; `pnpm vitest run packages/core/src/scrub.test.ts` | 02-01-T2, 02-02-T1, 02-14-T1 | pending |
| FEE-10 | No chain lib or program id in client chunks; web refuses to boot with a seed | static + unit | `sh scripts/check-client-bundle.sh`; `pnpm vitest run packages/core/src/scrub.test.ts` | 02-14-T1, 02-14-T2 | pending |
| FEE-10 | Mint keys derived from seed and lane; nothing secret stored | unit | `pnpm vitest run apps/worker/src/vanity.test.ts packages/core/src/keys.test.ts` | 02-09-T1 | pending |
| OPS-01 | Scrub removes wallet addresses; events reach both Sentry projects (local and staging) | unit + recorded check | `pnpm vitest run packages/core/src/scrub.test.ts` | 02-14-T1, 02-14-T2, 02-16-T3 | pending |
| auth | Worker bearer auth, body cap, error mapping | unit | `pnpm vitest run apps/worker/src/http.test.ts` | 02-06-T3 | pending |
| pool | Derived vanity key matches; suffix rule; reservation SQL (rolled-back transaction) | unit | `pnpm vitest run apps/worker/src/vanity.test.ts` | 02-09-T1 | pending |
| budget | Devnet runs refuse below the derived OPS_FLOOR_SOL and fail when a run's ops spend, excluding the separately recorded sim dev top-up, exceeds its RUN_BUDGET_SOL | integration (devnet) | `node --env-file=.env scripts/devnet-launch.ts --fund` | 02-11-T2 | pending |
| state | Launch state transitions; unknown never resent before expiry | unit | `pnpm vitest run apps/worker/src/settle.test.ts` | 02-12-T2 | pending |
| limits | Rate limiter windows and client IP (pin, quote, prepare, submit, consent scopes) | unit | `pnpm vitest run apps/web/lib/guard.test.ts` | 02-10-T1 | pending |

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One real Phantom launch on staging | LAUNCH-03, LAUNCH-05 | Needs the real extension and the owner's wallet | Owner launches on the staging URL with a small devnet dev buy; records any Phantom warning (02-18-T3) |
| Terms and consent copy review | PLAT-02, PLAT-03 | Owner approval | Read /terms and the consent prompt on staging (02-18-T3) |
| Sentry events arrive | OPS-01 | Needs the live DSNs | GET /api/sentry-test (enabled only for the check) triggers web and worker; confirm both events with addresses scrubbed (02-14-T2 locally, 02-16-T3 on staging, owner glance in 02-18-T3) |
| Designer critique and audit | PLAT-04 | AGENTS.md section 7 | critique and audit skills on the 02-17-T1 screenshots; blockers fixed (02-17-T2) |

## Validation Sign-Off

- [x] All tasks have an automated verify step or a Wave 0 dependency (checkpoint tasks are the manual-only rows)
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all MISSING references (test-first tasks create each test file before its code; 02-02 creates the Playwright harness)
- [x] No watch-mode flags
- [ ] Feedback latency under 15 s for the quick run (measured by 02-01-T3, which records the "Measured quick run" row)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
