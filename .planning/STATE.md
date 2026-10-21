---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 02-15-PLAN.md
last_updated: "2026-10-21T18:54:23.000Z"
last_activity: 2026-10-22
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 28
  completed_plans: 25
  percent: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-19)

**Core value:** A holder can verify on the token page that the dev holds no launch supply, and see that pre-bond fees went to forcing the bond and burning supply, never to the dev.
**Current focus:** Phase 2 — Launch Flow

## Current Position

Phase: 2 (Launch Flow) — EXECUTING
Plan: 16 of 18
Status: Ready to execute
Last activity: 2026-10-22

Progress: [█████████░] 89%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 6 min | 3 tasks | 16 files |
| Phase 01 P02 | 9 min | 2 tasks | 10 files |
| Phase 01 P03 | 18 min | 3 tasks | 14 files |
| Phase 01 P04 | 6 min | 2 tasks | 8 files |
| Phase 01 P05 | 15 min | 3 tasks | 13 files |
| Phase 01 P06 | 20 min | 2 tasks | 13 files |
| Phase 01 P07 | 10 min | 3 tasks | 15 files |
| Phase 01 P08 | 12 min | 2 tasks | 9 files |
| Phase 01 P09 | 15 min | 2 tasks | 8 files |
| Phase 01 P10 | 20 min | 2 tasks | 8 files |
| Phase 02 P01 | 10 min | 3 tasks | 14 files |
| Phase 02 P03 | 25 min | 2 tasks | 12 files |
| Phase 02 P02 | 20 min | 2 tasks | 7 files |
| Phase 02 P04 | 150 min | 3 tasks | 13 files |
| Phase 02 P05 | 25 min | 2 tasks | 18 files |
| Phase 02 P06 | 10 min | 3 tasks | 18 files |
| Phase 02 P07 | 25 min | 2 tasks | 17 files |
| Phase 02 P09 | 75 min | 2 tasks | 11 files |
| Phase 02 P08 | 45 min | 2 tasks | 18 files |
| Phase 02 P10 | 9 min | 2 tasks | 12 files |
| Phase 02 P11 | 20 min | 2 tasks | 12 files |
| Phase 02 P12 | 14 min | 3 tasks | - |
| Phase 02 P13 | 21 min | 2 tasks | - |
| Phase 02 P14 | 14 min | 2 tasks | - |
| Phase 02 P15 | 13 min | 2 tasks | - |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phases follow the 7 PROJECT.md build steps in order, all in mvp mode.
- [Roadmap]: PLAT-03 (terms page) moved from Go-Live to Phase 2, because the Phase 2 consent prompt must link to and accept the terms.
- [Roadmap]: FEE-10 (W key derivation, worker only) is in Phase 2, because launch needs W as creator.
- [Roadmap]: PLAT-04 (responsive) is in Phase 2; every later UI phase keeps it via mobile, tablet and desktop screenshots.
- [Roadmap]: TOKEN-03 (burn budget, 24h window) is in Phase 5 with the fee engine that produces those values.
- [Phase 01]: 01-01: vitest pinned 4.1.11 (4.1.12 is 4 days old, fails the 14-day rule); @types/node 24.19.1; pnpm 10.34.6
- [Phase 01]: 01-01: fork connect requires local host plus mainnet genesis; devnet requires devnet genesis
- [Phase 01]: 01-01: TDD RED verified but not committed separately (AGENTS.md forbids red commits)
- [Phase 01]: Config drift compares the effective schedule a BONDR-quoted coin pays (exotic, flat when exotic is all zero)
- [Phase 01]: A successful rerun drops stale stage/net error rows so old crashes do not fail spike:check forever
- [Phase 01]: 01-03: sendTx confirms by polling signature status; confirmTransaction's websocket kept the process alive
- [Phase 01]: 01-03: devnet launch with per-coin table: burn 780 B / 304k CU, sell to SOL 881 B / 421k CU; shared-only sell 1,191 B (41 B headroom)
- [Phase 01]: Live mainnet pump config on the fork matches PROJECT.md fee assumptions with no drift (max creator fee 300 bps)
- [Phase 01]: fork.sh honours a hand-set SURFPOOL_DATASOURCE_RPC_URL, so the public RPC fallback is an env override
- [Phase 01]: 01-05: finalizeIxs creates the SharingConfig PDA creator-vault quote ATA before update_fee_shares_v2 (InvalidAccountData without it on a Q-quoted coin)
- [Phase 01]: 01-05: second update_fee_shares_v2 rejected with pump-fees 6009 SharingConfigAdminRevoked (A1 resolved)
- [Phase 01]: 01-05: pump's devnet crank migrates a completed curve within about 10 slots; 6107 is proven in one tx [completing buy, child create] that reverts
- [Phase 01]: 01-05: run.ts skips a devnet stage only when its rows are ok and pass their rules
- [Phase 01]: 01-06: effective creator fee measured at 150.00 bps of gross Q volume on the fork (PROJECT.md 1.5% holds)
- [Phase 01]: 01-06: the 90/10 split is sized from the collect tx's own meta delta, never W's balance
- [Phase 01]: 01-07: the forced-bond burn is in the same tx as the completing buy, so pump's keeper cannot migrate between completion and burn
- [Phase 01]: 01-07: simulateTransaction with the accounts option works on Surfpool 1.6.1 (A7 holds); forced bond 926 B / 110k CU, exact variant 926 B / 108k CU
- [Phase 01]: 01-07: a buy_exact_quote_in_v3 budget above cost also buys from the pool-to-be, so the forced bond burns more than the curve's remaining supply
- [Phase 01]: 01-08: the bonded finalize is two txs (config 1,076 B / 244k CU, update 1,126 B / 134k CU); one tx measured 1,351 B
- [Phase 01]: 01-08: after finalize on a complete curve the sweeps are the pool sweep only, so the bonded second update fits at 1,214 B
- [Phase 01]: 01-08: the bonded second update is rejected with pump-fees 6009 SharingConfigAdminRevoked, same as devnet
- [Phase 01]: 01-08: distribution after bond paid exactly 80:20 (deployer 138,264,336,404 Q, treasury 34,566,084,101 Q)
- [Phase 01]: 01-09: the fork 6107 proof uses the devnet one-tx pattern [completing buy, child create], so both nets' evidence is comparable
- [Phase 01]: 01-09: a child create on a migrated Q has 8 remaining accounts and is 1,163 B, 99 more than on an unmigrated Q
- [Phase 01]: 01-09: resolveMultiHopRoute picks the pool venue for a migrated Q by itself (buy pool,curve 1,132 B / 162k CU; sell curve,pool 1,100 B / 150k CU)
- [Phase 01]: 01-10: pnpm spike:all is the phase gate; final run exit 0 (run=0 check=0), page PASS 67, FAIL 0, EXPECTED FAIL 5, NOT RUN 0
- [Phase 01]: 01-10 (owner, 2026-10-19): forced-bond burn mode is spend the full budget with buy_exact_quote_in_v3 and burn everything bought; the exact buy_v3 variant is evidence only
- [Phase 01]: 01-10 (owner, 2026-10-19): the treasury tops up ops by hand on the admin low-ops alert; ops pays table rent (about 0.0075 SOL per launch) and W floats (about 0.03 SOL per bonded coin)
- [Phase 01]: 01-10: launch table rent about 0.007-0.008 SOL at mainnet rent and W finalize float 0.018 SOL, both corrected in PROJECT.md
- [Phase 01]: 01-10: devnet refreshed on new Q 4Jw2pr67...; devnet ops holds 2.917 SOL
- [Phase 02]: 02-01: minimumReleaseAge stays 1440 (20160 fails on locked pump SDK transitives); new pins checked by hand against the 14-day cutoff
- [Phase 2]: 02-03: pool-venue launches pay the sell's buyback slice to PumpSwap GlobalConfig.buybackFeeRecipients[0], whose WSOL ATA the pool buy creates in the same tx
- [Phase 2]: 02-03: quoteVenue throws AwaitingMigration in the complete-but-unmigrated window; the worker maps it to paused
- [Phase 02]: 02-02: playwright.config.ts imports WEB_ENV from next.config.ts, whose loader resolves the root .env from its file path, so runner and server see only web names
- [Phase 02]: 02-02: next.config.ts sets agentRules: false so next dev stops writing apps/web/AGENTS.md and CLAUDE.md
- [Phase 02]: Neon project bondr (royal-waterfall-05278863, aws-us-east-1) in the Launch-plan org, pay as you go — Owner chose option A on 2026-10-19; the only org that can create projects is on Launch
- [Phase 02]: Drizzle casing snake_case in db() and drizzle.config.ts; integrity via CHECK and the landed-mint partial unique index — Database constraints over app checks (AGENTS.md section 6)
- [Phase 02]: 02-06: /status fees are those of a fresh BONDR-quoted child curve at the network default creator fee; the insta-sell estimate is fee-only over legs [bondr, child, child, bondr]
- [Phase 02]: 02-06: Worker status is cached 5 s on demand; a chain read failure nulls fees and minimum (UI disables signing); a missing settings row fails closed
- [Phase 02]: 02-06: /quote ignores the kill switch and maps AwaitingMigration to 409 paused awaiting_migration
- [Phase 02]: 02-07: shadcn button, input, textarea and label hand-ported into apps/web/components/ui-*.tsx; btn.ts removed, buttonVariants is the one button style source
- [Phase 02]: 02-07: launch steps register in BODIES in launch-flow.tsx; the flow owns the panel, the sr-only step heading and the focus move
- [Phase 02]: 02-09: reserve never hands out a mint whose launch is signed, sent, unknown or landed, even after its 10-minute window expired — An expired reservation whose tx may still land would give the next dev a used mint (T-02-09-02)
- [Phase 02]: 02-09: vanity rows are claimed with a scalar idx = (select ... limit 1 for update skip locked) — IN (subquery) was re-run per row and reserved every free mint for one wallet
- [Phase 02]: 02-09: the Mac pre-fill uses 4 grinder threads — worker_threads stop scaling past the M4 performance cores because of OpenSSL lock contention (73k keys/s at 4 threads, 50k at 10)
- [Phase 02]: 02-08: A pause outranks the wallet on step 3; Launches paused shows even when disconnected
- [Phase 02]: 02-08: One useStatus poll and one useQuote live in LaunchFlow; steps and the receipt read StepProps.live
- [Phase 02]: 02-08: paused.e2e.ts runs in its own Playwright project after chromium, since it flips the shared kill switch
- [Phase 02]: 02-10: one in-memory fixed-window limiter in guard.ts (entries carry their own end time); pin 5/10min per IP and wallet, quote 60/min, consent 10/10min
- [Phase 02]: 02-10: pinned files are named <SYMBOL>.<type>; the uploaded file name never reaches Pinata
- [Phase 02]: 02-11: insta-sell floor = (simulated burn spend - sell spend) less 300 bps; failed prepares keep their paid table as a failed row
- [Phase 02]: 02-11: web prepare route has its own 30 s worker timeout (measured 10-18 s on devnet)
- [Phase 02]: 02-12: co-sign runs before a row is marked signed, so a signed row always holds a resendable tx; settle never resends an unseen launch
- [Phase 02]: 02-13: a lost submit answer keeps step 4 polling instead of offering Try again, since the tx may already be out
- [Phase 02]: 02-14: Sentry projects bondr-web and bondr-worker in org mrbarnacle; one shared restrictive privacy config; web DSN must be a Railway build variable
- [Phase 02]: 02-14: open check: confirm the next real browser event carries no geo data (IP storage prevention switched on, not re-tested)
- [Phase 02]: 02-15: coin image is a CSS background (ipfs.io 429s the server); switch back to next/image once PINATA_GATEWAY is set

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 5 (from Phase 1 second code review, 2026-10-19):
  - finalizeIxs/splitIxs take deployer and treasury from the caller. The worker must derive the deployer from the coin's on-chain CreateEvent `user` and the treasury from config, and assert deployer != treasury != W, because the 8000 bps lock is permanent.
  - Add a resumable 2-tx finalize in core: finalizeConfigIxs, finalizeUpdateIxs and finalizeState (none/configured/revoked) read from chain. Send tx 2 immediately after tx 1, because anyone can run distribute in between and pay W 100%.
  - Detect "complete and pool exists" from chain instead of a caller boolean.
  - After a forced bond lands, the worker reads W's child balance and burns any remainder.
- Phases 3/4: route.ts must retry, not surface errors, during the roughly 10-slot window between curve completion and pump's keeper migrating it.

- Phase 2 (from Phase 1 code review, 2026-10-19): apps/web must only import pure @bondr/core modules (math and similar). Add a Biome noRestrictedImports rule in apps/web blocking pump.ts, send.ts, alt.ts and any module importing them. Core exports raw .ts (Node type stripping): Next.js needs transpilePackages, and a pnpm deploy/injected install for the Railway worker would break it, so record this as a ponytail note in the core README.

- Phase 1 is a hard gate: any spike step without a signature changes PROJECT.md before Phase 2.
- Phase 2: web must get each W pubkey without holding the master seed (FEE-10). The planner must decide how the worker supplies W pubkeys and vanity mint keys for the co-sign.
- Resolved 2026-10-19: Sentry (OPS-01) moved to Phase 2, so ADMIN-06 can read real issue counts in Phase 6.
- Phase 7: BONDR's own launch is a SOL pair at the standard creator fee, so the Phase 2 launch builder needs a SOL-quote path for it.
- Pump ships breaking changes on short notice; re-verify against pump-public-docs before each phase.
- OPS-01 Sentry projects pending: sentry_auth_token not in .env (02-04); create bondr-web and bondr-worker before 02-14

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-10-21T18:54:23.000Z
Stopped at: Completed 02-15-PLAN.md
Resume file: None
