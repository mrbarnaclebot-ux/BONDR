# Phase 5: Fee Engine and Public Ledger - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 05-CONTEXT.md. This log preserves the alternatives considered.

**Date:** 2026-10-25
**Phase:** 05-fee-engine-and-public-ledger
**Mode:** --auto. The owner delegated every choice on 2026-10-24; each pick is the recommended option.
**Areas discussed:** engine shape, triggers, sweep and buyback, forced bond and fallback, finalize and distribution, ops and reconciliation, ledger and UI data, testing

---

| Area | Question | Options considered | Selected |
|------|----------|--------------------|----------|
| Engine shape | Where does the engine run, and how is it kept safe? | (a) worker module, one replica, per-coin serial queue; (b) a separate jobs service with a Postgres leader lock | (a) recommended. One replica already holds for the trade store |
| Crash safety | How to avoid double sends? | (a) intent-first pending ledger rows, settled at boot; (b) check the chain before each job only | (a) recommended. Same model as Phase 2 launches |
| Rollout | How to ship a money-moving engine? | (a) `FEE_ENGINE` off/dry/on flag, default off; (b) always on | (a) recommended. AGENTS.md feature flags |
| Triggers | How does work start without periodic DB reads? | (a) indexer events + in-memory window timers + one daily batch; (b) a poll every few minutes | (a) recommended. Neon budget D-04 |
| Collect cadence | When to collect? | (a) only before a needed split (window end, forced bond, migration); (b) after every trade; (c) on a threshold | (a) recommended. Fewest ops fees |
| Sweep | How is the 24h sweep sized? | (a) W's whole BONDR balance, 90/10, floor rule; (b) only fees from that window | (a) recommended. After the split, W holds only budget |
| Buyback | Who holds swept BONDR, and when is it burned? | (a) a derived `buyback` role, burned in the daily batch; (b) a burn inside each sweep tx | (a) recommended. Matches FEE-06's "on a schedule" |
| Forced bond send | Which send path? | (a) Helius Sender on mainnet only, plain send on devnet and fork; (b) Sender everywhere | (a) recommended. Sender is mainnet-only |
| Forced bond check | Is the cached trigger enough? | (a) re-check with a fresh curve read and simulation before sending; (b) trust the indexed reserves | (a) recommended |
| Finalize pre-flight | What happens on a failed deployer check? | (a) hold, with a `held` row and a Sentry error, released by hand; (b) retry later | (a) recommended. The update is permanent |
| Distribution | How often? | (a) daily batch, above a minimum; (b) on every post-bond trade | (a) recommended |
| Ops floor | What does low ops do? | (a) Sentry alert, and pause non-urgent sends only; (b) alert only | (a) recommended. Bond-time sends stay atomic |
| Reconciliation | What does a mismatch do? | (a) a private diff row plus Sentry, never moves funds; (b) auto-correct | (a) recommended |
| Ledger storage | One table or many? | (a) one `fee_ledger` table with a kind column; (b) a table per kind | (a) recommended |
| Panel data | Where do the budget and totals come from? | (a) columns on `coins`, written on change; (b) computed per page view from the ledger | (a) recommended. No read-time aggregation |
| Phase 3 deferrals | Include Next to bond and the hero wording? | (a) yes, deferred to Phase 5 by Phase 3 D-08/D-09; (b) push to later | (a) |
| Testing | How to prove bond-time flows? | (a) devnet for collect/split/sweep/burn, Surfpool fork for bond/fallback/finalize/distribute; (b) devnet only | (a) recommended. Devnet cannot bond a child |

## Claude's Discretion

- Schema shape, held-finalize release route, the daily batch hour, the network floors, whether collect and split share a transaction, and the ledger SOL-value source.

## Deferred Ideas

- BONDR's own creator fee collection (Phase 7), admin kill switch and views (Phase 6), the first mainnet Sender run (Phase 7), a leader lock if the worker scales out.
