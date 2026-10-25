# Roadmap: BONDR

## Overview

BONDR goes from proof to production in seven vertical slices. First, a mainnet-fork spike proves every pump assumption with real transaction signatures. Next comes the one-transaction launch where the dev never holds supply. Then the indexer, lists and live token page, then trading through multi_hop_swap. After that, the worker fee engine with the public ledger that carries the core trust claim, then the owner's admin dashboard for recovery and safety. The last phase is go-live: ops hardening and the BONDR token launch that unlocks child launches.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Chain Spike** - Prove every pump assumption on a Surfpool mainnet fork, each step with a signature (completed 2026-10-19)
- [x] **Phase 2: Launch Flow** - Phantom connect, consent, launch form, one-tx launch with server co-sign, bare token page (completed 2026-10-23)
- [x] **Phase 3: Indexer, Lists and Token Page** - Trade ingestion, home lists, search, chart, trade feed, live updates, share cards (completed 2026-10-24)
- [x] **Phase 4: Trading** - Buy and sell panel via multi_hop_swap with quote preview and slippage, pre and post bond (completed 2026-10-24)
- [x] **Phase 5: Fee Engine and Public Ledger** - Worker runs split, forced bond, fallback burn, sweeps, finalize; ledger on the token page (completed 2026-10-25)
- [ ] **Phase 6: Admin Dashboard** - Owner-only recovery actions, kill switches, health, moderation, inspector, audit log, EVACUATE
- [ ] **Phase 7: Go-Live** - Contract check, CI, scripts, mainnet config, BONDR token launch gating child launches

## Phase Details

### Phase 1: Chain Spike

**Goal:** As the owner, I want every pump step proven on a mainnet fork, so that I build on facts, not docs.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** SPIKE-01, SPIKE-02, SPIKE-03, SPIKE-04, SPIKE-05
**Success Criteria** (what must be TRUE):

  1. Owner runs one script on a Surfpool fork and gets a signature for a create_v2 with creator = W, a stand-in pump-coin quote and creator_fee_bps 150
  2. Owner sees create + dev buy + insta sell, and separately create + dev buy + insta burn, land as single transactions with measured byte size and compute units under the limits
  3. Owner sees a forced-bond buy_exact_quote_in_v3 + burn complete a curve in one transaction, and a post-migration PumpSwap buy + burn, each with a signature
  4. Owner sees create_fee_sharing_config + one update_fee_shares_v2 set deployer 8000 / treasury 2000, a second update rejected, and distribution paying both
  5. Owner opens a bare page that lists every spike step with its signature, including a multi_hop_swap buy and sell SOL to stand-in to coin; any failed step forces a PROJECT.md change before Phase 2

**Plans:** 10/10 plans complete

Plans:

- [x] 01-01-PLAN.md - Walking skeleton part 1: phase branch, workspace, packages/core pump loader, network guard, key derivation, idempotent key generation
- [x] 01-02-PLAN.md - Walking skeleton part 2: results contract, run loop, live devnet config stage, checker, failure-tolerant static page
- [x] 01-03-PLAN.md - Devnet funding checkpoint, send path, stand-in and child create (creator = W), one-tx launches with per-coin lookup table
- [x] 01-04-PLAN.md - Surfpool fork up/down, fork config, 150 bps child create, fork launches
- [x] 01-05-PLAN.md - Devnet multi_hop_swap, fee sharing on an unbonded coin with rejected second update, 6107
- [x] 01-06-PLAN.md - Fork sim trades, creator fee collect, 90/10 split
- [x] 01-07-PLAN.md - Fork forced bond + burn, buy_v3 exact variant, migrate_v2, PumpSwap buy + burn
- [x] 01-08-PLAN.md - Fork finalize: sharing config, single 8000/2000 update, rejected update, distribution 80:20
- [x] 01-09-PLAN.md - Fork 6107 on a complete stand-in, stand-in migration, multi_hop_swap through the pool
- [x] 01-10-PLAN.md - One-command full run that always writes the page, devnet refresh, committed evidence, PROJECT.md changes, owner sign-off

### Phase 2: Launch Flow

**Goal:** As a dev, I want to launch a coin in one Phantom signature, so that buyers see I hold zero launch supply.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** PLAT-01, PLAT-02, PLAT-03, PLAT-04, LAUNCH-01, LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, LAUNCH-06, LAUNCH-07, FEE-10, OPS-01
**Success Criteria** (what must be TRUE):

  1. User connects and disconnects Phantom (the only wallet offered) from any page, and must accept a consent prompt linking to a short terms page before BONDR stores anything about their wallet
  2. Dev fills name, symbol, image, description and optional links, and the launch button stays disabled until the dev buy is at least the live minimum (0.25 SOL mainnet, about 0.0025 SOL devnet) and insta sell or insta burn is chosen
  3. Dev signs one Phantom transaction that creates a `bndr` mint with creator = that coin's W, with metadata and image already pinned on Pinata, and buys then sells or burns the dev buy; a tampered message or one missing the exit gets no mint co-signature
  4. Dev sees the success screen within 5 seconds of confirmation, showing "Dev holds 0 launch supply", the exit transaction link, the full contract address with a copy button, and a button to the coin's token page
  5. Dev sees a clear paused banner with the Launch button disabled (the form stays fillable, owner decision 2026-10-19) when launches are paused (launch flag off, or BONDR awaiting migration), and the launch pages work at mobile, tablet and desktop widths
  6. Errors thrown in web and worker show up in Sentry (moved from Phase 7 on owner approval, 2026-10-19)

**Plans:** 18/18 plans executed

Plans:

- [x] 02-01-PLAN.md - Web scaffold: Next.js 16, BONDR tokens and visual system, header and footer, Biome web import rule, web env allowlist, quick-run latency measured
- [x] 02-02-PLAN.md - Playwright harness (no root secrets in the web server) and the terms page with its e2e
- [x] 02-03-PLAN.md - BONDR-pool route in the launch builder (D-18), proven on the Surfpool fork with the stand-in migrated; pool-sell fixture captured
- [x] 02-04-PLAN.md - Owner checkpoint: Neon and Sentry projects; shared schema, client and first migration
- [x] 02-05-PLAN.md - Phantom connect and disconnect, consent dialog and consent API
- [x] 02-06-PLAN.md - Worker: env and mainnet guard, private bearer HTTP server, live /status and /quote; contract types, shared rules module, minimum math
- [x] 02-07-PLAN.md - Launch page and step 1 (Coin): UI primitives, stepper, state machine
- [x] 02-08-PLAN.md - Steps 2 and 3, receipt with live fees, paused state, web status and quote routes
- [x] 02-09-PLAN.md - Seed-derived bndr vanity pool: reservation, grinder, local pre-fill
- [x] 02-10-PLAN.md - Pinata pin route and rate limits (pin, quote, consent)
- [x] 02-11-PLAN.md - Worker prepare: table, build, simulate, insta-sell floor; web prepare route; devnet driver with budgets, size and prepare proof
- [x] 02-12-PLAN.md - Co-sign (sign order A), submit and settle; devnet launches for both exits and a refused tamper
- [x] 02-13-PLAN.md - Step 4 sign and step 5 success screen with copy CA and the error-code mapping; launch e2e on devnet
- [x] 02-14-PLAN.md - Sentry on web and worker with address scrub, web boot guard, client bundle gate
- [x] 02-15-PLAN.md - Bare token page /coin/[mint] with the proof and contract address
- [x] 02-16-PLAN.md - Owner checkpoint: Railway staging deploy (web public, worker private), seed copy, staging smoke
- [x] 02-17-PLAN.md - Responsive and axe matrix (36 screenshots per target), staging launch, Designer critique and audit with blockers fixed
- [x] 02-18-PLAN.md - Owner-approved staging redeploy, staging rerun, owner sign-off with a real Phantom launch

**UI hint**: yes

### Phase 3: Indexer, Lists and Token Page

**Goal:** As a trader, I want live lists and charts of every BONDR coin, so that I can find and judge coins.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** LIST-01, LIST-02, LIST-03, LIST-04, LIST-05, TOKEN-01, TOKEN-02, TOKEN-06
**Success Criteria** (what must be TRUE):

  1. User sees Trending (1h quote volume), Top (market cap), Latest and Oldest lists of BONDR-launched coins only, each row with image, name, symbol, market cap, 1h change, bond progress and age
  2. List rows and the token page update live over SSE when a trade lands, without a reload
  3. User finds a coin by name, symbol or mint through search
  4. User sees a lightweight-charts price chart with 1m, 5m, 1h and 1d candles, a live trade feed and the holder count on the token page
  5. A token link shared on X or Telegram renders a preview card with the coin's OG image

**Plans:** 15/15 plans complete

Plans:
**Wave 1**

- [x] 03-01-PLAN.md - Wave 0: wsUrl, fixture capture, devnet trade generator, stream probe (A1, A2, A8) and trade fixtures
- [x] 03-03-PLAN.md - Share card (TOKEN-06): static OG fonts, coin and site cards, metadataBase and SITE_URL

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md - TDD: PumpSwap and migration event decoding, price and market cap math (D-22), parseTx

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-04-PLAN.md - coins and trades tables (migration 0003), idempotent ingest, BONDR price in memory, launch backfill

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-05-PLAN.md - Token page trade feed with Launch rows and keyset Load more; Phase 3 number formats
- [x] 03-07-PLAN.md - Live ingestion: one logsSubscribe, gap fill, throttled holder recount, devnet proof

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-06-PLAN.md - Token page stats, holders, venue tag and curve-only Bond and burn panel
- [x] 03-08-PLAN.md - Live pipe: worker NDJSON events, web hub with replay, SSE route with limits

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03-09-PLAN.md - Live token page: useLive, flash, live feed, stats and bond panel, devnet live e2e

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03-10-PLAN.md - Market cap chart (TOKEN-01): lightweight-charts 5.2.1, candles on read, intervals, live candle

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 03-11-PLAN.md - Home: hero with counts, All coins grid with Top / Latest / Oldest, header Launch link

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 03-12-PLAN.md - Search by name, symbol or mint, and the Trending scroller with the D-13 fallback

**Wave 10** *(blocked on Wave 9 completion)*

- [x] 03-13-PLAN.md - Live home lists: flash, once-a-minute re-rank, new launches in Latest

**Wave 11** *(blocked on Wave 10 completion)*

- [x] 03-14-PLAN.md - Responsive and axe matrix with screenshots, Designer critique with blockers fixed

**Wave 12** *(blocked on Wave 11 completion)*

- [x] 03-15-PLAN.md - Owner checkpoint: staging deploy, staging checks, owner sign-off

**UI hint**: yes

### Phase 4: Trading

**Goal:** As a trader, I want to buy and sell BONDR coins with SOL in one signature, so that I never leave the page.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** TRADE-01, TRADE-02, TRADE-03, TRADE-04
**Success Criteria** (what must be TRUE):

  1. User buys a coin with SOL, routed SOL to BONDR to coin through multi_hop_swap, in one Phantom signature, and the trade shows in the feed
  2. User sells a coin back to SOL the same way
  3. User sees tokens out, price impact and fees in a quote preview, and sets slippage before signing
  4. Buy and sell work on a curve coin and on a migrated PumpSwap coin, and the fees charged match pump's live FeeConfig with no platform fee added

**Plans:** 13/13 plans complete

Plans:
**Wave 1**

- [x] 04-01-PLAN.md - Trade contracts, the red quote preview spec, and the masked route quote (TDD against the multi-hop fixtures)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md - Worker quote: core reader and hopInputs, 2 s per-coin cache, quote and balance handlers

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md - Quote on the token page: web quote route, shared trade state, first trade panel, page grid, UI-SPEC note
- [x] 04-04-PLAN.md - Prepare in the worker: shared error map, in-memory trade store, simulated and budgeted v0 build, devnet cap

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-05-PLAN.md - Panel controls: presets and Max, slippage, fee breakdown, 2 s refresh and 60 s pause, session balances
- [x] 04-06-PLAN.md - Submit in the worker: byte compare, send once, background settle, landed amounts, trade routes, live devnet prepare

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04-07-PLAN.md - Web prepare, submit and poll routes with an unstubbed guard spec (CSRF, session, body wallet, 429)
- [x] 04-08-PLAN.md - Mobile Quick trade bar and bottom sheet sharing the panel state
- [x] 04-09-PLAN.md - Surfpool fork rows for the PumpSwap path with pureQuote checked against landed amounts (TRADE-04)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 04-10-PLAN.md - Buy and sell end to end: trade run, button state table, result slot, one real devnet buy and sell

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 04-11-PLAN.md - Every D-17 result, impact and migration callouts, quote failure, the live region

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 04-12-PLAN.md - Responsive and axe matrix at 390, 768, 1440 with Designer critique and fixes

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 04-13-PLAN.md - Staging deploy (worker then web), staging specs, one real devnet buy and sell on staging; real-Phantom trade as a manual check

### Phase 5: Fee Engine and Public Ledger

**Goal:** As a holder, I want every fee movement shown with a transaction link, so that I can verify none went to the dev.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** FEE-01, FEE-02, FEE-03, FEE-04, FEE-05, FEE-06, FEE-07, FEE-08, FEE-09, TOKEN-03, TOKEN-04, TOKEN-05
**Success Criteria** (what must be TRUE):

  1. Without manual help, the worker collects each unbonded coin's creator fees, splits 90% to W and 10% to treasury, and every ledger row (collection, split, sweep, forced-bond buy, burn, finalize) shows amount, time and a transaction link
  2. When W's burn budget reaches 105% of the cost to complete the curve, one buy + burn transaction lands through Helius Sender and the coin bonds; a coin bonded by traders instead gets a PumpSwap buy + burn right after migration
  3. A coin unbonded for a full 24h window has its budget swept 90% to buyback and 10% to treasury; buyback BONDR is burned and post-bond fees are distributed on schedule; the ops wallet pays every fee and raises an alert below threshold
  4. After bond, the worker sweeps pending fees, passes the deployer pre-flight check, and runs the single 8000 / 2000 fee-share update; the token page then shows the deployer share
  5. User sees bond progress, burn budget vs cost to complete, time left in the 24h window, and totals (burned supply %, fees to burn, buyback, treasury); a nightly reconciliation records any ledger vs chain mismatch

**Plans:** 13/13 plans complete

Plans:

- [x] 05-01-PLAN.md - Failing ledger spec, fee_ledger table and coin fee columns with the D-08 constraints, contract types, pure fee rules
- [x] 05-02-PLAN.md - Coin row fee fields, server-only ledger read and route, Fee ledger panel on the token page (spec green)
- [x] 05-03-PLAN.md - Core prep: signTx, buyback role, wFloat in core, costFromReserves, unclaimed fees on the curve patch
- [x] 05-04-PLAN.md - Ledger store, intent-first land pipeline with ops floor and mainnet-only Sender, collect, split and window sweep jobs
- [x] 05-05-PLAN.md - Engine behind FEE_ENGINE: boot recovery, per-coin queue, window timers, trade hook, fee events, devnet dry run
- [x] 05-06-PLAN.md - Bond and burn unbonded panel (budget gauge, window, flow), totals and Supply burned
- [x] 05-07-PLAN.md - Forced bond and PumpSwap fallback burn with the WR-08 fix, engine triggers, fork rows
- [x] 05-08-PLAN.md - Finalize: chain-read state, deployer pre-flight, held and release, 8000/2000 update, closing sweep, fork rows
- [x] 05-09-PLAN.md - Daily batch: buyback burn, distribution crank, finalize retries, nightly reconcile, fork distribute row
- [x] 05-10-PLAN.md - Bonded panel, bonded totals, live fee events, trade creator copy
- [x] 05-11-PLAN.md - Home Next to bond rail and the bonded-by-their-own-fees hero line
- [x] 05-12-PLAN.md - Real devnet engine e2e with the spend cap, token page responsive and axe matrix, engine runbook
- [x] 05-13-PLAN.md - Staging: migrate, worker then web, FEE_ENGINE=on, staging matrix, Neon idle check

**UI hint**: yes

### Phase 6: Admin Dashboard

**Goal:** As the owner, I want one dashboard to see and fix every coin and job, so that nothing needs a manual script.
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-07, ADMIN-08, ADMIN-09, ADMIN-10, ADMIN-11
**Success Criteria** (what must be TRUE):

  1. Only the allowlisted wallet can sign in, sessions expire after 30 minutes, and every money-moving action asks for a fresh signature
  2. Owner sees treasury, buyback and ops balances, every W with its state, platform totals, health (heartbeat, leader lock, last run per job, RPC latency and errors, Sentry issue count, vanity pool size), and a per-coin timeline with next expected step and retry
  3. Owner runs each of the 11 recovery actions, each simulating first with balance changes shown, limited to burn, treasury, buyback or that coin's deployer, and each written to the audit log with actor, time, simulation and signature
  4. Owner flips per-job kill switches (launches, forced bond, sweeps, finalize, buyback burn), hides a coin from lists, blocks a deployer from launching, and inspects any pasted signature's decoded instructions, error and explorer link
  5. Owner runs EVACUATE by typing the phrase and signing; all jobs pause and every W balance moves to the treasury

**Plans:** 6/26 plans executed

Plans:

**Wave 1**

- [x] 06-01-PLAN.md - Red sign-in spec, admin e2e harness, migration 0007 (switches, hidden/held, blocked_deployers, admin_audit, kinds, sig-kind index)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md - Contracts: admin payload types, error codes, leftover_burn and evacuate kinds with copy and totals, scrub, STATE todo

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md - Admin sign-in with Phantom, 30-minute bondr_admin cookie, guarded /api/admin/[op], console shell
- [x] 06-04-PLAN.md - Multi-mint fee ledger fixes (sig-kind key, per-row sol, per-mint publish, evacuate in reconcile), fee-ledger-memory split
- [x] 06-05-PLAN.md - TDD: intent store with fresh-signature check, destination allowlist decoder

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 06-06-PLAN.md - fee-boot split, engine stuck memory, exclusive runs, idle waits, manual hold

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 06-07-PLAN.md - Five kill switches in worker memory and settings, job gates, last-run marks

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 06-08-PLAN.md - Gated worker admin routes, memory-only health (RPC ring, Sentry count), admin env
- [ ] 06-09-PLAN.md - Leftover burn, close accounts and leftover sweep jobs; finalize burns leftovers; distribute any amount

**Wave 7** *(blocked on Wave 6 completion)*

- [ ] 06-10-PLAN.md - Audit writer, switch and act routes (hold, release, re-check launch), overview and coin-live
- [ ] 06-11-PLAN.md - Capture-deps simulation with balance diff, registry of the nine transaction actions

**Wave 8** *(blocked on Wave 7 completion)*

- [ ] 06-12-PLAN.md - Forwarder, overview load, Refresh, Wallets and Health panels with the visibility-aware poll
- [ ] 06-13-PLAN.md - Worker simulate, execute (fresh signature, audit first, gated land) and intent routes

**Wave 9** *(blocked on Wave 8 completion)*

- [ ] 06-14-PLAN.md - Kill switches panel and audit log panel with keyset paging
- [ ] 06-15-PLAN.md - Fork gate: retry forced bond, run migrate, burn W tokens, finalize split, distribute now through the money path
- [ ] 06-19-PLAN.md - Moderation worker and core: hide and block with audit, hidden list filter, blocked launch refusal

**Wave 10** *(blocked on Wave 9 completion)*

- [ ] 06-16-PLAN.md - W table: state function, filters, sort, sticky Coin column, selection

**Wave 11** *(blocked on Wave 10 completion)*

- [ ] 06-17-PLAN.md - Per-coin timeline, action grid with reasons, hold, release and re-check launch

**Wave 12** *(blocked on Wave 11 completion)*

- [ ] 06-18-PLAN.md - Simulation dialog and client run: simulate, sign intent, execute, poll; Burn buyback now

**Wave 13** *(blocked on Wave 12 completion)*

- [ ] 06-20-PLAN.md - Moderation web: overview lists, Moderation panel, public blocked copy, serial spec

**Wave 14** *(blocked on Wave 13 completion)*

- [ ] 06-21-PLAN.md - Transaction inspector: worker decoder with SDK coders, route and panel

**Wave 15** *(blocked on Wave 14 completion)*

- [ ] 06-22-PLAN.md - EVACUATE worker: balances, packing, simulation totals, pause-first execute, runbook

**Wave 16** *(blocked on Wave 15 completion)*

- [ ] 06-23-PLAN.md - EVACUATE section: phrase arm, auto-simulate, sign and evacuate, simulate-only state

**Wave 17** *(blocked on Wave 16 completion)*

- [ ] 06-24-PLAN.md - Devnet run: Sweep now, Burn buyback now, Re-check launch, EVACUATE on dev coins; console-open Neon check; spend

**Wave 18** *(blocked on Wave 17 completion)*

- [ ] 06-25-PLAN.md - Responsive and axe matrix at 390/768/1440, Designer critique sign-off

**Wave 19** *(blocked on Wave 18 completion)*

- [ ] 06-26-PLAN.md - Staging: web then worker, locked-state matrix, Phase 5 and 4 regressions, Neon idle, HV-06-01 and HV-06-02

**UI hint**: yes

### Phase 7: Go-Live

**Goal:** As the owner, I want BONDR live on mainnet with guardrails, so that strangers can launch without asking me.
**Mode:** mvp
**Depends on:** Phase 6
**Requirements:** OPS-02, OPS-03, OPS-04, OPS-05
**Success Criteria** (what must be TRUE):

  1. The weekly contract check verifies pump program IDs, IDL account layouts and Global flags, and pauses jobs on a forced mismatch
  2. Every push runs lint, tests and a Playwright smoke test in CI, and `scripts/` sets up, runs, tests and deploys BONDR with one command each
  3. The BONDR token is launched on mainnet through BONDR (SOL pair, treasury as creator, insta burn), and child launches stay disabled until it exists

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1, 2, 3, 4, 5, 6, 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Chain Spike | 10/10 | Complete | 2026-10-19 |
| 2. Launch Flow | 18/18 | Complete | 2026-10-23 |
| 3. Indexer, Lists and Token Page | 15/15 | Complete   | 2026-10-24 |
| 4. Trading | 13/13 | Complete    | 2026-10-24 |
| 5. Fee Engine and Public Ledger | 13/13 | Complete    | 2026-10-25 |
| 6. Admin Dashboard | 6/26 | In Progress|  |
| 7. Go-Live | 0/TBD | Not started | - |
