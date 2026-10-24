---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 04-08-PLAN.md
last_updated: "2026-10-24T16:12:50.029Z"
last_activity: 2026-10-24
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 56
  completed_plans: 55
  percent: 43
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-19)

**Core value:** A holder can verify on the token page that the dev holds no launch supply, and see that pre-bond fees went to forcing the bond and burning supply, never to the dev.
**Current focus:** Phase 4 — Trading

## Current Position

Phase: 4 (Trading) — EXECUTING
Plan: 13 of 13
Status: Ready to execute
Last activity: 2026-10-24

Progress: [██████████] 98%

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
| Phase 02 P16 | 67 min | 3 tasks | - |
| Phase 03 P01 | 12 min | 3 tasks | 18 files |
| Phase 03 P03 | 14 min | 2 tasks | 18 files |
| Phase 03 P04 | 12 min | 3 tasks | 13 files |
| Phase 03 P05 | 11 min | 3 tasks | 14 files |
| Phase 03 P07 | 16 min | 3 tasks | 15 files |
| Phase 03 P10 | 19min | 2 tasks | 15 files |
| Phase 03 P11 | 18min | 3 tasks | 21 files |
| Phase 03 P12 | 27min | 2 tasks | 11 files |
| Phase 03 P13 | 15min | 2 tasks | 15 files |
| Phase 03 P14 | 35min | 2 tasks | 13 files |
| Phase 04 P01 | 12 min | 2 tasks | 10 files |
| Phase 04 P03 | 25 min | 2 tasks | 9 files |
| Phase 04 P04 | 8 min | 2 tasks | 11 files |
| Phase 04 P05 | 20 min | 3 tasks | 11 files |
| Phase 04 P06 | 10 min | 2 tasks | 11 files |
| Phase 04 P07 | 8 min | 2 tasks | 5 files |
| Phase 04 P08 | 25 min | 2 tasks | 8 files |
| Phase 04 P09 | 9 min | 2 tasks | 6 files |
| Phase 04 P10 | 17 min | 3 tasks | 12 files |
| Phase 04 P11 | 17min | 2 tasks | 11 files |

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
- [Phase 02]: Review CR-01: the wallet is proved once by a Phantom signMessage at consent and then read from an HMAC-signed session cookie in every launch route; staging web needs SESSION_SECRET
- [Phase 02]: Neon has a hard 500 CU-h/month quota (compute_time_seconds 1800000); hitting it suspends dev and staging until the 1st. Computes stay at 0.25 CU and nothing polls the database
- [Phase 02]: The kill switch lives in worker memory (loaded on first status read); flip it with the bearer-protected worker POST /kill-switch {enabled}, which writes the DB too. Prepare and submit re-read the DB, so a pause set in raw SQL still stops launches, but open pages show it only after the next launch attempt or a worker restart
- [Phase 02]: 02-16: staging is Railway project bondr, env staging, web public at web-staging-72bad.up.railway.app, worker private, both in US East next to Neon. railway.json is deprecated for new services, so it was deleted and the settings live on the services (IaC .railway/railway.ts deferred to Phase 7). Railway's edge overwrites a forged X-Real-IP (12 forged requests, 429 from the 11th), so web WR-03 holds
- [Phase 02]: Lookup table recentSlot is the newest rooted block below finalized: Helius devnet reports finalized equal to confirmed, so the finalized slot failed the create with "is not a recent slot"
- [Phase 02]: 02-17: staging launch CyR56jVf...bndr landed; staging matrix 37/37. ipfs.io now 429s our images (service-worker-only gateway), so coin images and on-chain metadata image links need a new gateway
- [Phase 02]: Coin images and on-chain metadata links use the owner's Pinata dedicated gateway (PINATA_GATEWAY, set on staging web 2026-10-23, inlined into the client at build); ipfs.io is the fallback. Links die with the Pinata account. Coins launched before (CyR56jVf...bndr) keep ipfs.io links
- [Phase 02]: Coin page reads are cached per process: a landed coin with facts for an hour, a miss or a coin without facts for a minute
- [Phase 03]: 03-01: A1 and A2 hold on devnet: Helius logsSubscribe mentions [BONDR] notified launches (BONDR loaded from the per-coin table), curve, multi-hop and BONDR-only trades, and getSignaturesForAddress(mint) listed them all; the 03-07 stream design stands
- [Phase 03]: 03-01: A8 fails on devnet: a child needs about 752M BONDR to complete, more than BONDR's curve holds (723M), so pool-trade and migration fixtures come from the Surfpool fork and devnet pool trades are fixture-only
- [Phase 03]: 03-01: devnet-trades --complete is a refuse-only gate (exit 2); the buy-out and pool path is not built because it cannot run on devnet
- [Phase 03]: 03-03: coin card route sets cache-control itself (immutable for a landed coin, max-age=300 site card) and is force-dynamic
- [Phase 03]: 03-03: landedCoin in lib/launches.ts is the one cached landed lookup for page, metadata and share card
- [Phase 03]: 03-04: int8 amount columns are a string customType (drizzle 0.45 bigint has no string mode)
- [Phase 03]: 03-04: BONDR identity (mint, pool) lives in worker bondr-price.ts; seedBondrPrice sets it before its first await and ingest reads bondr()
- [Phase 03]: 03-04: a coin patch applies when its mint got a newly inserted trade, or when the tx has no trade of that mint (CreatePoolEvent); no slot-order guard yet
- [Phase 03]: 03-05: the feed cursor is the last row's slot.seq; parseCursor refuses values past int8 max so a bad cursor is a 400
- [Phase 03]: 03-05: Load more ends on more=false from the server (limit 51), not on spotting the launch rows client-side
- [Phase 03]: 03-05: seeded e2e coins (e2e/fixtures.ts) have launches.created_at a year back so newest-landed-launch specs never pick one
- [Phase 03]: 03-07: coin state applies only when the trade's slot >= coins.last_slot (migration 0004); same-slot ties apply in arrival order; venue only advances
- [Phase 03]: 03-07: ingestLaunch(conn, row, tx) gap fills each new coin; the stream gap fills every coin on each websocket open
- [Phase 03]: 03-07: holder recount armed only by inserted trades, at most once per coin every 5 min; last count time in memory
- [Phase 03]: 03-10: the chart's role=img summary overlays the canvas (attribution link inside the chart breaks axe nested-interactive)
- [Phase 03]: 03-10: default candle interval is computed on the server from coins.launched_at; oklch CSS tokens go to rgba through a 1px canvas for lightweight-charts
- [Phase 03]: 03-11: list rows reuse core coinRow's select and mapping (coinRows), so cards, the token page and live events read the same numbers
- [Phase 03]: 03-11: header Launch link is an icon below 360px and the wordmark hides below 440px so the devnet header fits at 320 and 390
- [Phase 03]: 03-12: a full mint searches through listCoins q; the client opens /coin/{mint} only on an exact mint in the result (no searchByMint)
- [Phase 03]: 03-12: trending is one query ordered by 1h volume, 24h volume, newest launch; mode read from the first row; list not filtered (up to 10 cards)
- [Phase 03]: 03-13: the re-rank hold is a CSS :hover/:focus-within check on data-hold regions at tick time, re-checked after pointerleave and blur
- [Phase 03]: 03-13: home resync is one GET /api/coins?trending=1; page 0 merges in front of loaded coins, Trending is replaced
- [Phase 03]: 03-14: chart attributionLogo off; the footer "Charts by TradingView" link meets the license link requirement
- [Phase 03]: 03-14: header Launch link stays an icon with the accessible name below 360px (label does not fit at 320)
- [Phase 03]: 03-14: Top and Oldest pick up a new launch on reload or resync catch-up; Latest stays live (D-14)
- [Phase 04]: 04-01: price impact is 1 - out/spotOut per hop in floats (reserveIn/(reserveIn+netIn), curve buys capped at real tokens), so tiny trades read about 0
- [Phase 04]: 04-01: hop fee SOL is x*total/(10000+total) on a buy input and x*total/(10000-total) on a sell output; coin hop fees valued at BONDR spot
- [Phase 04]: 04-03: the token page grid at 1100px uses rows auto 1fr with the right column spanning both, so a tall Trade plus Bond column never opens a gap between chart and Trades
- [Phase 04]: 04-03: TRADE-03 and TRADE-04 stay open until slippage (04-05) and real trades (04-10) ship
- [Phase 04]: 04-04: prepareTrade takes TradeCtx (Ctx & { net }), simulates at 1.4M CU with the env price, then asks the estimator once (mainnet only) and clamps for the final ceil(units*11/10) limit
- [Phase 04]: 04-04: core trade-error.ts is the one error map for launch and trade; launch sims now map a dead blockhash to expired and 6004 to slippage
- [Phase 04]: 04-05: stored slippage is read in a mount effect so server and first client render match; useRouteQuote lives in lib/use-route-quote.ts
- [Phase 04]: 04-05: the 2 s refresh is a tick in the quote effect (no loading dim); balances load only on connect, visibilitychange and refreshBalance
- [Phase 04]: 04-06: a refused trade submit (expired, message_changed) also fails the store entry; submit re-reads the entry after the block height await so concurrent submits cannot both broadcast
- [Phase 04]: 04-07: trade submit forwards the session wallet with no web-side ownership read; the worker 404 and signer check decide, so web touches no database
- [Phase 04]: 04-08: the Quick trade bar's bottom clearance pads the footer below 1100px (body:has([data-trade-bar]) footer), since the layout footer is the page's last content
- [Phase 04]: 04-09: RESEARCH A1 closed, routeQuote equals the landed amount to the base unit on curve/pool, pool/curve and pool/pool fork routes; quote.ts unchanged
- [Phase 04]: 04-09: TRADE-04 left pending until the UI signs trades (04-10)
- [Phase 04]: 04-10: a trade the worker no longer knows (404 after a restart) is unknown with the last signature, not a failure (T8)
- [Phase 04]: 04-10: runTrade detects an account switch through wallet.onAccountChange, since the WalletApi object is a render snapshot
- [Phase 04]: 04-11: A non-submit trade button press calls preventDefault, since a refresh re-renders it as type submit before the click default runs
- [Phase 04]: 04-11: The callout slot shows one callout: result, migration, impact, quote failed, in that order

### Pending Todos

- Replace the placeholder contact handle in the terms page
- Phase 5: worker-core review WR-08, `forcedBondIxs` sets minOut to W's whole child balance, so any leftover in W reverts every later forced bond (`packages/core/src/bond.ts:78-88`).

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

Last session: 2026-10-24T16:12:50.023Z
Stopped at: Completed 04-08-PLAN.md
Resume file: None
