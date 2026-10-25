# Phase 6: Admin Dashboard - Context

**Gathered:** 2026-10-25
**Status:** Ready for planning
**Mode:** Auto. The owner delegated every gray area on 2026-10-24 (autonomous mode: "keep going and dont stop... only stop if human intervention is needed in regards to real money"). Each decision below is the recommended option, recorded as owner-delegated and logged in 06-DISCUSSION-LOG.md. Everything here runs on devnet and the Surfpool fork. Any mainnet send, real-SOL spend or paid-plan change stops for the owner (Phase 7).

<domain>
## Phase Boundary

As the owner, I want one dashboard to see and fix every coin and job, so that nothing needs a manual script.

Phase 6 delivers an owner-only console at `/admin` in apps/web, backed by new bearer-protected `/admin/*` worker routes:
- **Sign-in (ADMIN-01):** the single allowlisted wallet, a 30-minute session, and a fresh signature for every money-moving action.
- **Overview (ADMIN-02):** treasury, buyback and ops balances, every W with its state, and platform totals.
- **Recovery actions (ADMIN-03, ADMIN-04):** the 11 actions, each simulated first with balance changes shown, and destinations limited to burn, treasury, buyback or that coin's deployer.
- **Kill switches (ADMIN-05):** launches, forced bond, sweeps, finalize and buyback burn.
- **Health (ADMIN-06):** worker heartbeat, leader lock, last run per job, RPC latency and errors, Sentry issue count, vanity pool size.
- **Moderation (ADMIN-07):** hide a coin from lists, block a deployer wallet from launching.
- **Timeline (ADMIN-08):** per coin, each state and transaction, the next expected step, and a retry for a stuck step.
- **Transaction inspector (ADMIN-09):** decoded instructions, the error and an explorer link for any pasted signature.
- **Audit log (ADMIN-10):** actor, time, simulation result and signature for every admin action.
- **EVACUATE (ADMIN-11):** typed phrase plus signature, then every job pauses and every W balance moves to the treasury.
- **Folded from Phase 5 review:** WR-08 (leftover child tokens in W), because "Burn W token balance" is its recovery action.

Not in Phase 6:
- the mainnet switch, real-SOL admin actions and the BONDR token launch (Phase 7, owner-gated)
- master seed rotation (EVACUATE only drains and pauses; rotation is a Phase 7 runbook)
- a trading kill switch (Phase 4 D-18: trading never moves platform funds; not in ADMIN-05's list)
- CI, the weekly pump contract check (OPS-02, Phase 7). The mockup's "Pump contract check" health row waits for it.

</domain>

<decisions>
## Implementation Decisions

### Carried forward (locked earlier, not re-decided)
- **D-01:** Chain access, keys and the master seed stay in the worker (FEE-10, Phase 5 D-02). Web reads Postgres for page data and calls the worker's private bearer HTTP (`apps/worker/src/http.ts`, `apps/web/lib/worker.ts`). Every admin transaction is built, simulated, signed and sent by the worker with derived keys (W, ops, treasury, buyback). Ops pays every fee.
- **D-02:** Neon budget (Phase 3 D-04, Phase 5 D-03, memory note): 0.25 CU computes, nothing reads Postgres on a timer, and an open admin tab must not keep Neon awake.
- **D-03:** One worker replica (Phase 4 D-07, Phase 5 D-07). In-memory stores (prepared trades, engine state) stay per process.
- **D-04:** The fee engine and its rules are Phase 5 as shipped: intent-first `fee_ledger` rows (D-08), the `FEE_ENGINE` off/dry/on flag (D-09), the spend guard in `fee-guard.ts` (CR-01 fix), the held finalize and its release (D-18), the ops floor pause (D-20) and reconciliation diff rows (D-21). Admin actions call the same engine job functions; they never duplicate fee math.
- **D-05:** The held-finalize rule: the update is permanent, so any pre-flight failure holds, nothing auto-retries, and only the owner releases (Phase 5 D-18). Phase 6 is the release UI.
- **D-06:** Layout follows the approved `.planning/mockups/admin.html` and DESIGN-BRIEF section 5 ("dense console: balances and kill switches first, then health, then the W table, then the selected coin timeline, then inspector, moderation and audit log, with EVACUATE isolated at the bottom"). gsd-ui-phase writes the UI-SPEC before planning. Mockup numbers are illustrative, not config.
- **D-07:** No emoji anywhere; SVG icons and text labels only. Values are SOL equivalents in the UI (Phase 3 D-01).

### Sign-in and session (ADMIN-01)
- **D-08 (owner-delegated):** The allowlist is one env value, `ADMIN_WALLET` (a public key, not a secret), set on both web and worker. Unset or invalid means admin fails closed: `/admin` shows "Admin is not configured" and every `/admin/*` worker route answers 403. This is the phase's ship-dark switch (AGENTS.md section 6), so no extra feature flag.
- **D-09 (owner-delegated):** Sign-in reuses the Phase 2 pattern in `apps/web/lib/session.ts`: a sealed nonce, a Phantom `signMessage`, `signatureOk`. The admin message is domain-separated from the consent message ("BONDR admin sign-in", wallet, nonce, expiry), so a consent signature can never open admin. The nonce is single-use (spent in Postgres like consent; one write per sign-in is fine for Neon).
- **D-10 (owner-delegated):** A separate `bondr_admin` cookie, HMAC-sealed with SESSION_SECRET, HttpOnly, SameSite=Strict, Path=/, with a 30-minute absolute expiry (no sliding renewal). The UI shows the time left, as in the mockup. Any wallet other than ADMIN_WALLET gets "This wallet is not the admin wallet" and no cookie. The public 12-hour session is unchanged.
- **D-11 (owner-delegated):** `/admin` is not linked anywhere, is `noindex`, and renders only the sign-in panel until the admin cookie is valid. Every web `/api/admin/*` route checks the cookie, `sameOrigin` and `rateLimited` (`apps/web/lib/guard.ts`), then forwards to the worker with the session wallet as the actor.

### Fresh signature and simulate-first (ADMIN-01, ADMIN-04)
- **D-12 (owner-delegated):** "Money-moving" means any action that sends a transaction. Each one runs in two calls:
  1. `simulate`: the worker builds the transactions, simulates them with the accounts option, and returns the result, CU, fee, before/after balances for every touched account, and the destination check. It keeps the built transactions in memory for 2 minutes under an intent id (same pattern as the Phase 4 trade store).
  2. `execute`: the owner signs a human-readable intent message in Phantom ("BONDR admin action", action, coin, intent id, destinations, expiry). The worker itself verifies that signature against ADMIN_WALLET, so a leaked WORKER_TOKEN alone cannot move funds. The intent id is single-use, and an expired blockhash or intent means simulate again. Nothing is resent automatically.
- **D-13 (owner-delegated):** Non-transaction actions (hold for review, re-check launch, kill switch flips, hide, block, unhide, unblock) need the admin session only, no fresh signature, and are still written to the audit log.
- **D-14 (owner-delegated):** Destination lock in the worker, not the UI. Before simulating, the worker checks every outflow recipient against an allowlist built for that action: the burn instruction, the treasury, the buyback wallet, that coin's deployer (`launches.wallet`), and the coin's own W or vault accounts for internal moves. Ops only pays fees and rent. Anything else refuses with `destination_refused`, and the simulation dialog shows "Destinations check passed: ..." as in the mockup.
- **D-15 (owner-delegated):** Finalize from the dashboard always uses the coin's recorded deployer (`launches.wallet`). The UI never accepts a typed deployer address. A held coin is released by re-running finalize with that deployer after the owner has read the hold reason. The existing `POST /fee/release` keeps its bearer-only behaviour for the runbook, but the admin route does not expose the "owner names a deployer" form, so ADMIN-04's "that coin's deployer" holds.

### Recovery actions (ADMIN-03)
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

### Kill switches (ADMIN-05)
- **D-18 (owner-delegated):** Five switches: launches (exists), forced bond, sweeps, finalize, buyback burn. They are new boolean columns on the single-row `settings` table, loaded once at boot and held in worker memory, exactly like the Phase 2 launches switch (`status.ts`). One route `POST /admin/switch {job, enabled}` writes the DB, then memory. No reads on a timer.
- **D-19 (owner-delegated):** What each switch covers:
  - forced bond covers the forced bond and the fallback pool burn
  - sweeps covers the window collect, split and sweep
  - finalize covers finalize and the distribution crank
  - buyback burn covers the daily buyback burn
  - reconciliation always runs, because it only reads
  A paused job skips its sends, while trade events keep accruing in memory. On resume, the next trigger or window catches up. Pausing never moves funds (mockup copy). `FEE_ENGINE` stays the deploy-time master flag above the switches.
- **D-20 (owner-delegated):** No job-wide auto-pause after N failures (the mockup's "auto-paused after 3 failed attempts"). Instead, a step that fails 3 times for one coin shows as stuck on that coin's row and timeline, with its retry action. The Phase 5 behaviour already does not resend unknown rows.

### Data freshness under the Neon budget (ADMIN-02, ADMIN-06, ADMIN-08)
- **D-21 (owner-delegated):** Postgres-backed panels (W table, platform totals, timeline, moderation lists, audit log, vanity pool size) load on page open, on a Refresh button, and after each action. They never load on a timer.
- **D-22 (owner-delegated):** Worker-memory panels (heartbeat, kill switch states, last run per job, RPC stats, ops floor state) come from one `GET /admin/health` that reads memory only. The page polls it every 10 s only while the tab is visible. Neon can suspend with the console open.
- **D-23 (owner-delegated):** Balances: treasury, buyback and ops are read from chain by the worker (one getMultipleAccounts) on load and on Refresh. The W table uses the coin row's `fee_budget` (Phase 5 D-23) instead of reading 500 W accounts. Live W balances are read only for the selected coin and inside each simulation.
- **D-24 (owner-delegated):** The W table shows every coin, loaded in one query, with filter chips per state, as in the mockup: All, Stuck, Trigger ready, Held, Collecting, Finalized. Each coin's state and next step come from the engine's in-memory coin state joined to the coin row. The table scrolls horizontally inside its container on narrow screens.

### Health (ADMIN-06)
- **D-25 (owner-delegated):** Heartbeat is the worker's own answer: boot time, uptime, the last indexer stream event and the last engine activity.
  - There is no leader lock today. One replica is the guard (D-03). A Postgres session advisory lock would hold a connection open, which risks keeping Neon awake.
  - So the "Leader lock" row honestly reports "single replica, no lock" plus the instance id and boot time. A real lock stays deferred until the worker scales out.
- **D-26 (owner-delegated):** RPC latency and errors are measured in the worker. Its Connection uses a fetch wrapper that keeps an in-memory ring of the last hour: p50, p95, error rate and 429 count. Last run per job is in-memory timestamps set by each job, shown as "since boot" after a restart.
- **D-27 (owner-delegated):** Sentry issue count comes from the worker calling the Sentry API with a read-only token, `SENTRY_READ_TOKEN`. It reads the unresolved issues of bondr-web and bondr-worker, cached 60 s and fetched on demand. With no token, the row shows "Sentry not configured" and nothing breaks. Creating the token is a free owner-side step, not a blocker.
- **D-28 (owner-delegated):** The vanity pool size is a count of free rows in `vanity_mints`, read with the page load (D-21), with the mockup's alert below 100. The ops row reuses `OPS_FLOOR_LAMPORTS`. It shows a warning style below the floor and an estimate of the transactions left.

### Moderation (ADMIN-07)
- **D-29 (owner-delegated):** Hide is a `coins.hidden_at` timestamp plus a reason. Hidden coins drop out of home lists, search, Trending and the Next to bond rail. The token page stays reachable by URL with its proof and ledger intact, because the fee record must stay verifiable. The change shows after the web list cache expires (about a minute); that is acceptable.
- **D-30 (owner-delegated):** Block is a `blocked_deployers` table (wallet, reason, time). It does not use the `wallets` consent table, because a deployer can be blocked before it ever consents. The worker's launch prepare checks it at prepare time, which already reads the DB, and refuses with a `blocked` error that web shows plainly. Unhide and unblock exist, and every change is audited.

### Timeline (ADMIN-08)
- **D-31 (owner-delegated):** A per-coin timeline built from the launch row, `fee_ledger` rows (including `held` and `reconcile_diff`) and the engine's in-memory state. Each step has a state (done, stuck, next), time, short signature and Solscan link. A stuck step shows its last error and attempt count, with its retry action inline (the mockup's stuckbox). The next expected step is computed: window end time, trigger ratio, awaiting migration, finalize next, or distribute after finalize.

### Transaction inspector (ADMIN-09)
- **D-32 (owner-delegated):** `POST /admin/inspect {signature}` calls `getTransaction` (RPC only, no DB) and decodes instructions by program: System, Token and Token-2022, ATA, ComputeBudget, pump, pump-amm, pump-fees, using the pinned SDK IDLs. Program errors are mapped through the existing `trade-error.ts` map plus IDL error names. It works for any signature, not only BONDR's, and returns status, slot, fee payer, instructions, error and a Solscan link.

### Audit log (ADMIN-10)
- **D-33 (owner-delegated):** A new `admin_audit` table: id, time, actor wallet, action, mint (nullable), params, simulation summary (result, CU, fee, balance changes, destination check), the owner's intent signature, transaction signatures, and result (pending, landed, failed, refused).
  - The worker writes it intent-first, before sending, then settles it, the same model as Phase 5 D-08.
  - Non-transaction actions are written as one landed row.
  - Code only ever inserts and settles, and a DB check limits state transitions.
  - Shown newest first, 50 per page with Load more (keyset, like the Phase 3 trade feed).
- **D-34 (owner-delegated):** The worker writes every audit row, because it does the sends. Moderation and switch changes also go through worker routes, so there is one write path and one audit writer.

### EVACUATE (ADMIN-11)
- **D-35 (owner-delegated):** The flow:
  1. The owner types `EVACUATE ALL W TO TREASURY` exactly (mockup copy). The button stays disabled until it matches.
  2. Simulate: the worker builds transfer transactions for every W holding a balance, several W signers per transaction within the size limit. It simulates all of them and shows totals: wallets, BONDR, SOL and failures.
  3. The owner signs the intent (D-12).
  4. Execute: the worker first switches every kill switch off, launches included, and persists `settings.evacuated_at`. Then it sends the transfers, paced like the engine.
- **D-36 (owner-delegated):** W's BONDR and spare SOL go to the treasury. Any child-token balance is burned rather than moved (burn is an allowed destination). Moving child supply into the treasury would put a dev-like holder on the coin and break the core claim.
  - Each W move writes a public `evacuate` ledger row ("Moved X BONDR to treasury, emergency"), because the public ledger must say where the budget went.
  - After EVACUATE, switches stay off until the owner turns them back on one by one. Seed rotation is out of scope (Phase 7 runbook).
- **D-37 (owner-delegated):** EVACUATE is proven locally on devnet against the dev database's coins and by unit tests. On staging it runs simulate-only, so the staging engine keeps running for HV-05-01.

### Layout and devices
- **D-38 (owner-delegated):** It is responsive at 390, 768 and 1440 per the mockup, answering DESIGN-BRIEF open question 4. Every action, including EVACUATE, works on a phone, because the owner often reacts to an alert away from a desk. Screenshots at all three widths go to the Designer critique (AGENTS.md section 7).

### Testing and rollout
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` (Phase 6 section): goal and the 5 success criteria
- `.planning/REQUIREMENTS.md`: ADMIN-01..11
- `.planning/PROJECT.md`: Key Decisions (no multisig, EVACUATE break-glass, treasury tops up ops on the low-ops alert), Risks (fee-share pre-flight hold, master seed leak, pump breaking change kill switch), Constraints (secrets in the worker only)
- `AGENTS.md`: sections 2 (ask before outward-facing actions), 6 (feature flags), 7 (screenshots and critique), 12 (definition of done)

### Design
- `.planning/mockups/admin.html`: the approved console layout, copy, states, simulation dialog and EVACUATE block
- `.planning/mockups/tokens.css`, `.planning/design/DESIGN-BRIEF.md` (sections 2, 5, 6, 7, 9 question 4)

### Prior phase decisions
- `.planning/phases/05-fee-engine-and-public-ledger/05-CONTEXT.md`: D-07, D-08, D-09, D-18, D-20, D-21, D-22, D-23 and its Deferred list
- `.planning/phases/05-fee-engine-and-public-ledger/05-REVIEW-engine.md` WR-08, and `05-REVIEW-FIX-engine.md` (why WR-08 was skipped, what the fix needs)
- `.planning/phases/05-fee-engine-and-public-ledger/05-13-SUMMARY.md` and `05-HUMAN-UAT.md`: staging state, HV-05-01 timing (do not pause staging jobs while it is pending)
- `.planning/phases/04-trading/04-CONTEXT.md`: D-07 (in-memory store, single replica), D-18 (kill switches belong to Phase 6)
- `.planning/phases/03-indexer-lists-and-token-page/03-CONTEXT.md`: D-04 (Neon)
- `.planning/phases/02-launch-flow/02-CONTEXT.md` and STATE.md "Review CR-01": the signMessage and HMAC session model
- `.planning/STATE.md`: kill switch note (worker memory, POST /kill-switch), Neon quota note, WR-08 todo

### Code
- `apps/worker/src/http.ts`, `fee-routes.ts`, `main.ts`: the bearer routes and route map to extend
- `apps/worker/src/status.ts`: the launches kill switch pattern (memory plus DB)
- `apps/worker/src/fee-engine.ts`, `fee-guard.ts`, `fee-prebond.ts`, `fee-burns.ts`, `fee-finalize.ts`, `fee-batch.ts`, `fee-recover.ts`, `fee-send.ts`, `fee-ledger.ts`, `fee-reconcile.ts`, `fee-config.ts`: the jobs the actions call
- `apps/worker/src/settle.ts`: settleLaunch, for Re-check launch
- `apps/worker/src/env.ts`: ops, treasury and buyback derivation
- `packages/core/src/bond.ts` (forcedBondIxs, migrateIxs), `sharing.ts`, `collect.ts`, `send.ts`, `trade-error.ts`, `sig.ts`, `schema.ts`, `keys.ts`
- `apps/web/lib/session.ts`, `guard.ts`, `worker.ts`, `ledger-copy.ts`; `apps/web/components/consent-dialog.tsx`, `wallet.tsx`, `tx-link.tsx`, `ui-button.tsx`, `ui-field.tsx`, `ui-seg.tsx`, `tag.tsx`, `callout.tsx`
- `apps/web/e2e/phantom.ts`: the fake Phantom with real signMessage
- `apps/worker/README.md`: the fee engine runbook (held release, batch)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `http.ts`: bearer check (`authorized`), `Fail` and `fail`, `readJson`. New `/admin/*` routes sit next to `feeRoutes` in `main.ts`.
- `fee-routes.ts`: `POST /fee/release` and `POST /fee/batch` (`batchNow`), the starting point for admin actions.
- `status.ts`: `setSwitch` and the in-memory switch loaded on first read. Extend it to five switches.
- Engine jobs: `windowJob` (fee-guard), forced bond and `bondedJob` (fee-burns), `finalizeJob` (fee-finalize), `distributeJob` and `buybackBurnJob` (fee-batch), `settleRows` (fee-recover), `Engine.enqueue` for per-coin serialization, and `Engine.release`.
- `settleLaunch` (settle.ts) for Re-check launch. `migrateIxs` (core bond.ts) for Run migrate.
- `session.ts`: seal, unseal, nonce and cookie helpers; `signatureOk` in core `sig.ts`.
- `guard.ts`: `sameOrigin`, `rateLimited`, `BASE58_KEY`.
- The Phase 4 trade store pattern: an in-memory id to built tx map with a 2-minute TTL, which becomes the intent store.
- `trade-error.ts`: one error map for the inspector.
- Web UI kit: `ui-button`, `ui-field`, `ui-seg`, `tag`, `callout`, `tx-link`, `copy-chip`; tokens in `apps/web/app/tokens.css`.
- `e2e/phantom.ts`: `injectPhantom` and `signIn` helpers, with real keys.

### Established Patterns
- Intent-first rows settled from chain (Phase 2 launches, Phase 5 fee_ledger). The admin audit uses the same model.
- Constraints first in `schema.ts`; Drizzle migrations run as the web pre-deploy step.
- Worker errors are passed to the browser only as contract codes (`worker.ts` PASS); raw text never reaches the browser, and RPC errors are `redact`ed.
- Files under 300 lines, one runnable check per non-trivial change, and `ponytail:` comments for shortcuts.

### Integration Points
- `apps/web/app/admin/page.tsx` (new) and `apps/web/app/api/admin/*` (new) go to the worker's `/admin/*`.
- The `settings` table gains four switch columns plus `evacuated_at`; `coins` gains `hidden_at` and its reason; new tables `blocked_deployers` and `admin_audit`; and `fee_ledger_kind` gains `leftover_burn` and `evacuate`.
- Web list queries (`lib/coins.ts`, core `coin-row.ts`) filter out hidden coins. Worker `prepare.ts` checks `blocked_deployers`.
- The engine checks the switch for each job before a send, and the hold flag per coin.

</code_context>

<specifics>
## Specific Ideas

- Copy follows the mockup: "Every money move asks for a fresh signature", "Pausing a job never moves funds", "Destinations check passed: deployer matches the launch signer, treasury matches config. No other destination is allowed.", and "This is the single allowed update_fee_shares_v2 for SWMP. Once confirmed it is permanent; only pump admin can reset it."
- The simulation dialog shows Result, Compute, Fee (ops pays), "Simulated Ns ago", and a before/after/change table per account.
- The EVACUATE block reads "Disarmed. The phrase must match exactly." until the phrase matches, then shows the simulated totals and "Sign and evacuate N wallets".

</specifics>

<deferred>
## Deferred Ideas

- **Treasury independent of the master seed (Phase 7, owner-gated, before mainnet):** today the treasury is derived from the same master seed as every W (`env.ts`). So after a real seed leak, EVACUATE moves funds into a wallet the attacker can also derive. Before mainnet, the treasury should be an external address (for example `TREASURY_PUBKEY`) not derived from the seed. This touches the permanent 8000/2000 finalize target, so it needs an owner decision.
- Master seed rotation after EVACUATE: a Phase 7 runbook.
- The "Pump contract check" health row: when OPS-02 ships in Phase 7.
- A Postgres leader lock and a multi-replica worker: only if the worker scales out.
- Reclaiming launch lookup table rent (deactivate, wait, close): a later chore. It is not in ADMIN-03's list.
- Job-wide auto-pause after repeated failures (in the mockup): add if per-coin stuck marking proves too noisy.
- A trading kill switch: only if needed (Phase 4 D-18).
- The first real-SOL admin action on mainnet: Phase 7, owner-gated.

</deferred>

---

*Phase: 06-admin-dashboard*
*Context gathered: 2026-10-25 (auto mode, owner-delegated)*
