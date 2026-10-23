# Requirements: BONDR

**Defined:** 2026-10-19
**Core Value:** A holder can verify on the token page that the dev holds no launch supply, and see that pre-bond fees went to forcing the bond and burning supply, never to the dev.

## v1 Requirements

### Chain proof (spike)

- [x] **SPIKE-01**: Owner can run one script on a Surfpool mainnet fork that creates a coin with creator = W, a pump-coin quote and creator_fee_bps 150, then prints the signature
- [x] **SPIKE-02**: Owner can see that create + dev buy + insta sell (and, separately, + insta burn) fits in one transaction, with the measured size and compute units
- [x] **SPIKE-03**: Owner can see a forced-bond buy + burn complete the curve in one transaction, and the fallback PumpSwap buy + burn after migration
- [x] **SPIKE-04**: Owner can see create_fee_sharing_config + the single update_fee_shares_v2 set deployer 80 / treasury 20 after migration, and distribution pay both
- [x] **SPIKE-05**: Owner can see a multi_hop_swap buy and sell SOL to BONDR-stand-in to coin

### Wallet and platform

- [x] **PLAT-01**: User can connect with Phantom (the only wallet offered) and disconnect from any page
- [x] **PLAT-02**: User sees a consent prompt and must accept the terms before BONDR stores anything about their wallet
- [x] **PLAT-03**: User can read a short terms page linked from the footer and the consent prompt
- [x] **PLAT-04**: The site works at mobile, tablet and desktop widths

### Launch

- [x] **LAUNCH-01**: Dev can fill the launch form: name (32 chars or fewer), symbol (13 or fewer), image, description, optional X, Telegram and website links
- [x] **LAUNCH-02**: Dev must enter a dev buy of at least the live minimum (0.25 SOL on mainnet, scaled by curve reserves on devnet) and choose insta sell or insta burn before the launch button enables
- [x] **LAUNCH-03**: Dev signs one transaction in Phantom that creates the coin (mint ending in `bndr`), buys, and sells or burns the dev buy
- [x] **LAUNCH-04**: Server co-signs with the mint key only when the signed message matches the one it built and contains the chosen exit
- [x] **LAUNCH-05**: Dev sees a success screen within 5 seconds of confirmation with "Dev holds 0 launch supply", the exit transaction link, the full contract address with a copy-to-clipboard button, and a button to open the coin page
- [x] **LAUNCH-06**: Dev sees a clear paused state when launches are paused (kill switch, or BONDR awaiting migration)
- [x] **LAUNCH-07**: Coin metadata and image are pinned to IPFS (Pinata) before signing

### Discovery

- [ ] **LIST-01**: User sees a separate Trending section on the home page: a horizontal side-scroller of coin cards ranked by quote volume in the last hour
- [x] **LIST-02**: User sees a Top list ranked by market cap
- [x] **LIST-03**: User sees Latest (newest launches first) and Oldest, in tabs alongside Top, each shown as a card grid of at most 5 cards per row
- [ ] **LIST-04**: Each coin card shows image, name, symbol, market cap, 1h change, bond progress and age, and updates live without a reload
- [x] **LIST-05**: User can search BONDR coins by name, symbol or mint

### Token page

- [x] **TOKEN-01**: User sees a price chart (lightweight-charts) with 1m, 5m, 1h and 1d candles
- [x] **TOKEN-02**: User sees a live trade feed and holder count
- [ ] **TOKEN-03**: User sees bond progress, burn budget vs cost to complete the curve, and the time left in the current 24h window
- [ ] **TOKEN-04**: User sees the fee ledger: every collection, split, sweep, forced-bond buy, burn and finalize, with amount, time and a transaction link
- [ ] **TOKEN-05**: User sees totals: burned supply %, fees to burn, fees to buyback, fees to treasury, and the post-bond deployer share once finalized
- [ ] **TOKEN-06**: Shared token links render a preview card (OG image) on X and Telegram

### Trading

- [ ] **TRADE-01**: User can buy a coin with SOL, routed SOL to BONDR to coin through multi_hop_swap, in one Phantom signature
- [ ] **TRADE-02**: User can sell a coin back to SOL the same way
- [ ] **TRADE-03**: User sees a quote preview (tokens out, price impact, fees) and can set slippage before signing
- [ ] **TRADE-04**: Trading works before and after bond (curve and PumpSwap) with no platform fee added

### Fee engine (worker)

- [ ] **FEE-01**: Worker collects each unbonded coin's creator fees and splits them 90% to W's burn budget and 10% to the treasury, recording every step in the ledger
- [ ] **FEE-02**: Worker detects when W's burn budget is at least 105% of the cost to complete the curve, and sends one buy + burn transaction through Helius Sender
- [ ] **FEE-03**: When traders bond a coin first, worker buys on PumpSwap after migration with the burn budget and burns in the same transaction
- [ ] **FEE-04**: Every 24h window without bonding, worker sweeps W's burn budget to the buyback wallet (90%) and the treasury (10%); W stays creator until bond
- [ ] **FEE-05**: After bond, worker sweeps pending fees, then runs create_fee_sharing_config and the single update_fee_shares_v2 (deployer 8000 / treasury 2000), with a pre-flight check of the deployer address
- [ ] **FEE-06**: Worker burns the BONDR held by the buyback wallet on a schedule
- [ ] **FEE-07**: Worker cranks distribution of post-bond fees to the deployer and treasury on a schedule
- [ ] **FEE-08**: The ops wallet pays every worker transaction fee; worker alerts when it drops below the threshold
- [ ] **FEE-09**: A nightly reconciliation compares ledger balances to on-chain balances and records discrepancies
- [x] **FEE-10**: Each W key is derived from the master seed and is used only inside the worker; web never holds wallet secrets

### Admin

- [ ] **ADMIN-01**: Owner signs in with the single allowlisted wallet; sessions expire after 30 minutes, and every money-moving action needs a fresh signature
- [ ] **ADMIN-02**: Owner sees treasury, buyback and ops balances, every W with its state, and platform totals
- [ ] **ADMIN-03**: Owner can run each recovery action: sweep now, retry forced bond, burn W token balance, run migrate, finalize split, hold for review, retry sweep, distribute now, re-check launch, sweep leftovers + close accounts, burn buyback now
- [ ] **ADMIN-04**: Every action simulates first and shows balance changes before confirm; destinations are limited to burn, treasury, buyback, or that coin's deployer
- [ ] **ADMIN-05**: Owner can flip kill switches per job (launches, forced bond, sweeps, finalize, buyback burn)
- [ ] **ADMIN-06**: Owner sees health: worker heartbeat, leader lock, last run per job, RPC latency and errors, Sentry issue count, vanity pool size
- [ ] **ADMIN-07**: Owner can hide a coin from lists and block a deployer wallet from launching
- [ ] **ADMIN-08**: Owner sees a per-coin timeline with each state, transaction, next expected step, and retry for a stuck step
- [ ] **ADMIN-09**: Owner can paste a signature and see the decoded instructions, the error and an explorer link
- [ ] **ADMIN-10**: Every admin action is written to an audit log: actor, time, simulation result, signature
- [ ] **ADMIN-11**: Owner can run EVACUATE: type the phrase, sign, then all jobs pause and every W balance moves to the treasury

### Operations

- [x] **OPS-01**: Sentry captures errors from web and worker
- [ ] **OPS-02**: A weekly contract check verifies the pump program IDs, the IDL account layouts and the Global flags BONDR depends on, and pauses jobs on a mismatch
- [ ] **OPS-03**: CI runs lint, tests and a Playwright smoke test on every push
- [ ] **OPS-04**: `scripts/` has one-command setup, dev, test and deploy
- [ ] **OPS-05**: BONDR token is launched on mainnet through BONDR; child launches enable only after it exists

## v2 Requirements

- **LOCK-01**: Dev can lock the dev buy with Streamflow for 1 hour to 12 months (after a Token-2022 devnet test)
- **DEX-01**: Bonded coins get Dexscreener Enhanced Token Info, paid from fees (manual queue)
- **SOC-01**: Comments on token pages
- **NOTF-01**: Notifications for bonds and burns

## Out of Scope

| Feature | Reason |
|---------|--------|
| Platform trading fee | Owner decision |
| Wallets other than Phantom | Owner decision |
| Multisig treasury | Sole dev |
| Mobile app | The responsive site covers it |
| Multi-chain | Solana only |
| User profiles, limit orders | Not needed for v1 success |
| Preventing dev buys from other wallets | Impossible on-chain; accepted by owner |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SPIKE-01 | Phase 1 | Complete |
| SPIKE-02 | Phase 1 | Complete |
| SPIKE-03 | Phase 1 | Complete |
| SPIKE-04 | Phase 1 | Complete |
| SPIKE-05 | Phase 1 | Complete |
| PLAT-01 | Phase 2 | Complete |
| PLAT-02 | Phase 2 | Complete |
| PLAT-03 | Phase 2 | Complete |
| PLAT-04 | Phase 2 | Complete |
| LAUNCH-01 | Phase 2 | Complete |
| LAUNCH-02 | Phase 2 | Complete |
| LAUNCH-03 | Phase 2 | Complete |
| LAUNCH-04 | Phase 2 | Complete |
| LAUNCH-05 | Phase 2 | Complete |
| LAUNCH-06 | Phase 2 | Complete |
| LAUNCH-07 | Phase 2 | Complete |
| LIST-01 | Phase 3 | Pending |
| LIST-02 | Phase 3 | Complete |
| LIST-03 | Phase 3 | Complete |
| LIST-04 | Phase 3 | Pending |
| LIST-05 | Phase 3 | Complete |
| TOKEN-01 | Phase 3 | Complete |
| TOKEN-02 | Phase 3 | Complete |
| TOKEN-03 | Phase 5 | Pending |
| TOKEN-04 | Phase 5 | Pending |
| TOKEN-05 | Phase 5 | Pending |
| TOKEN-06 | Phase 3 | Pending |
| TRADE-01 | Phase 4 | Pending |
| TRADE-02 | Phase 4 | Pending |
| TRADE-03 | Phase 4 | Pending |
| TRADE-04 | Phase 4 | Pending |
| FEE-01 | Phase 5 | Pending |
| FEE-02 | Phase 5 | Pending |
| FEE-03 | Phase 5 | Pending |
| FEE-04 | Phase 5 | Pending |
| FEE-05 | Phase 5 | Pending |
| FEE-06 | Phase 5 | Pending |
| FEE-07 | Phase 5 | Pending |
| FEE-08 | Phase 5 | Pending |
| FEE-09 | Phase 5 | Pending |
| FEE-10 | Phase 2 | Complete |
| ADMIN-01 | Phase 6 | Pending |
| ADMIN-02 | Phase 6 | Pending |
| ADMIN-03 | Phase 6 | Pending |
| ADMIN-04 | Phase 6 | Pending |
| ADMIN-05 | Phase 6 | Pending |
| ADMIN-06 | Phase 6 | Pending |
| ADMIN-07 | Phase 6 | Pending |
| ADMIN-08 | Phase 6 | Pending |
| ADMIN-09 | Phase 6 | Pending |
| ADMIN-10 | Phase 6 | Pending |
| ADMIN-11 | Phase 6 | Pending |
| OPS-01 | Phase 2 | Complete |
| OPS-02 | Phase 7 | Pending |
| OPS-03 | Phase 7 | Pending |
| OPS-04 | Phase 7 | Pending |
| OPS-05 | Phase 7 | Pending |

**Coverage:** 57/57 v1 requirements mapped, no orphans, no duplicates.

---
*Requirements defined: 2026-10-19*
*Last updated: 2026-10-19 after roadmap creation*
