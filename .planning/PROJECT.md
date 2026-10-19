# BONDR

## What This Is

BONDR is a Solana memecoin launchpad built on pump.fun through the official pump SDK. Positioning: every token is meant to bond. Until a coin bonds, its creator fees are locked away from the dev. They force the coin to bond and burn supply. After bonding, the dev earns a permanent share of trading fees. BONDR also lists, charts and trades every coin launched on it.

## Core Value

A holder can verify on the token page that the dev holds no launch supply, and see that pre-bond fees went to forcing the bond and burning supply, never to the dev.

## Who It Is For

- **For:** memecoin devs who want a launch buyers trust, and traders who want coins without dev bags or pre-bond fee farming. Starts with the owner and friends; open to the public later.
- **Not for:** devs who want to keep their launch supply or take fees before bonding. Not multi-chain.

## Fee Mechanic (source of truth)

Verified against pump-fun/pump-public-docs @ 639b87f and live mainnet accounts on 2026-10-18 (see research/FINDINGS.md).

1. **BONDR token first.** BONDR launches on BONDR paired with SOL; its creator is the treasury, at the standard pump schedule. Every other coin pairs with BONDR as its quote (pump coin quote, depth 1; current `max_curve_depth` is 2).
2. **Launch, one atomic transaction:**
   - `create_v2` with the `bndr` vanity mint, `creator` = that coin's BONDR token wallet W, quote = BONDR, `creator_fee_bps` = 150.
   - Mandatory dev buy of at least 0.25 SOL, routed SOL to BONDR to coin.
   - The dev's chosen exit, **insta sell** or **insta burn** (Streamflow lock deferred).
   - The server co-signs with the mint key only if that exit is present.
3. **Fees per trade.** Bonding curve: 0.95% protocol + 1.5% creator = 2.45%. PumpSwap after bond: 0.20% LP + 0.05% protocol + 1.5% creator = 1.75%.
4. **Pre-bond split.** The worker collects W's creator fees: 90% stays in W as the burn budget, 10% goes to the treasury.
5. **Forced bond.** When W's burn budget covers the quote needed to complete the curve plus a buffer, the worker buys with the full budget (`buy_exact_quote_in_v3`). It burns the tokens bought in the same transaction. If another buyer crosses first, pump's synthetic migration fills the rest at the pool price.
6. **Fallback burn.** If traders bond the coin first, W buys on PumpSwap right after migration and burns in the same transaction.
7. **Rolling 24h sweep.** For every 24h window a coin spends unbonded, W's burn budget goes to the BONDR buyback wallet and that BONDR is burned. W stays the fee recipient until the coin bonds.
8. **Finalize after bond.** W runs `create_fee_sharing_config`, then the single allowed `update_fee_shares_v2`: deployer 8000 bps / treasury 2000 bps. This is permanent and distribution is permissionless.
9. **Ops wallet.** It pays transaction fees for every worker transaction, so W never needs SOL for gas.

## Requirements

### Validated

(None yet. Ship to validate.)

### Active

- [ ] Dev launches a coin with the full fee mechanic in one transaction and never holds launch supply
- [ ] Every coin page shows a public fee ledger: collections, splits, sweeps, forced-bond buy, burns, finalize, each with a transaction link
- [ ] Worker runs the fee mechanic (split, forced bond, fallback burn, rolling sweep, finalize, buyback burn) without manual help
- [ ] Home lists: trending, top market cap, latest, oldest (BONDR coins only)
- [ ] Trading on BONDR (buy and sell through `multi_hop_swap`) with live chart and trade feed, no platform fee
- [ ] Admin dashboard with recovery actions, kill switches, health, moderation, timeline, transaction inspector, audit log and EVACUATE
- [ ] Phantom-only wallet connect, terms page, consent prompt before collecting any data

### Out of Scope

- Dexscreener auto-enhance: no official order API ($299, web checkout). Revisit with a manual queue.
- Streamflow dev-supply lock: Token-2022 support unproven; costs 0.16 SOL + 0.5% of tokens. Add after a devnet test passes.
- Comments, chat, social feeds: not core to the trust mechanic.
- User profiles beyond a wallet address, notifications, limit orders: not needed for v1 success.
- Mobile app: the site is responsive instead.
- Multi-chain, multisig: Solana only, sole dev.
- Platform trading fee: owner decision. Trading on BONDR costs the same as anywhere.
- Wallets other than Phantom: owner decision.

## Success Criteria

- **Week 1 after go-live:**
  - BONDR token live.
  - 5-10 launches with zero failed launch transactions.
  - At least one coin force-bonded by its own fees, with the burn on its ledger.
- **Month 1:**
  - 50+ launches.
  - 1,500 SOL of total volume across BONDR coins.
  - About 3 SOL to the treasury.
  - Every daily sweep and finalize runs with no manual help.
- **Done for v1:** a stranger launches, trades and verifies their burns without asking the owner anything.

## Context

- Reference implementation: the owner's scrapped agencybook project at /Users/uzi/agencybook-phase-15. It has a one-tx launch with fee sharing (packages/core/src/launch/build.ts), HMAC-derived keypairs (launch/sign.ts), a program allowlist on sends (chain/send.ts), a worker with a Postgres leader lock and job leases (apps/worker/src/main.ts), and PUMPFUN.md notes.
- Pump ships breaking program changes on short notice: 2025-11-11, 2026-03-19, 2026-09-01.
- agencybook's launch was sniped within the same second. Launch and forced-bond sends need a private path.

## Constraints

- **Budget:** about $100/month: Helius Developer $49, Railway ~$20-30, Neon free tier or $19, Sentry and Pinata free tiers.
- **Team:** one owner, who is the sole dev and sole admin.
- **Legal:** a short terms page and a consent prompt only (AGENTS.md).
- **Security:** wallet secrets live in the worker only, never in web. The master seed sits in the worker environment.
- **Pump coupling:** pin `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0. Read fee tiers from the live FeeConfig, never hardcode them.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Coins pair with BONDR as quote at `creator_fee_bps` 150 | Custom pairs allow up to 3% creator fee: about 5x the burn budget of a 0.30% SOL pair, and demand for BONDR | Pending |
| Creator = per-token wallet W, not the deployer | `set_creator` is pump-admin only and fee shares update once, so the revert must be the single final update | Pending |
| Pre-bond split 90 W / 10 treasury off-chain; post-bond split 80 deployer / 20 treasury on-chain | Owner decision; only one on-chain update is allowed | Pending |
| Forced-bond buy and burn in the same transaction | Tokens never sit in W, so RugCheck and Bubblemaps do not flag a dev-like holder | Pending |
| Rolling 24h sweep to BONDR buyback; 90% buyback, 10% treasury | Owner decision; dead coins never accumulate fees | Pending |
| Dev must insta sell or insta burn the launch buy; server co-signs only if present | Dev never holds supply; the vanity mint key is the enforcement point | Pending |
| No platform trading fee | Owner decision | Pending |
| Phantom only | Owner decision; matches agencybook | Pending |
| pnpm monorepo: apps/web (Next.js 16), apps/worker, packages/core | Ports agencybook code directly | Pending |
| Neon Postgres + Drizzle; Railway (web + worker); Sentry | Owner choice; agencybook stack | Pending |
| Helius Developer RPC; Helius Sender with MEV protection for launches and forced bonds | The free tier gets rate-limited (429) during launch bursts; snipers | Pending |
| Own indexer: worker ingests pump program logs for BONDR mints into Postgres | Lists, charts and the ledger need our data; pump's API is undocumented | Pending |
| SSE for live updates; TradingView lightweight-charts | Simplest one-way push; standard trader chart | Pending |
| Pinata IPFS for metadata and images | Images survive if BONDR is down | Pending |
| All W keys HMAC-derived from one master seed in worker env | Nothing per token to store; EVACUATE covers a leak | Pending |
| Ops wallet pays all worker transaction fees | W holds only quote tokens; no gas top-ups per token | Pending |
| No multisig; EVACUATE break-glass with typed phrase + wallet signature, treasury only | Sole dev; one fast response to a seed leak | Pending |
| Test on devnet, plus a Surfpool mainnet fork for pump flows | pump devnet can lag mainnet | Pending |

## Defaults Chosen Without Explicit Owner Confirmation

Review these at spec approval:

1. **Dev buy minimum:** 0.25 SOL, measured on the SOL input before the BONDR hop.
2. **Forced-bond trigger:** burn budget at least 105% of the quote needed to complete the curve.
3. **Trending:** ranked by quote volume in the last 1h. Top = market cap. Latest and oldest = launch time.
4. **BONDR's own launch:** goes through the same flow with insta burn.
5. **BONDR curve completion:** launches pause automatically while BONDR's curve is complete but not yet migrated (pump error 6107).
6. **Lists and pages:** only coins launched through BONDR.
7. **Vanity mint:** suffix is case-sensitive `bndr`, from a pool pre-ground by the worker.

## Build Steps (vertical slices, in order)

1. **Chain spike on a mainnet fork.**
   - Prove every pump assumption with scripts and a bare page:
     - create_v2 with creator = W, BONDR-style pump-coin quote, creator_fee_bps 150
     - atomic create + dev buy + sell or burn, under the transaction size limit
     - collect and split
     - forced-bond `buy_exact_quote_in_v3` + burn
     - migrate
     - fallback PumpSwap buy + burn
     - create_fee_sharing_config + single update_fee_shares_v2
     - multi_hop_swap
   - Decisions: Surfpool fork, stand-in quote coin, measured transaction sizes.
   - Exit: every step has a transaction signature, or the spec changes.
2. **Launch flow.**
   - Phantom connect, consent prompt, launch form (name, symbol, image, description, links, dev buy amount, exit choice), Pinata upload, vanity mint pool, server co-sign rule.
   - A bare token page.
   - Decisions: agencybook sign order A (wallet signs, server verifies the message is unchanged, then adds the mint signature).
3. **Indexer, lists and token page.**
   - Trade ingestion, candles, market cap and volume rollups.
   - Home lists, token page with chart, trade feed and SSE live updates.
4. **Trading.** Buy and sell panel on the token page via multi_hop_swap, slippage control, quote preview.
5. **Fee engine and public ledger.**
   - Worker jobs: collect and split, forced bond, fallback burn, rolling sweep, finalize, buyback burn, ops-wallet fee payer, reconciliation.
   - Ledger section on the token page.
6. **Admin dashboard.** The 13 recovery actions, kill switches, health, moderation, timeline, transaction inspector, audit log, EVACUATE, simulate-first and fixed destinations.
7. **Go-live.**
   - Terms page, Sentry, mainnet config, weekly pump contract check, CI with a Playwright smoke test, BONDR token launch.
   - Child launches enabled only after BONDR exists.

Each UI step ends with Playwright screenshots at mobile, tablet and desktop widths, and a Designer critique (AGENTS.md section 7).

## Risks and What Would Change Course

| Risk | Signal | Response |
|------|--------|----------|
| Pump disables `creator_fee_configurable` or pump-coin quotes | Global flag flips, or the contract check fails | Fall back to SOL pairs at 0.30% creator fee; the burn shrinks about 5x |
| The single fee-share update fails or is misused | Spike step fails, or a wrong deployer is locked in | Pre-flight hold in admin. Only pump CTO admin can reset; show the runbook |
| Master seed leak | Unexpected outflow from any W | EVACUATE, rotate the seed for new launches |
| BONDR price volatility drags every coin | Large BONDR drawdown | Accept; show SOL-equivalent values everywhere |
| BONDR curve awaiting migration blocks launches | Pump error 6107 | Auto-pause launches with a banner |
| Forced bond rarely triggers (thin volume in 24h windows) | Under 10% of coins reach the trigger in month 1 | Revisit the 90/10 split or the 24h window |
| Pump breaking change | Weekly contract check, or a send fails with a program error | Kill switch, update the pinned SDK, re-run the spike suite |
| RPC cost above budget | Helius credits over 80% | Reduce subscriptions, poll inactive coins less often |
| Snipers front-run the forced-bond buy | Buy fills mostly at the pool price | Acceptable: the budget is still fully spent and burned |
| Streamflow never supports Token-2022 | Devnet test fails | Keep only sell and burn exits |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? Move to Out of Scope with the reason.
2. Requirements validated? Move to Validated with the phase reference.
3. New requirements emerged? Add to Active.
4. Decisions to log? Add to Key Decisions.
5. "What This Is" still accurate? Update if it has drifted.

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections.
2. Core Value check: still the right priority?
3. Audit Out of Scope: are the reasons still valid?
4. Update Context with the current state.

---
*Last updated: 2026-10-19 after initialization*
