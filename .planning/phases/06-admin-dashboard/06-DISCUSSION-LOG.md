# Phase 6: Admin Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 06-CONTEXT.md. This log preserves the alternatives considered.

**Date:** 2026-10-25
**Phase:** 06-admin-dashboard
**Mode:** --auto. The owner delegated every choice on 2026-10-24 (autonomous mode). Each pick is the recommended option. No AskUserQuestion was used.
**Areas discussed:** sign-in and session, fresh signature and simulate-first, destination lock, recovery actions, WR-08 fold, kill switches, data freshness under Neon, health signals, moderation, timeline, transaction inspector, audit log, EVACUATE, layout and devices, testing and rollout

Log lines: `[auto] [Area] - Q: "..." -> Selected: "..." (recommended default)`. Todo match for phase 6 returned 0 matches; WR-08 was folded from STATE.md Pending Todos at the orchestrator's direction.

---

| Area | Question | Options considered | Selected |
|------|----------|--------------------|----------|
| Allowlist | How is the one admin wallet configured? | (a) `ADMIN_WALLET` env on web and worker, fail closed when unset; (b) a DB row; (c) hardcoded | (a) recommended. Also the ship-dark switch |
| Sign-in | How does the owner prove the wallet? | (a) reuse the Phase 2 signMessage plus HMAC seal, domain-separated admin message, single-use nonce; (b) a new auth provider | (a) recommended. No new dependency |
| Session | How long, and what kind? | (a) separate `bondr_admin` cookie, 30 min absolute; (b) sliding 30 min; (c) reuse the 12 h public session | (a) recommended. ADMIN-01 says expire after 30 minutes |
| Visibility | Who can load `/admin`? | (a) unlinked, noindex, sign-in panel only until the admin cookie is valid; (b) 404 for everyone not signed in | (a) recommended. The owner needs somewhere to sign in |
| Fresh signature | What does "fresh signature" sign? | (a) a human-readable intent message (action, coin, intent id, destinations, expiry) the worker verifies against ADMIN_WALLET; (b) the owner signs the transaction itself; (c) web verifies only | (a) recommended. W, ops and treasury keys live in the worker, so the owner cannot co-sign their transactions. Worker-side checking means a leaked WORKER_TOKEN cannot move funds |
| Simulate-first | How is the simulation tied to the send? | (a) simulate stores the built txs in memory for 2 min under an intent id, execute sends exactly those, an expired intent re-simulates; (b) rebuild at execute | (a) recommended. What was shown is what is sent (Phase 4 trade store pattern) |
| Signature scope | Which actions need a fresh signature? | (a) every action that sends a transaction; non-transaction actions need the session only and are still audited; (b) every action | (a) recommended |
| Destination lock | Where is the destination rule enforced? | (a) in the worker, per-action allowlist of burn, treasury, buyback, that coin's deployer, plus internal W and vault moves; (b) UI only | (a) recommended. ADMIN-04 is a money rule |
| Held finalize release | Can the owner type a deployer? | (a) no, finalize always uses `launches.wallet`; the bearer route stays for the runbook; (b) expose the Phase 5 owner-named deployer form | (a) recommended. Keeps "that coin's deployer" exact |
| Recovery actions | How are the 11 actions built? | (a) each maps to an existing engine job via `Engine.enqueue`, runs even when its switch is off, greyed when not applicable; (b) new standalone scripts per action | (a) recommended. No duplicated fee math |
| WR-08 | Fold the leftover-child-token issue? | (a) fold: fix forcedBondIxs minOut, add `leftover_burn` public kind, burn in "Burn W token balance" and automatically at finalize's closing step; (b) leave for later | (a) recommended. The action is its recovery path |
| Kill switches | Where do the 5 switches live? | (a) `settings` columns, loaded once, held in worker memory, one write route (Phase 2 pattern); (b) env vars; (c) read the DB before every send | (a) recommended. Neon budget |
| Switch coverage | Which jobs does each switch stop? | (a) forced bond includes the pool burn, sweeps includes collect and split, finalize includes distribute, reconcile always runs; (b) one switch per internal job | (a) recommended. Matches the 5 in ADMIN-05 |
| Auto-pause | Pause a whole job after 3 failures, as the mockup shows? | (a) no, mark the coin's step stuck with a retry; (b) yes, job-wide | (a) recommended. Smaller; one bad coin does not stop all coins |
| Freshness | How does the console stay current without waking Neon? | (a) DB panels load on open, Refresh and after actions; worker-memory health polls every 10 s while visible; (b) poll everything every 10 s; (c) SSE from the DB | (a) recommended. D-04 Neon budget |
| W balances | How to show 500 W balances? | (a) the coin row's `fee_budget`, live chain read only for the selected coin and in simulations; (b) getMultipleAccounts for all W on every load | (a) recommended. Fewer RPC calls |
| Leader lock | What does the leader lock row show? | (a) "single replica, no lock" with instance id and boot time; (b) add a Postgres session advisory lock | (a) recommended. A held session connection may keep Neon awake; one replica is the current guard |
| RPC stats | How are latency and errors measured? | (a) fetch wrapper with a 1 h in-memory ring; (b) Helius dashboard API | (a) recommended. No new dependency |
| Sentry count | Where does the issue count come from? | (a) worker calls the Sentry API with `SENTRY_READ_TOKEN`, cached 60 s, "not configured" when missing; (b) skip it | (a) recommended. ADMIN-06 lists it; fails soft |
| Hide coin | What does hiding do? | (a) `coins.hidden_at`, off lists, search and rails; the token page stays reachable; (b) 404 the token page too | (a) recommended. The fee record must stay verifiable |
| Block deployer | Where is the block stored and checked? | (a) `blocked_deployers` table, checked at worker prepare; (b) a flag on the `wallets` consent table | (a) recommended. A wallet can be blocked before it consents |
| Timeline | What feeds it? | (a) launch row, fee_ledger rows and engine memory, with a computed next step and inline retry; (b) a new events table | (a) recommended. No new writes |
| Inspector | How are instructions decoded? | (a) worker getTransaction and decoding by known program using the pinned SDK IDLs, errors via trade-error.ts; (b) link to Solscan only | (a) recommended. ADMIN-09 asks for decoded instructions |
| Audit log | Where and how is it written? | (a) new `admin_audit` table, worker writes intent-first and settles, one writer for all admin changes; (b) web writes; (c) log lines only | (a) recommended. Matches the Phase 5 ledger model |
| EVACUATE flow | How does break-glass run? | (a) exact phrase, simulate all W transfers, sign the intent, then switch everything off and persist `evacuated_at`, then send paced transfers; (b) send first, pause after | (a) recommended. Pausing first stops jobs racing the drain |
| EVACUATE child tokens | What happens to child tokens in W? | (a) burn them, move BONDR and SOL to the treasury; (b) move everything to the treasury | (a) recommended. Treasury holding child supply breaks the core claim; burn is an allowed destination |
| EVACUATE ledger | Are evacuate moves public? | (a) yes, a public `evacuate` ledger row; (b) private | (a) recommended. The ledger must say where the budget went |
| EVACUATE testing | Where is it proven? | (a) local devnet plus units, simulate-only on staging; (b) a real run on staging | (a) recommended. Staging must keep running for HV-05-01 |
| Mobile | Does admin work on a phone? | (a) yes, all actions at 390 per the mockup; (b) desktop only, EVACUATE on mobile | (a) recommended. The owner reacts to alerts away from a desk |
| Testing | How is it verified? | (a) units, Playwright with the fake Phantom and a test ADMIN_WALLET, devnet for prebond actions, fork for bond-time actions, 0.1 SOL cap; (b) units only | (a) recommended |

## Claude's Discretion

- Schema details for `admin_audit`, `blocked_deployers` and the new columns; the intent message wording and store shape; the number of W per EVACUATE transaction and its pacing; the inspector decoding library; whether the admin nonce reuses `consent_nonces`; the console's component split.

## Deferred Ideas

- A treasury not derived from the master seed, before mainnet (Phase 7, owner decision; it changes the permanent finalize target).
- Seed rotation after EVACUATE (Phase 7 runbook).
- The pump contract check health row (with OPS-02, Phase 7).
- A leader lock and multiple worker replicas.
- Reclaiming launch lookup table rent.
- A job-wide auto-pause after repeated failures.
- A trading kill switch.
- The first real-SOL admin action on mainnet (Phase 7, owner-gated).
