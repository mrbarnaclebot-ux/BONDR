---
phase: 06-admin-dashboard
verified: 2026-10-26T07:30:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "HV-06-01: owner sets ADMIN_WALLET (both services) and SITE_URL (both services) on staging, signs in at /admin with Phantom, runs the inspector, simulates Burn buyback now and simulates EVACUATE without sending"
    expected: "Console opens with a 30-minute countdown; inspector decodes a pasted signature with a Solscan link; Burn buyback now shows balance changes and 'Destinations check passed'; EVACUATE shows totals and 'Simulation only on this deploy'; nothing is signed or sent"
    why_human: "Needs the owner's real Phantom wallet and Railway variables; ADMIN_WALLET is the owner's address and is not known to the agents"
  - test: "HV-06-02: owner creates a read-only Sentry token and sets SENTRY_READ_TOKEN on the staging worker"
    expected: "Health panel's Sentry cell shows the unresolved issue count instead of 'Not configured'"
    why_human: "Owner-side token creation in the Sentry UI"
---

# Phase 6: Admin Dashboard Verification Report

**Phase Goal:** As the owner, I want one dashboard to see and fix every coin and job, so that nothing needs a manual script.
**Mode:** mvp
**Verified:** 2026-10-26T07:30:00Z
**Status:** human_needed (all automated checks pass; two owner-side staging checks remain)
**Re-verification:** No, initial verification

## User Flow Coverage

| Step | Expected | Evidence in codebase | Status |
|------|----------|----------------------|--------|
| Owner opens /admin | noindex sign-in card, nothing else until cookie | `apps/web/app/admin/page.tsx:12-31`; e2e `admin-signin` "/admin shows the noindex sign-in card"; staging `admin-locked.e2e.ts` 5 passed (06-26) | VERIFIED |
| Owner signs in | only ADMIN_WALLET gets a 30-min cookie | `apps/web/app/api/admin/session/route.ts:47-70`; `apps/web/lib/session.ts:89,139-162` | VERIFIED |
| Owner sees everything | balances, W table, totals, health, timeline | `admin-console.tsx:103-133` mounts Wallets, KillSwitches, Health, WTable, Timeline, Inspect, Moderation, AuditLog, Evacuate | VERIFIED |
| Owner fixes a coin | simulate, sign intent, worker sends, audit | `apps/worker/src/admin-money.ts:65-171`; fork 06-15 five actions landed; devnet 06-24 Sweep now and Burn buyback now landed | VERIFIED |
| Outcome: no manual script needed | every recovery path reachable from the console | 11 actions + 5 switches + moderation + inspector + EVACUATE wired through `/api/admin/[op]` FORWARD map (`route.ts:23-33`) | VERIFIED |

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Only the allowlisted wallet signs in, sessions expire after 30 min, every money-moving action asks for a fresh signature | VERIFIED | Web: `session/route.ts:52` refuses any wallet but ADMIN_WALLET before the signature check; nonce spent in `consent_nonces` (`:57-63`); `session.ts:89` `ADMIN_MS = 30*60_000`, `:139-146` absolute Max-Age, `:154-162` session valid only if `exp > now && exp - now <= ADMIN_MS` and wallet == admin. `[op]/route.ts:85-86` sameOrigin + cookie before body. Worker: `admin-routes.ts:23-29` `gated()` wraps every route (`:127`), fails closed with no ADMIN_WALLET. Fresh signature: `admin-intent.ts:102-110` `take()` verifies ed25519 over the stored intent text against ADMIN_WALLET, single-use, 2-min TTL; `admin-money.ts:126-128` executeAction calls it for all 10 tx actions incl. evacuate. SIWS domain line from SITE_URL (`admin-intent.ts:51-73`, WR-B-03). Tests: session.test "the admin cookie holds 30 minutes for the configured admin only (D-10)"; admin-intent.test "another key's signature is refused...", "a consent or admin sign-in signature is never an intent"; admin-routes.test "no admin wallet answers 403", "without SITE_URL, simulate and execute answer 403"; e2e admin-signin "another wallet is refused and gets no cookie" |
| 2 | Owner sees treasury/buyback/ops balances, every W with its state, platform totals, health (heartbeat, leader lock, last run per job, RPC latency and errors, Sentry count, vanity pool), per-coin timeline with next step and retry | VERIFIED | Balances: `admin-overview.ts:33-41` one getMultipleAccountsInfo for treasury, buyback, ops and their BONDR ATAs. W table and totals: `apps/web/lib/admin-data.ts:56,115,183-198` (coin rows, totals, vanity free count at `:131-133,188`). Health: `apps/worker/src/health.ts:39-57` bootAt, instance (leader-lock row reports single replica, D-25), lastStream, lastRuns per job, `rpcStats()`, `sentryCount()`, switches, opsLow; memory only. Timeline: `apps/web/lib/admin-timeline.ts:142-181` stuck step with attempts, held, "Up next"; retry inline `admin-timeline-boxes.tsx:13-19,66-80` mapped from engine step names (`fee-stuck.ts:34-38`). e2e admin-console (health polls only while visible), admin-timeline (stuck box, greyed action explains itself), admin-wtable |
| 3 | Owner runs each of the 11 recovery actions, each simulating first with balance changes, limited to burn/treasury/buyback/that coin's deployer, each audited with actor, time, simulation and signature | VERIFIED | 9 tx actions in `admin-actions.ts:195` ACTIONS + routes TX list `admin-routes.ts:41-44`; hold/release/re-check in `admin-act.ts:56-105`. Simulate first: `admin-money.ts:65-91` runs the real job through captureDeps, checks every outflow (`refusedDestination`) and only then stores an intent. Allowlist: `admin-actions.ts:63-70` (`allowed`, `sweepDest`), finalize deployer = `launches.wallet` (`:149-168`), never typed. Send-side re-check: `admin-send.ts:13-24` gatedDeps refuses any tx outside the allowlist before land. Audit: `admin-money.ts:101-104` pending row (actor, action, mint, simulation, intentSig) written before any send, settled once with sigs (`:171`); `admin_audit` table `packages/core/migrations/0007_admin.sql:1-17` with `at`, result CHECKs and the append-only `admin_audit_guard` trigger (`:52-65`). On chain: fork 06-15 (forced bond, migrate, burn W tokens, finalize, distribute, simulated change == landed change); devnet 06-24 (Sweep now 3/3 landed, Burn buyback now supply drop exact, Re-check launch negative). Retry sweep and Sweep leftovers covered by unit tests (`admin-actions.test.ts`, `admin-leftover.test.ts`) |
| 4 | Owner flips per-job kill switches, hides a coin, blocks a deployer, inspects any pasted signature | VERIFIED | Switches: `switches.ts:8-14,50-58` five columns, DB then memory; gates `fee-boot.ts:71` (`allowed: switchOn(job) && !coin.hold`) consumed at `fee-finalize.ts:164`, `fee-burns.ts:67,98,123`, `fee-guard.ts:48`, `fee-batch.ts:58,104`; launches via `status.ts:200`; flips audited `admin-act.ts:40`. Hide: `packages/core/src/coin-row.ts:149` `isNull(coins.hiddenAt)` in coinRows, used by list, trending and next rail (`apps/web/lib/coins.ts:73,91,107`); token page still reachable. Block: `apps/worker/src/prepare.ts:147` refuses `blocked` before any build. Inspector: `admin-inspect.ts` decodes System, Token, Token-2022, ATA, ComputeBudget and pump programs via SDK coders; panel links Solscan `admin-inspect.tsx:70`. Tests: switches.test, admin-moderate.test, admin-inspect.test (8), e2e admin-switch, admin-moderation, admin-inspect |
| 5 | Owner runs EVACUATE by typing the phrase and signing; all jobs pause and every W balance moves to the treasury | VERIFIED (devnet; mainnet locked, see Warnings) | Phrase: `apps/web/lib/admin-copy-evac.ts` exact match, `admin-evacuate.tsx` disabled until match. Worker: `admin-evacuate.ts:81-82` allowlist treasury + burn only; `:87-98` BONDR TransferChecked and SOL to treasury, child tokens burned; `:156` batches `urgent: true` (CR-W-01, ops floor never skips them); `:252-260` refusal re-check then `pauseAll()` (`switches.ts:63-72`, every switch off + `evacuated_at` in one write) before the first send. `/kill-switch` cannot re-enable launches after EVACUATE (WR-W-08, switches.test). Devnet 06-24: "EVACUATE empties every dev W to the treasury and burn and pauses every switch" passed. Unit: admin-evacuate-exec.test "pauses every job first, then each batch after idle...", "simulate mode and any net but devnet refuse with 409 before pausing anything"; e2e admin-evacuate (7) |

**Score:** 5/5

## Requirements Coverage

All 11 IDs appear in PLAN frontmatter, are checked in REQUIREMENTS.md and map to Phase 6 in its traceability table. No orphaned requirements.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ADMIN-01 | SATISFIED | `session.ts:89,139-162`; `session/route.ts:52`; `admin-routes.ts:23-29`; `admin-intent.ts:102-110`; session.test, admin-intent.test, admin-signin.e2e, admin-locked.e2e (staging) |
| ADMIN-02 | SATISFIED | `admin-overview.ts:33-41`; `admin-data.ts:115,183`; `admin-wallets.tsx`, `admin-wtable.tsx`; admin-console.e2e, admin-wtable.e2e |
| ADMIN-03 | SATISFIED | `admin-actions.ts:195`, `admin-act.ts:100-105`; fork 06-15 (5 actions), devnet 06-24 (3 actions); unit for retry sweep, sweep leftovers, hold |
| ADMIN-04 | SATISFIED | `admin-money.ts:65-91`, `admin-dest.ts`, `admin-send.ts:13-24`; admin-dest.test, admin-sim.e2e "a refused destination shows the refusal and no send button" |
| ADMIN-05 | SATISFIED | `switches.ts`, `fee-boot.ts:71` and the five job gates; switches.test, admin-switch.e2e |
| ADMIN-06 | SATISFIED (Sentry count live only after HV-06-02) | `health.ts:39-57`, `rpc-stats.ts`, `sentry-count.ts`, `admin-data.ts:131-133,188`; health.test, rpc-stats.test, sentry-count.test |
| ADMIN-07 | SATISFIED | `admin-moderate.ts`, `coin-row.ts:149`, `prepare.ts:147`; admin-moderate.test, admin-moderation.e2e |
| ADMIN-08 | SATISFIED | `admin-timeline.ts:142-181`, `admin-timeline-boxes.tsx:13-80`; admin-timeline.test, admin-timeline.e2e |
| ADMIN-09 | SATISFIED | `admin-inspect.ts`, `admin-inspect.tsx:70`; admin-inspect.test, admin-inspect.e2e (real devnet signature) |
| ADMIN-10 | SATISFIED | `0007_admin.sql:1-17,52-65`; `admin-audit.ts`; pending-before-send `admin-money.ts:101`; admin-audit.test incl. WR-W-06 boot settle |
| ADMIN-11 | SATISFIED on devnet (mainnet execution locked by design, see Warnings) | `admin-evacuate.ts`, `switches.ts:63-72`, `admin-evacuate.tsx`; admin-evacuate-exec.test, admin-evacuate.e2e, devnet 06-24 |

## Behavioral Spot-Checks (run by the verifier, 2026-10-26)

| Check | Result |
|-------|--------|
| `pnpm vitest run` (full) | 92 files passed, 704 passed, 2 skipped |
| `pnpm typecheck` | clean (root tsc and web `next typegen && tsc`) |
| `pnpm lint` (`biome ci .`) | 429 files, no fixes |
| `rg TBD\|FIXME\|XXX` over admin worker, web, core and e2e files | none |
| `rg TODO\|HACK\|PLACEHOLDER` over admin files | none |
| Files over 300 lines | `apps/web/e2e/admin-responsive.e2e.ts` 301 (Info); `trade.e2e.ts` 307 is Phase 4 |

Not run by the verifier (by instruction): devnet specs (`admin-devnet`, `admin-neon`), staging specs, stubbed Playwright specs. Their results above come from the 06-15, 06-24, 06-25 and 06-26 summaries.

## Anti-Patterns and Warnings

| Item | Severity | Detail |
|------|----------|--------|
| EVACUATE cannot execute on mainnet | WARNING (Phase 7 prerequisite) | `apps/worker/src/env.ts:74` throws at boot for `ADMIN_EVACUATE=on` off devnet, and `admin-evacuate.ts:219,230` refuses again. The worker README says "Mainnet stays refused until the Phase 7 runbook flips it", but a runbook cannot flip it: it needs a code change. PROJECT.md relies on EVACUATE as the seed-leak response. Phase 7's success criteria do not mention it, so add an explicit Phase 7 task (unlock on mainnet behind ALLOW_MAINNET, or record the decision to keep it locked) |
| Devnet proof predates the review fixes | WARNING (in progress) | 06-24 ran before WR-B-03 changed the intent text and before CR-W-01 / CR-E-01 / CR-E-02. Unit tests and the fork gate (99 ok, 123 checks) were rerun after the fixes; a devnet re-run and staging redeploy are being done by a separate agent now. Record their result in the 06-24 or 06-26 summary |
| Staging runs the pre-review build | Info | Staging worker 1a9b6aa9 (06-26) predates the review fixes. HV-06-01 must run after the redeploy |
| Bearer `POST /fee/release`, `/fee/batch` | Info | Phase 5 runbook routes, bearer-only, not owner-signed (D-15, OQ6). Outside the console; acceptable as documented |
| Leader lock | Info | Reported honestly as "single replica, no lock" (D-25). Revisit if the worker scales out |
| Retry sweep, Sweep leftovers, landed Re-check launch | Info | Unit tests only, not on chain (per D-39) |
| Staging ingest refuses version 1 txs | Info (pre-existing Phase 4) | In deferred-items.md; must be fixed before Phase 7 go-live; not a Phase 6 gap |

## Human Verification Required

See `06-HUMAN-UAT.md`.

### 1. HV-06-01: staging console with the owner's Phantom
**Test:** Set ADMIN_WALLET on staging web and worker, confirm SITE_URL on both, sign in, run the inspector, simulate Burn buyback now and EVACUATE, send nothing.
**Expected:** The console opens with a 30-minute countdown, and the inspector decodes the signature with a Solscan link. Burn buyback now shows balance changes and "Destinations check passed". EVACUATE shows its totals and "Simulation only on this deploy".
**Why human:** Needs the owner's wallet and Railway variables.

### 2. HV-06-02: Sentry issue count
**Test:** Set SENTRY_READ_TOKEN on the staging worker.
**Expected:** The Health panel shows the unresolved issue count.
**Why human:** The token has to be created in the Sentry UI.

## Gaps Summary

No blocking gaps. All five success criteria and all 11 requirements are implemented, wired and tested in the codebase, with on-chain proof on the fork and on devnet. Two owner-side staging checks remain (HV-06-01, HV-06-02). Before go-live, Phase 7 must decide whether EVACUATE can execute on mainnet. Today the code makes it devnet-only, so the break-glass does not exist on mainnet.

---

_Verified: 2026-10-26T07:30:00Z_
_Verifier: Claude (gsd-verifier)_
