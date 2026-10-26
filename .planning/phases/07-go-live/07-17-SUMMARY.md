---
phase: 07-go-live
plan: 17
subsystem: worker boot, env, settle and ingest, admin health
tags: [genesis, boot, env, worker, admin, tdd]
requires: [07-16, 07-07, 07-11]
provides:
  - "env quoteMint: PublicKey | null (null only on mainnet with BONDR_QUOTE_MINT unset); quoteOf(env) throws not_ready in genesis"
  - "apps/worker/src/genesis-boot.ts enterGenesis(), genesisRoutes(gctx, admin), verifyQuoteMint(online, Q, treasury), NOT_READY_ROUTES"
  - "settle.ts setGenesis(on); ingest.ts backfillRows(exec, Q) and backfillLaunches(conn, Q)"
  - "switches.ts switchesLine(s), the shared boot log format"
  - "AdminHealth.genesis: boolean; the Genesis mode callout in Kill switches"
affects: [07-18 owner genesis page, 07-21 fork rehearsal, 07-28 G-3 genesis boot (greps `wallets: ops=` and `(genesis)`)]
key-files:
  created:
    - apps/worker/src/genesis-boot.ts
    - apps/worker/src/genesis-boot.test.ts
  modified:
    - apps/worker/src/env.ts
    - apps/worker/src/env.test.ts
    - apps/worker/src/main.ts
    - apps/worker/src/settle.ts
    - apps/worker/src/settle-flow.test.ts
    - apps/worker/src/ingest.ts
    - apps/worker/src/ingest.test.ts
    - apps/worker/src/switches.ts
    - apps/worker/src/admin-money.ts
    - apps/worker/src/admin-overview.ts
    - apps/worker/src/health.ts
    - apps/worker/src/health.test.ts
    - packages/core/src/api-admin.ts
    - apps/web/components/admin-switches.tsx
    - apps/web/e2e/admin-contract.e2e.ts
    - apps/web/lib/admin-copy-health.test.ts
    - scripts/devnet-launch.ts
    - scripts/devnet-trades.ts
    - scripts/stream-probe.ts
    - vitest.config.ts
key-decisions:
  - "07-17: enterGenesis runs before the server starts, so no route answers while a freshly seeded database still has switches on; a DB failure there fails boot and Railway restarts"
  - "07-17: quoteOf(env) is the one narrowing point for every non-genesis reader of the BONDR mint; in genesis, admin money actions (simulate/execute, EVACUATE included) answer not_ready"
  - "07-17: the admin overview reads BONDR balances as 0 in genesis instead of failing, so the console still shows treasury and ops SOL"
requirements-completed: []
duration: 25min
completed: 2026-10-26
---

# Phase 7 Plan 17: Genesis Boot and Admin Callout Summary

**On mainnet with BONDR_QUOTE_MINT unset, the worker now boots in genesis mode. Before any route answers, it loads the settings row and writes every switch off with a `genesis` audit row, then logs the all-off switches line. It serves a reduced route table: status, quote, prepare (genesisOne), submit, kill-switch and admin. Trade and fee routes answer not_ready. It skips the index boot, the engine and the stream. Once BONDR_QUOTE_MINT is set on mainnet, boot first checks that the mint's curve is a SOL pair created by the treasury, and refuses to start otherwise. Settle never ingests the genesis coin, and the boot backfill never picks the quote mint. Admin shows a "Genesis mode." callout.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1+2 RED | Failing env, boot route, mint check and switch tests | 3b1a9aa |
| 1+2 GREEN | env, genesis-boot.ts, the main.ts branch, settle flag, backfill exclusion | 9384f6b |
| 3 | AdminHealth.genesis and the Kill switches callout, with e2e and shots | 3fbd727 |
| docs | Worker README entry | 3a447fd |

## Evidence

- env.test.ts: 11 passed. RED came first. Mainnet with the variable unset or blank gives null. Devnet unset, or mainnet set to an invalid value, throws naming BONDR_QUOTE_MINT.
- genesis-boot.test.ts: 4 passed. RED came first, and the DB case ran on the Neon dev branch (not skipped). The cases:
  - The route table keeps status, quote, prepare, submit, kill-switch and admin. Every trade and fee key answers not_ready.
  - Through the route, a prepare with no actor answers not_ready and a stranger actor answers forbidden.
  - verifyQuoteMint accepts a curve quoted in NATIVE_MINT or the default key with the treasury as creator. It refuses a BONDR-quoted curve, another creator, or a missing curve, and the message never contains the mint.
  - enterGenesis on a seeded all-on row: all five columns end false, evacuated_at stays null, exactly one landed `genesis` switch audit row is written, and the log line matches. The settings row is restored in afterAll.
- settle-flow.test.ts: 2 passed. With setGenesis(true), landed() moves sent to landed, writes the facts and never calls ingestLaunch. The control case outside genesis ingests once.
- ingest.test.ts: 5 passed (DB, rolled back). backfillRows excludes a landed launch whose mint is Q and keeps the other one.
- health.test.ts and admin-copy-health.test.ts: 17 passed. `genesis` is false with a quote mint and true with null.
- admin-contract.e2e.ts: 9 passed. The genesis callout's text and its /launch link render, Launches stays enabled, a mismatch callout comes first, and the callout is absent outside genesis. Gate shots: admin-genesis-callout at 390 and 1440.
  - Some runs failed instead: 1 in 9 in two of five runs, always in pre-existing cases, with `route.fetch: read ECONNRESET` / `Response has been disposed` in the stubConsole health pass-through. Reruns were clean.
- `pnpm typecheck` and `pnpm lint` are clean. Line counts: main.ts 117, genesis-boot.ts 61, env.ts about 160, ingest.ts 280, admin-switches.tsx 151.

## Deviations from Plan

1. **Tasks 1 and 2 were committed together.** Making env.quoteMint nullable breaks main.ts until it branches, and main.ts calls the new backfill signature. Separate commits would have left a commit that fails typecheck.
2. **[Rule 3] `quoteOf(env)` was added for the other mint readers:** admin-money adminBase, admin-overview coinLive, and three devnet scripts. In genesis mode it throws not_ready. The overview instead reads the BONDR balances as 0 in genesis.
3. **genesisRoutes takes `(gctx, admin)` instead of `{ env, conn, sctx, pctx, admin }`.** main.ts builds `gctx = { ...base, Q: null, treasury, env }` and a shared table (the admin routes and sentry-test) that both branches spread. The child table moved into `childRoutes(ctx, env)`.
4. `switchesLine` in switches.ts replaces bootIndex's inline log format, so genesis prints exactly the same line.
5. admin-stubs.ts was not changed. It has no default health fixture: it merges into the real worker answer, which now carries `genesis`. admin-copy-health.test.ts was the literal that needed `genesis: false`.
6. Not run: a real genesis-mode boot of main.ts. It would write the dev database's switches off and read mainnet. 07-21 (fork) and 07-28 (G-3) cover it.

## Owner or orchestrator notes

- **EVACUATE is not available in genesis mode.** It goes through adminBase/feeDeps, which needs Q, so it answers not_ready. Production boots with ADMIN_EVACUATE=simulate (D-13) anyway, but a seed leak during the dark period could not be evacuated through the console until BONDR exists. Making EVACUATE Q-free is a follow-up if the owner wants it.
- The enterGenesis DB test adds one `genesis` admin_audit row to the dev branch per run. admin_audit is append-only by design.

## Threat Flags

None new. T-07-17-01: verifyQuoteMint (tested). T-07-17-02: enterGenesis writes all switches off before any route is up (DB-tested), no engine starts, and trade and fee routes answer not_ready. T-07-17-03: devnet still requires the mint (tested). T-07-17-04: the settle flag and the backfill exclusion (tested).

## Self-Check: PASSED

- FOUND apps/worker/src/genesis-boot.ts, apps/worker/src/genesis-boot.test.ts, both admin-genesis-callout shots
- FOUND commits 3b1a9aa, 9384f6b, 3fbd727, 3a447fd
