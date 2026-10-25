# Phase 5: Fee Engine and Public Ledger - Research

**Researched:** 2026-10-25
**Domain:** Solana worker automation (pump / PumpSwap / pump-fees on Token-2022 BONDR), intent-first ledger in Postgres, live UI over the Phase 3 SSE hub
**Confidence:** HIGH for the code paths and chain facts (read from this repo, the pinned SDKs and read-only devnet RPC). MEDIUM for Helius Sender details (its docs disagree) and for two untried builder paths (flagged below).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried forward (locked earlier)
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

#### Engine shape
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

#### Sweep, buyback and treasury
- **D-12:** FEE-04: at a window end, collect and split first. Then W's whole BONDR budget is split 90% to the buyback wallet and 10% to the treasury, in one transaction W signs. W stays the creator. A window with a zero budget writes no row. A coin older than one window when the engine first starts is swept at its next window end, with no retroactive windows.
- **D-13:** The buyback wallet is a new derived role, `buyback` (keys.ts Role). The daily batch burns its entire BONDR balance in one transaction, logged as one ledger row of kind `buyback_burn`, with no mint (the platform row). Each coin's own ledger shows its `sweep_buyback` rows. Site-wide burn totals and the home ledger tape are deferred (UI-SPEC scope, owner-delegated 2026-10-25); per-coin totals cover TOKEN-05.
- **D-14:** Split arithmetic stays exactly as proven: treasury = floor(amount / 10), sized from the transaction's own balance delta, never from W's balance (PROJECT.md item 4). The 24h sweep uses the same floor rule over W's BONDR balance at sweep time, which is all budget after the split.

#### Forced bond and fallback
- **D-15:** The trigger is budget ≥ 105% of the quote needed to complete the curve (PROJECT.md default 2). Before sending, the engine re-checks on chain with one fresh curve read and a simulation, because the cached reserves may lag. The burn amount comes from the simulation's post-account state (Phase 1 method).
- **D-16:** Forced bond and pool burn sends use Helius Sender on mainnet with its minimum tip, paid by ops. On devnet and the fork they use plain sendTx (Sender is mainnet-only). This mirrors the Phase 4 mainnet-only priority fee pattern. The mainnet Sender path is unit-checked only, and first runs in Phase 7 (owner-gated).
- **D-17:** If traders bond a coin first, the fallback runs on the migration event: the PumpSwap buy with W's whole budget, burned in the same transaction. It pins the first buyback recipient, and ops creates that ATA (PROJECT.md item 6).

#### Finalize and distribution
- **D-18:** Finalize runs once the coin is bonded and its burn is done. Deployer pre-flight check: the deployer is the coin's on-chain CreateEvent `user`, and it must equal `launches.wallet`. Deployer, treasury and W must all differ, and the deployer must be on-curve.
  - Any failure holds finalize. The engine writes a `held` ledger row with a reason, and Sentry raises an error. Nothing retries a held finalize automatically: Phase 6 gives the admin the release action, and until then the owner releases it with a worker HTTP call.
  - The two transactions (sweeps plus config, then the sweep plus the single update) follow the Phase 1 proven split. The update's 6009 is final, never retried.
- **D-19:** Distribution crank (FEE-07): the daily batch distributes for each finalized coin whose pending fees exceed a minimum. That minimum is set so the ops fee stays under 1% of the payout. Each run is logged as a `distribute` row.

#### Ops and reconciliation
- **D-20:** FEE-08: the low-ops alert reuses the existing "ops below floor" warning, which goes to Sentry. Each engine send checks ops's post-balance from the transaction meta, with no extra RPC call.
  - Below the floor, the engine pauses new non-urgent sends: sweeps, buyback burns and distribution.
  - The forced bond and the fallback burn still run, because they are atomic with migration.
  - The floor is a config value per network. The owner tops ops up by hand (owner, 2026-10-19).
- **D-21:** FEE-09: the nightly reconciliation compares, for each W, the ledger-implied BONDR balance (collected minus split minus swept minus spent) with the on-chain balance. It does the same for the buyback wallet.
  - A difference beyond rounding dust writes a `reconcile_diff` row (it is not public, and Phase 6 reads it) and raises a Sentry error.
  - It never moves funds.
  - Chain reads are batched with getMultipleAccounts.

#### Ledger and UI data
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

#### Testing
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

### Deferred Ideas (OUT OF SCOPE)
- Collecting BONDR's own creator fees for the treasury: Phase 7 (BONDR does not exist on mainnet yet).
- An admin kill switch, held-finalize release UI and reconciliation view: Phase 6.
- Helius Sender on mainnet first runs at go-live: Phase 7, owner-gated.
- Site-wide burn totals and the home ledger tape from home.html: a later phase.
- A leader lock for multiple worker replicas: only if the worker scales out.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FEE-01 | Collect each unbonded coin's creator fees, split 90% W / 10% treasury, ledger every step | `collectIxs` + `splitIxs` reused as two txs (Pattern 4). Split sized from the collect's meta delta via `tokenDelta`. `split_treasury` row references its `collect` row (partial unique index). |
| FEE-02 | Budget ≥ 105% of cost to complete triggers one buy + burn via Helius Sender | Trigger from `TradeEvent.creatorFeeUnclaimed` plus the SDK cost on indexed reserves (Pattern 2). Fresh re-check, then `forcedBondIxs` after the WR-08 fix (Pitfall 5). Sender path in Pattern 7. |
| FEE-03 | Traders bond first: PumpSwap buy + burn after migration | Hook on venue moving to `pool` (CreatePoolEvent). Uses `buyExactQuoteInV2Instructions` with the whole budget, burning the simulated out (Pattern 5, A2). Proven fallback: `poolBuyBurnIxs`. |
| FEE-04 | Every 24h window unbonded: sweep 90% buyback / 10% treasury | Window schedule derived from `launchedAt` and `FEE_WINDOW_MS` with in-memory timers (Pattern 3). One W-signed tx with two `transferChecked` writes two rows sharing one signature. |
| FEE-05 | After bond: sweep pending, pre-flight deployer, config, single 8000/2000 update | New core `finalizeConfigIxs`, `finalizeUpdateIxs` and `finalizeState` (split of `finalizeIxs`, STATE blocker). Pre-flight reads the launch tx's CreateEvent `user`. The closing sweep empties W (Pattern 6). |
| FEE-06 | Burn buyback BONDR on a schedule | Daily batch: `createBurnCheckedInstruction` on BONDR (Token-2022, 6 decimals, verified on devnet), signed by the derived `buyback` role, ops pays. |
| FEE-07 | Crank post-bond distribution on a schedule | `distributeIxs`, ops pays. Pending = `Pool.creatorFees` plus the AMM and pump vault ATAs of the sharing config PDA, read with one getMultipleAccounts. `getMinimumDistributableFee` is SOL-only, so it is not used (Pitfall 9). |
| FEE-08 | Ops pays every fee; alert below threshold | Ops is the fee payer (index 0), so its post balance is `meta.postBalances[0]`. Reuse the 0.05 SOL `OPS_FLOOR_LAMPORTS` (move it to one shared place) and log `ops below floor` through console.error, which Sentry captures. |
| FEE-09 | Nightly reconciliation records ledger vs chain mismatch | One grouped SQL sum per W plus one for buyback. W and buyback BONDR ATAs read with getMultipleAccountsInfo (100 per call). Mismatches go to `reconcile_diff` rows and console.error. |
| TOKEN-03 | Bond progress, burn budget vs cost to complete, time left in 24h window | New coin columns `fee_budget`, `fees_unclaimed`, `cost_to_complete` and `bondr_sol`, written with the trade patch. Window computed from `launchedAt` and `FEE_WINDOW_MS` (added to WEB_ENV). |
| TOKEN-04 | Fee ledger rows with amount, time, tx link | `lib/ledger.ts` keyset page (20) of landed public kinds. Route `/api/coin/[mint]/ledger`. New LiveEvent `fee`. |
| TOKEN-05 | Totals: burned %, to burn, buyback, treasury, deployer share once finalized | Running total columns on `coins`, incremented in the same DB transaction that lands the row (Pattern 8). |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Ponytail `full`: reuse before writing, stdlib and installed deps first, shortest working diff. Mark shortcuts with `ponytail:` comments.
- Files under 300 lines, functions under 40 lines, three directory levels at most, and a README.md in any directory with more than five files. Every new worker file needs a line in `apps/worker/src/README.md`, and every web file one in `components/README.md` and `lib/README.md`.
- One runnable check per non-trivial change. Use Vitest (`*.test.ts`) and Playwright (`*.e2e.ts`) only. No new test frameworks.
- No emoji anywhere. Never commit secrets: new env names go in `.env.example`, and the seed, RPC URL and token are never printed.
- Database constraints over application checks (section 6). Feature flags for risky work (`FEE_ENGINE`).
- Never break the build: `pnpm test`, `pnpm lint` (biome ci) and `pnpm typecheck` stay green.
- Ask before outward-facing or real-money actions: no mainnet sends, no real-SOL spend beyond devnet (owner memory: autonomous mode stops only for real money). The Neon budget is a hard 500 CU-h a month: never poll the database.
- UI phases end with Playwright screenshots at 390, 768 and 1440, 0 axe violations, and a Designer critique.
- Branch `phase-05-fee-engine` is current. Commit after every green task.

## Summary

Every builder the engine needs already exists in `packages/core` and is proven on chain. The work is to wrap them in a long-running, crash-safe worker loop, not to write new chain logic. A spike script and a worker differ in five ways:

1. **Who signs.** The spike gets keys from `ctx.key(role, id)` over `Net = devnet|fork`. The worker has `env.ts` helpers typed `"devnet"`, and no `buyback` role yet.
2. **Send-then-record.** `sendTx` signs and sends in one call. D-08 needs the signature and `lastValidBlockHeight` written *before* broadcast. Split it into `signTx` plus the existing `broadcast`/`sendRaw`.
3. **Rent floats.** `wFloat` is a spike helper, and devnet rent is not mainnet rent. A 0-byte account costs 650,240 lamports on devnet, against 890,880 on the fork. Move the helper into core and read rent live.
4. **The finalize split.** `finalize.ts` slices `finalizeIxs` by hand. The STATE blocker asks for a resumable `finalizeConfigIxs`, `finalizeUpdateIxs` and `finalizeState`.
5. **Known review bugs.** WR-08 (the `forcedBondIxs` minOut) and the "caller boolean" for complete-and-pool.

The trigger needs no RPC and no in-memory summing. The pinned pump SDK's `TradeEvent` carries `creatorFeeUnclaimed`, the curve's creator bucket after the trade. It is present in both the devnet and the fork fixtures. Store it on the coin row with the patch the indexer already writes, and the restart problem disappears. Devnet coins accrue **30 bps**, not 150: FeeConfig `flatFees.creatorFeeBps = 0x1e`, read live, and every devnet fixture shows `creatorFeeBasisPoints: 30`. A 0.01 SOL devnet trade accrues about 30,000 lamports of fee value. The cost to complete comes from the SDK's `getBuyV3QuoteAmountFromTokenAmount`, called on a curve object built from the indexed reserves, with the global and fee config cached.

Helius Sender is a plain `POST` to `/fast` and needs two things in the transaction: a tip transfer to one of 10 mainnet-beta accounts, and a compute unit price. The docs disagree on the minimum tip (0.001 SOL for Sender Max, 0.0002 SOL on older pages, 0.000005 SOL with `swqos_only`). Keep the tip a config value. Model it on Phase 4's `priorityMicroLamports(net, estimate, ...)`: inject the fetch, so the mainnet path is unit-checked and never runs on devnet.

**Primary recommendation:** Build `apps/worker/src/fee/` as a small set of files: ledger store, recovery, triggers and timers, one job per flow, the daily batch, and send. Each money job takes an injected `Deps` (connection, keypairs, ledger store, send function). Postgres backs the worker; an in-memory store backs the Surfpool fork stage and the units, so the fork rows run the engine's own code. Land Wave 0 core fixes first: the `signTx` split, the `buyback` role, WR-08, the finalize split, `wFloat`, and the `creatorFeeUnclaimed` patch field.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trigger math, window schedule, split floors | API / Backend (worker, pure core fns) | — | Pure bigint math in core `math.ts`, so it is unit-testable and web never computes money |
| Building, signing and sending fee txs | API / Backend (worker only) | — | FEE-10 / D-02: the seed and keys never leave the worker |
| Pending-row intent and settle | Database (constraints) | Worker (settle loop) | D-08: the partial unique indexes make a double send impossible, not just unlikely |
| Indexed fee state (unclaimed, cost, BONDR price) | Worker ingest (the existing patch write) | Database (`coins` columns) | Written on the trade write that already happens, with no extra wake (D-03, D-23) |
| Panel totals | Database (`coins` running totals) | Worker (increment in the landing tx) | D-23: no read-time aggregation |
| Ledger page and Load more | Frontend Server (Next route, `server-only` lib) | Database | Same 10 s kept read as the trades page |
| Live ledger and panel updates | Worker `GET /events` | Web hub, then the browser via SSE | Phase 3 hub; a new `fee` event type |
| Window countdown and ratio display | Browser | — | Client tick from `launchedAt` + `windowMs`; the ratio is floored from base units sent by the server |
| Held-finalize release, manual batch run | Worker private HTTP (bearer) | — | Phase 6 adds the UI |

## Standard Stack

No new packages. Every capability is covered by pinned dependencies.

### Core (already installed, verified in `packages/core/package.json` and `node_modules/.pnpm`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @pump-fun/pump-sdk | 4.1.0 | collect, sweep, forced bond, sharing, distribute, `getBuyV3QuoteAmountFromTokenAmount`, `decodeTradeEventBc` | Phase 1 proven; loaded only through `core/pump.ts` |
| @pump-fun/pump-swap-sdk | 2.1.0 | `poolState`, `buyV2Instructions`, `buyExactQuoteInV2Instructions`, `decodePool` | The fallback burn; `Pool.creatorFees` for the distribution read |
| @solana/web3.js | 1.99.0 | tx compile, `simulateTransaction` with accounts, `getMultipleAccountsInfo`, `PublicKey.isOnCurve` | Project standard |
| @solana/spl-token | 0.4.15 | `createBurnCheckedInstruction`, `createTransferCheckedInstruction`, `getMint`, `AccountLayout` | Token-2022 BONDR |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | `fee_ledger` table, partial unique indexes, migration `0005_*` | Project standard |
| vitest | 4.1.11 | units | Project standard |
| @playwright/test + @axe-core/playwright | 1.63.0 / 4.13.0 | UI matrix and the devnet e2e | Project standard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two txs for collect, then split | One tx where the split is sized by simulation | Saves one 5,000-lamport fee per collect, but breaks D-14 "sized from the tx's own delta" if a trade lands between simulation and landing. Keep two txs. |
| `buyExactQuoteInV2Instructions` (whole budget) for the fallback | `poolBuyBurnIxs` (buy_v2 exact out, proven) | buy_v2 leaves part of the budget unspent in W, and the closing sweep then takes it. Use exact-quote-in to honor D-17 "whole budget", with buy_v2 as the fallback if the fork row fails. |
| Summing `TradeEvent.creatorFee` in memory | Storing the latest `creatorFeeUnclaimed` on the coin row | The stored value survives restarts with no rebuild. The SDK documents it as the curve bucket after the trade. |
| `getMinimumDistributableFee` | Reading `Pool.creatorFees` and the two vault ATAs | The SDK says the view is SOL-only (`feesQuoteMint: NATIVE_MINT`), so it is meaningless for a BONDR quote. |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed in this phase. The UI-SPEC Registry Safety section also adds none. Sender is called with Node's built-in `fetch`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | not run (nothing to check) | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Helius logsSubscribe (BONDR mint) ──► stream.ts queue ──► ingestTx / gapFill / ingestLaunch
                                                              │ parseTx (pure; + creatorFeeUnclaimed, cost)
                                                              ▼
                                         DB txn: trades insert + coins patch (fees_unclaimed, cost, bondr_sol)
                                                              │ after commit: arm()
                                       ┌──────────────────────┴─────────────────────┐
                                       ▼                                            ▼
                             publish trade/launch/bond                engine.onIngest(parsed, bonded, launched)
                                                                                    │ (ignored until engine ready)
                     ┌────────────────────────┬─────────────────────┬───────────────┴───────────┐
                     ▼                        ▼                     ▼                           ▼
            trigger105(budget,cost)?   new launch: set timer   venue -> pool (migration)   daily batch timer (UTC hour)
                     │ yes                    │ window end          │                           │
                     ▼                        ▼                     ▼                           ▼
        per-coin serial queue (Map<mint, Promise>) ──────────────────────────────►  buyback burn, distribute,
                     │                                                               reconcile (1 DB read, batched RPC)
                     ▼
   job: [fresh chain read + simulate] → signTx → INSERT pending row (sig, lvbh)   ◄── unique partial indexes refuse a 2nd intent
                     │                                      │
                     ▼                                      ▼
     broadcast: devnet/fork RPC | mainnet Helius Sender   settle (getSignatureStatuses, nextState)
                                                            │
                                                            ▼
                     DB txn: row -> landed/failed/expired + coins running totals
                                                            │
                                                            ▼
                  publish {type:"fee", data:{mint, rows, coin}} ──► web hub ──► /api/live SSE ──► token page / home
   ops postBalances[0] < floor ──► console.error("ops below floor") ──► Sentry; pause non-urgent jobs

 Boot: seedBondrPrice → loadCoins → engine.load (1 read) → engine.recover (settle every pending row) → ready
       → backfillLaunches → startStream (gap fill feeds hooks) → engine.evaluateAll (finalize/trigger catch-up, timers)
```

### Recommended Project Structure
```
packages/core/src/
├── send.ts          # + signTx() (compile, allowlist, size, sign) reused by sendTx
├── keys.ts          # Role + "buyback"
├── bond.ts          # WR-08 fix: minOut = simOut - pre-balance; poolExactInBurnIxs (exact-quote-in + burn)
├── sharing.ts       # + finalizeConfigIxs, finalizeUpdateIxs, finalizeState (none|configured|revoked)
├── curve.ts         # + costFromReserves(row, global, feeConfig): SDK quote on a synthesized curve, no RPC
├── float.ts         # wFloat(conn, w, bytes): moved from scripts/spike/stages/bond.ts
├── fees.ts          # pure: windowOf, nextWindowEnd, sweepSplit, budgetOf, deployerOk, distributeMin
├── trades.ts        # curveState patch + feesUnclaimed (TradeEvent.creatorFeeUnclaimed), cost, bondrSol
├── schema.ts        # fee_ledger + coins fee columns
└── api.ts           # LedgerRow, CoinFees, LiveEvent "fee"
apps/worker/src/fee/  # README.md (more than 5 files)
├── engine.ts        # load, ready flag, per-coin queue, hooks, timers, flag gating
├── ledger.ts        # LedgerStore interface + Postgres impl (insertPending, settle, applyTotals)
├── recover.ts       # boot settle of pending rows (reuses settle.ts nextState)
├── send.ts          # sendPath(net): RPC or Sender; tip ixs; ops floor check from meta
├── prebond.ts       # collect, split, sweep, forced bond jobs
├── bonded.ts        # migration: collect, pool burn, finalize (pre-flight, config, update, closing sweep)
├── batch.ts         # daily: buyback burn, distribute, reconcile
└── routes.ts        # POST /fee/release, POST /fee/batch (bearer)
apps/web/lib/ledger.ts, ledger-copy.ts (+ test), app/api/coin/[mint]/ledger/route.ts, components per UI-SPEC
scripts/spike/stages/engine.ts   # fork rows calling apps/worker/src/fee/* with an in-memory LedgerStore
```

### Pattern 1: Intent-first send (D-08)
**What:** sign, then write a pending row, then broadcast, then settle. Never store or resend the wire. A pending row whose blockhash has expired and whose signature was never seen becomes `expired`, and the job is re-derived later.
**When to use:** every engine transaction.
```typescript
// core/send.ts: the first half of today's sendTx, exported (sendTx becomes signTx + sendRaw).
export function signTx(o: SendOpts & { bh: BlockhashInfo }):
  { ok: true; raw: Uint8Array; sig: string; bytes: number } | { ok: false; err: string; bytes: number } {
  const msg = compile(o.payer.publicKey, o.ixs, o.tables ?? [], o.bh.blockhash);
  const bytes = messageSize(msg);
  const refused = checkMessage(msg) ?? (bytes > PACKET_LIMIT ? `too large: ${bytes}` : null);
  if (refused) return { ok: false, err: refused, bytes };
  const tx = new VersionedTransaction(msg);
  tx.sign([o.payer, ...(o.signers ?? [])]);
  return { ok: true, raw: tx.serialize(), sig: bs58.encode(tx.signatures[0]), bytes };
}
// engine: const s = signTx(...); await ledger.insertPending(rows(s.sig, bh.lastValidBlockHeight));
//         const sent = await broadcast(conn, s.raw, {...}); const r = sent ?? await settle(conn, s.sig, ...);
```
Source: `packages/core/src/send.ts` (`compile`, `checkMessage`, `broadcast`, `settle` already exist). `apps/worker/src/settle.ts` `nextState` is the boot-recovery decision function: reuse it.

### Pattern 2: Trigger with no RPC (D-10)
**What:** the budget is `fee_budget` (W's BONDR after the last landed row) plus 90% of `fees_unclaimed`. The cost is the SDK v3 quote over the indexed reserves.
```typescript
// core/curve.ts. The SDK math on a curve built from the coins row (TradeEvent reserves are post-trade).
// global/feeConfig are cached (trade-state.ts already caches fee configs per 60 s).
export const costFromReserves = (r: Reserves, global: Global, feeConfig: FeeConfig, creator: PublicKey, quoteMint: PublicKey) =>
  getBuyV3QuoteAmountFromTokenAmount({ global, feeConfig, mintSupply: new BN(SUPPLY.toString()),
    bondingCurve: { ...r, tokenTotalSupply: new BN(SUPPLY.toString()), complete: false, creator, quoteMint,
      isMayhemMode: false, isCashbackCoin: false, creatorFeeBps: new BN(0) /* devnet 0; 150 on mainnet */ } as BondingCurve,
    amount: r.realTokenReserves, curveBaseTokenBalance: r.realTokenReserves });
// trigger: trigger105(feeBudget + applyBps(feesUnclaimed, 9000), cost)   (math.ts, exists)
```
The SDK's `v3Rates` reads `creatorFeeBps` and the reserves (market-cap fee tiers). Build the curve's `creatorFeeBps` from the coin's real value: 0 on devnet, where it was probed, and 150 on mainnet launches. The planner can store `creator_fee_bps` once per coin from the CreateEvent, or read it from the curve at launch ingest. Verify with one unit test that compares against `costToComplete` on a fixture-derived curve.

### Pattern 3: Window schedule, derived and not stored (D-10, D-12)
`windowIndex(now) = floor((now - launchedAt) / windowMs)`. The current window closes at `launchedAt + (windowIndex + 1) * windowMs`. Timers come from `launchedAt`, loaded once at boot, so a restart loses nothing and nothing is retroactive. Web uses the same formula with `FEE_WINDOW_MS` added to `WEB_ENV` (default 86,400,000). That drops D-23's "current window start" column. It is allowed under "exact schema shape" discretion, and it avoids one coin write per coin per day. Node `setTimeout` caps at 2^31-1 ms (about 24.8 days), so 24 h is safe.

### Pattern 4: Collect then split (FEE-01, D-14), proven call sequence
`collectIxs({online, payer: ops, mint, creator: W, quoteMint: Q})` lands, and `collected = tokenDelta(meta, Q, W)` (`trade.ts`). Then `splitIxs({payer: ops, creator: W, treasury, quoteMint: Q, treasuryAmount: split90_10(collected).treasury, decimals: 6})`, signed by `[ops, W]`. Ops pays the ATA rent: W's BONDR ATA is missing on devnet today (probed: `wQAta: missing`, 1,513,840 lamports for 170 bytes on devnet). On boot, a landed `collect` with no landed `split_treasury` that references it gets its split sent from the stored amount.

### Pattern 5: Forced bond and fallback, one helper (D-15, D-17)
Both flows: simulate with `accounts: [W child ATA]`, then `minOut = post - pre` (WR-08 fix: `pre` is W's child balance before), burn `post` (all, including a leftover), send. The forced bond is `buyExactIn` on the curve (`forcedBondIxs`, exists). The fallback is `PUMP_AMM_SDK.buyExactQuoteInV2Instructions(state, wholeBudget, minBaseOut)`: "spends at most `spendableQuoteIn` (fees included) for at least `minBaseOut`" (pump-swap-sdk 2.1.0 `offlinePumpAmm.ts:1450`). It needs `buybackAtaIx(ops, Q, buyback)` first, from pinned `poolState`, as `poolBuyBurnIxs` does. Ops floats W with `wFloat` (rents read live).

### Pattern 6: Finalize, resumable (FEE-05, D-18, STATE blocker)
1. **State from chain, one read:** `getMultipleAccountsInfo([bondingCurvePda, canonicalPumpPoolPdaWithQuote(mint, Q), feeSharingConfigPda(mint)])` gives complete, pool exists, and finalizeState none, configured or revoked (`decodeSharingConfig().adminRevoked`). This replaces the caller boolean.
2. **Pre-flight:** fetch the launch tx (`launches.signature`), take `innerEvents(tx)` CreateEvent `user`, and check it equals `launches.wallet`. Deployer, treasury and W must all differ, and `PublicKey.isOnCurve(deployer)` must hold. A failure writes a `held` row and calls `console.error` (Sentry). An RPC failure is not a hold: retry at the next boot or batch.
3. **tx1** `finalizeConfigIxs` = [float `rent(SHARING_CONFIG_SIZE)+0.01 SOL`, sweeps, create_fee_sharing_config] (1,076 B proven). **tx2** sent immediately: `finalizeUpdateIxs` = [configSweeps (pool only), vault ATA, update_fee_shares_v2 8000/2000] (1,126 B proven). A 6009 on tx2 is final: mark the row failed with code 6009 and set the coin to `finalized` only if `readSharing` shows `[8000,2000]`.
4. **Closing sweep:** the update's inner distribution pays W 100% of the pre-update vault (Phase 1 01-08: "fees from trades 1 to 4 went to W2 through the update's inner distribution"), and so does anyone who distributes between tx1 and tx2. After tx2, sweep W's whole BONDR 90/10 as the current window's `sweep_buyback`/`sweep_treasury`. W then ends at 0 BONDR and 0 child tokens. (A6)

### Pattern 7: Mainnet-only Sender path, unit-checkable (D-16)
```typescript
// fee/send.ts. Same shape as trade-prepare.ts priorityMicroLamports(net, estimate, ...).
export const SENDER_TIPS = ["4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE", /* ...the 10 mainnet-beta accounts */];
export const tipIxs = (net: TradeNet, ops: PublicKey, lamports: number, pick = Math.random) =>
  net === "mainnet" ? [SystemProgram.transfer({ fromPubkey: ops,
    toPubkey: new PublicKey(SENDER_TIPS[Math.floor(pick() * SENDER_TIPS.length)]), lamports })] : [];
export async function urgentBroadcast(net: TradeNet, conn: Connection, raw: Uint8Array, o: RawOpts,
  post: typeof fetch = fetch): Promise<SendResult | null> {
  if (net !== "mainnet") return broadcast(conn, raw, o);
  const res = await post(SENDER_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction",
      params: [Buffer.from(raw).toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }] }) });
  return res.ok ? null : { ok: false, status: "unknown", sig: o.sig, lastValidBlockHeight: o.lastValidBlockHeight, bytes: o.bytes, err: `sender ${res.status}` };
}
// Unit check: devnet -> no tip ix and fetch never called; mainnet -> exactly one tip ix to a listed account
// >= SENDER_TIP_LAMPORTS, a setComputeUnitPrice present (budget()), checkMessage passes, fetch called once.
```
Endpoint: `http://ewr-sender.helius-rpc.com/fast` (Newark, nearest to Railway US East) or global `https://sender.helius-rpc.com/fast`. Settlement after Sender uses the normal RPC `settle`. `skipPreflight: true` is why D-15's simulation is mandatory. Keep `env.ts` `launchNet` refusing mainnet. The mainnet branch is reachable only in units.

### Pattern 8: Landing applies totals in the same DB transaction (D-23)
A pure per-kind map `{ kind -> column increments }` (unit-tested), applied as `update coins set to_buyback = to_buyback + $x, ...` in the same transaction that moves the row to `landed`. Then, if `listening()`, read `coinRow` once (the DB is awake) and `publish({type:"fee", data:{mint, rows, coin}})`. This is the `announce` pattern from `ingest.ts`.

### Anti-Patterns to Avoid
- **Reading W's balance to size a split:** banned by D-14 and T-01-20. Use the collect tx's meta delta.
- **Resending an `unknown` signature:** `send.ts` already warns against it. Recovery checks `getSignatureStatuses(..., {searchTransactionHistory: true})` only after `lastValidBlockHeight` has passed.
- **A timer that reads Postgres:** window timers and the batch use in-memory state. The batch is the one daily wake.
- **Acting on hooks before boot recovery:** the gap fill fires hooks with `live=false` during boot. The engine updates in-memory state but enqueues no job until `ready`.
- **Spike copies in fork rows:** `stages/engine.ts` imports `apps/worker/src/fee/*` (precedent: `scripts/devnet-trades.ts` imports `../apps/worker/src/env.ts`).
- **Hardcoded rent:** devnet rent differs from mainnet and the fork.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cost to complete | Constant-product plus fee math | `getBuyV3QuoteAmountFromTokenAmount` (SDK) over indexed reserves | Fee tiers depend on reserves and creator bps; `curve.ts` already bans a hand-rolled curve |
| Distribution ix list | Custom sweep/consolidate/distribute | `distributeIxs` (SDK `buildDistributeCreatorFeesInstructions`) | Order matters; it refuses an un-swept curve bucket (6095) |
| Event decoding | Log parsing | `innerEvents` (emit_cpi under the event authority) | Logs truncate; the authority check proves events are real |
| Tx landed/expired decision | New state machine | `settle.ts` `nextState` + `send.ts` `settle`/`unseen` | Already tested (settle.test.ts) |
| Burn amount | Pool or curve math | `simulateTransaction` with the `accounts` option | Phase 1: the landed buy matched the simulation exactly |
| Program allowlist | Per-call checks | `checkMessage` inside `signTx` | One choke point; System, Token-2022, ATA, pump, AMM and pump-fees are already allowed |
| Pending fee read post-bond | Summing BuyEvents | `Pool.creatorFees` + `coinCreatorVaultAtaPda` + pump vault ATA, one getMultipleAccountsInfo | Exact on-chain state |

**Key insight:** pump ships breaking changes on short notice. Every amount comes from the SDK or a simulation, and every landed amount comes from a meta delta. The engine owns only sequencing, idempotency and records.

## Runtime State Inventory

Not a rename or migration phase, so this section is mostly empty. Two live-state facts matter:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Dev DB: 6 coins / 26 trades. Staging: 2 coins / 13 trades (read-only count, 2026-10-25). Each has a nonzero curve creator bucket (devnet coin F9DVpq... 902,032 BONDR; GoJKjY... 518,123 BONDR) and no W BONDR ATA. | New coin columns default to 0. `fees_unclaimed` is backfilled by the first trade after deploy, or the boot pass reads each curve's `creatorFee` once (one getMultipleAccountsInfo). |
| Live service config | Railway staging worker env: add `FEE_ENGINE=on` and the per-network config; web adds `FEE_WINDOW_MS` only if non-default (it never is on staging). | Manual Railway variable set (routine, reversible). |
| OS-registered state | None: verified, no cron or launchd; all scheduling is in-process. | None |
| Secrets/env vars | No new secrets. `buyback` derives from the existing `MASTER_SEED`. A Sender API key is optional and can reuse `helius_api_key` (must be redacted). | `.env.example` gains `FEE_ENGINE`, `FEE_WINDOW_MS`, `FEE_BATCH_HOUR_UTC` |
| Build artifacts | None | None |

## Common Pitfalls

### Pitfall 1: NULL breaks a unique (mint, kind, window) index
**What goes wrong:** `window_index` is null for once-per-coin kinds, and Postgres treats NULLs as distinct, so two pending `forced_bond` rows both insert. **How to avoid:** use partial unique indexes per kind group with non-null columns (below). Neon is Postgres 18.6 (probed), so `NULLS NOT DISTINCT` exists, but drizzle 0.45 only exposes `nullsNotDistinct()` on unique *constraints*, not partial unique indexes.

### Pitfall 2: Crash between pending insert and broadcast
**What goes wrong:** the row is pending and the tx never left. **How to avoid:** do not store the wire. Recovery runs `nextState`: unseen and still within `lastValidBlockHeight` means poll; past it, one history recheck, then `expired`. The job is re-derived from chain on the next trigger.

### Pitfall 3: Stale `fees_unclaimed` after a collect
**What goes wrong:** the coin row still shows the pre-collect bucket until the next trade, so the budget double-counts. **How to avoid:** when a `collect` lands, set `fees_unclaimed = 0` where `last_slot <= collect slot`.

### Pitfall 4: A third party sweeps the curve bucket
`sweep_creator_fee` takes any payer (collectIxs' comment: "Collect is permissionless"). A foreign sweep drops `creatorFeeUnclaimed` while the fees sit in W's creator vault. `collectIxs` still claims both, so the budget estimate is only conservative. Accept it. (A3)

### Pitfall 5: WR-08, forcedBondIxs minOut equals W's whole balance
`packages/core/src/bond.ts:78-88`: `simOut` is W's post balance, so any leftover child token in W makes `minOut` unreachable and every later forced bond reverts. Fix: read W's child ATA balance before simulating, set `minOut = simOut - pre`, and keep burning `simOut`. Add one unit check on the arithmetic and let the fork row prove it.

### Pitfall 6: The 10-slot complete-to-migrate window
Between `CompleteEvent` (venue `complete`) and `CreatePoolEvent` (venue `pool`), nothing post-bond can run (`quoteVenue` throws `AwaitingMigration`). Hook migration work on the venue moving to `pool` only. A forced bond whose completing tx lands is followed by the keeper's migration. The fork has no keeper, so the fork stage calls `migrateIxs` itself (as in `pool.ts`).

### Pitfall 7: Devnet rent and W at 0 lamports
Devnet rent: 0 B is 650,240 lamports, 165 B is 1,488,440, and 170 B is 1,513,840 (probed). The fork uses mainnet rent (890,880 for 0 B). W holds 0 lamports today. Split, sweep and burn need W or buyback only as a read-only signer, so probably no float is needed (A4). Buys and the config charge rent to W, so float those with live `wFloat`.

### Pitfall 8: Helius free tier paces sends
Helius free allows about 1 send per second. Use `pace(1100)` on devnet, as in `settle.ts`. The engine shares the process-wide `pace`.

### Pitfall 9: `getMinimumDistributableFee` is SOL-only
pump-sdk 4.1.0 `onlineSdk.ts`: "The only view the program has; a quote-aware one is a program change" (`feesQuoteMint: NATIVE_MINT`). For BONDR, read pending as `Pool.creatorFees` + AMM vault ATA + pump vault ATA of `feeSharingConfigPda(mint)`.

### Pitfall 10: Hooks during the gap fill
`arm(..., live=false)` runs for gap-filled history. The engine must take the newest state (patches are slot-guarded) and never fire a forced bond from a stale gap-fill trade: the D-15 fresh re-check covers it.

### Pitfall 11: Two devnet workers on one ops wallet
Local dev and staging both sign with the same devnet ops (Phase 1 ids). Their DBs differ, so their coins differ, but keep `FEE_ENGINE=off` in the local `.env` by default and turn it on only for the e2e run.

### Pitfall 12: Sender silently drops a tx without the tip or the price
Both a tip transfer and `setComputeUnitPrice` are required, or the tx is rejected (400 "Missing tip, priority fee"). `budget()` already adds the price. The unit check asserts both are present.

## Code Examples

### Ledger schema (drizzle, follows schema.ts conventions)
```typescript
// Source: packages/core/src/schema.ts patterns (launches_landed_mint partial unique, big customType)
export const feeLedger = pgTable("fee_ledger", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  kind: text().notNull(),
  mint: text().references(() => coins.mint),          // null: platform (buyback_burn)
  state: text(),                                        // null for held / reconcile_diff (no tx)
  amount: big(),                                        // base units of the mint moved (W's |delta| for W txs)
  burned: big(),                                        // tokens burned (coin units; BONDR for buyback_burn)
  sol: big(),                                           // lamports at landing: toSol(bondr amount, bondrPrice.get())
  signature: text(),
  lastValidBlockHeight: bigint({ mode: "bigint" }),
  windowIndex: integer(),
  ref: bigint({ mode: "number" }),                      // split_treasury -> its collect row id
  detail: jsonb(),                                      // held reason, shares, distribute split, diff
  error: text(),
  createdAt: tstz().notNull().defaultNow(),
  landedAt: tstz(),
}, (t) => [
  check("fee_ledger_kind", sql`kind in ('collect','split_treasury','sweep_buyback','sweep_treasury','forced_bond',
    'pool_burn','buyback_burn','finalize_config','finalize_update','distribute','held','reconcile_diff')`),
  check("fee_ledger_state", sql`state in ('pending','landed','failed','expired')`),
  check("fee_ledger_tx", sql`(state is null) = (kind in ('held','reconcile_diff')) and (state is null) = (signature is null)`),
  check("fee_ledger_landed", sql`(state = 'landed') = (landed_at is not null)`),
  check("fee_ledger_ref", sql`(kind = 'split_treasury') = (ref is not null)`),
  check("fee_ledger_window", sql`kind not in ('sweep_buyback','sweep_treasury') or window_index is not null`),
  check("fee_ledger_platform", sql`(mint is null) = (kind = 'buyback_burn')`),
  // D-08, live = pending or landed, so a second intent fails before anything is signed or sent:
  uniqueIndex("fee_ledger_once").on(t.mint, t.kind).where(sql`state in ('pending','landed') and kind in ('forced_bond','pool_burn','finalize_config','finalize_update')`),
  uniqueIndex("fee_ledger_bond_burn").on(t.mint).where(sql`state in ('pending','landed') and kind in ('forced_bond','pool_burn')`),
  uniqueIndex("fee_ledger_sweep").on(t.mint, t.kind, t.windowIndex).where(sql`state in ('pending','landed') and kind in ('sweep_buyback','sweep_treasury')`),
  uniqueIndex("fee_ledger_split").on(t.ref).where(sql`state in ('pending','landed') and kind = 'split_treasury'`),
  uniqueIndex("fee_ledger_sig_kind").on(t.signature, t.kind),
  index("fee_ledger_public").on(t.mint, t.landedAt.desc(), t.id.desc()).where(sql`state = 'landed'`),
]);
```
Generate with `pnpm --filter @bondr/core exec drizzle-kit generate --name fee_ledger`. The root `db:generate` hardcodes `--name init`, so use the explicit name, as 0003 and 0004 did. Railway runs the migrations as the web pre-deploy (`migrate.ts`).

### Coin columns (D-23)
`fee_budget big default 0`, `fees_unclaimed big default 0`, `cost_to_complete big` (null until a trade), `bondr_sol double`, `to_buyback big default 0` + `to_buyback_sol`, `to_treasury` + `_sol`, `bond_spent` + `_sol`, `bond_burned big default 0`, `deployer_earned` + `_sol`, `finalize text default 'none' check in ('none','held','done')`, `deployer_bps smallint`, `creator_fee_bps smallint`. The supply-burned % is computed in core `coinRow` from `bond_burned` plus the launch burn row's tokens, over `SUPPLY` (A5).

### Reconciliation SQL (FEE-09)
```sql
select mint, sum(case kind when 'collect' then amount when 'finalize_config' then amount when 'finalize_update' then amount
  else -amount end) as implied
from fee_ledger where state = 'landed' and mint is not null
  and kind in ('collect','split_treasury','sweep_buyback','sweep_treasury','forced_bond','pool_burn','finalize_config','finalize_update')
group by mint;
-- buyback: sum(sweep_buyback.amount) - sum(buyback_burn.burned)
```
Dust rule: |implied - chain| ≤ 0 base units for W. Every amount is a meta delta, so the match should be exact. Any donation to W shows up as a diff, by design.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Creator fees paid to the creator vault per trade | v3 trades accrue to the curve's `creatorFee` bucket, reported on `TradeEvent.creatorFeeUnclaimed`; a sweep moves the bucket | pump-sdk 4.x (pinned) | The trigger reads one event field; `collectIxs` sweeps first (Phase 1 Pitfall 6) |
| PumpSwap v1 buys | `buy_v2` / `buy_exact_quote_in_v2` leave creator fees in `Pool.creatorFees` | pump-swap-sdk 2.x | Distribution must sweep the pool bucket; pending = `Pool.creatorFees` + vaults |
| Sender min tip 0.0002 SOL (older docs) | 0.001 SOL "Sender Max"; 0.000005 SOL with `?swqos_only=true` | Helius docs, current | Config value `SENDER_TIP_LAMPORTS`; re-verify at Phase 7 |

**Deprecated/outdated:** `exactBondIxs` is evidence-only. Keep it for the spike's `bond.exact` row, and never call it from the engine.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Helius Sender is mainnet-only, and its minimum tip is 0.001 SOL (Sender Max) | Pattern 7 | Tip too low means drops at go-live. Mitigation: config value, unit-checked only, re-verified in Phase 7 (owner-gated) |
| A2 | `buyExactQuoteInV2Instructions` + BurnChecked(simulated out) works for the fallback like the proven buy_v2 path | Pattern 5 | Fork row fails; fall back to the proven `poolBuyBurnIxs`, and the closing sweep takes the unspent budget |
| A3 | Anyone can call `sweep_creator_fee`, so `creatorFeeUnclaimed` can drop without our collect | Pitfall 4 | None for safety (collect claims the vault too); only the displayed budget reads low |
| A4 | W and buyback at 0 lamports can sign transferChecked and BurnChecked as read-only owners without a float | Pitfall 7 | The first devnet split fails preflight (no spend). Add `wFloat(conn, W, [0])` as the spike did |
| A5 | "Supply burned" includes the launch insta-burn tokens plus the bond burn | Coin columns | Display only; the UI-SPEC is silent. The planner can count bond burns only |
| A6 | W's post-bond, pre-update fees (paid to W by the update's inner distribution) go 90/10 buyback/treasury in a closing sweep, not 80/20 | Pattern 6 | Policy choice; the amount is minutes of pool fees. Owner may prefer to distribute them 80/20. Recorded publicly either way |
| A7 | BONDR (pump Token-2022 coin) has no extension blocking an owner burn | FEE-06 | Phase 1 burned child coins of the same mint type, so low risk. The devnet e2e proves it |
| A8 | Distribution minimum = 100 × (5,000 + priority) lamports, about 0.001 SOL rounded up | D-19 | Too low wastes ops; too high delays payouts. Only exercised on the fork in this phase |

## Open Questions (with recommendations)

1. **Collect and split in one tx?** Recommendation: two txs, as proven. The second tx is idempotent through the `ref` unique index. Cost about 5,000 lamports.
2. **SOL value source.** Recommendation: the BONDR price at landing (`bondrPrice.get()`, in memory, no RPC) via `toSol`. It is stored on the row and never revalued.
3. **Per-network floors and minimums.** Recommendation:
   - `OPS_FLOOR_LAMPORTS`: 0.05 SOL on devnet (the existing build.ts value; devnet ops holds 2.75 SOL). Mainnet is set in Phase 7.
   - `COLLECT_MIN_LAMPORTS` (the value of `fees_unclaimed`, and of the budget for a sweep): 10,000 on devnet, about 1/3 of one 0.01 SOL e2e trade's fee. 1,000,000 on mainnet and the fork.
   - `DISTRIBUTE_MIN_LAMPORTS`: 1,000,000.
   - `SENDER_TIP_LAMPORTS`: 1,000,000.
4. **Batch hour.** Recommendation: `FEE_BATCH_HOUR_UTC=4`, plus a bearer `POST /fee/batch` so the e2e and the owner can run it now.
5. **Held release.** Recommendation: a bearer `POST /fee/release {mint, deployer}`. The owner names the deployer after a manual check. The engine re-runs only the differ and on-curve checks against that address, then finalizes. The call is logged.
6. **Devnet spend under 0.1 SOL.** Estimate:
   - Each coin with fees: W ATA 0.0015 SOL once plus about 3 tx fees per window that has fees.
   - Platform, once: treasury plus buyback BONDR ATAs, 0.003 SOL.
   - The e2e coin's launch table: about 0.006 SOL.
   - With 8 existing coins plus 2 e2e coins, about 0.03 SOL.

   Recommendation: the e2e script prints ops before and after, as devnet-trades does, and fails above budget.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | worker, scripts | yes | 24.13.0 | — |
| pnpm | all | yes | 10.34.6 | — |
| Surfpool | fork rows | yes (`.cache/surfpool/surfpool`), not running | 1.6.1 | `pnpm spike:fork-up` |
| Helius devnet RPC + WS | devnet e2e, staging | yes (key in .env, probed read-only) | — | — |
| Neon (dev + staging branches) | ledger | yes | Postgres 18.6 | — |
| Railway CLI | staging env vars | yes | — | dashboard |
| Devnet ops balance | spend | 2.7508 SOL | — | owner tops up by hand |
| Helius Sender | mainnet only | not used this phase | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (units, DB-backed tests skip without DATABASE_URL); Playwright 1.63.0 + axe 4.13.0 (UI, devnet e2e with `E2E_DEVNET=1`); spike runner (fork rows, `pnpm spike:check`) |
| Config file | none for Vitest (defaults, `*.test.ts`); `playwright.config.ts` (`*.e2e.ts`); `scripts/spike/nets/fork.ts` |
| Quick run command | `pnpm vitest run <file>` |
| Full suite command | `pnpm test && pnpm lint && pnpm typecheck` |
| Fork gate | `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike && SPIKE_NET=fork pnpm spike:check` (about 75 s; fork runs rebuild state, so the engine stage runs inside the full fork list after `finalizeStage`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEE-01 | split = floor(delta/10) from the collect meta; no split without a collect; ref unique | unit + devnet e2e | `pnpm vitest run packages/core/src/fees.test.ts apps/worker/src/fee/ledger.test.ts` | ❌ Wave 0 |
| FEE-02 | trigger105 on budget + 90% unclaimed; costFromReserves equals the SDK cost; WR-08 minOut | unit + fork | `pnpm vitest run packages/core/src/curve.test.ts packages/core/src/math.test.ts`; fork row `engine.forced` | math.test ✅, others ❌ |
| FEE-02 | Sender path: devnet plain, mainnet tip + price + allowlist | unit | `pnpm vitest run apps/worker/src/fee/send.test.ts` | ❌ Wave 0 |
| FEE-03 | fallback burn on migration, W ends 0 child | fork | fork row `engine.pool.burn` | ❌ |
| FEE-04 | window index and next end from launchedAt; no retroactive window; zero budget writes no row | unit + devnet e2e | `pnpm vitest run packages/core/src/fees.test.ts` | ❌ Wave 0 |
| FEE-05 | deployer pre-flight (equal, differ, on-curve); finalizeState; closing sweep | unit + fork | `pnpm vitest run packages/core/src/fees.test.ts`; fork rows `engine.finalize.config`, `engine.finalize.update` | ❌ |
| FEE-06 | buyback burn row, supply drop equals burned | devnet e2e | `E2E_DEVNET=1 pnpm e2e apps/web/e2e/fee-devnet.e2e.ts` | ❌ |
| FEE-07 | distribute above the minimum, 80:20 within 1 unit | fork | fork row `engine.distribute` | ❌ |
| FEE-08 | ops floor from `postBalances[0]` pauses non-urgent jobs only | unit | `pnpm vitest run apps/worker/src/fee/engine.test.ts` | ❌ |
| FEE-09 | implied vs chain diff writes reconcile_diff | unit (pure diff) + DB | `pnpm vitest run apps/worker/src/fee/batch.test.ts` | ❌ |
| D-08 | pending recovery: landed, expired, poll; a second intent is refused by the index | unit + DB-backed | `pnpm vitest run apps/worker/src/fee/recover.test.ts packages/core/src/db.test.ts` | db.test ✅ (extend) |
| TOKEN-03/04/05 | panel, ledger, totals, rail, hero; axe 0 at 390/768/1440 | e2e (seeded) | `pnpm e2e apps/web/e2e/fee-ledger.e2e.ts apps/web/e2e/responsive-fee.e2e.ts` | ❌ |
| TOKEN-04 | every public kind maps to copy; held and buyback_burn do not | unit | `pnpm vitest run apps/web/lib/ledger-copy.test.ts` | ❌ |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched test files>` plus `pnpm lint`.
- **Per wave merge:** `pnpm test && pnpm lint && pnpm typecheck`. After a chain wave, also run the fork gate.
- **Phase gate:**
  - the full suite
  - the fork gate (all `engine.*` rows PASS, W child = 0)
  - `E2E_DEVNET=1` with `FEE_WINDOW_MS=600000` locally
  - the staging matrix
  - the ops spend printout under 0.1 SOL

  All green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/core/src/fees.test.ts`: window math, sweep 90/10 floor, deployer pre-flight, distribution min, totals map
- [ ] `packages/core/src/curve.test.ts`: costFromReserves against a fixture-derived curve (devnet `curve-buy` reserves + fork `complete`)
- [ ] `packages/core/src/trades.test.ts`: extend with `feesUnclaimed` from fixtures (curve-buy: 211320574291; forced-bond: 1905959520314)
- [ ] `packages/core/src/send.test.ts`: extend with `signTx` (refused program, oversize, signature slot 0)
- [ ] `apps/worker/src/fee/{send,engine,recover,batch,ledger}.test.ts`: in-memory LedgerStore; DB-backed parts skip without DATABASE_URL
- [ ] `scripts/spike/stages/engine.ts` + rules; the line in `nets/fork.ts` after `finalizeStage`
- [ ] `apps/web/e2e/fee-ledger.e2e.ts` (seeded rows via `fixtures.ts`), `fee-devnet.e2e.ts`, `responsive-fee.e2e.ts`

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (worker routes) | Existing bearer `authorized()` (timingSafeEqual) on `/fee/release`, `/fee/batch` |
| V3 Session Management | no | — |
| V4 Access Control | yes | Engine transfers only to derived treasury/buyback ATAs or the on-chain deployer; `checkMessage` program allowlist |
| V5 Input Validation | yes | Ledger route: base58 mint (`BASE58_KEY`), cursor regex and int8 range (as `parseCursor`); release body: base58 deployer, on-curve |
| V6 Cryptography | yes | `derive` HMAC (existing); never hand-roll |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Double send after a crash (double sweep or burn) | Tampering | Intent-first rows + partial unique indexes + no resend of unknown |
| Wrong deployer locked into the permanent 80/20 | Elevation | Pre-flight: CreateEvent user = launches.wallet, three-way differ, on-curve; held, never auto-retried |
| Front-run between simulate and land | Tampering | minOut = simulated delta (revert, not overburn); re-simulate on retry |
| Secrets in logs (seed, RPC key, Sender api-key) | Info disclosure | `redact()` on every error; Sentry `scrub` |
| Public exposure of held reasons or reconcile diffs | Info disclosure | Ledger read selects only landed public kinds; `held`/`reconcile_diff`/`buyback_burn` never leave the server |
| Ops drained by fee spam | DoS | Collect only before needed splits (D-11); per-network minimums; ops floor pauses non-urgent jobs |

## Sources

### Primary (HIGH confidence)
- This repo:
  - `packages/core/src/{collect,bond,sharing,send,keys,curve,events,trades,trade,price,math,schema,api,coin-row}.ts`
  - `apps/worker/src/{main,ingest,stream,events-route,settle,launches,build,env,sentry,trade-prepare}.ts`
  - `scripts/spike/stages/{prebond,bond,pool,finalize}.ts`, `nets/fork.ts`, `run.ts`
  - `apps/web/lib/{launches,trades,coins,live-hub,use-live}.ts`
- Pinned SDK sources:
  - `@pump-fun/pump-sdk@4.1.0`: `state.ts` TradeEventBc `creatorFeeUnclaimed`; `bondingCurve.ts` `getBuyV3QuoteAmountFromTokenAmount`, `v3Rates`; `onlineSdk.ts` `getMinimumDistributableFee`, `buildDistributeCreatorFeesInstructions`
  - `@pump-fun/pump-swap-sdk@2.1.0`: `offlinePumpAmm.ts` `buyExactQuoteInV2Instructions`; `types/sdk.ts` `Pool.creatorFees`
- Fixture decode, run in this session: devnet 30 bps and `creatorFeeUnclaimed` present; fork 150 bps.
- Read-only devnet RPC (this session):
  - BONDR 4Jw2pr... is Token-2022, 6 decimals, 1e15 supply
  - FeeConfig flat creator 30 bps, protocol 95 bps; `creatorFeeConfigurable` false
  - W ATAs missing, W at 0 lamports
  - rent values
  - ops 2.7508 SOL
- Neon read-only count: dev 6 coins, staging 2; Postgres 18.6.
- `.planning/phases/01-chain-spike/01-05..01-10-SUMMARY.md`, STATE.md blockers and WR-08.

### Secondary (MEDIUM confidence)
- [Helius Sender docs](https://www.helius.dev/docs/sending-transactions/sender): endpoints, 10 mainnet-beta tip accounts, 0.001 SOL / 0.000005 SOL swqos_only tips, a tip and a priority fee required, ping endpoint
- [Helius Sender sendTransaction API reference](https://www.helius.dev/docs/api-reference/sender/sendtransaction): skipPreflight optional, maxRetries "should be set to 0"

### Tertiary (LOW confidence)
- [Helius Sender agent skill page](https://www.helius.dev/docs/agents/mcp/skills/sender) and the localized pages: older 0.0002 SOL tip figure (conflicts with the current page)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Nothing new; versions read from the lockfile tree.
- Architecture: HIGH. Every hook point, builder and pattern read in code; the boot ordering follows `main.ts`.
- Chain facts: HIGH on devnet and fork (probed or decoded this session). MEDIUM on Sender (docs conflict, mainnet-only, Phase 7).
- Pitfalls: HIGH. Most come from this repo's own review notes and probes.

**Research date:** 2026-10-25
**Valid until:** 2026-11-08. pump ships breaking changes on short notice, so re-verify against pump-public-docs before execution.
