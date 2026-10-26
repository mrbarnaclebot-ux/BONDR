# Switching BONDR from pump.fun to Meteora (DBC)

**Owner decision (2026-10-26):** parked. Stay on pump for Phase 7 and v1; revisit Meteora as a second lane in a later milestone.

Researched 2026-10-26. Research role, read-only on code. Not committed.
Sources: Meteora docs (fetched as .md from docs.meteora.ag, program 0.2.2) and the local repo. Items marked UNCONFIRMED were not verified on a primary source or on chain.

## Answer and recommendation

Meteora's Dynamic Bonding Curve (DBC) can host almost every BONDR mechanic, and it fixes the one thing pump cannot: block-0 sniping. Its fee scheduler is a high base fee that decays by slot or timestamp from pool activation, and an optional "first swap with minimum fee" path lets the dev's create-plus-buy transaction pay the minimum fee while snipers pay the cliff fee. That is the economic defence SNIPING.md called impossible on pump. Costs: a rewrite of every chain-side module (about 1,950 lines of non-test code import the pump SDK, plus about 8 spike stages and 3 devnet scripts), a new indexer decoder, a redesigned post-bond 80/20 split (liquidity lock split instead of fee sharing), loss of pump.fun front-end discovery, and a proof phase that repeats the Phase 1 spike on Meteora.

Recommendation: option (c) stay on pump for mainnet launch (Phase 7), then add Meteora as a second lane (option b) in a post-launch milestone, starting with a one-phase devnet spike. Reasons:
1. Mainnet is next and the pump mechanic is proven end to end (spike on devnet and a mainnet fork, Phase 6 reviewed). A full switch resets that evidence.
2. The things Meteora gives us (anti-sniper decay, permanent LP lock, creator transfer) are real but unproven for BONDR's specific W-collects-then-force-bonds flow. Three design points below are UNCONFIRMED and could break the plan.
3. Discovery: pump.fun is where flow is. DBC tokens trade on Jupiter and are listed on terminals by Meteora's own claims, but there is no pump.fun-style front page for us (we are our own front page).
4. A lane switch is cheap to keep open: the code is already split behind `packages/core/src/pump.ts` (single load point), so a `Venue` interface can come later without touching the web app.

If the owner decides sniping is the top risk and wants Meteora at launch, do the full switch only after a 1-2 week devnet spike proves the 5 open points in the last section. Do not start the full switch blind.

## 1. Pump coupling map

Counts from `rg` over apps, packages, scripts, excluding tests and node_modules. Total non-test files importing `pump.ts` or a pump SDK: 15 (about 2,040 lines in those files, of which maybe 1,200 are pump-specific). Tests that mock or assert pump behaviour: roughly 25 more files (trade-prepare, trade-quote, trade-state, fee-ledger, ingest, sharing, curve, trades, db tests).

| Concern | Files (lines) | What pump-specific code does |
|---|---|---|
| SDK load point | `packages/core/src/pump.ts` (59), `packages/core/package.json` | createRequire load of `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0 (ESM/BN workaround); re-exports PDAs, program IDs, quote math. Only door to pump. |
| Launch tx building | `packages/core/src/launch.ts` (237), `apps/worker/src/build.ts` (139), `prepare.ts`, `alt.ts` | `create_v2` with creator = W, quote = BONDR, creator_fee_bps 150, SOL to BONDR leg then `buy_v3` exact-out, insta sell/burn exit, per-coin ALT. 1,064 byte tx budget is a pump-account-count artefact. |
| Quote-mint support | `quote.ts` (241), `quote-read.ts` (140), `route.ts` (29), `config.ts` (46) | pump coin-quote (depth 1, max_curve_depth 2), `PumpQuoteAccounts`, canonical pool PDA with quote. Entire concept is a pump feature. |
| Trade prepare / quote | `trade.ts` (163), `trades.ts` (279), `apps/worker/src/trade-prepare.ts`, `trade-quote.ts` (110), `trade-state.ts`, `trade-submit.ts` | `multi_hop_swap` buy/sell, `getBuyV3*` / `getSellSolAmountFromTokenAmount` quote math, slippage; pump fee tiers via `computeFeesBps`. |
| Curve read | `curve.ts` (83), `curve-state.ts` (33) | `bondingCurvePda`, curve account decode, `complete` flag, remaining supply. |
| Ingest / events | `events.ts` (105), `apps/worker/src/ingest.ts` (258), `stream.ts`, `holders.ts` | Decodes pump `TradeEvent` / `CreateEvent` / complete / migrate from tx logs; writes trades, slots, curve progress. Needs a full DBC equivalent. |
| Fee collect | `collect.ts` (88), `apps/worker/src/fee-prebond.ts` (83), `fee-batch.ts` (200) | `collect_creator_fee` for W (no W signature), 10% treasury split from the collect tx delta. |
| Forced bond | `bond.ts` (175), `apps/worker/src/fee-send.ts` (271), `fee-engine.ts`, `fee-burns.ts` (129), `fee-boot.ts` (115) | `buy_exact_quote_in_v3` with the full burn budget, simulate-for-balance, burn in same tx, Helius Sender submit. |
| Fallback burn / PumpSwap | `bond.ts`, `launch.ts`, `migrate.ts` (28) | PumpSwap pool buy with pinned buyback recipient, burn; `pump-swap-sdk` `OnlinePumpAmmSdk`. |
| Fee sharing / finalize | `sharing.ts` (172), `apps/worker/src/fee-finalize.ts` (179) | `create_fee_sharing_config` then single `update_fee_shares_v2` 8000/2000; permissionless distribute crank; sweeps first. |
| Sign/send | `cosign.ts` (93), `send.ts`, `submit.ts` | Mint co-sign (vanity), generic. Mostly venue-neutral. |
| Admin | `admin-actions.ts`, `admin-money.ts`, `admin-inspect.ts`, `admin-evacuate.ts` | Pump account reads for recovery and EVACUATE; moderate rewrites. |
| Schema | `schema.ts` (283) | One pump-named column reference; curve and fee ledger tables are venue-neutral in shape. |
| Spike and scripts | `scripts/spike/stages/*` (bond 274, prebond 268, finalize 212, complete 192, launch 183, sharing 149, multihop 149, create 146, pool-launch 98), `scripts/devnet-launch.ts` (244), `devnet-trades.ts` (267) | The Phase 1 evidence suite. All would be redone on Meteora (the proof is the expensive part). |
| Web | `apps/web` | `check-client-bundle.sh` enforces web never imports pump. Web only talks to worker API, so it is mostly insulated; token page copy and fee numbers change. |

Lane concept: `VANITY_LANE` (`apps/worker/src/env.ts:88`, values `local` / `staging`) is a vanity-mint/buyback-wallet namespace for devnet databases, not a venue switch. It cannot be reused as a pump/Meteora lane; a new `venue` column on launches would be needed.

## 2. Meteora capabilities (DBC, program 0.2.2)

Program ID (mainnet and devnet): `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`. Sources: [What is DBC](https://docs.meteora.ag/core-products/dbc/what-is-dbc.md), [repo](https://github.com/MeteoraAg/dynamic-bonding-curve), [Accounts and Permissions](https://docs.meteora.ag/core-products/dbc/accounts-and-permissions.md), [Launch Configuration](https://docs.meteora.ag/core-products/dbc/launch-configurations.md), [Instructions](https://docs.meteora.ag/developer-guides/dbc/program/instructions.md).

- Model: a partner (launchpad, us) creates a reusable `PoolConfig` (quote mint, curve, fees, migration, LP split, fee_claimer, leftover_receiver). Creators then call `initialize_virtual_pool_with_spl_token` or `..._with_token2022` against that config. One shared config can serve every coin; a per-coin config is not required. No config-count limit is documented (UNCONFIRMED beyond docs).
- Curve: universal curve, 1 to 16 active segments (20 stored). Prices must strictly increase.
- Quote mint: any SPL Token mint is permissionless. A Token 2022 quote mint is permissionless if its extensions are only MetadataPointer, TokenMetadata and (zero or revoked) TransferFeeConfig. Anything else needs a Meteora operator-created `TokenBadge`. BONDR is a pump Token-2022 mint with 6 decimals (FINDINGS.md:36); whether its extension set qualifies is UNCONFIRMED and must be checked on chain. If not, a badge request to Meteora is needed, a dependency outside our control.
- Base mint: SPL or Token-2022 (metadata pointer and metadata initialised by the program), 6 to 9 decimals (matches our 6). Optional base transfer fee up to 10%; optional transfer-hook pools (Token-2022, hook revoked at curve completion). Token-2022 base requires DAMM v2 migration.
- Mint address: [SDK `createPool`](https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/reference.md) takes `baseMint` as an input, so a pre-ground vanity keypair as a signer looks supported. UNCONFIRMED (not tested; check the IDL account is a signer, not a PDA).
- Migration: threshold is a quote-reserve amount (`migration_quote_threshold`). New configs migrate only to DAMM v2 (DAMM v1 rejected for new configs). At migration: pool created at `migration_sqrt_price`, positions are NFTs, liquidity split between partner and creator across unlocked / permanent-locked / vesting buckets; at least 10% must stay locked after day 1. Fixed 0.2% protocol liquidity migration fee; optional configurable migration fee up to 99% split partner/creator. See [Migration and Liquidity](https://docs.meteora.ag/core-products/dbc/migration-and-liquidity.md).
- Who migrates: `migrateToDammV2` takes a `payer` ("MIGRATOR"); Meteora runs keepers for listed quote mints (SOL 10, USDC 750, JUP, MET, and others) and for Jupiter-verified quotes with Organic Score above 50 and notional above 750 USD. A BONDR quote almost surely does not qualify at first, so we must run our own migrator (or the [manual migrator](https://migrator.meteora.ag/)). Whether the instruction is fully permissionless is not stated explicitly; the "payer" naming and public manual migrator suggest yes. UNCONFIRMED.
- Trading fees: base fee mode fixed / linear / exponential scheduler (rate limiter is deprecated and rejected for new configs); optional dynamic (volatility) fee on top; collect mode QuoteToken or OutputToken; min base fee 0.25%, max total fee 99%. Protocol takes 20% of the total trading fee; a referral takes 20% of the protocol share (not additive). The remainder splits between partner (fee_claimer) and creator by `creator_trading_fee_percentage`. Fees are claimable as they accrue, no need to wait for migration. See [DBC Fees](https://docs.meteora.ag/core-products/dbc/fees/overview.md).
- Claim authority: partner fees need the config `fee_claimer` signature; creator fees need the current pool creator signature (`claim_creator_trading_fee`). The creator can be changed with `transfer_pool_creator`, which also moves creator fee-claim rights.
- Other fees and splits: optional pool creation fee (0.001 to 100 SOL, 10% protocol / 90% partner); surplus above the threshold splits 20% protocol, 80% partner and creator by the same creator percentage.
- Swaps: `swap2` with exact-in, partial-fill and exact-out modes. Partial fill is the key to a safe forced bond (spend only what completes the curve).
- Events/IDL: `EvtSwap2`, `EvtSwap3`, `EvtInitializePool`, `EvtCurveComplete`, `EvtClaimTradingFee`, `EvtClaimCreatorTradingFee` ([events](https://docs.meteora.ag/developer-guides/dbc/program/events.md)). Anchor event-CPI, so decodable from tx inner instructions or logs. Helius/Geyser support for DBC specifically: UNCONFIRMED; any Yellowstone/enhanced-tx pipeline can read the program ID. Codex tracks Meteora launches under the `MeteoraDBC` filter ([Codex](https://docs.codex.io/launchpads/meteora.md)).
- Audits: Offside Labs reports for 0.1.1 through 0.2.2 and an OtterSec report for 0.1.3 ([audits](https://docs.meteora.ag/resources/audits/dbc.md)). Upgrade authority and any recent incident history: UNCONFIRMED, not checked.
- SDK: `@meteora-ag/dynamic-bonding-curve-sdk` 2.0.0, MIT, TypeScript ([repo](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk)). Builders for config, pool, `createPoolWithFirstBuy`, swap quotes, claims, migration. `createPoolWithPartnerAndCreatorFirstBuy` also exists.
- Reference launchpad: [Meteora Invent "Fun Launch"](https://docs.meteora.ag/invent/scaffold/fun-launch.md) is a Next.js scaffold on DBC with Jupiter-API trading and TradingView charts.

## 3. Mechanic mapping

Status key: AS-IS (port with a new builder), REDESIGN, IMPOSSIBLE, UNCONFIRMED.

| Mechanic | Pump implementation (file) | Meteora equivalent | Status | Notes |
|---|---|---|---|---|
| Create coin, dev holds no supply | `create_v2` + dev buy + exit, one tx (`launch.ts`) | `createPoolWithFirstBuy` then dev exit (sell or burn) in the same tx | AS-IS (size to check) | No `multi_hop_swap`: SOL to BONDR leg stays a separate swap (Jupiter or DAMM/pump route for BONDR). Tx size limit (1,232 B) must be re-measured; DBC pool init has its own account count. |
| BONDR as quote of every child coin | pump coin-quote depth 1 (`quote.ts`) | Config `quote_mint` = BONDR | UNCONFIRMED | Needs BONDR's extensions to be permissionless-eligible or a TokenBadge; if BONDR itself stays on pump, trades need BONDR liquidity routing. If BONDR is launched on DBC with SOL quote, children quoted in BONDR are possible but BONDR's own migration has to precede children if keepers matter (they do not for us). |
| Vanity `bndr` mint pre-generated | `cosign.ts`, `vanity.ts` | Pass the vanity keypair as base mint signer | UNCONFIRMED | Likely fine; verify base mint is a signer account. |
| Creator fees to per-coin wallet W | `create_v2` creator = W, 150 bps (`launch.ts`) | Pool creator = W; config `creator_trading_fee_percentage` high (100% if allowed, UNCONFIRMED) and `fee_claimer` = treasury | AS-IS with caveat | Fee total is set in the config (we choose it; min 0.25%). Protocol takes 20% of the total fee, so to net 1.5% to creator the fee must be about 1.9%; compare pump's 0.95% protocol + 1.5% creator = 2.45%. |
| 24h-window collect, 10% to treasury | `collect.ts`, `fee-prebond.ts` (no W signature) | `claim_creator_trading_fee` signed by W (seed-derived, server-held); 10% transfer in the same tx | AS-IS | W signs (we hold the seed, so no real change). Fees accrue in the pool and can be claimed any time, even mid-window. Alternative: fee_claimer (partner) route avoids W signing but cannot be per coin without per-coin configs. |
| Sweep 90/10 to buyback wallet, burn BONDR | `fee-batch.ts`, `fee-burns.ts` | Same SPL transfers and `burn` | AS-IS | Venue-neutral if BONDR is the quote and fees are collected in quote (collect mode QuoteToken). With OutputToken mode fees arrive in the child token on buys: avoid. |
| Forced bond when budget >= 105% cost | `bond.ts`: `buy_exact_quote_in_v3`, full budget, burn same tx | `swap2` by W, partial-fill mode capped at remaining quote to threshold, then burn base tokens | REDESIGN | Anyone may swap, so W can complete the curve. But pump's "spend whole budget past completion at pool price" trick does not exist: the curve stops at the threshold; excess budget stays in W (or becomes surplus). Surplus splits 20% protocol, 80% partner/creator. Burn only what W bought. Burn amount from `simulateTransaction` approach still works. |
| If traders bond first, W buys on pool and burns | PumpSwap buy + burn (`bond.ts`, `launch.ts`) | Buy on the migrated DAMM v2 pool (needs a DAMM v2 swap builder, e.g. `@meteora-ag/cp-amm-sdk`) or via Jupiter | REDESIGN | New SDK, new pool PDA, new decoder. Migration must be triggered first by us (no keeper for BONDR quote). |
| Trigger migration | pump keeper does it (~10 slots) | `migrateToDammV2` by our migrator wallet (or manual migrator) | REDESIGN | Our worker must run it promptly; a ledger and stuck-migration admin action are new work. |
| Post-bond 80/20 dev/treasury, permanent | `sharing.ts`: `create_fee_sharing_config` + one `update_fee_shares_v2` 8000/2000 | Migrated-liquidity split: creator = dev, creator permanent-locked 80%, partner (treasury) permanent-locked 20%, via `transfer_pool_creator` W to dev before migration | REDESIGN | Different shape. Fees come from the DAMM v2 positions, not a sharing config, and each side claims its own position fees (no distribute crank). Permanence: permanent locked liquidity is lockable on chain, arguably stronger than pump's revoked admin. Risk: if a third party migrates before W transfers creator, the creator position goes to W and the NFT must be moved (is a permanent-locked position NFT transferable? UNCONFIRMED). |
| Pre-bond fees never reach dev | W is creator | W is creator until after the curve completes | AS-IS | Order of operations changes: bond, claim last creator fees, `transfer_pool_creator`, then migrate. |
| Burn supply | SPL burn in same tx | Same | AS-IS | Token-2022 burn on base mint. |
| Rolling 24h sweep while unbonded | worker | Same worker logic | AS-IS | |
| Trade UI quotes (buy/sell with BONDR leg) | `trade.ts`, `trades.ts`, `trade-quote.ts` (`multi_hop_swap`) | SDK `swapQuote2` / `swap2`, plus an extra BONDR leg | REDESIGN | No multi_hop; a SOL buy is two swaps in one tx, or require users to hold BONDR. Jupiter routing could replace our own router for migrated coins. |
| Indexer | `events.ts`, `ingest.ts` | Decode `EvtSwap2`, `EvtCurveComplete`, `EvtInitializePool` | REDESIGN | Roughly the same line count; new IDL types. |
| Anti-sniper | IMPOSSIBLE on pump (SNIPING.md) | Fee scheduler + `enable_first_swap_with_min_fee` | NEW | See section 4. |
| Dev-supply lock (Streamflow, deferred) | not built | Not needed; or base `token_authority` options | n/a | |
| Dynamic creator split pre-bond | n/a | Possible via `creator_trading_fee_percentage` | n/a | |

## 4. Anti-sniper on Meteora

Primary source: [Fee Scheduler](https://docs.meteora.ag/core-products/dbc/fees/fee-scheduler.md), [Rate Limiter](https://docs.meteora.ag/core-products/dbc/fees/rate-limiter.md) (deprecated), [Launch Configuration](https://docs.meteora.ag/core-products/dbc/launch-configurations.md), [A.S.S. overview](https://docs.meteora.ag/meteoras-anti-sniper-suite-a.s.s./meteoras-anti-sniper-suite).

- Scheduler: cliff fee (starting), number of periods, period frequency, reduction factor. Linear (fixed step) or exponential (percentage step). Measured from pool activation, and the activation type is slot-based or timestamp-based, so the fee can decay per slot. Bounds: base fee at least 0.25%, total fee at most 99%. A fee of say 90% at slot 0 decaying over a few hundred slots makes a block-0 snipe uneconomic. This is an economic deterrent, not a prevention: a bot can still land in slot 0, it pays the cliff fee.
- First swap with minimum fee: when `enable_first_swap_with_min_fee` is set, the initialize-pool transaction that contains the first swap (no referral, targets the new pool) pays the minimum fee. That is exactly BONDR's atomic create plus dev buy, so the dev's own buy avoids the cliff fee while any later buyer pays it. Constraint: the swap must be in the same tx as pool init (we already do that); the instructions sysvar is added to swap accounts.
- Dynamic fee: optional volatility fee on top of the base.
- Rate limiter (buy-size-sensitive, 12 h cap) is deprecated and rejected for new configs and pools.
- Creator-only window, allowlist, or slot-based buy blocking: no such feature found. UNCONFIRMED whether the scheduler applies to sells too (docs say buys for the limiter; scheduler text is silent).
- Side effect that helps BONDR: the cliff-fee revenue goes mostly to creator and partner (80% of it after the 20% protocol cut, split by `creator_trading_fee_percentage`). With creator = W, sniper fees become burn budget, which can pay for a faster forced bond. It also means high early fees raise the forced-bond threshold race: W accumulates fast.
- Costs: honest traders in the decay window also pay high fees; the schedule must be published on the token page. W's own forced bond also pays the fee at the time it runs (small, since it usually runs after 24h windows when the fee has decayed).
- Private submission (Helius Sender) remains useful for the launch tx (SNIPING.md first recommendation); it still applies on Meteora.

## 5. Discovery and liquidity tradeoffs

- pump.fun: bonding-curve coins appear on pump.fun's front page and in every pump-aware terminal and bot by default. BONDR coins currently get this for free (their mints are pump coins with a BONDR quote). Not independently measured here.
- Meteora DBC: Meteora's docs state DBC tokens are tradable through Jupiter and listed in terminals; a Meteora quick-launch guide names Jupiter Pro, Axiom and Photon (search summary of Meteora docs, not individually verified). DexScreener support for DBC pools: UNCONFIRMED (no source found). Third-party trackers exist (Codex `MeteoraDBC`). Large launchpads built on DBC exist (Bags, Believe, Star.fun, America.fun per a KuCoin Q1 2026 summary, third-party and secondary; verify before citing).
- After migration, a DAMM v2 pool is a standard Meteora pool visible on Jupiter; the pump route (PumpSwap) is also on Jupiter.
- Net: Meteora loses pump.fun's organic front page and the largest pool of bot flow; it gains lower slot-0 sniper take and a standard pool. BONDR already drives its own front page, so the loss matters mostly for external discovery. A DBC coin's graduated pool (DAMM v2) does not carry pump's "graduated" badge in pump-aware tools.
- Quote mint risk: children quoted in BONDR need aggregators to price BONDR. On Meteora a non-listed quote has no keeper migration, so we carry operational liability for every migration.

## 6. Options

| | (a) Full switch before mainnet | (b) Meteora as a second lane | (c) Stay on pump |
|---|---|---|---|
| What | Replace pump with DBC everywhere | `venue` per coin; pump stays the default; DBC lane behind a feature flag | No change |
| Rough effort | 8 to 10 phases: spike (DBC devnet, 1 to 2 plans), launch builder, trade/quote, indexer, fee engine collect+bond+burn, migrate+finalize, admin rewrites, retest/e2e/fork proof, web copy | 5 to 6 phases after launch: spike, DBC launch + indexer, trade routes, fee/bond/migrate, admin, UI toggle; shares fee ledger, schema, web | 0 |
| Thrown away | `sharing.ts`, `bond.ts`, `launch.ts`, quote/route code, pump SDK wrapper, ~25 tests, 11 spike stages and their evidence | Nothing | Nothing |
| Risk | Resets Phase 1 evidence; mainnet slips by about 6 to 10 phases of work; BONDR quote badge dependency; open design points below | Doubles surface (two venues, two proofs); needs a venue interface; moderate | Block-0 sniping unsolved; accepted by owner for dev buys (REQUIREMENTS.md:109) but not for launch snipes |
| Gains | Anti-sniper, permanent locked LP, Meteora SDK, partner revenue knobs | Same gains for opted-in coins; A/B data on snipes and volume | Ships now, proven |

Recommendation: (c) for Phase 7 mainnet, then (b). In the interim, take SNIPING.md's cheap fix (move the launch tx to Helius Sender).

Suggested first step after mainnet: a one-phase devnet spike "DBC lane" with the same shape as Phase 1, answering the open questions below, producing results rows beside the pump ones.

## 7. Open questions for the owner and for the spike

Owner decisions:
1. How much weight on block-0 sniping vs time to mainnet? If it is the top risk, is a 6 to 10 phase delay acceptable?
2. Is pump.fun front-page discovery important to you, or do holders find coins through BONDR and Axiom/Jupiter?
3. Should BONDR itself launch on DBC (SOL quote) so children can be quoted in it there, or stay a pump coin?
4. Are you fine with the post-bond dev share being a permanent-locked LP position the dev claims themselves, rather than a pump fee sharing config with a distribute crank?
5. Are you fine with a higher protocol take (Meteora 20% of every trading fee plus 0.2% migration fee plus 20% of surplus) vs pump's 0.95%?

Spike checks (all UNCONFIRMED today):
1. Does `creator_trading_fee_percentage` allow 100%? Does the pool creator signature requirement allow W (a seed-derived keypair) as creator on `initialize_virtual_pool_*`, with a separate payer?
2. Is BONDR (Token-2022, 6 decimals) accepted as a quote mint permissionlessly, or does it need a TokenBadge? Check its extensions on chain.
3. Is `migration_damm_v2` callable by any payer, and can a third party migrate before we run `transfer_pool_creator`? Is a permanent-locked position transferable?
4. Does the vanity mint keypair work as the base mint signer? Does the create plus first-buy plus exit tx fit in 1,232 bytes with BONDR quote?
5. Does the scheduler apply to sells, and what is the cliff fee that stays under 99% total with protocol 20%? Check `first swap with minimum fee` applies to our `createPoolWithFirstBuy` path.
6. Are DBC pools visible on DEX Screener, Axiom, Photon without a listing request?
7. Which program upgrade authority does DBC have, and are there recent incident reports? Not checked here.
