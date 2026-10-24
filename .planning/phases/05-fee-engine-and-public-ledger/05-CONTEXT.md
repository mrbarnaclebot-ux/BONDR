# Phase 5: Fee Engine and Public Ledger - Context

**Gathered:** 2026-10-25
**Status:** Ready for planning
**Mode:** Auto. The owner delegated every gray area on 2026-10-24 ("keep going and dont stop... only stop if human intervention is needed in regards to real money"). Each decision below is the recommended option, logged in 05-DISCUSSION-LOG.md. Everything here runs on devnet and the Surfpool fork. Any mainnet send, real-SOL spend or paid-plan change stops for the owner.

<domain>
## Phase Boundary

As a holder, I want every fee movement shown with a transaction link, so that I can verify none went to the dev.

Phase 5 delivers:
- **The worker fee engine**, with no manual help:
  - collect and the 90/10 split (FEE-01)
  - the forced bond buy and burn at 105% (FEE-02)
  - the PumpSwap fallback buy and burn when traders bond first (FEE-03)
  - the rolling 24h sweep, 90% to buyback and 10% to treasury (FEE-04)
  - finalize after bond: sweep, deployer pre-flight check, config, then the single 8000/2000 update (FEE-05)
  - the buyback BONDR burn on a schedule (FEE-06)
  - the post-bond distribution crank (FEE-07)
  - ops pays every fee, with a low-balance alert (FEE-08)
  - a nightly reconciliation (FEE-09)
- **The public ledger:** each collection, split, sweep, forced-bond buy, burn, finalize and distribution, with amount, time and a Solscan link (TOKEN-04).
- **The token page's Bond and burn panel** gains:
  - the burn budget against the cost to complete
  - time left in the current 24h window
  - totals: burned supply %, fees to burn, buyback, treasury, and the deployer share once finalized (TOKEN-03, TOKEN-05)
- **Pieces deferred from Phase 3 D-08 and D-09:**
  - the home "Next to bond" rail
  - the hero line's "bonded by their own fees" wording

Not in Phase 5:
- admin recovery actions, kill switch UI, timeline and transaction inspector (Phase 6)
- the mainnet switch and BONDR token launch (Phase 7)
- collecting BONDR's own creator fees for the treasury (Phase 7, see Deferred)

</domain>

<decisions>
## Implementation Decisions

### Carried forward (locked earlier)
- **D-01:** The fee mechanic is PROJECT.md items 4-9, as proven in Phase 1. The core builders already exist and are reused, not rewritten:
  - `packages/core/src/collect.ts`: collectIxs and splitIxs
  - `bond.ts`: forcedBondIxs, poolBuyBurnIxs, migrateIxs
  - `sharing.ts`: finalizeIxs, configSweeps, updateIxs, distributeIxs, readSharing
  - `send.ts`: sendTx, with the program allowlist
  - `keys.ts`: derive
  Forced-bond burn mode: spend the full budget with `buy_exact_quote_in_v3`, and burn everything bought in the same transaction (owner, 2026-10-19).
- **D-02:** Chain access, keys and the master seed stay in the worker (FEE-10). Web reads Postgres and the worker's private HTTP. Ops is the fee payer of every engine transaction, and tops W up in the same transaction when W needs rent (PROJECT.md item 9).
- **D-03:** Neon budget (Phase 3 D-04): nothing reads Postgres on a short timer. The engine is event-driven from the indexer, plus one daily batch (D-10).
- **D-04:** Values are SOL equivalents in the UI (Phase 3 D-01). Ledger amounts are stored in base units of the mint moved (BONDR or the coin), together with the SOL value at that moment.
- **D-05:** Layout follows the approved `token.html` mockup (Bond and burn, ledger) and `home.html` (Next to bond, hero). gsd-ui-phase writes the UI-SPEC before planning.
- **D-06:** Devnet refuses 150 bps creator fees (6077), so devnet coins accrue the default creator fee; the engine reads the real accrued amount and never assumes 150 bps. Devnet cannot bond a child (Phase 3 A8), so the forced bond, fallback burn, finalize and distribution are proven on the Surfpool fork, as in Phase 1. Collect, split, sweep, buyback burn, alerts and reconciliation run on real devnet coins and on staging.

### Engine shape
- **D-07:** One engine module in the worker, one replica (same ponytail as the Phase 4 trade store). Work is serialized per coin, so two jobs on one W never overlap. ponytail: a single replica; add a Postgres advisory lock if the worker ever runs two.
- **D-08:** Intent first, for crash safety. Before sending, the engine writes a `pending` ledger row holding the signature and lastValidBlockHeight. It settles the row to `landed`, `failed` or `expired` afterwards. At boot, every pending row is settled from chain status before any new work starts, so a restart never double-sends a sweep or a burn. The database enforces one landed row per (mint, kind, window) where a kind must happen once: split per collect, sweep per window, forced bond, pool burn, finalize config, finalize update.
- **D-09:** Feature flag `FEE_ENGINE` = `off`, `dry` or `on`, default `off`.
  - `dry` builds and simulates every transaction, logs it and writes nothing.
  - Staging runs `on` (devnet).
  - This ships dark and is the Phase 5 stop switch until Phase 6 adds the admin kill switch (AGENTS.md section 6, feature flags).
- **D-10:** Triggers:
  - **On trade (indexer event, no RPC):** add the trade's creator fee to the coin's in-memory pending total, and recompute the budget against the cost to complete from the indexed curve reserves. If budget × 100 ≥ 105 × cost, run collect, split, then the forced bond.
  - **Per-coin window timer:** in memory. Loaded once at boot from landed launches, and set on each new launch. At the end of each 24h window (counted from launch time): collect, split, then sweep.
  - **On migration (the indexer's bond event):** collect what is left, the PumpSwap buy and burn if W holds budget, then finalize.
  - **Daily batch, at one fixed UTC hour, one database wake:** buyback burn (FEE-06), distribution crank (FEE-07), reconciliation (FEE-09). Recovery of anything a restart dropped runs at boot.
- **D-11:** Collect cadence is not every trade. Collect runs only before a split that is needed (window end, forced bond, migration). This bounds ops transaction fees to a few per coin per day. The minimum worthwhile amount is a config value scaled per network: on devnet it is low enough that real e2e trades trigger it.

### Sweep, buyback and treasury
- **D-12:** FEE-04: at a window end, collect and split first. Then W's whole BONDR budget is split 90% to the buyback wallet and 10% to the treasury, in one transaction W signs. W stays the creator. A window with a zero budget writes no row. A coin older than one window when the engine first starts is swept at its next window end, with no retroactive windows.
- **D-13:** The buyback wallet is a new derived role, `buyback` (keys.ts Role). The daily batch burns its entire BONDR balance in one transaction, logged as one ledger row of kind `buyback_burn`, with no mint (the platform row). Each coin's own ledger shows its `sweep_buyback` rows. Site-wide burn totals and the home ledger tape are deferred (UI-SPEC scope, owner-delegated 2026-10-25); per-coin totals cover TOKEN-05.
- **D-14:** Split arithmetic stays exactly as proven: treasury = floor(amount / 10), sized from the transaction's own balance delta, never from W's balance (PROJECT.md item 4). The 24h sweep uses the same floor rule over W's BONDR balance at sweep time, which is all budget after the split.

### Forced bond and fallback
- **D-15:** The trigger is budget ≥ 105% of the quote needed to complete the curve (PROJECT.md default 2). Before sending, the engine re-checks on chain with one fresh curve read and a simulation, because the cached reserves may lag. The burn amount comes from the simulation's post-account state (Phase 1 method).
- **D-16:** Forced bond and pool burn sends use Helius Sender on mainnet with its minimum tip, paid by ops. On devnet and the fork they use plain sendTx (Sender is mainnet-only). This mirrors the Phase 4 mainnet-only priority fee pattern. The mainnet Sender path is unit-checked only, and first runs in Phase 7 (owner-gated).
- **D-17:** If traders bond a coin first, the fallback runs on the migration event: the PumpSwap buy with W's whole budget, burned in the same transaction. It pins the first buyback recipient, and ops creates that ATA (PROJECT.md item 6).

### Finalize and distribution
- **D-18:** Finalize runs once the coin is bonded and its burn is done. Deployer pre-flight check: the deployer is the coin's on-chain CreateEvent `user`, and it must equal `launches.wallet`. Deployer, treasury and W must all differ, and the deployer must be on-curve.
  - Any failure holds finalize. The engine writes a `held` ledger row with a reason, and Sentry raises an error. Nothing retries a held finalize automatically: Phase 6 gives the admin the release action, and until then the owner releases it with a worker HTTP call.
  - The two transactions (sweeps plus config, then the sweep plus the single update) follow the Phase 1 proven split. The update's 6009 is final, never retried.
- **D-19:** Distribution crank (FEE-07): the daily batch distributes for each finalized coin whose pending fees exceed a minimum. That minimum is set so the ops fee stays under 1% of the payout. Each run is logged as a `distribute` row.

### Ops and reconciliation
- **D-20:** FEE-08: the low-ops alert reuses the existing "ops below floor" warning, which goes to Sentry. Each engine send checks ops's post-balance from the transaction meta, with no extra RPC call.
  - Below the floor, the engine pauses new non-urgent sends: sweeps, buyback burns and distribution.
  - The forced bond and the fallback burn still run, because they are atomic with migration.
  - The floor is a config value per network. The owner tops ops up by hand (owner, 2026-10-19).
- **D-21:** FEE-09: the nightly reconciliation compares, for each W, the ledger-implied BONDR balance (collected minus split minus swept minus spent) with the on-chain balance. It does the same for the buyback wallet.
  - A difference beyond rounding dust writes a `reconcile_diff` row (it is not public, and Phase 6 reads it) and raises a Sentry error.
  - It never moves funds.
  - Chain reads are batched with getMultipleAccounts.

### Ledger and UI data
- **D-22:** One `fee_ledger` table. Columns:
  - kind (collect, split_treasury, sweep_buyback, sweep_treasury, forced_bond, pool_burn, buyback_burn, finalize_config, finalize_update, distribute, held)
  - mint (null for platform rows)
  - state (pending, landed, failed, expired)
  - amount, the mint moved
  - tokens burned, when there is a burn
  - SOL value
  - signature
  - window index
  - created and landed times
  Only `landed` rows are public. New landed rows reach open pages through the Phase 3 SSE hub as a new `fee` event, so no new reads.
- **D-23:** The coin row carries the panel's numbers, written only when they change: burn budget, uncollected fees (from trade events, on the trade write that already happens), current window start, totals to burn, buyback and treasury, burned supply, and the finalized deployer share. The token page and the home rail read the row. No reads happen on a timer.
- **D-24:** Next to bond (Phase 3 D-08): the home rail ranks unbonded coins by budget / (1.05 × cost to complete), shows the top few, and is hidden when none has a budget. The hero line becomes "N coins bonded by their own fees" once any forced bond lands. Until then it keeps the Phase 3 count wording.

### Testing
- **D-25:**
  - **Units:** trigger math, split and sweep floors, the window schedule, deployer pre-flight, pending-row recovery.
  - **Devnet e2e:** a real coin gets trades, a shortened window (`FEE_WINDOW_MS` env, local only; staging keeps 24h), then collect, split, sweep and a buyback burn, with ledger rows on the page.
  - **Fork:** the Phase 1 Surfpool fork rows run the engine's own code paths for the forced bond, fallback burn, finalize and one distribution. Each records signatures and that W ends at 0 child tokens.
  - **Spend cap:** devnet spend from ops stays under 0.1 SOL for the phase.

### Claude's Discretion
- Exact schema shape for the ledger, window index and coin columns, as long as the DB constraints in D-08 hold.
- How the worker exposes a held-finalize release before Phase 6 (a bearer-protected POST is fine).
- The daily batch hour and the per-network floors and minimums.
- Whether collect and split share one transaction (the Phase 1 rows used two).
- The SOL-value source for a ledger row (the BONDR price at the trade or at landing).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` (Phase 5 section): goal and the 5 success criteria
- `.planning/REQUIREMENTS.md`: FEE-01..09, TOKEN-03..05
- `.planning/PROJECT.md`: Fee Mechanic items 4-9, Key Decisions, Risks (forced bond rarely triggers, wrong deployer locked in)

### Design
- `.planning/mockups/token.html`: Bond and burn panel, ledger
- `.planning/mockups/home.html`: Next to bond rail, hero line
- `.planning/mockups/tokens.css`, `.planning/design/DESIGN-BRIEF.md`
- `.planning/phases/03-indexer-lists-and-token-page/03-UI-SPEC.md`, `.planning/phases/04-trading/04-UI-SPEC.md`: the token page contract this phase extends

### Prior evidence and code
- `.planning/phases/01-chain-spike/01-10-SUMMARY.md`, plus the 01-06..01-09 summaries: prebond.collect and prebond.split, bond.forced, bond.pool.burn, finalize.config and finalize.update, finalize.distribute, sharing.update2.rejected rows
- `scripts/spike/stages/prebond.ts`, `bond.ts`, `finalize.ts`, `sharing.ts`, `pool.ts`: the proven call sequences
- `packages/core/src/collect.ts`, `bond.ts`, `sharing.ts`, `send.ts`, `keys.ts`: the builders the engine reuses
- `apps/worker/src/ingest.ts`, `stream.ts`, `events-route.ts`: the trade and bond events the engine listens to, and the SSE publish
- `.planning/phases/03-indexer-lists-and-token-page/03-CONTEXT.md`: D-04 (Neon), D-08, D-09
- `.planning/phases/04-trading/04-CONTEXT.md`: D-08 (mainnet-only fee pattern), D-18 (kill switches in Phase 6)
- `.planning/STATE.md`: the decisions log, including the pre-flight note that the deployer comes from the CreateEvent `user` and deployer != treasury != W

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The core fee builders above (collect, bond, sharing) and `send.ts` sendTx with the program allowlist and settle.
- `keys.ts` derive(master, role, net, id): add the `buyback` role. W is keyed by the coin id.
- `apps/worker/src/ingest.ts`: the trade write path (the place to add pending fees) and bond detection (`coins.venue`, `bondSig`).
- `apps/worker/src/events-route.ts` publish: the SSE fan-out for the new `fee` event.
- `apps/worker/src/sentry.ts`: console warn and error go to Sentry, including the existing ops floor warning.
- `apps/web/components/token-bond.tsx`: the Phase 3 Bond and burn panel to extend.

### Established Patterns
- Worker HTTP routes are bearer-protected (`http.ts`). Web reads Postgres for public data.
- Launch states with intent-first rows and settle (Phase 2 `launches` table and `settle.ts`): the model for D-08.
- Constraints first in `schema.ts`. Drizzle migrations run as the web pre-deploy step.
- One runnable check per non-trivial change. `ponytail:` comments mark shortcuts.

### Integration Points
- `apps/worker/src/main.ts` boots the engine after the indexer.
- `coins` gains the panel columns, plus a new `fee_ledger` table.
- `apps/web/app/coin/[mint]/page.tsx` and `apps/web/app/page.tsx` read the new columns and rows.

</code_context>

<specifics>
## Specific Ideas

- The ledger row copy follows the mockup, for example "Burned 804.8M GRUB, forced bond", "Swept 0.42 SOL to buyback", each with a Solscan link.
- The 24h window shows as a countdown, "Next sweep in 13h 22m".

</specifics>

<deferred>
## Deferred Ideas

- Collecting BONDR's own creator fees for the treasury: Phase 7 (BONDR does not exist on mainnet yet).
- An admin kill switch, held-finalize release UI and reconciliation view: Phase 6.
- Helius Sender on mainnet first runs at go-live: Phase 7, owner-gated.
- Site-wide burn totals and the home ledger tape from home.html: a later phase.
- A leader lock for multiple worker replicas: only if the worker scales out.

</deferred>

---

*Phase: 05-fee-engine-and-public-ledger*
*Context gathered: 2026-10-25 (auto mode, owner-delegated)*
