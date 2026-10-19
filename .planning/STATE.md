---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-08-PLAN.md
last_updated: "2026-10-19T06:55:10.256Z"
last_activity: 2026-10-19
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 10
  completed_plans: 8
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-19)

**Core value:** A holder can verify on the token page that the dev holds no launch supply, and see that pre-bond fees went to forcing the bond and burning supply, never to the dev.
**Current focus:** Phase 1 — Chain Spike

## Current Position

Phase: 1 (Chain Spike) — EXECUTING
Plan: 9 of 10
Status: Ready to execute
Last activity: 2026-10-19

Progress: [████████░░] 80%

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

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2 (from Phase 1 code review, 2026-10-19): apps/web must only import pure @bondr/core modules (math and similar). Add a Biome noRestrictedImports rule in apps/web blocking pump.ts, send.ts, alt.ts and any module importing them. Core exports raw .ts (Node type stripping): Next.js needs transpilePackages, and a pnpm deploy/injected install for the Railway worker would break it, so record this as a ponytail note in the core README.

- Phase 1 is a hard gate: any spike step without a signature changes PROJECT.md before Phase 2.
- Phase 2: web must get each W pubkey without holding the master seed (FEE-10). The planner must decide how the worker supplies W pubkeys and vanity mint keys for the co-sign.
- Resolved 2026-10-19: Sentry (OPS-01) moved to Phase 2, so ADMIN-06 can read real issue counts in Phase 6.
- Phase 7: BONDR's own launch is a SOL pair at the standard creator fee, so the Phase 2 launch builder needs a SOL-quote path for it.
- Pump ships breaking changes on short notice; re-verify against pump-public-docs before each phase.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-10-19T06:55:10.247Z
Stopped at: Completed 01-08-PLAN.md
Resume file: None
