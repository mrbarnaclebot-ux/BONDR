# Phase 6: Admin Dashboard - Research

**Researched:** 2026-10-25
**Domain:** Owner console on an existing Next.js 16 web + node:http worker + Solana devnet fee engine. Wallet-signature auth, simulate-first admin transactions, an audit log, kill switches, a transaction decoder and an emergency drain.
**Confidence:** HIGH for codebase reuse and wiring (every path below was read in this session). MEDIUM for the simulate-first design of multi-transaction actions, which is new and partly bounded by RPC limits. LOW/ASSUMED for the Sentry token type.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried forward (locked earlier, not re-decided)
- **D-01:** Chain access, keys and the master seed stay in the worker (FEE-10, Phase 5 D-02). Web reads Postgres for page data and calls the worker's private bearer HTTP (`apps/worker/src/http.ts`, `apps/web/lib/worker.ts`). Every admin transaction is built, simulated, signed and sent by the worker with derived keys (W, ops, treasury, buyback). Ops pays every fee.
- **D-02:** Neon budget (Phase 3 D-04, Phase 5 D-03, memory note): 0.25 CU computes, nothing reads Postgres on a timer, and an open admin tab must not keep Neon awake.
- **D-03:** One worker replica (Phase 4 D-07, Phase 5 D-07). In-memory stores (prepared trades, engine state) stay per process.
- **D-04:** The fee engine and its rules are Phase 5 as shipped: intent-first `fee_ledger` rows (D-08), the `FEE_ENGINE` off/dry/on flag (D-09), the spend guard in `fee-guard.ts` (CR-01 fix), the held finalize and its release (D-18), the ops floor pause (D-20) and reconciliation diff rows (D-21). Admin actions call the same engine job functions; they never duplicate fee math.
- **D-05:** The held-finalize rule: the update is permanent, so any pre-flight failure holds, nothing auto-retries, and only the owner releases (Phase 5 D-18). Phase 6 is the release UI.
- **D-06:** Layout follows the approved `.planning/mockups/admin.html` and DESIGN-BRIEF section 5 ("dense console: balances and kill switches first, then health, then the W table, then the selected coin timeline, then inspector, moderation and audit log, with EVACUATE isolated at the bottom"). gsd-ui-phase writes the UI-SPEC before planning. Mockup numbers are illustrative, not config.
- **D-07:** No emoji anywhere; SVG icons and text labels only. Values are SOL equivalents in the UI (Phase 3 D-01).

#### Sign-in and session (ADMIN-01)
- **D-08 (owner-delegated):** The allowlist is one env value, `ADMIN_WALLET` (a public key, not a secret), set on both web and worker. Unset or invalid means admin fails closed: `/admin` shows "Admin is not configured" and every `/admin/*` worker route answers 403. This is the phase's ship-dark switch (AGENTS.md section 6), so no extra feature flag.
- **D-09 (owner-delegated):** Sign-in reuses the Phase 2 pattern in `apps/web/lib/session.ts`: a sealed nonce, a Phantom `signMessage`, `signatureOk`. The admin message is domain-separated from the consent message ("BONDR admin sign-in", wallet, nonce, expiry), so a consent signature can never open admin. The nonce is single-use (spent in Postgres like consent; one write per sign-in is fine for Neon).
- **D-10 (owner-delegated):** A separate `bondr_admin` cookie, HMAC-sealed with SESSION_SECRET, HttpOnly, SameSite=Strict, Path=/, with a 30-minute absolute expiry (no sliding renewal). The UI shows the time left, as in the mockup. Any wallet other than ADMIN_WALLET gets "This wallet is not the admin wallet" and no cookie. The public 12-hour session is unchanged.
- **D-11 (owner-delegated):** `/admin` is not linked anywhere, is `noindex`, and renders only the sign-in panel until the admin cookie is valid. Every web `/api/admin/*` route checks the cookie, `sameOrigin` and `rateLimited` (`apps/web/lib/guard.ts`), then forwards to the worker with the session wallet as the actor.

#### Fresh signature and simulate-first (ADMIN-01, ADMIN-04)
- **D-12 (owner-delegated):** "Money-moving" means any action that sends a transaction. Each one runs in two calls:
  1. `simulate`: the worker builds the transactions, simulates them with the accounts option, and returns the result, CU, fee, before/after balances for every touched account, and the destination check. It keeps the built transactions in memory for 2 minutes under an intent id (same pattern as the Phase 4 trade store).
  2. `execute`: the owner signs a human-readable intent message in Phantom ("BONDR admin action", action, coin, intent id, destinations, expiry). The worker itself verifies that signature against ADMIN_WALLET, so a leaked WORKER_TOKEN alone cannot move funds. The intent id is single-use, and an expired blockhash or intent means simulate again. Nothing is resent automatically.
- **D-13 (owner-delegated):** Non-transaction actions (hold for review, re-check launch, kill switch flips, hide, block, unhide, unblock) need the admin session only, no fresh signature, and are still written to the audit log.
- **D-14 (owner-delegated):** Destination lock in the worker, not the UI. Before simulating, the worker checks every outflow recipient against an allowlist built for that action: the burn instruction, the treasury, the buyback wallet, that coin's deployer (`launches.wallet`), and the coin's own W or vault accounts for internal moves. Ops only pays fees and rent. Anything else refuses with `destination_refused`, and the simulation dialog shows "Destinations check passed: ..." as in the mockup.
- **D-15 (owner-delegated):** Finalize from the dashboard always uses the coin's recorded deployer (`launches.wallet`). The UI never accepts a typed deployer address. A held coin is released by re-running finalize with that deployer after the owner has read the hold reason. The existing `POST /fee/release` keeps its bearer-only behaviour for the runbook, but the admin route does not expose the "owner names a deployer" form, so ADMIN-04's "that coin's deployer" holds.

#### Recovery actions (ADMIN-03)
- **D-16 (owner-delegated):** Each action maps to an existing engine path, and admin actions run even when that job's kill switch is off (pause the automation, fix by hand). The per-coin queue (`Engine.enqueue`) serializes them with automatic jobs.

  | Action | What it does | When it applies |
  |---|---|---|
  | Sweep now | the window job out of schedule: collect, split, then the 90/10 sweep (`fee-guard.ts` windowJob) | curve coin |
  | Retry forced bond | the forced-bond job, with the fresh curve read and simulation of Phase 5 D-15 | curve coin with budget at or above the 105% trigger |
  | Burn W token balance | burns any child tokens W holds (WR-08) | any coin whose W holds child tokens |
  | Run migrate | pump's permissionless migrate (`migrateIxs`) when the keeper has not migrated a complete curve | complete, unmigrated curve |
  | Finalize split | `finalizeJob`, both transactions, deployer = `launches.wallet` (D-15); also the held-finalize release | bonded coin, finalize not revoked |
  | Hold for review | marks the coin held; the engine skips all of its sends until released (no transaction) | any coin |
  | Retry sweep | settles the coin's pending or failed sweep rows from chain, then re-runs the window job | coin with a failed or expired sweep row |
  | Distribute now | `distributeJob` for one coin, ignoring the batch minimum | finalized coin |
  | Re-check launch | `settleLaunch` for a launch stuck in signed, sent or unknown, then arms the coin if it landed (no transaction) | launch rows not landed or failed |
  | Sweep leftovers, close accounts | after finalize: leftover BONDR swept 90/10, leftover child tokens burned, W's empty token accounts closed with rent to the treasury | finalized coin |
  | Burn buyback now | `buybackBurnJob` out of schedule | platform (no coin) |

  The UI greys an action that does not apply to the coin's state and says why (mockup copy: "Greyed actions do not apply after bond").
- **D-17 (owner-delegated, folds Phase 5 WR-08):** Leftover child tokens in W are burned, never held.
  - Fix `forcedBondIxs` so its minimum out is computed from the buy, not from W's whole child balance, so a leftover no longer reverts every later forced bond (`packages/core/src/bond.ts`).
  - Add a public ledger kind `leftover_burn` (migration on the `fee_ledger_kind` check, `totalsFor`, reconcile and `ledger-copy.ts`). Copy: "Burned leftover X GRUB".
  - "Burn W token balance" writes it, and finalize's closing step burns any leftover automatically instead of only logging it.

#### Kill switches (ADMIN-05)
- **D-18 (owner-delegated):** Five switches: launches (exists), forced bond, sweeps, finalize, buyback burn. They are new boolean columns on the single-row `settings` table, loaded once at boot and held in worker memory, exactly like the Phase 2 launches switch (`status.ts`). One route `POST /admin/switch {job, enabled}` writes the DB, then memory. No reads on a timer.
- **D-19 (owner-delegated):** What each switch covers:
  - forced bond covers the forced bond and the fallback pool burn
  - sweeps covers the window collect, split and sweep
  - finalize covers finalize and the distribution crank
  - buyback burn covers the daily buyback burn
  - reconciliation always runs, because it only reads
  A paused job skips its sends, while trade events keep accruing in memory. On resume, the next trigger or window catches up. Pausing never moves funds (mockup copy). `FEE_ENGINE` stays the deploy-time master flag above the switches.
- **D-20 (owner-delegated):** No job-wide auto-pause after N failures (the mockup's "auto-paused after 3 failed attempts"). Instead, a step that fails 3 times for one coin shows as stuck on that coin's row and timeline, with its retry action. The Phase 5 behaviour already does not resend unknown rows.

#### Data freshness under the Neon budget (ADMIN-02, ADMIN-06, ADMIN-08)
- **D-21 (owner-delegated):** Postgres-backed panels (W table, platform totals, timeline, moderation lists, audit log, vanity pool size) load on page open, on a Refresh button, and after each action. They never load on a timer.
- **D-22 (owner-delegated):** Worker-memory panels (heartbeat, kill switch states, last run per job, RPC stats, ops floor state) come from one `GET /admin/health` that reads memory only. The page polls it every 10 s only while the tab is visible. Neon can suspend with the console open.
- **D-23 (owner-delegated):** Balances: treasury, buyback and ops are read from chain by the worker (one getMultipleAccounts) on load and on Refresh. The W table uses the coin row's `fee_budget` (Phase 5 D-23) instead of reading 500 W accounts. Live W balances are read only for the selected coin and inside each simulation.
- **D-24 (owner-delegated):** The W table shows every coin, loaded in one query, with filter chips per state, as in the mockup: All, Stuck, Trigger ready, Held, Collecting, Finalized. Each coin's state and next step come from the engine's in-memory coin state joined to the coin row. The table scrolls horizontally inside its container on narrow screens.

#### Health (ADMIN-06)
- **D-25 (owner-delegated):** Heartbeat is the worker's own answer: boot time, uptime, the last indexer stream event and the last engine activity.
  - There is no leader lock today. One replica is the guard (D-03). A Postgres session advisory lock would hold a connection open, which risks keeping Neon awake.
  - So the "Leader lock" row honestly reports "single replica, no lock" plus the instance id and boot time. A real lock stays deferred until the worker scales out.
- **D-26 (owner-delegated):** RPC latency and errors are measured in the worker. Its Connection uses a fetch wrapper that keeps an in-memory ring of the last hour: p50, p95, error rate and 429 count. Last run per job is in-memory timestamps set by each job, shown as "since boot" after a restart.
- **D-27 (owner-delegated):** Sentry issue count comes from the worker calling the Sentry API with a read-only token, `SENTRY_READ_TOKEN`. It reads the unresolved issues of bondr-web and bondr-worker, cached 60 s and fetched on demand. With no token, the row shows "Sentry not configured" and nothing breaks. Creating the token is a free owner-side step, not a blocker.
- **D-28 (owner-delegated):** The vanity pool size is a count of free rows in `vanity_mints`, read with the page load (D-21), with the mockup's alert below 100. The ops row reuses `OPS_FLOOR_LAMPORTS`. It shows a warning style below the floor and an estimate of the transactions left.

#### Moderation (ADMIN-07)
- **D-29 (owner-delegated):** Hide is a `coins.hidden_at` timestamp plus a reason. Hidden coins drop out of home lists, search, Trending and the Next to bond rail. The token page stays reachable by URL with its proof and ledger intact, because the fee record must stay verifiable. The change shows after the web list cache expires (about a minute); that is acceptable.
- **D-30 (owner-delegated):** Block is a `blocked_deployers` table (wallet, reason, time). It does not use the `wallets` consent table, because a deployer can be blocked before it ever consents. The worker's launch prepare checks it at prepare time, which already reads the DB, and refuses with a `blocked` error that web shows plainly. Unhide and unblock exist, and every change is audited.

#### Timeline (ADMIN-08)
- **D-31 (owner-delegated):** A per-coin timeline built from the launch row, `fee_ledger` rows (including `held` and `reconcile_diff`) and the engine's in-memory state. Each step has a state (done, stuck, next), time, short signature and Solscan link. A stuck step shows its last error and attempt count, with its retry action inline (the mockup's stuckbox). The next expected step is computed: window end time, trigger ratio, awaiting migration, finalize next, or distribute after finalize.

#### Transaction inspector (ADMIN-09)
- **D-32 (owner-delegated):** `POST /admin/inspect {signature}` calls `getTransaction` (RPC only, no DB) and decodes instructions by program: System, Token and Token-2022, ATA, ComputeBudget, pump, pump-amm, pump-fees, using the pinned SDK IDLs. Program errors are mapped through the existing `trade-error.ts` map plus IDL error names. It works for any signature, not only BONDR's, and returns status, slot, fee payer, instructions, error and a Solscan link.

#### Audit log (ADMIN-10)
- **D-33 (owner-delegated):** A new `admin_audit` table: id, time, actor wallet, action, mint (nullable), params, simulation summary (result, CU, fee, balance changes, destination check), the owner's intent signature, transaction signatures, and result (pending, landed, failed, refused).
  - The worker writes it intent-first, before sending, then settles it, the same model as Phase 5 D-08.
  - Non-transaction actions are written as one landed row.
  - Code only ever inserts and settles, and a DB check limits state transitions.
  - Shown newest first, 50 per page with Load more (keyset, like the Phase 3 trade feed).
- **D-34 (owner-delegated):** The worker writes every audit row, because it does the sends. Moderation and switch changes also go through worker routes, so there is one write path and one audit writer.

#### EVACUATE (ADMIN-11)
- **D-35 (owner-delegated):** The flow:
  1. The owner types `EVACUATE ALL W TO TREASURY` exactly (mockup copy). The button stays disabled until it matches.
  2. Simulate: the worker builds transfer transactions for every W holding a balance, several W signers per transaction within the size limit. It simulates all of them and shows totals: wallets, BONDR, SOL and failures.
  3. The owner signs the intent (D-12).
  4. Execute: the worker first switches every kill switch off, launches included, and persists `settings.evacuated_at`. Then it sends the transfers, paced like the engine.
- **D-36 (owner-delegated):** W's BONDR and spare SOL go to the treasury. Any child-token balance is burned rather than moved (burn is an allowed destination). Moving child supply into the treasury would put a dev-like holder on the coin and break the core claim.
  - Each W move writes a public `evacuate` ledger row ("Moved X BONDR to treasury, emergency"), because the public ledger must say where the budget went.
  - After EVACUATE, switches stay off until the owner turns them back on one by one. Seed rotation is out of scope (Phase 7 runbook).
- **D-37 (owner-delegated):** EVACUATE is proven locally on devnet against the dev database's coins and by unit tests. On staging it runs simulate-only, so the staging engine keeps running for HV-05-01.

#### Layout and devices
- **D-38 (owner-delegated):** It is responsive at 390, 768 and 1440 per the mockup, answering DESIGN-BRIEF open question 4. Every action, including EVACUATE, works on a phone, because the owner often reacts to an alert away from a desk. Screenshots at all three widths go to the Designer critique (AGENTS.md section 7).

#### Testing and rollout
- **D-39 (owner-delegated):**
  - **Units:** the intent message binding (action, coin, id, expiry), single use, wrong-wallet refusal, the destination allowlist, the switch gating per job, the 30-minute expiry, and the phrase match.
  - **Playwright:** drives the console with the fake Phantom (`apps/web/e2e/phantom.ts`) and `ADMIN_WALLET` set to a test key locally. It covers sign-in, the non-admin refusal, the switches, a simulate-then-sign action, hide and block, the inspector, and the audit row.
  - **Devnet:** Sweep now, Burn buyback now and Re-check launch run on real dev coins.
  - **Surfpool fork:** Retry forced bond, Burn W token balance, Run migrate, Finalize split and Distribute now run on the fork, as in Phase 5.
  - **Spend cap:** devnet ops spend stays under 0.1 SOL for the phase.
  - **Staging:** deploys with ADMIN_WALLET set to the owner's Phantom address once the owner gives it. Until then staging admin fails closed (D-08).

### Claude's Discretion
- Exact schema for `admin_audit`, `blocked_deployers` and the new `settings` and `coins` columns, as long as the D-33 transition check and the D-14 rule hold.
- The intent message wording and the in-memory intent store shape.
- How many W fit per EVACUATE transaction, and its pacing.
- The IDL decoding library for the inspector (prefer what the pinned pump SDKs already ship).
- Whether the admin sign-in nonce reuses `consent_nonces` or gets its own table.
- Component split of the console, within the 300-line file rule.

### Folded Todos
- **Phase 5 worker-core review WR-08** (STATE.md Pending Todos): `forcedBondIxs` sets minOut to W's whole child balance, so any leftover in W reverts every later forced bond, and leftovers are never burned. Folded as D-17, because ADMIN-03's "Burn W token balance" is its recovery path.

### Deferred Ideas (OUT OF SCOPE)
- **Treasury independent of the master seed (Phase 7, owner-gated, before mainnet):** today the treasury is derived from the same master seed as every W (`env.ts`). So after a real seed leak, EVACUATE moves funds into a wallet the attacker can also derive. Before mainnet, the treasury should be an external address (for example `TREASURY_PUBKEY`) not derived from the seed. This touches the permanent 8000/2000 finalize target, so it needs an owner decision.
- Master seed rotation after EVACUATE: a Phase 7 runbook.
- The "Pump contract check" health row: when OPS-02 ships in Phase 7.
- A Postgres leader lock and a multi-replica worker: only if the worker scales out.
- Reclaiming launch lookup table rent (deactivate, wait, close): a later chore. It is not in ADMIN-03's list.
- Job-wide auto-pause after repeated failures (in the mockup): add if per-coin stuck marking proves too noisy.
- A trading kill switch: only if needed (Phase 4 D-18).
- The first real-SOL admin action on mainnet: Phase 7, owner-gated.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Allowlisted wallet sign-in, 30 min session, fresh signature per money action | Extend `apps/web/lib/session.ts` (seal/unseal/issueNonce, `signatureOk` from `@bondr/core/sig`); domain-separated admin cookie value (Pitfall 1); intent store + worker-side signature check (Pattern 3, Code Examples 1-2) |
| ADMIN-02 | Treasury, buyback, ops balances; every W with state; platform totals | One `getMultipleAccountsInfo` in the worker; W table = one web query over `coins` + `launches` (+ in-flight launches) joined to engine memory (Pattern 6) |
| ADMIN-03 | The 11 recovery actions | Action registry mapping to `windowJob`, `forcedJob`, `finalizeJob`, `distributeJob`, `buybackBurnJob`, `settleRows`, `settleLaunch`, `migrateIxs`, plus two new builders (W child burn, close accounts) (Pattern 4) |
| ADMIN-04 | Simulate first with balance changes; destinations limited | Capturing `FeeDeps.land` + `simulateTransaction` with `accounts` (already used in `bond.ts`), outflow decoder + allowlist enforced inside the admin `land` (Patterns 2 and 5) |
| ADMIN-05 | Five per-job kill switches | `settings` columns + one memory module generalizing `status.ts`; gate via a new `FeeDeps.allowed(job, coin)` checked at the top of each job (Pattern 7) |
| ADMIN-06 | Heartbeat, leader lock, last runs, RPC stats, Sentry count, vanity pool | Memory-only `/admin/health`; `fetch` option of web3.js `Connection` for the RPC ring; Sentry Organization Issues API (Pattern 8) |
| ADMIN-07 | Hide coin, block deployer | `coins.hidden_at/hidden_reason` filtered once in core `coinRows`; `blocked_deployers` checked in worker `prepare.ts admit()` (Pattern 9) |
| ADMIN-08 | Per-coin timeline, next step, retry stuck step | Launch row + all `fee_ledger` rows of the mint + engine memory failure map (Pattern 6) |
| ADMIN-09 | Paste signature, decode, error, explorer link | `getTransaction(maxSupportedTransactionVersion: 0)`; web3.js `SystemInstruction`/`ComputeBudgetInstruction`, spl-token `decodeInstruction`, anchor 0.31 `BorshInstructionCoder.decode/format` via the SDKs' `getPumpProgram`/`getPumpFeeProgram`/`getPumpAmmProgram` (Pattern 10) |
| ADMIN-10 | Audit log with actor, time, simulation, signature | `admin_audit` table, intent-first insert + guarded settle like `launches.advance` (Pattern 11) |
| ADMIN-11 | EVACUATE: phrase, sign, pause all, drain every W to treasury | Switches off + `evacuated_at` first, then greedy packing with core `wireSize` <= `PACKET_LIMIT`, `evacuate` + `leftover_burn` ledger rows; three ledger fixes needed for multi-mint txs (Pitfalls 4-6) |
</phase_requirements>

## Project Constraints (from AGENTS.md)

No `./CLAUDE.md` exists; `AGENTS.md` is the project manual. Directives the planner must honor:

- No emoji anywhere (code, UI, commits, docs). SVG icons (lucide-react) and text labels only.
- Files under 300 lines, functions under 40 lines, three directory levels max, a README in any directory with more than five files (worker `src/README.md`, `apps/web/components/README.md`, `apps/web/lib/README.md` get one line per new file).
- One runnable check per non-trivial change. No new test framework: Vitest 4.1.11 and Playwright 1.63.0 already exist.
- Ponytail at `full`: reuse before writing; no new dependency for what a few lines do; mark deliberate shortcuts with a `ponytail:` comment naming the ceiling and upgrade path.
- Never break the build; every task leaves `pnpm test`, `pnpm lint` (Biome 2.5.15) and `pnpm typecheck` green.
- Never commit secrets; `.env.example` lists every new variable name (`ADMIN_WALLET`, `SENTRY_READ_TOKEN`, the EVACUATE mode flag).
- Ask before destructive or outward-facing actions. Devnet and staging deploys are pre-approved in autonomous mode; mainnet, real SOL and paid plan changes stop for the owner (memory: autonomous mode).
- Database constraints over application checks (section 6).
- Every UI phase ends with Playwright screenshots at 390, 768, 1440 plus axe; Designer critique before sign-off.
- Branch per phase (already on `phase-06-admin-dashboard`), small atomic commits.
- Neon: 500 CU-h/month hard quota, 0.25 CU, no polling DB reads (memory note).

## Summary

Phase 6 is mostly wiring around code that already exists. The worker already has the bearer HTTP server (`http.ts`), the launches kill switch in memory (`status.ts`), the in-memory store with a 2-minute TTL (`trade-store.ts`), every engine job the 11 actions need (`fee-guard.ts`, `fee-burns.ts`, `fee-finalize.ts`, `fee-batch.ts`, `fee-recover.ts`, `settle.ts`), one signing choke point with a program allowlist (`signTx` in `core/send.ts`), and a proven `simulateTransaction` call with the `accounts` option (`core/bond.ts simulatedBalance`). The web already has the HMAC seal, nonce and Phantom `signMessage` flow (`lib/session.ts`, `consent-dialog.tsx`), the CSRF and rate-limit guards (`lib/guard.ts`), the worker client that strips raw error text (`lib/worker.ts`) and a fake Phantom with real Ed25519 keys for Playwright (`e2e/phantom.ts`). No new npm package is needed: anchor 0.31.1 (an SDK dependency) provides IDL instruction decoding through the SDK's own `getPumpProgram`/`getPumpAmmProgram`/`getPumpFeeProgram`, and web3.js/spl-token provide the native decoders.

The single most important design insight: every engine job sends through the injected `FeeDeps.land(job)`. That one seam makes simulate-first cheap. Simulation runs the same job with a `FeeDeps` whose `land` simulates and records instead of sending (mode `dry`, no ledger writes, a copied `FeeCoin`). Execution runs the same job with a `FeeDeps` whose `land` first enforces the action's destination allowlist and records signatures into the intent. A new `FeeDeps.allowed(job, coin)` gives the automated deps the kill switches and the per-coin hold, while the admin deps always allow (admin actions run with switches off, D-16). This keeps D-04 ("never duplicate fee math") literally true.

The highest-risk findings are four latent bugs the phase would trip over: (1) the admin cookie value would be indistinguishable from the 12-hour public session cookie (same `wallet-exp` format, same key), so the owner's public cookie could be pasted in as an admin cookie; (2) EVACUATE's "several W per transaction" collides with the `fee_ledger_sig_kind` unique index (one row per signature and kind), so the insert is refused and nothing is sent; (3) `withSol`, `landed()` and `fee-recover landed()` assume one mint and one row per kind per transaction; (4) dependent multi-transaction actions (Sweep now, Finalize split) cannot be simulated as one exact sequence on a plain RPC, so the simulation must be honest about later steps. A fifth surprise: the D-17 `forcedBondIxs` minOut fix is already in the code (`minOutAfter`, `bond.test.ts`), so only the `leftover_burn` kind and the burns remain.

**Primary recommendation:** Build the phase as one worker module family (`admin-*.ts`) that runs the existing engine jobs through two alternate `FeeDeps` (capture for simulate, gated for execute), one web catch-all forwarder `app/api/admin/[op]/route.ts` (all POST), and one additive migration `0007`. Fix the four latent bugs first, in the wave that adds the schema.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Admin sign-in (nonce, signMessage verify, cookie) | Frontend Server (Next route handlers) | Database (nonce spend in `consent_nonces`) | Same as consent today; web owns cookies, worker never sees cookies |
| Admin authorization of every API call | Frontend Server (cookie, sameOrigin, rate limit) | API/Backend (worker re-checks `ADMIN_WALLET` + actor) | D-11 plus D-08 fail-closed in both tiers |
| Fresh-signature verification for money actions | API/Backend (worker) | Browser (Phantom signs the worker's text verbatim) | D-12: a leaked WORKER_TOKEN alone must not move funds |
| Build, simulate, sign, send admin txs | API/Backend (worker) | — | D-01: keys and chain only in the worker |
| Destination allowlist | API/Backend (worker, inside the admin `land`) | — | D-14: never the UI |
| Kill switch state | API/Backend (worker memory) | Database (`settings` row, read at boot, written on flip) | D-18, Neon rule |
| Health (heartbeat, RPC ring, last runs, Sentry count) | API/Backend (worker memory) | External (Sentry API, cached 60 s) | D-22: the poll must never wake Neon |
| W table, totals, timeline rows, audit pages, moderation lists, vanity count | Frontend Server (web Postgres reads on page load and Refresh) | API/Backend (engine memory per coin, chain balances) | D-01, D-21 |
| Hidden-coin filter | Database query (core `coinRows`) | — | One WHERE in the shared list query |
| Blocked deployer | API/Backend (worker `prepare.ts`) | Database (`blocked_deployers`) | D-30 |
| Transaction inspector | API/Backend (worker RPC + IDL decode) | Browser (renders labeled text only) | Program IDs must not enter the client bundle (`scripts/check-client-bundle.sh`) |
| Audit log writes | API/Backend (worker) | Database (CHECK + guarded UPDATE) | D-34: one writer |
| Health poll scheduling, countdown, EVACUATE phrase match | Browser | — | Visibility-aware `setTimeout` chain |

## Standard Stack

### Core (all already installed; no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.3.8 | `/admin` page, `/api/admin/*` route handlers | [VERIFIED: apps/web/package.json] existing app |
| react / react-dom | 19.3.0 | Console components | [VERIFIED: apps/web/package.json] |
| node:http (worker) | Node 24.13.0 | `/admin/*` routes beside `feeRoutes` | [VERIFIED: apps/worker/src/http.ts] existing server |
| node:crypto | Node 24 | HMAC seal, Ed25519 verify (`signatureOk`), random ids | [VERIFIED: apps/web/lib/session.ts, packages/core/src/sig.ts] |
| @solana/web3.js | 1.99.0 | `simulateTransaction({accounts})`, `getTransaction`, `SystemInstruction`, `ComputeBudgetInstruction`, `Connection({fetch})` | [VERIFIED: lib/index.d.ts lines 466, 1116, 3234] |
| @solana/spl-token | 0.4.15 | `decodeInstruction(ix, programId)`, `AccountLayout`, `MintLayout`, `createBurnCheckedInstruction`, `createCloseAccountInstruction`, `createTransferCheckedInstruction` | [VERIFIED: lib/types/instructions/decode.d.ts:27] |
| @pump-fun/pump-sdk | 4.1.0 | `getPumpProgram`, `getPumpFeeProgram`, `pumpIdl`, `migrateV2Instruction`, `decodeSharingConfig` | [VERIFIED: dist/index.d.ts] |
| @pump-fun/pump-swap-sdk | 2.1.0 | `getPumpAmmProgram`, `pumpAmmJson` | [VERIFIED: dist/index.d.ts]; use this copy, not the nested 1.x (core `pump.ts` comment) |
| @coral-xyz/anchor (transitive) | 0.31.1 | `program.coder.instruction.decode(data)` and `.format(ix, metas)` | [VERIFIED: dist/cjs/coder/borsh/instruction.d.ts:19,23]; reached only through the SDK `Program` objects, never imported directly (pnpm strict) |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | Schema + migration 0007 | [VERIFIED: package.json] |
| postgres | 3.4.9 | Driver | [VERIFIED] |
| lucide-react | 1.52.0 | Icons (one new: `Pause`) | [VERIFIED: UI-SPEC] |
| @sentry/node | 11.4.0 | Already reports worker errors; the issue count uses plain `fetch` to the Sentry REST API | [VERIFIED] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.11 | Units (no config file, `*.test.ts`) | Every pure module and DB-backed test (skips without DATABASE_URL) |
| @playwright/test | 1.63.0 | E2E (`*.e2e.ts`) | Console flows, screenshots |
| @axe-core/playwright | 4.13.0 | a11y gate via `e2e/shoot.ts gate()` | Every surface at 3 widths |
| Surfpool | 1.6.1 (`.cache/surfpool/surfpool`) | Fork gate for the 5 fork-only actions | `pnpm spike:fork-up` |
| neonctl | 8.10.3 | Neon idle check | After deploy and with the console open |
| railway CLI | 5.71.0 | Staging deploy | 06 staging plan |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SDK `getPumpProgram(...).coder` | Direct `new BorshInstructionCoder(pumpIdl)` import | Needs `@coral-xyz/anchor` as a declared core dependency; the SDK objects already carry the coder, so no |
| Org-issues Sentry endpoint | `@sentry/node` API | The SDK reports events; it has no issue-listing API. Plain `fetch` is 15 lines |
| `solana:signIn` (SIWS) feature | `signMessage` | The project already ships `signMessage` with domain-separated text; SIWS adds a second auth shape for no gain |
| Jito `simulateBundle` for sequence simulation | Per-step `simulateTransaction` | Not available on Helius devnet [ASSUMED]; per-step is what the RPC offers |
| Postgres trigger for audit immutability | CHECK + guarded UPDATE (launches pattern) | A trigger is the only true DB-level transition guard; optional hardening (see Pattern 11) |

**Installation:** none. `pnpm install` is unchanged.

## Package Legitimacy Audit

No external package is added in this phase. Every library above is already pinned in `pnpm-lock.yaml` and was vetted in earlier phases (14-day release rule, STATE.md 01-01 and 02-01).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | — | — | — | — | not run (nothing to install) | n/a |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Owner phone/desktop (Phantom)
   |
   | 1. GET /admin  (server render: config check, cookie check, one DB overview load, one worker overview call)
   v
Next.js web  ---------------------------------------------------------------+
   |  /api/admin/session  (nonce GET-in-POST, signMessage verify, consent_nonces spend, bondr_admin cookie)
   |  /api/admin/[op]     (POST only: cookie -> sameOrigin -> rateLimited -> forward {..., actor})
   |       ops read locally from Postgres: overview, coin timeline rows, audit page
   |       ops forwarded to worker: health, coin-live, simulate, execute, intent, act, switch, moderate, inspect
   v                                                                        |
Worker (private, bearer)                                                    |
   admin gate: ADMIN_WALLET valid? actor === ADMIN_WALLET? else 403          |
     |                                                                      |
     +-- health  -> memory only (marks, rpc ring, switches, opsLow, Sentry cache 60 s) --> Sentry API (on demand)
     +-- switch/moderate/act -> Postgres write -> memory -> admin_audit (landed row)
     +-- inspect -> RPC getTransaction -> decoders (web3, spl-token, SDK coders) -> labeled text
     +-- simulate {action, mint}
     |      applicability check -> allowlist for action -> run engine job with CAPTURE FeeDeps
     |      (land = compile+simulate with accounts option, record pre/post balances; no ledger writes)
     |      -> intent store {id, message text, summary, allowlist, expiresAt} -> return to browser
     |
     |   Browser shows dialog; Phantom signs the returned message text
     |
     +-- execute {id, signature}
     |      verify signature over STORED text against ADMIN_WALLET; mark used (sync)
     |      insert admin_audit pending -> Engine.enqueue(mint) -> same job with GATED FeeDeps
     |      (land = destination check -> core signTx (program allowlist) -> fee_ledger intent -> broadcast)
     |      -> intent.state/sigs updated in memory -> admin_audit settled
     +-- intent {id} -> memory only (browser polls 1 s while Sending)
     |
     +-- evacuate (same simulate/execute shape): switches off + evacuated_at -> greedy-packed W batches
            -> each batch waits for its mints' queues idle -> land (paced 1.1 s) -> evacuate/leftover_burn rows
```

### Recommended Project Structure

```
apps/worker/src/
  admin-routes.ts      # route map, ADMIN_WALLET + actor gate, wiring into main.ts
  admin-intent.ts      # intent store (trade-store shape), intentMessage(), take() single-use + verify
  admin-actions.ts     # registry: the 11 actions -> applies(), allowlist(), run(d, coin)
  admin-sim.ts         # capture FeeDeps, per-job simulation, balance diff, fee estimate
  admin-dest.ts        # pure outflow decoder + allowlist check
  admin-audit.ts       # insert pending / settle / one-shot landed rows
  admin-leftover.ts    # W child burn + close accounts builders (new ixs, leftover_burn rows)
  admin-evacuate.ts    # balances read, greedy packing, execute loop
  admin-inspect.ts     # getTransaction + decoders
  admin-moderate.ts    # hide/unhide/block/unblock writes
  health.ts            # boot time, instance id, marks (stream, engine, per-job last run), snapshot
  rpc-stats.ts         # timed fetch for Connection + 1 h ring, p50/p95/errors/429
  sentry-count.ts      # SENTRY_READ_TOKEN fetch, 60 s cache
  switches.ts          # five switches: boot load, memory, set (generalizes status.ts launches switch)
  fee-boot.ts          # split out of fee-engine.ts (loadRows, feeDeps, startEngine): fee-engine.ts is at 299 lines
packages/core/src/
  schema.ts            # settings columns, coins hidden/held columns, blocked_deployers, admin_audit, kind check
  migrations/0007_admin.sql
  api.ts               # AdminAction, AdminJob, admin error codes, LedgerKind + leftover_burn, evacuate, payload types
  fees.ts              # PUBLIC_KINDS + totalsFor for the two new kinds
apps/web/
  app/admin/page.tsx
  app/api/admin/session/route.ts
  app/api/admin/[op]/route.ts      # one forwarder + local DB ops
  lib/session.ts                    # + adminMessage, adminCookie, adminSession (reuse seal/unseal)
  lib/admin-data.ts                 # Postgres reads (W rows, totals, timeline rows, audit page, moderation, vanity)
  lib/admin-run.ts                  # client: simulate -> signMessage -> execute -> poll intent (mirrors trade-run.ts)
  lib/admin-copy.ts (+ .test.ts)    # pure maps per UI-SPEC
  lib/use-health.ts                 # visibility-aware 10 s poll
  components/admin-*.tsx            # one panel per file per UI-SPEC Component Inventory
scripts/spike/stages/admin.ts       # fork rows for the 5 fork-only actions
apps/web/e2e/admin*.e2e.ts          # console specs (+ a serial project for switch flips)
```

### Pattern 1: Admin session reuses session.ts, with a domain-separated cookie value
**What:** Put the admin helpers in `lib/session.ts` (88 lines today) so they reuse the private `mac/seal/unseal`. Message header "BONDR admin sign-in". Cookie `bondr_admin`, value sealed as `admin-<wallet>-<exp>`. Verify the tag, the wallet equals the configured `ADMIN_WALLET`, the expiry is in the future, and `exp - now <= 30 min`.
**When to use:** sign-in POST, every `/api/admin/*` call, the `/admin` server render.
**Why the tag:** the public cookie is `seal("<wallet>-<exp>")` with the same SESSION_SECRET. Without a tag, the owner's 12 h public cookie value is a valid admin cookie value (Pitfall 1).

### Pattern 2: Two alternate FeeDeps around the unchanged engine jobs
**What:** `FeeDeps.land` is already the single send seam (`fee-send.ts land`, wired in `fee-engine.ts feeDeps`). Build:
- `simDeps(base, steps)`: `{...base, mode: "dry", publish: () => {}, land: (job) => simulateJob(base, job, steps)}`, returning `{state: "dry"}`. `settled()` treats `dry` as settled, so later steps of the job still build. In dry mode the guard never settles rows (`fee-guard.ts guard`) and `hold()`/`lockedFinal()` write nothing.
- `adminDeps(base, intent)`: `{...base, mode: "on", allowed: () => true, land: async (job) => { const bad = refusedDestination(job.ixs, intent.allow); if (bad) return refuse(bad); const r = await land(d, job); intent.record(r); return r; }}`.
- Automated deps: `allowed(job, coin)` returns `switches[job] && !coin.held`.
**When to use:** every money action and EVACUATE.
**Critical:** pass a shallow copy of the engine's `FeeCoin` into the simulation (`{...coin}`), because jobs mutate `coin.open`, `coin.finalize`, `coin.notReady` (`fee-finalize.ts lockedFinal` sets `coin.finalize = "done"` even in dry mode).

### Pattern 3: Intent store and fresh signature (trade-store shape)
**What:** `Map<id, Intent>` with `id = randomBytes(16).toString("hex")`, TTL 2 min until executed, max entries bounded like `TRADE_MAX`. The worker builds the message text, stores it, and returns it. The browser signs those exact bytes. `execute` rebuilds nothing from the browser: it verifies `signatureOk(Buffer.from(stored.message), sig, ADMIN_WALLET)` and only then sets `used = true`, with no `await` between the check and the set, so two concurrent executes cannot both pass. An invalid signature does not burn the intent (no DoS by a token holder). After execute, keep the entry (state, sigs) for about 10 minutes for the browser's poll.

### Pattern 4: Action registry
One record per action: `{ tx: boolean, applies(view) -> reason | null, allow(coin, d) -> Allowed, run(d, coin) -> Promise<Landed[]> }`.

| Action | run | Allowlist (plus burn, ops fees/rent, W and W ATAs) |
|---|---|---|
| Sweep now | `windowJob(d, coin, windowOf(launchedAt, now, windowMs))` | treasury, buyback |
| Retry forced bond | `forcedJob(d, coin)` | treasury (split) |
| Burn W token balance | new `leftoverBurnJob(d, coin)`: BurnChecked of W's child balance, `leftover_burn` row | burn only |
| Run migrate | `migrateIxs({global, user: ops, mint, quoteMint})` via `d.land` with no ledger row (audit only) | none (pump program flows) |
| Finalize split | `finalizeJob(d, coin, coin.wallet)` (override = `launches.wallet`, D-15) | treasury, deployer = `launches.wallet` |
| Hold / Release hold | DB + memory only | n/a |
| Retry sweep | `settleRows` for the coin's pending sweep rows, then `windowJob(d, coin, failedRow.windowIndex)` | treasury, buyback |
| Distribute now | `distributeJob(d, coin, {anyAmount: true})` (new optional flag skips `worthPaying`'s minimum; still needs pending > 0) | none top-level (program pays the locked holders) |
| Re-check launch | one-shot status check, `landed` path of `settle.ts` (Pattern 12) | n/a |
| Sweep leftovers, close accounts | `sweepJob` at the next free window index, `leftoverBurnJob`, then CloseAccount of W's empty BONDR and child ATAs, destination treasury | treasury, buyback, burn |
| Burn buyback now | `buybackBurnJob(d)` on the `"platform"` queue | burn only |

Serialization: when the engine exists, `let out; await engine.enqueue(mint, async () => { out = await run(d, coin); })`. `enqueue` swallows the job's error and returns `void`, and with `FEE_ENGINE=off` the engine is `null`, so call `run` directly then.

### Pattern 5: Outflow decoder for the destination check (pure)
Decode the top-level instructions each job hands to `land` (before `budget()` is prepended):
- System `Transfer` (`SystemInstruction.decodeInstructionType` === "Transfer"): `to` = keys[1].
- Token / Token-2022 `TransferChecked` / `Transfer` (spl-token `decodeInstruction(ix, ix.programId)` in try/catch): destination ATA = keys[2] / keys[1]. Compare against the precomputed allowed ATAs (`getAssociatedTokenAddressSync(Q|mint, owner, true, T22)`).
- `CloseAccount`: destination keys[1] must be the treasury.
- `BurnChecked` / `Burn`: always allowed (the burn destination).
- ATA program create / createIdempotent: rent paid by ops, allowed.
- ComputeBudget: ignored.
- pump, pump-amm, pump-fees: program-controlled flows, covered by `ALLOWED_PROGRAMS` in `signTx` and shown in the simulated balance table. They are not decoded for recipients.

`ponytail:` the check covers BONDR-authored top-level transfers. CPI recipients inside pump programs are trusted through the program allowlist. Upgrade path: diff every writable account in the simulation result against the allowlist.

### Pattern 6: W table state = DB row + engine memory, computed in one pure function
DB part (one web query, D-24): `coins` join `launches`, plus `launches` in `signed|sent|unknown` (no coin row yet: "Launch unconfirmed"), plus one lateral or aggregate over `fee_ledger` for a pending bond burn ("Bond sent"). Memory part (worker `overview` call): per mint `{ stuck?: {step, attempts, code, at}, busy }`. Rules, in order: stuck, launch unconfirmed, held (`held_at` or `finalize = held`), bond sent, awaiting migration (`venue = complete`), bonded (`pool` + finalize `none`), finalized (`done`), trigger ready (`trigger105(budgetOf(feeBudget, feesUnclaimed), costToComplete)` from `@bondr/core/math` and `@bondr/core/fees`, both web-importable), collecting.

Stuck tracking is in engine memory, not the ledger: a job that throws while building (for example `forcedBondIxs` "burn simulation failed") writes no `fee_ledger` row, so only `enqueue`'s catch sees it. Add `failures: Map<mint, {step, attempts, code, at}>` to `Engine`, incremented in the `enqueue` rejection handler and on a `failed` Landed, and reset on a landed step. It resets on restart ("since boot", D-26).

### Pattern 7: Kill switch gate as a FeeDeps capability
Do not gate inside `land` by ledger kind: the forced bond's urgent collect and finalize's closing collect would be wrongly paused by `sweeps`. Gate once at the top of each job instead:
`windowJob` -> `sweeps`; `forcedJob` and `poolBurnJob` -> `forcedBond`; `finalizeJob` and `distributeJob` -> `finalize`; `buybackBurnJob` -> `buybackBurn`. A paused job returns `{state: "skipped"}`, which `settled()` treats as not settled, so `bondedJob` stops before finalize. Reconcile stays ungated (D-19). The `launches` switch keeps its current path (`liveStatus(ctx, fresh)` re-reads the DB at prepare and submit).

### Pattern 8: Memory-only health
- `health.ts`: `bootAt`, `instance = process.env.RAILWAY_REPLICA_ID ?? randomBytes(4)` [ASSUMED env name], `mark(name)` called from the stream message handler, `Engine.enqueue`, and one line at the top of each job ("split", "bond check", "sweep", "distribute", "buyback").
- `rpc-stats.ts`: pass `fetch` in the `Connection` config (`connect(net, {fetch: timedFetch})`; web3.js `ConnectionConfig.fetch`, verified in the d.ts). Record `{at, ms, status}`. Prune entries older than 1 h on insert and cap the array at 50k. web3.js retries 429 internally, so each retry is counted.
- `sentry-count.ts`: `GET https://sentry.io/api/0/organizations/mrbarnacle/issues/?query=is:unresolved&limit=100&statsPeriod=` with `Authorization: Bearer ${SENTRY_READ_TOKEN}` [CITED: docs.sentry.io/api/events/list-an-organizations-issues/]. Count by `issue.project.slug` in {bondr-web, bondr-worker}. Show "100+" when 100 come back. Cache 60 s with one shared promise, the `status.ts live()` pattern.
- Vanity and reconcile cells come from the page load (web reads `vanity_mints` with the `vanity.ts poolSize` predicate, and the latest `reconcile_diff` rows).

### Pattern 9: Moderation
- Hidden: add `isNull(coins.hiddenAt)` inside core `coinRows` (used only by `listCoins`, `trending`, `nextToBond`; `coinRow` for the token page and `announce.ts` stays unfiltered, D-29). Web list caches (`kept`) expire on their own.
- Blocked: in `prepare.ts admit()`, add `blocked(db(), wallet)` to the existing `Promise.all` of DB reads, and refuse before `prepareGuard`. New contract code `blocked` (HTTP 403, passes `worker.ts PASS`). Launch UI copy: "This wallet cannot launch coins on BONDR."

### Pattern 10: Inspector
`conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })` (null means "not found"). Resolve keys with `tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses })`, then decode each compiled instruction by program id. For pump, pump-amm and pump-fees use `program.coder.instruction.decode(Buffer.from(data))` and `.format(decoded, metas)` (anchor 0.31.1). The program objects come from `getPumpProgram(conn)`, `getPumpFeeProgram(conn)` and pump-swap-sdk's `getPumpAmmProgram(conn)`. Re-export the two missing getters from `core/pump.ts`. Errors: `customCode(meta.err)` plus `fromLogs(meta.logMessages)` (name from anchor's "Error Code: X" log), then `tradeError` for a contract label. Return labeled lines only. Never send program ids to client code: `scripts/check-client-bundle.sh` fails the build on ComputeBudget, Token-2022 or pump ids in client chunks.

### Pattern 11: Audit rows
`admin_audit(id identity, at timestamptz default now(), actor text, action text, mint text null, params jsonb, simulation jsonb null, intent_sig text null, sigs text[] default '{}', result text, settled_at timestamptz null, error text null)`.
CHECKs: `result in ('pending','landed','failed','refused')`, `(result = 'pending') = (settled_at is null)`, `(intent_sig is null) = (simulation is null)` for money actions [discretion]. Settle with a guarded `UPDATE ... WHERE id = $1 AND result = 'pending'`, exactly like `launches.ts advance`. Optional hardening (D-33 "a DB check limits state transitions"): a `BEFORE UPDATE OR DELETE` trigger that raises unless `OLD.result = 'pending'`. It needs a custom migration (`drizzle-kit generate --custom`). Index `(at desc, id desc)` for keyset paging.

### Pattern 12: Re-check launch as a one-shot
`settleLaunch` loops until an outcome (minutes). For the console, do one `getSignatureStatuses([sig], {searchTransactionHistory: true})`. If confirmed with no error, run the existing landed path: `advance` + `markUsed` + `ingestLaunch`, after which `announce` calls `engine.onIngest`, which arms the coin. Otherwise answer "not on chain yet" and change nothing (the boot resume and the existing unknown-retry loop own the rest). Export `landed` and `observe` from `settle.ts` instead of copying them.

### Anti-Patterns to Avoid
- **Accepting message text from the browser at execute.** Verify only against the worker's stored text.
- **Gating switches by ledger kind inside `land`.** It breaks forced bond and finalize (Pattern 7).
- **Running admin simulations on the engine's live `FeeCoin`.** Copy it first.
- **GET routes under `/api/admin` with `sameOrigin`.** Browsers omit Origin on same-origin GET, so every poll would 403. Use POST for all admin API calls (Pitfall 8).
- **Program-id maps in web code.** The bundle check fails; the worker labels everything.
- **A new feature flag for admin.** `ADMIN_WALLET` unset is the ship-dark switch (D-08).
- **Reading Postgres in `/admin/health`, or polling any DB-backed route.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ed25519 verify | tweetnacl / custom | `signatureOk` (`@bondr/core/sig`) | Already used by consent, works in web and worker |
| Cookie sealing | JWT library | `session.ts` `seal/unseal` (HMAC-SHA256, timingSafeEqual) | Existing, tested (`session.test.ts`) |
| In-memory TTL store | new cache class | copy `trade-store.ts` shape | Sweep-on-insert and size cap already proven |
| Anchor ix decoding | Borsh parser per IDL | SDK `Program.coder.instruction.decode/format` | Handles every arg type in the pinned IDLs |
| Tx size check for EVACUATE packing | byte math | core `wireSize(payer, ixs)` + `PACKET_LIMIT` | Counts signatures, keys and lookups exactly |
| Sending / settling txs | new send loop | `fee-send.ts land` (intent-first, pace, never resends unknown) | D-08 crash safety in one place |
| Program allowlist | per-action program checks | `checkMessage` inside `signTx` | Already the single signing gate |
| Error mapping | new map | `trade-error.ts` (`customCode`, `fromLogs`, `tradeError`) | D-32 says so |
| Rate limit / CSRF / JSON body cap | new middleware | `guard.ts` `rateLimited`, `sameOrigin`, `json` | Existing |
| Next batch time | date math | `fee-batch.ts nextBatchAt` | Exists |
| Free vanity count | new query | `vanity.ts poolSize` predicate (`ready`) | Same definition the grinder uses |
| Modal focus trap | JS trap / shadcn Dialog | native `<dialog>.showModal()` | UI-SPEC decision |

**Key insight:** this phase's risk is not missing capability. It is accidentally creating a second send path, a second auth shape or a second source of truth. Every recommendation above routes through the one that exists.

## Common Pitfalls

### Pitfall 1: Admin cookie interchangeable with the public session cookie
**What goes wrong:** `sessionCookie` seals `"<wallet>-<exp>"` with SESSION_SECRET. An admin cookie sealed the same way is the same token family, so a 12 h public cookie value placed under `bondr_admin` passes as a 12 h admin session.
**How to avoid:** tag the sealed value (`admin-<wallet>-<exp>`), check the tag and `exp - now <= 30 min`, and unit-test that a public cookie value is refused.
**Warning signs:** an admin test that only checks "wallet equals ADMIN_WALLET".

### Pitfall 2: Simulating dependent multi-transaction actions
**What goes wrong:** Sweep now (collect, then split sized from the collect's landed meta, then a sweep of W's post-split balance) and Finalize split (config tx, update tx that needs the config account, closing collect and sweep) cannot be simulated as an exact sequence with single `simulateTransaction` calls. Finalize's update simulation fails before the config exists.
**How to avoid:** simulate each captured step against current chain state. Make the first step authoritative for "Result". Mark later steps "re-checked by preflight when sent" (the send path does not skip preflight: `broadcast` uses `skipPreflight: false` unless `expectFail`). Present the net table as the sum of per-step simulated deltas, labeled estimated, and enforce the destination allowlist on every step at send time. Execute re-runs the job (fresh reads), not stale stored bytes. See Open Question 1.
**Warning signs:** "Result failed" on a valid finalize; sweep amounts in the dialog that ignore the pending collect.

### Pitfall 3: Two EVACUATE rows in one transaction violate `fee_ledger_sig_kind`
**What goes wrong:** the unique index is `(signature, kind)` over every row (`schema.ts`, `fee-ledger.ts keysOf` mirrors it). Several W per tx means several `evacuate` (and `leftover_burn`) rows with one signature. `insertPending` gets 23505, returns `null`, and `land` returns `{state: "done"}`: nothing is sent and nothing is reported.
**How to avoid:** migration 0007 replaces it with a unique index on `(signature, kind, coalesce(mint, ''))`, and `memoryLedger.keysOf` mirrors it. Unit-test a two-mint insert in `fee-ledger.test.ts` and `db.test.ts`.

### Pitfall 4: `withSol` and facts are keyed by kind, not by row
**What goes wrong:** `withSol` (`fee-send.ts`) writes `out[r.kind].sol` from the first row of a kind, and `pgSettle` applies `facts[kind]` to every row of that kind, so every W's evacuate row gets the first W's SOL value.
**How to avoid:** EVACUATE rows carry exact intent amounts and `sol` at build time; `withSol` skips rows whose `sol` is already set (`if (r.sol !== undefined) continue`); EVACUATE jobs pass no `facts`.

### Pitfall 5: One-mint assumptions in `landed()` and recovery
**What goes wrong:** `fee-send.ts landed()` calls `d.publish(rows[0].mint, rows)`, and `Engine.landed(mint, rows)` applies every row to that one coin. `fee-recover.ts landed()` uses `rows[0].mint` for its W. A multi-mint tx updates the wrong coin's memory and publishes wrong SSE events.
**How to avoid:** group rows by mint (`Map.groupBy`, already used in `applyTotals`) before `publish` in both places. DB totals are already grouped correctly.

### Pitfall 6: Reconcile reports every evacuated W as a diff
**What goes wrong:** `impliedOf` and `pgImplied` (`fee-reconcile.ts`) only know the Phase 5 kinds; an `evacuate` row reduces W's chain BONDR but not the implied sum.
**How to avoid:** add `evacuate` to `OUT` and to the SQL kind list. `leftover_burn` burns child tokens, not BONDR, so it needs no change.

### Pitfall 7: Window-index collisions for sweeps run by hand
**What goes wrong:** `fee_ledger_sweep` is unique on `(mint, kind, windowIndex)` over live rows. Sweep now in window k uses the slot that window k's timer will want, and the timer's sweep then inserts nothing (silently `done`). Sweep leftovers on the same day as finalize's closing sweep collides the same way.
**How to avoid:** Sweep now intentionally takes window k's slot (it is that window's sweep, early; document it). Retry sweep reuses the failed row's `windowIndex` (failed rows are not live). Sweep leftovers picks the lowest index at or after the current one with no live sweep row. Surface `{state: "done"}` with no signature as "Nothing to send" in the dialog, never as success with zero txs.

### Pitfall 8: `sameOrigin` on GET
**What goes wrong:** the Fetch spec omits Origin on same-origin GET and HEAD [CITED: Firefox bug 1508661 quoting the Fetch spec; MDN Origin], so `guard.ts sameOrigin` returns false and the 10 s health poll 403s.
**How to avoid:** every `/api/admin/*` call is POST (the bodies are tiny). The cookie is SameSite=Strict as a second layer.

### Pitfall 9: `Engine.enqueue` semantics
**What goes wrong:** it swallows rejections (`.then(() => {}, logged(what))`), resolves immediately when mode is `off`, and the engine is `null` when `FEE_ENGINE=off`. An admin action awaiting it gets no result, or never runs.
**How to avoid:** capture the result in a closure. Run directly when there is no engine. Add `Engine.idle(mints)` (await the current queue tails) for EVACUATE batches that span several mints.

### Pitfall 10: Line budgets already at the limit
`fee-engine.ts` is 299 lines, `fee-ledger.ts` 297 and `fee-send.ts` 259. Switches, the failure map, the `allowed` gate and the grouping fixes push them over 300. The first worker task should split `fee-engine.ts` (boot and deps into `fee-boot.ts`) and `fee-ledger.ts` (`memoryLedger` into `fee-ledger-memory.ts`).

### Pitfall 11: Shared kill switch state in parallel Playwright workers
**What goes wrong:** `paused.e2e.ts` already runs in its own serial project because flipping a switch affects every spec. Admin switch, hide and EVACUATE specs have the same problem.
**How to avoid:** put switch-flipping and hide/block specs in a serial project (or extend the `paused` project); restore state in `afterAll`. Stub `/api/admin/simulate` and `/execute` in the UI specs so no Playwright run spends devnet SOL by accident.

### Pitfall 12: Local and staging share the devnet seed and ops wallet
Treasury and ops are the same keys in both lanes; buyback is per lane. Admin actions run from a local worker sign with the same ops as the staging engine (Phase 5 Pitfall 11). Run the local devnet admin task with `FEE_ENGINE=on` only for its duration, and EVACUATE locally only against dev database coins (`coinFrom` already refuses a W that does not derive from this seed).

### Pitfall 13: Hold semantics
Reusing `coins.finalize = 'held'` for "Hold for review" would overwrite `done` on a finalized coin. Its release would set `none`, and the batch would re-run finalize. Use separate `coins.held_at` and `held_reason` columns (CHECK both null or both set), loaded into `FeeCoin.hold` at boot and checked by `allowed()`. `Engine.release(mint, deployer)` is the D-18 finalize release, not the inverse of a manual hold. "Release hold" is a new memory + DB clear (see Open Question 3 for a finalize-held coin).

### Pitfall 14: Web cannot reach worker routes it does not forward
`worker.ts call()` turns any non-PASS status (401 included) into `worker_unavailable`. A missing `ADMIN_WALLET` on the worker answers 403 (in PASS) with `{error: "forbidden"}`. Add the new codes to `ApiError`'s union and to `http.ts STATUS`. Return the destination refusal as a 200 simulation result with `destinations.ok = false`, not as an error status, because `worker.ts` strips every field except `error` and `paused` from error bodies, and the dialog needs the account name.

### Pitfall 15: D-17's first bullet is already done
`bond.ts buyAndBurn` already floors minOut at `minOutAfter(pre, simOut)` and burns the whole simulated post balance, with tests in `bond.test.ts` and `fees.test.ts` (commit a8758e1). The STATE.md todo text is stale. The plan should only verify it and update STATE.md; do not re-implement.

## Code Examples

### 1. Admin cookie and message (web, inside lib/session.ts)
```typescript
// Source: pattern of apps/web/lib/session.ts sessionCookie/sessionWallet (this repo)
export const ADMIN_COOKIE = "bondr_admin";
const ADMIN_MS = 30 * 60_000;

export const adminMessage = (wallet: string, nonce: string, expires: string): string =>
  ["BONDR admin sign-in", "", `Wallet: ${wallet}`, `Nonce: ${nonce}`, `Expires: ${expires}`, "",
   "Signing this message is not a transaction and costs nothing."].join("\n");

export function adminCookie(wallet: string, now = Date.now()): { header: string; exp: number } {
  const exp = now + ADMIN_MS;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = seal(`admin-${wallet}-${exp}`); // tag: a public session value can never pass here
  return { header: `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=1800; HttpOnly; SameSite=Strict${secure}`, exp };
}

export function adminSession(cookie: string | null, admin: string | null, now = Date.now()) {
  const raw = cookie?.split(/;\s*/).find((c) => c.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
  const [tag, wallet, exp] = unseal(raw ?? "")?.split("-") ?? [];
  const e = Number(exp);
  return tag === "admin" && admin && wallet === admin && e > now && e - now <= ADMIN_MS ? { wallet, exp: e } : null;
}
```

### 2. Intent message and single-use take (worker)
```typescript
// Source: trade-store.ts shape + core/sig.ts signatureOk (this repo)
export const intentMessage = (i: { action: string; coin: string | null; id: string; to: string[]; expiresAt: number }) =>
  ["BONDR admin action", "", `Action: ${i.action}`, `Coin: ${i.coin ?? "platform"}`, `Intent: ${i.id}`,
   `Destinations: ${i.to.join(", ") || "burn only"}`, `Expires: ${new Date(i.expiresAt).toISOString()}`, "",
   "This is not a transaction. The BONDR worker checks it before sending."].join("\n");

export function take(id: string, sig: Uint8Array, admin: string, now = Date.now()): Intent {
  const e = intents.get(id);
  if (!e || now >= e.expiresAt) throw fail({ error: "intent_expired" });
  if (e.used) throw fail({ error: "intent_used" });
  if (!signatureOk(Buffer.from(e.message, "utf8"), sig, admin)) throw fail({ error: "bad_intent_signature" });
  e.used = true; // synchronous after the check: two concurrent executes cannot both pass
  return e;
}
```

### 3. Simulating one captured job (worker)
```typescript
// Source: core/bond.ts simulatedBalance (simulateTransaction with accounts, proven on Surfpool 1.6.1 in 01-07)
async function simulateJob(d: FeeDeps, job: Job, watch: PublicKey[]) {
  const ixs = [...budget(job.cu ?? 400_000), ...job.ixs];
  const { blockhash } = await d.conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: d.ops.publicKey, recentBlockhash: blockhash, instructions: ixs })
    .compileToV0Message();
  const pre = await d.conn.getMultipleAccountsInfo(watch);
  const sim = await d.conn.simulateTransaction(new VersionedTransaction(msg), {
    sigVerify: false, replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: watch.map((k) => k.toBase58()) },
  });
  const fee = 5000 * msg.header.numRequiredSignatures + Math.ceil(((job.cu ?? 400_000) * 1000) / 1_000_000);
  return { err: sim.value.err, cu: sim.value.unitsConsumed, logs: sim.value.logs, pre, post: sim.value.accounts, fee };
}
```

### 4. RPC ring through the Connection fetch option (worker)
```typescript
// Source: @solana/web3.js 1.99 ConnectionConfig.fetch (lib/index.d.ts:3234)
const ring: { at: number; ms: number; status: number }[] = [];
export const timedFetch: typeof fetch = async (input, init) => {
  const t = performance.now();
  try {
    const res = await fetch(input, init);
    note(res.status, performance.now() - t);
    return res;
  } catch (e) { note(0, performance.now() - t); throw e; }
};
function note(status: number, ms: number) {
  const now = Date.now();
  ring.push({ at: now, ms, status });
  while (ring.length && (ring[0].at < now - 3_600_000 || ring.length > 50_000)) ring.shift();
}
// ponytail: HTTP-level only; JSON-RPC errors inside a 200 are not counted. Parse a clone if that matters.
```

### 5. EVACUATE packing (worker)
```typescript
// Source: core/send.ts wireSize + PACKET_LIMIT (this repo)
function pack(ops: PublicKey, perW: { w: Keypair; ixs: TransactionInstruction[] }[], head: TransactionInstruction[]) {
  const batches: (typeof perW)[] = [];
  let cur: typeof perW = [];
  for (const one of perW) {
    const next = [...cur, one];
    if (wireSize(ops, [...budget(400_000), ...head, ...next.flatMap((x) => x.ixs)]) > PACKET_LIMIT && cur.length) {
      batches.push(cur); cur = [one];
    } else cur = next;
  }
  if (cur.length) batches.push(cur);
  return batches; // about 3 W per tx: each W adds its signature, key, two ATAs and its child mint
}
```

### 6. Web catch-all forwarder (all POST)
```typescript
// Source: guard.ts + worker.ts patterns (this repo)
const FORWARD = new Set(["health", "coin-live", "simulate", "execute", "intent", "act", "switch", "moderate", "inspect"]);
export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const s = adminSession(req.headers.get("cookie"), adminWalletEnv());
  if (!s) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limited = rateLimited(req, `admin:${op}`, op === "health" ? 30 : 60, 60_000, s.wallet);
  if (limited) return limited;
  const body = (await json(req, 16 * 1024)) ?? {};
  if (FORWARD.has(op)) {
    const r = await workerPost(`/admin/${op}`, { ...(body as object), actor: s.wallet }, 30_000);
    return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  }
  return local(op, body); // overview, coin, audit: Postgres reads in lib/admin-data.ts
}
```

### 7. Visibility-aware health poll (client)
```typescript
useEffect(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = false;
  const tick = async () => {
    if (document.visibilityState !== "visible") return;
    const r = await fetch("/api/admin/health", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    if (r?.status === 401) return onExpired();
    setHealth(r?.ok ? await r.json() : null);
    if (!stop) timer = setTimeout(tick, 10_000); // scheduled after the response: polls never overlap
  };
  const vis = () => { clearTimeout(timer); if (document.visibilityState === "visible") void tick(); };
  document.addEventListener("visibilitychange", vis);
  void tick();
  return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
}, []);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sentry `GET /projects/{org}/{project}/issues/` | `GET /organizations/{org}/issues/` (project filter, `query`, `limit` max 100) | Project endpoint marked deprecated [CITED: docs.sentry.io/api/events/list-a-projects-issues/] | Use the org endpoint |
| Organization auth tokens for API reads | Personal tokens or internal integrations for issue reads | Org tokens are "not customizable" and CI-focused [CITED: docs.sentry.io/account/auth-tokens/] | The owner creates a personal token with read scopes for `SENTRY_READ_TOKEN` |
| Hand-decoding anchor ix data | anchor 0.31 `coder.instruction.decode` + `format` | Present in the pinned 0.31.1 | No Borsh code |

**Deprecated/outdated in this repo:**
- STATE.md Pending Todo "WR-08 forcedBondIxs minOut": fixed in a8758e1. Only the leftover burn remains (Pitfall 15).
- `POST /kill-switch` (bearer, launches only): keep it for the runbook and `paused.e2e.ts`, but it bypasses the audit log. Have it call the same `switches.set` so memory stays consistent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Admin money actions run regardless of `FEE_ENGINE` (built from an admin `FeeDeps` that always exists); `FEE_ENGINE` only governs automation | Patterns 2, 4 | If the owner expects `off` to block all sends, a local worker with `ADMIN_WALLET` set can send devnet txs. Alternative: refuse execute unless mode is `on`, but then EVACUATE cannot run with the engine off |
| A2 | EVACUATE execution is controlled by a new worker env (suggested `ADMIN_EVACUATE=simulate|on`, default `simulate`, boot fails on other values); staging leaves it unset (D-37), local sets `on` for the devnet proof | EVACUATE, Environment | A default of `simulate` must be flipped before mainnet (Phase 7 runbook item) |
| A3 | `SENTRY_READ_TOKEN` is a personal token (or internal integration) with event and project read; the org issues endpoint on `sentry.io/api/0` serves the US-region org `mrbarnacle`; count is capped at 100 per call | Pattern 8 | A wrong token type returns 403 and the row shows an error state; harmless |
| A4 | Manual hold uses new `coins.held_at` / `held_reason`, separate from `finalize = 'held'` | Pitfall 13 | If the owner wanted one notion of held, the UI shows two sources; low risk |
| A5 | "Release hold" on a finalize-held coin also sets finalize `none` (the next batch retries the full preflight), while "Finalize split" with `launches.wallet` is the D-15 release | Open Question 3 | If D-05 means release must only happen through Finalize split, the console should hide Release hold for finalize-held coins |
| A6 | Multi-step simulations: first step authoritative, later steps estimated and re-checked by preflight; execute re-runs the job instead of replaying stored bytes | Pitfall 2 | D-12 says "keeps the built transactions"; if read strictly, single-tx actions could replay stored ixs. The safety property (owner signature + destination lock) holds either way |
| A7 | `fee_ledger_sig_kind` becomes unique on `(signature, kind, coalesce(mint,''))` | Pitfall 3 | Needed for D-35's several W per tx; one W per tx would avoid it but takes 3x the txs |
| A8 | Re-check launch is a one-shot status read, not the full `settleLaunch` loop | Pattern 12 | A long-running HTTP call would time out the web route |
| A9 | Window index policy for hand-run sweeps (Pitfall 7) | Pitfall 7 | A wrong index silently sends nothing (the dialog must say so) |
| A10 | The Playwright admin key is derived from the master seed (`seedAccount("admin:devnet:e2e")`) and injected as `ADMIN_WALLET` into both local webServer envs by `playwright.config.ts` | Validation | A reused dev server with another `ADMIN_WALLET` makes admin specs skip (detect and skip, not fail) |
| A11 | `RAILWAY_REPLICA_ID` (or a random id) for the Leader lock row's instance id | Pattern 8 | Cosmetic |
| A12 | Helius devnet offers no bundle simulation | Alternatives | If it does, multi-step simulation could be exact; not needed for safety |

## Open Questions (RESOLVED)

Resolved 2026-10-25 under the owner's autonomous-mode delegation: every question below takes its Recommendation, recorded as Claude's discretion in the plans. The owner may override.

1. **How exact must multi-step simulations be?**
   - What we know: a single-tx RPC simulation cannot see the effect of an earlier unsent tx. Finalize's update fails simulation before the config exists.
   - What's unclear: whether the owner expects a full exact preview for Sweep now and Finalize split.
   - Recommendation: per-step list, first step authoritative, net table labeled "estimated" for dependent steps, fine print "Later transactions are simulated again by the RPC before they are sent". This needs one copy line beyond UI-SPEC; the planner adds it to `admin-copy.ts`.

2. **Should execute replay stored bytes for single-tx actions?**
   - Recommendation: no. One code path (re-run the job through the gated `land`) is shorter and fresher. Destination lock and owner signature give the safety. Logged as A6.

3. **Release hold on a finalize-held coin.**
   - Recommendation: show "Finalize split" (primary) and "Release hold" (quiet). Release clears `held_at` and sets finalize `none`, so the next batch re-runs the full CreateEvent preflight. Logged as A5.

4. **Re-check launch positive path on devnet.**
   - What we know: producing a launch stuck in `signed/sent/unknown` that later lands is hard on demand.
   - Recommendation: devnet covers the negative path (a crafted `unknown` row with an unseen signature: "not on chain yet, nothing changed"); the landed path is a unit test with a stubbed status and an injected `landed`.

5. **Devnet coins with fees for Sweep now.**
   - Recommendation: reuse the 05-12 approach (`fee-devnet.e2e.ts` picks a derived-W curve coin and trades to accrue fees) before Sweep now; otherwise the action legitimately sends nothing.

6. **`/kill-switch` and `/fee/release` audit.**
   - Recommendation: keep both bearer routes for the runbook, unaudited. ADMIN-10 covers console actions. Note it in the worker README.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | yes | 24.13.0 | — |
| pnpm | everything | yes | 10.34.6 | — |
| Surfpool | fork rows (5 actions) | yes (cached binary) | 1.6.1 at `.cache/surfpool/surfpool` | `fork.sh` downloads it |
| Helius devnet + mainnet keys | devnet actions, fork datasource | yes (in .env, names only checked) | — | — |
| neonctl | Neon idle check | yes | 8.10.3 | Neon console |
| railway CLI | staging deploy | yes | 5.71.0 | Railway MCP |
| gh | PR | yes | 2.103.0 | — |
| Playwright browsers / playwright-cli | e2e, screenshots | yes | 1.63.0 / 0.1.8 | — |
| Sentry read token (`SENTRY_READ_TOKEN`) | Health Sentry cell | no (owner-side, free) | — | "Not configured" row (D-27) |
| Owner's Phantom address for staging `ADMIN_WALLET` | Staging sign-in | no (owner-side) | — | Staging stays locked (D-08); staging tests verify the locked state |

**Missing dependencies with no fallback:** none block the phase.
**Missing dependencies with fallback:** Sentry token, staging admin wallet.

## Staging plan guidance (for the 05-13-style final plan)

- **Deploy order:** web first (its pre-deploy runs migration 0007). The migration is additive: new tables, new nullable or defaulted columns, the kind check widened by drop/add as in 0006, and the sig_kind index swapped. The running Phase 5 worker keeps working on it. Then deploy the worker.
- **Switch columns default to true,** so the staging engine keeps running (HV-05-01 must not be paused). Confirm from the worker boot log that all switches loaded as running.
- **Staging variables:** leave `ADMIN_WALLET` unset on web and worker until the owner provides the Phantom address (D-39), leave the EVACUATE mode unset (simulate-only, D-37), and leave `SENTRY_READ_TOKEN` unset unless the owner created one. Never print variables.
- **Locked-state staging matrix** (`E2E_BASE_URL` set):
  1. `/admin` renders "Admin is not configured" with no button, `noindex` in the HTML, at 390, 768 and 1440 through `gate()` (axe 0, no horizontal scroll, `-staging` screenshots in `.planning/phases/06-admin-dashboard/screenshots/`).
  2. `POST /api/admin/health` with no cookie returns 401. A cross-origin POST returns 403.
  3. `POST /api/admin/session` with a valid test-key signature returns the not-configured refusal and sets no cookie.
  4. If staging later reports configured (the owner set `ADMIN_WALLET`), the spec asserts the "Sign in" card instead and skips the rest with a reason (it cannot sign as the owner).
  5. The Phase 5 fee matrix and the Phase 4 trade matrix run again as regression.
- **Public additions on staging:** ledger route 200/404 unchanged; launch blocked copy cannot be exercised without admin, so it stays a local test.
- **Neon idle check:** with no browser open, both computes suspend within about 6 minutes (as in 05-13). Locally, also run the console-open check: sign in with the test admin, leave the tab visible about 8 minutes, and confirm with `neonctl` that the dev compute suspends while `/api/admin/health` keeps answering.
- **Owner human-verification items (non-blocking):** HV-06-01: set `ADMIN_WALLET` on staging web and worker, sign in with Phantom, run the inspector on a staging signature, and simulate (not execute) Burn buyback now and EVACUATE. HV-06-02: create `SENTRY_READ_TOKEN` and confirm the Sentry cell.
- **Spend:** record devnet ops before and after; the phase total stays under 0.1 SOL.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (units; DB-backed tests `describe.skipIf(!process.env.DATABASE_URL)`, loading the root .env as `db.test.ts` does). Playwright 1.63.0 + @axe-core/playwright 4.13.0 (`*.e2e.ts`). Spike runner on Surfpool 1.6.1 for fork rows |
| Config file | No Vitest config (defaults). `playwright.config.ts` (projects `chromium` and serial `paused`). `scripts/spike/nets/fork.ts` |
| Quick run command | `pnpm vitest run <touched *.test.ts>` and `pnpm lint` |
| Full suite command | `pnpm test && pnpm lint && pnpm typecheck` plus `pnpm --filter @bondr/web build && pnpm check:bundle` for any client change |
| Fork gate | `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` (adds `admin.*` rows) |
| E2E (local) | `pnpm exec playwright test apps/web/e2e/admin*.e2e.ts` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Admin message domain separation; tagged cookie; public cookie refused; 30 min expiry; wrong wallet gets no cookie; nonce single use | unit + DB + e2e | `pnpm vitest run apps/web/lib/session.test.ts`; `pnpm exec playwright test apps/web/e2e/admin-signin.e2e.ts` | session.test.ts yes (extend); e2e no (Wave 0) |
| ADMIN-01 | Intent binds action, coin, id, expiry; single use; wrong wallet refused; tampered text refused; expired refused | unit | `pnpm vitest run apps/worker/src/admin-intent.test.ts` | no (Wave 0) |
| ADMIN-01 | Worker 403 on every `/admin/*` with ADMIN_WALLET unset or invalid, or actor mismatch | unit | `pnpm vitest run apps/worker/src/admin-routes.test.ts` | no (Wave 0) |
| ADMIN-02 | W state derivation order; trigger ready from budgetOf/trigger105; totals; balances payload | unit + e2e (seeded coins) | `pnpm vitest run apps/web/lib/admin-copy.test.ts`; `admin-console.e2e.ts` | no (Wave 0) |
| ADMIN-03 | Registry: every action has applies/allow/run and a reason; not-applicable codes | unit | `pnpm vitest run apps/worker/src/admin-actions.test.ts` | no |
| ADMIN-03 | Retry forced bond, Burn W token balance, Run migrate, Finalize split, Distribute now land on the fork through simulate then execute | fork | `SPIKE_NET=fork SPIKE_ONLY=admin pnpm spike && SPIKE_NET=fork pnpm spike:check` (rows `admin.forced`, `admin.leftover`, `admin.migrate`, `admin.finalize`, `admin.distribute`) | no (Wave 0: `scripts/spike/stages/admin.ts`) |
| ADMIN-03 | Sweep now, Burn buyback now, Re-check launch on devnet | devnet e2e | `E2E_DEVNET=1 FEE_WINDOW_MS=600000 pnpm exec playwright test apps/web/e2e/admin-devnet.e2e.ts` (or a `scripts/` runner signing intents with the test key) | no |
| ADMIN-04 | Outflow decoder: System/Token/Token-2022 transfer, CloseAccount, Burn allowed, unknown recipient refused; refusal returned as a 200 sim result | unit | `pnpm vitest run apps/worker/src/admin-dest.test.ts` | no |
| ADMIN-04 | Sim balance diff equals the landed delta for single-tx actions | fork | fork rows assert `sim.post - sim.pre == landed delta` | no |
| ADMIN-05 | Each job returns skipped when its switch is off; admin deps bypass; reconcile ungated; bondedJob stops before finalize | unit | `pnpm vitest run apps/worker/src/fee-engine.test.ts apps/worker/src/switches.test.ts apps/worker/src/fee-burns.test.ts` | partial (extend) |
| ADMIN-05 | Flip in UI persists (DB + memory), audit row, revert on failure | e2e (serial project) | `pnpm exec playwright test --project=admin-serial` | no |
| ADMIN-06 | RPC ring p50/p95/error/429 over a 1 h window; Sentry count cache and no-token path; health never touches DB | unit | `pnpm vitest run apps/worker/src/rpc-stats.test.ts apps/worker/src/sentry-count.test.ts apps/worker/src/health.test.ts` | no |
| ADMIN-06 | Neon suspends with the console open | manual-assisted | `neonctl` endpoint state after about 8 min with the console tab visible | n/a |
| ADMIN-07 | `coinRows` excludes hidden; token page still 200; prepare refuses blocked with `blocked` | unit + DB + e2e | `pnpm vitest run apps/web/lib/coins.test.ts apps/worker/src/prepare.test.ts`; `admin-moderation.e2e.ts` | partial |
| ADMIN-08 | Timeline steps from launch + ledger + memory; next-step copy per situation; stuck after 3 failures | unit | `pnpm vitest run apps/web/lib/admin-copy.test.ts apps/worker/src/fee-engine.test.ts` | partial |
| ADMIN-09 | Decode fixture txs offline (`packages/core/src/fixtures/forced-bond.json`, `launch-burn.json`, `pool-buy.json`): program labels, pump ix names, error name for a failed tx | unit | `pnpm vitest run apps/worker/src/admin-inspect.test.ts` | no |
| ADMIN-10 | Insert pending, settle once, second settle no-op, CHECKs refuse bad combos; keyset page | DB | `pnpm vitest run packages/core/src/db.test.ts apps/worker/src/admin-audit.test.ts` | partial |
| ADMIN-11 | Phrase exact match; packing <= 1232 bytes; switches off before first send; evacuate rows per W with own amounts; two-mint tx inserts (sig_kind); reconcile counts evacuate | unit + DB | `pnpm vitest run apps/worker/src/admin-evacuate.test.ts apps/worker/src/fee-ledger.test.ts apps/worker/src/fee-reconcile.test.ts apps/web/lib/admin-copy.test.ts` | partial |
| ADMIN-11 | EVACUATE drains dev-database coins on devnet | devnet (local, D-37) | scripted run with `ADMIN_EVACUATE=on`, then a balance printout of every W (0 BONDR, 0 child) | no |
| Public | `leftover_burn` and `evacuate` copy and totals | unit | `pnpm vitest run apps/web/lib/ledger-copy.test.ts packages/core/src/fees.test.ts` | yes (extend) |
| UI | 390/768/1440 axe 0, no horizontal scroll, screenshots | e2e | `admin-responsive.e2e.ts` via `shoot.ts gate(page, name, width, PHASE6_SHOTS)` | no |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched tests>` + `pnpm lint`
- **Per wave merge:** full suite; after any chain-code wave, the fork gate
- **Phase gate:** full suite, fork gate with every `admin.*` row passing, local admin e2e, devnet admin run with ops spend printed, `pnpm check:bundle`, staging locked-state matrix, Neon idle checks

### Wave 0 Gaps
- [ ] `apps/worker/src/admin-intent.test.ts`, `admin-dest.test.ts`, `admin-actions.test.ts`, `admin-routes.test.ts`, `admin-evacuate.test.ts`, `admin-inspect.test.ts`, `admin-audit.test.ts`, `rpc-stats.test.ts`, `sentry-count.test.ts`, `health.test.ts`, `switches.test.ts`
- [ ] `apps/web/lib/admin-copy.test.ts`; extend `session.test.ts`, `ledger-copy.test.ts`, `coins.test.ts`, `scrub.test.ts` (add `SENTRY_READ_TOKEN` to `forbiddenEnv`)
- [ ] `scripts/spike/stages/admin.ts` + entry in `scripts/spike/nets/fork.ts` + `stages/README.md` row
- [ ] `apps/web/e2e/admin-*.e2e.ts`, an `adminAccount()` helper in `phantom.ts`, a stub module `admin-stubs.ts` (pattern of `trade-stubs.ts`), a serial Playwright project, `PHASE6_SHOTS` in `shoot.ts`
- [ ] `playwright.config.ts`: inject `ADMIN_WALLET` (test key address) into both local webServer envs; add `ADMIN_WALLET` to `WEB_ENV` in `next.config.ts`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Phantom `signMessage` over a domain-separated text, `signatureOk` (node:crypto Ed25519), single-use sealed nonce spent in `consent_nonces`, single allowlisted key `ADMIN_WALLET` |
| V3 Session Management | yes | `bondr_admin` HMAC-sealed, tagged value, HttpOnly, SameSite=Strict, Secure in production, 30 min absolute, explicit sign-out (Max-Age=0) |
| V4 Access Control | yes | Web: cookie + `sameOrigin` + rate limit. Worker: bearer + `ADMIN_WALLET` configured + actor equality; money actions additionally need a fresh intent signature verified in the worker; destination allowlist in `land`; program allowlist in `signTx` |
| V5 Input Validation | yes | Enums for action/job/op; `BASE58_KEY` for mints and wallets; signature regex (base58, 64 bytes decoded); reason 1-120 chars; JSON body cap 16 KB (`json()`, `readJson`) |
| V6 Cryptography | yes | node:crypto only (HMAC-SHA256, Ed25519 verify, randomBytes); never hand-roll |
| V7 Error Handling and Logging | yes | Contract codes only to the browser (`worker.ts` rebuild); `redact()` on RPC text; audit rows for every console action; no secrets, seeds or tokens in logs or audit params |
| V8 Data Protection | yes | Hide and block reasons and audit rows are admin-only (never in public reads); Sentry `scrub` already removes addresses |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Public session cookie reused as admin cookie | Elevation of privilege | Tagged sealed value + max-age check (Pitfall 1) |
| Consent signature replayed as admin sign-in, or sign-in signature replayed as an intent | Spoofing | Distinct first lines ("BONDR consent" / "BONDR admin sign-in" / "BONDR admin action"); the worker verifies only its stored intent text |
| Intent replay or double execute | Tampering | Single-use id, set synchronously after a valid signature; 2 min expiry inside the signed text |
| Leaked WORKER_TOKEN moves funds | Elevation of privilege | Money routes need the owner's fresh signature (D-12) |
| Leaked WORKER_TOKEN flips switches, hides coins, blocks deployers | Tampering / DoS | Accepted by D-13 (session-only for non-tx actions); worker is private-network only; every change is audited. Record as an accepted risk |
| Funds sent to an attacker address | Elevation of privilege | Per-action allowlist enforced in the worker `land`; deployer only from `launches.wallet` (D-15); treasury and buyback derived, never from input |
| CSRF on admin POSTs | Tampering | `sameOrigin` + SameSite=Strict + `application/json` requirement |
| Clickjacking the EVACUATE button | Tampering | Existing `X-Frame-Options: DENY` and `frame-ancestors 'none'` |
| Admin console probing | Information disclosure | Not linked, `noindex`, 401 before any data; rate limits per IP and wallet |
| Memory exhaustion through simulate spam | DoS | Rate limit plus an intent store size cap (trade-store `TRADE_MAX` pattern) |
| Sentry read token leaking through web | Information disclosure | Worker-only variable; add `SENTRY_READ_TOKEN` to `forbiddenEnv` so web refuses to boot holding it |
| Seed leak makes EVACUATE pointless | (deferred) | Treasury independent of seed is Phase 7 (Deferred Ideas) |

## Sources

### Primary (HIGH confidence)
- Codebase, read this session: `apps/worker/src/{http,main,fee-routes,status,env,trade-store,sentry,fee-engine,fee-guard,fee-config,fee-send,fee-burns,fee-finalize,fee-batch,fee-prebond,fee-recover,fee-ledger,fee-reconcile,settle,launches,vanity,prepare}.ts`; `packages/core/src/{send,sig,keys,bond,bond.test,collect,sharing,schema,db,migrate,fees,net,pump,events,trade-error,scrub,api}.ts`; `packages/core/migrations/0005_fee_ledger.sql`, `0006`; `apps/web/lib/{session,guard,worker,terms,coins,live-list,ledger-copy,trade-run}.ts`; `apps/web/app/api/consent/route.ts`; `apps/web/proxy.ts`; `apps/web/next.config.ts`; `apps/web/instrumentation.ts`; `apps/web/e2e/{phantom,paused}.e2e.ts|ts`; `playwright.config.ts`; `biome.json`; `scripts/check-client-bundle.sh`; `scripts/spike/stages/engine-bond.ts`
- Type definitions in node_modules: web3.js 1.99.0 `ConnectionConfig.fetch`, `SystemInstruction`/`ComputeBudgetInstruction.decodeInstructionType`; spl-token 0.4.15 `decodeInstruction`; anchor 0.31.1 `BorshInstructionCoder.decode/format`; pump-sdk 4.1.0 `getPumpProgram`/`getPumpFeeProgram`; pump-swap-sdk 2.1.0 `getPumpAmmProgram`; drizzle 0.45.3 (`nullsNotDistinct` only on unique constraints)
- Planning docs: 06-CONTEXT.md, 06-UI-SPEC.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, 05-13-PLAN/SUMMARY, 05-HUMAN-UAT, 05-REVIEW(-engine), 05-REVIEW-FIX-engine, 05-SECURITY, 05-VALIDATION

### Secondary (MEDIUM confidence)
- [Sentry: List an Organization's Issues](https://docs.sentry.io/api/events/list-an-organizations-issues/), endpoint, scopes, `query`, `limit` <= 100
- [Sentry: List a Project's Issues (deprecated)](https://docs.sentry.io/api/events/list-a-projects-issues/)
- [Sentry: Auth Tokens](https://docs.sentry.io/account/auth-tokens/), token types; personal tokens for issue reads
- [Firefox bug 1508661](https://bugzil.la/1508661) and [MDN Origin (pt-BR)](https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Headers/Origin): no Origin header on same-origin GET/HEAD per the Fetch spec

### Tertiary (LOW confidence)
- [Sentry forum: X-Hits header](https://forum.sentry.io/t/x-hits-header-missing-from-issues-api/5467) and [Sentry forum: API with the number of issues](https://forum.sentry.io/t/api-with-the-number-of-issues/7220): an estimated count header capped at 1000; not relied on (count the returned array instead)
- [Sentry API tokens (Mintlify mirror)](https://www.mintlify.com/getsentry/sentry/api/api-tokens): scope names; not relied on

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Everything is already installed and was verified in package.json and type definitions.
- Architecture: HIGH for reuse and seams (all code read). MEDIUM for the simulate-first design of dependent multi-tx actions (Pitfall 2, A6).
- Pitfalls: HIGH. Pitfalls 1, 3, 4, 5, 6, 7, 9, 10, 13, 14 and 15 come from reading the exact code paths.
- Sentry integration: MEDIUM for the endpoint, LOW/ASSUMED for the token type and region URL.

**Research date:** 2026-10-25
**Valid until:** 2026-11-24 (stable internal code). Re-check the pump SDK IDLs before the fork task, because pump ships breaking changes on short notice (STATE.md).
