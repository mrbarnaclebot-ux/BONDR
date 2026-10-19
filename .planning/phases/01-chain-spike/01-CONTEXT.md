# Phase 1: Chain Spike - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove every pump.fun step that BONDR's fee mechanic depends on, with real transaction signatures on a Surfpool mainnet fork. Covers SPIKE-01..05:

- create_v2 with creator = W, a pump-coin quote and creator_fee_bps 150
- atomic create + dev buy + insta sell, and create + dev buy + insta burn, with measured size and compute units
- collect and split; forced-bond `buy_exact_quote_in_v3` + burn; post-migration PumpSwap buy + burn
- create_fee_sharing_config, then one update_fee_shares_v2 (deployer 8000 / treasury 2000), a second update rejected, distribution paying both
- multi_hop_swap buy and sell, SOL to stand-in to coin

The deliverable is a bare results page listing every step with its signature or its failure. Any failed step forces a PROJECT.md change before Phase 2. No product UI, no database, no worker, no hosting in this phase.

</domain>

<decisions>
## Implementation Decisions

### Where the proof runs
- **D-01 (revised 2026-10-19 by owner):** Hybrid. Run every step devnet supports on devnet, matching the agencybook habit. Use the Surfpool mainnet fork only for the gaps. No real-mainnet transaction in Phase 1; real mainnet waits for Phase 7.
  - **Verified 2026-10-19:** devnet pump Global has `creator_fee_configurable = false` and `max_configurable_creator_fee_bps = 0` (mainnet: true / 300). `max_curve_depth` is 2 on both, and all three pump programs were redeployed on devnet within the last ~10 days.
  - **Devnet steps:** create_v2 with creator = W and a pump-coin quote (default creator fee), create + dev buy + insta sell/burn in one tx with size and CU measured, single update_fee_shares_v2 and the rejected second update (on an unbonded coin), multi_hop_swap, and the 6107 migration-window error if a stand-in can be completed cheaply. Otherwise that test moves to the fork.
  - **Fork-only steps:** anything needing creator_fee_bps 150, or around 85+ SOL of volume. That covers the 150 bps create, collect and 90/10 split on 1.5% fees, forced-bond buy_exact_quote_in_v3 + burn, migrate, post-migration PumpSwap buy + burn, and finalize + distribution after bond.
  - The results page labels each row with its environment (devnet or fork).
- **D-02:** The fork runs against current mainnet pump programs and Global/FeeConfig state. The spike reads live values (fee tiers, `max_curve_depth`, `creator_fee_configurable`, `max_configurable_creator_fee_bps`) and records them in the results. Nothing is hardcoded.
- **D-03:** Nobody runs pump's keeper on the fork. The spike calls `migrate` itself, which anyone may do. The results note that mainnet migration timing depends on pump's keeper.

### BONDR stand-in states
- **D-04:** Create a fresh SOL-paired pump coin on the fork as the BONDR stand-in. The treasury keypair is its creator, matching the planned BONDR launch.
- **D-05:** Test child coins against all three stand-in states:
  1. Stand-in on its curve: child create, trades, forced bond.
  2. Stand-in complete but not migrated: child create must fail with `QuoteCurveAwaitingMigration` (6107). Record the error as a pass.
  3. Stand-in migrated to PumpSwap: child create, trades and the multi_hop_swap route still work.

### Spike code
- **D-06:** Foundation, not throwaway. Pump logic goes into `packages/core` (TypeScript, pnpm workspace), ported from agencybook where it fits:
  - instruction builders
  - W key derivation (HMAC from a master seed)
  - send path
  - curve and pool math
  - event decoding
- **D-07:** Phase 1 scripts in `scripts/spike/` are thin callers of `packages/core`. Phase 2 imports the same modules.
- **D-08:** Pin `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0. Load the SDKs only from server/worker code; web must never bundle them (agencybook pattern).
- **D-09:** Minimal monorepo skeleton only: root package.json, pnpm-workspace.yaml, packages/core, scripts/spike. Do not create apps/web or apps/worker yet; Phase 2 creates them. Vitest for unit checks on pure math (curve cost to complete, 90/10 split, 105% trigger).

### How fees get generated
- **D-10:** Simulated wallets trade each test coin, funded with fork airdrops, so creator fees accrue and are collected and split 90/10 for real.
- **D-11:** To reach the forced-bond threshold quickly, W may be topped up directly. The results page labels every top-up as such and keeps it separate from fees earned by trading.
- **D-12:** The 90/10 split is an off-chain transfer from W. 10% moves to the treasury keypair and 90% stays in W as the burn budget. The spike proves that both transfers land.

### Results page
- **D-13:** The spike writes one JSON results file and generates one static HTML page from it. Each row shows the step, pass/fail, signature, transaction bytes, compute units used and notes; failures show the error code. No server and no framework.

### Claude's Discretion
- How Surfpool is installed and started (it is not on PATH; agencybook used Surfpool 1.6.0). Pre-fund mints for the rent difference noted in agencybook (Surfpool keeps 6960 lamports/byte vs 5080 on mainnet).
- Script layout, naming and the order steps run in, as long as one command runs everything end to end.
- Whether to use a vanity `bndr` mint in the spike. Not required; vanity grinding belongs to Phase 2.
- How to measure transaction size and compute units (simulation results vs confirmed meta).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### BONDR spec
- `.planning/PROJECT.md` — "Fee Mechanic (source of truth)", Key Decisions, Risks
- `.planning/REQUIREMENTS.md` — SPIKE-01..05
- `.planning/ROADMAP.md` — Phase 1 success criteria
- `.planning/research/FINDINGS.md` — verified pump fee and mechanics facts, plus open unknowns

### pump.fun (external, re-clone before planning: `gh repo clone pump-fun/pump-public-docs`; findings were made at commit 639b87f)
- `docs/instructions/COIN_CREATION.md` — create_v2 accounts, quote mint remaining accounts, creator_fee_bps
- `docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md` — pump coin as quote, depth, error 6107, multi_hop_swap pointer
- `docs/instructions/CREATOR_FEE_SHARING.md` — create_fee_sharing_config, update_fee_shares_v2 locks after one use
- `docs/instructions/SWEEP_FEES.md`, `docs/instructions/COLLECT_CREATOR_FEE.md` — v3 fees kept on curve, sweep before config changes (6095, 6033)
- `docs/instructions/TRADE_V3.md`, `docs/SYNTHETIC_MIGRATION.md` — buy_exact_quote_in_v3, crossing the curve
- `docs/instructions/MULTI_HOP_SWAP.md` — SOL to quote coin to child routing
- `docs/PUMP_SWAP_README.md`, `docs/instructions/PUMP_SWAP_TRADE_V2.md` — post-migration buy
- `idl/` — account layouts used by the weekly contract check later

### agencybook reference implementation (outside this repo, read-only)
- `/Users/uzi/agencybook-phase-15/packages/core/src/launch/build.ts` — one-tx launch: create_v2 + fee sharing + dev buy, sign order A
- `/Users/uzi/agencybook-phase-15/packages/core/src/launch/sign.ts` — HMAC-derived mint and claim keypairs
- `/Users/uzi/agencybook-phase-15/packages/core/src/chain/pump.ts` — createRequire SDK loading that keeps SDKs out of web bundles
- `/Users/uzi/agencybook-phase-15/packages/core/src/chain/send.ts` — sendWithIntent, program allowlist, Helius Sender
- `/Users/uzi/agencybook-phase-15/packages/core/src/chain/crank.ts` — sweep/distribute builders, graduation detection
- `/Users/uzi/agencybook-phase-15/packages/core/src/chain/buyback.ts` — PumpSwap buy path (classic SPL deviation noted)
- `/Users/uzi/agencybook-phase-15/packages/core/src/chain/events.ts`, `decode.ts` — pump event and account decoding
- `/Users/uzi/agencybook-phase-15/.planning/research/v2-launchpad/PUMPFUN.md` — pump notes and gotchas

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No BONDR code exists yet (greenfield; the repo holds only AGENTS.md and .planning/).
- agencybook `packages/core/src/chain/*` and `launch/*` are the porting source. They have unit tests and snapshots that can be ported alongside the code.

### Established Patterns
- AGENTS.md rules: files under 300 lines, functions under 40 lines, one runnable check per non-trivial change, no emoji, `ponytail:` comments on deliberate shortcuts.
- agencybook: plain JSON-RPC instead of web3.js Connection for reads; SDKs loaded via createRequire; secrets only in worker env.

### Integration Points
- `packages/core` becomes the shared chain library for apps/web (Phase 2) and apps/worker (Phase 2 onward).

</code_context>

<specifics>
## Specific Ideas

- The results page is the owner's evidence that the mechanic works. Show the measured transaction sizes against the 1232-byte limit and compute units against the limit, so later decisions (adding a Streamflow lock or a Jito tip to the launch tx) can be judged from it.
- Record the live on-chain fee figures next to the values PROJECT.md assumes (0.95% + 1.5% on curve; 0.20% + 0.05% + 1.5% on PumpSwap), so any drift shows up immediately.

</specifics>

<deferred>
## Deferred Ideas

- Streamflow lock with a pump Token-2022 coin. LOCK-01 is v2. A fork test could later be added to the spike suite as a cheap way to unblock it.
- Real-mainnet smoke launch. Happens in Phase 7 with the BONDR token launch.
- Helius Sender / private send path. The fork has no private relay, so proving it belongs in Phase 2 (launch) and Phase 5 (forced bond).

</deferred>

---

*Phase: 01-chain-spike*
*Context gathered: 2026-10-19*
