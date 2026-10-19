# Phase 1: Chain Spike - Research

**Researched:** 2026-10-19
**Domain:** pump.fun programs (pump, pump-amm, pump-fees) via @pump-fun/pump-sdk 4.1.0 and @pump-fun/pump-swap-sdk 2.1.0; Solana devnet and a Surfpool mainnet fork
**Confidence:** HIGH for SDK surface, sizes and the launch tx (measured on a live fork this session); MEDIUM for devnet faucet and Helius limits

## Summary

Every pump primitive BONDR needs exists in the pinned SDKs and in the live programs. This session ran the riskiest step for real on a Surfpool 1.6.1 mainnet fork. It created a SOL-paired stand-in, then sent one v0 transaction for each exit: child `create_v2` (quote = stand-in, `creator_fee_bps` 150, creator = W), dev buy, then insta burn or insta sell. Both landed. Insta burn: 745 bytes, 346,803 CU. Insta sell: 742 bytes, 381,907 CU. In both, the dev's child balance afterwards was exactly 0 [VERIFIED: fork run, scratchpad/probe/launch.cjs]. No program check blocks selling or burning in the creating transaction.

Four findings change how the planner must build the spike:
1. **The launch tx needs an address lookup table.** Without one, every exit variant is 1,576 to 1,859 bytes, over the 1,232 limit.
2. **A table of only shared accounts is not always enough.** With such a table, "exact-out buy + multi_hop sell to SOL" is 1,215 to 1,242 bytes, at or over the limit. Per-mint keys must go in the table too, which is possible because mints are pre-generated.
3. **The dev buy must be exact tokens out (`buy_v3`), not `multi_hop_swap`.** Sell and burn both need the exact amount at signing time, and `multi_hop_swap` is exact-in only.
4. **The forced-bond burn has the same amount problem.** `buy_exact_quote_in_v3` only knows its token output after it executes.

The owner switched testing to hybrid (D-01). Devnet runs the **same pump and pump-amm bytecode** as mainnet (sha256 of the dumped ELF matches). Only pump-fees differs (873,241 vs 853,513 bytes) [VERIFIED: `solana program dump` both clusters]. Devnet Global has `initial_virtual_sol_reserves` = 0.3 SOL against mainnet's 30 SOL, so **a devnet curve completes for about 0.86 SOL**. That makes the devnet 6107 test cheap. Devnet's exotic fee schedule is all zero, so pump-coin-quoted coins fall back to flatFees (0.95% + 0.30%) on the curve. The PumpSwap creator fee for such pools on devnet is **0**. That is why post-bond distribution must stay on the fork.

**Primary recommendation:** build `packages/core` around the SDK builders plus three small in-house pieces: exact-out dev-buy math, a lookup-table helper (fork and devnet) and one send/measure helper. Run the D-01 devnet list first, then the fork list. Sequence the stand-in states deliberately (Pitfall 1). Write one results.json that a checker script asserts on.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Instruction building (create, trades, sweeps, fee sharing, multi-hop) | packages/core (server-only library) | - | Phase 2 web and worker import it; SDK must never reach a browser bundle (D-08) |
| W / treasury / ops key derivation | packages/core (worker-only module) | - | Master seed lives only in worker env (PROJECT.md Security) |
| Curve, pool, split, trigger math | packages/core (pure, no SDK) | - | Unit-testable with Vitest; web can show previews later |
| Send, confirm, measure bytes and CU | packages/core | scripts/spike | One send path, as agencybook send.ts |
| Network selection (devnet or fork), RPC URLs, guards | scripts/spike | - | Spike-only orchestration; reads `.env` |
| Results JSON and static HTML page | scripts/spike | - | D-13: no server, no framework |
| Chain state (curves, pools, configs) | Solana devnet / Surfpool fork | Helius RPC upstream | The source of truth being proven |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

#### Where the proof runs
- **D-01 (revised 2026-10-19 by owner):** Hybrid. Run every step devnet supports on devnet, matching the agencybook habit. Use the Surfpool mainnet fork only for the gaps. No real-mainnet transaction in Phase 1; real mainnet waits for Phase 7.
  - **Verified 2026-10-19:** devnet pump Global has `creator_fee_configurable = false` and `max_configurable_creator_fee_bps = 0` (mainnet: true / 300). `max_curve_depth` is 2 on both, and all three pump programs were redeployed on devnet within the last ~10 days.
  - **Devnet steps:** create_v2 with creator = W and a pump-coin quote (default creator fee), create + dev buy + insta sell/burn in one tx with size and CU measured, single update_fee_shares_v2 and the rejected second update (on an unbonded coin), multi_hop_swap, and the 6107 migration-window error if a stand-in can be completed cheaply. Otherwise that test moves to the fork.
  - **Fork-only steps:** anything needing creator_fee_bps 150, or around 85+ SOL of volume. That covers the 150 bps create, collect and 90/10 split on 1.5% fees, forced-bond buy_exact_quote_in_v3 + burn, migrate, post-migration PumpSwap buy + burn, and finalize + distribution after bond.
  - The results page labels each row with its environment (devnet or fork).
- **D-02:** The fork runs against current mainnet pump programs and Global/FeeConfig state. The spike reads live values (fee tiers, `max_curve_depth`, `creator_fee_configurable`, `max_configurable_creator_fee_bps`) and records them in the results. Nothing is hardcoded.
- **D-03:** Nobody runs pump's keeper on the fork. The spike calls `migrate` itself, which anyone may do. The results note that mainnet migration timing depends on pump's keeper.

#### BONDR stand-in states
- **D-04:** Create a fresh SOL-paired pump coin on the fork as the BONDR stand-in. The treasury keypair is its creator, matching the planned BONDR launch.
- **D-05:** Test child coins against all three stand-in states:
  1. Stand-in on its curve: child create, trades, forced bond.
  2. Stand-in complete but not migrated: child create must fail with `QuoteCurveAwaitingMigration` (6107). Record the error as a pass.
  3. Stand-in migrated to PumpSwap: child create, trades and the multi_hop_swap route still work.

#### Spike code
- **D-06:** Foundation, not throwaway. Pump logic goes into `packages/core` (TypeScript, pnpm workspace), ported from agencybook where it fits:
  - instruction builders
  - W key derivation (HMAC from a master seed)
  - send path
  - curve and pool math
  - event decoding
- **D-07:** Phase 1 scripts in `scripts/spike/` are thin callers of `packages/core`. Phase 2 imports the same modules.
- **D-08:** Pin `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0. Load the SDKs only from server/worker code; web must never bundle them (agencybook pattern).
- **D-09:** Minimal monorepo skeleton only: root package.json, pnpm-workspace.yaml, packages/core, scripts/spike. Do not create apps/web or apps/worker yet; Phase 2 creates them. Vitest for unit checks on pure math (curve cost to complete, 90/10 split, 105% trigger).

#### How fees get generated
- **D-10:** Simulated wallets trade each test coin, funded with fork airdrops, so creator fees accrue and are collected and split 90/10 for real.
- **D-11:** To reach the forced-bond threshold quickly, W may be topped up directly. The results page labels every top-up as such and keeps it separate from fees earned by trading.
- **D-12:** The 90/10 split is an off-chain transfer from W. 10% moves to the treasury keypair and 90% stays in W as the burn budget. The spike proves that both transfers land.

#### Results page
- **D-13:** The spike writes one JSON results file and generates one static HTML page from it. Each row shows the step, pass/fail, signature, transaction bytes, compute units used and notes; failures show the error code. No server and no framework.

### Claude's Discretion
- How Surfpool is installed and started (it is not on PATH; agencybook used Surfpool 1.6.0). Pre-fund mints for the rent difference noted in agencybook (Surfpool keeps 6960 lamports/byte vs 5080 on mainnet).
- Script layout, naming and the order steps run in, as long as one command runs everything end to end.
- Whether to use a vanity `bndr` mint in the spike. Not required; vanity grinding belongs to Phase 2.
- How to measure transaction size and compute units (simulation results vs confirmed meta).

### Deferred Ideas (OUT OF SCOPE)
- Streamflow lock with a pump Token-2022 coin. LOCK-01 is v2. A fork test could later be added to the spike suite as a cheap way to unblock it.
- Real-mainnet smoke launch. Happens in Phase 7 with the BONDR token launch.
- Helius Sender / private send path. The fork has no private relay, so proving it belongs in Phase 2 (launch) and Phase 5 (forced bond).

### Coordinator additions (2026-10-19, during research)
- Helius RPC: repo-root `.env` holds `helius_api_key` (gitignored; `.env.example` documents it, verified this session). Use Helius devnet for devnet steps and Helius mainnet as the Surfpool upstream. Never print the key.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPIKE-01 | One script creates a coin with creator = W, pump-coin quote, creator_fee_bps 150, prints signature | Devnet: default fee (150 is refused there, 6077). Fork: 150 bps. Builder `PUMP_SDK.createV2Instruction({... quoteMint: Q, quoteTokenProgram: TOKEN_2022, creatorFeeBps: new BN(150), pumpQuote })`, with `pumpQuote` from `OnlinePumpSdk.fetchPumpQuote(Q, { global })`. Proven on fork this session |
| SPIKE-02 | create + dev buy + insta sell, and separately + insta burn, in one tx with size and CU | Pattern 2 (exact-out dev buy) plus Pattern 3 (lookup table). Fork measurements: burn 745 B / 346,803 CU, sell 742 B / 381,907 CU |
| SPIKE-03 | Forced-bond buy + burn completes a curve in one tx; post-migration PumpSwap buy + burn | Pattern 4 (burn amount strategy), Pattern 6 (sequencing), `migrateV2Instruction`, `PUMP_AMM_SDK.buyV2Instructions` + BurnChecked (agencybook buyback proved buy + burn exactly on a fork) |
| SPIKE-04 | create_fee_sharing_config + single update_fee_shares_v2 sets 8000/2000, second rejected, distribution pays both | Pattern 5. Rejection is expected as pump-fees 6009 `SharingConfigAdminRevoked` or 6024 `FeeSharesAlreadyUpdated`; record the actual code. Run on devnet (unbonded) and again on the fork (bonded) because pump-fees bytecode differs |
| SPIKE-05 | multi_hop_swap buy and sell SOL to stand-in to coin | `OnlinePumpSdk.resolveMultiHopRoute([SOL, Q, C], "buy")`, `simulateMultiHopSwap` for minOut, `PUMP_SDK.multiHopSwapInstructions`. Two hops fit legacy size (docs) |
</phase_requirements>

## Project Constraints (from AGENTS.md)

There is no CLAUDE.md. These AGENTS.md directives apply to the plan:
- No code before the spec is approved. Done: Phase 1 planning is approved scope.
- No emoji anywhere: code, UI, commits, docs, results page.
- Never break the build. Tests stay green and the app stays runnable.
- Never commit secrets. `.env` is gitignored and `.env.example` is committed (verified: `.gitignore:1:.env`). Spike keypairs live outside the repo.
- Ask before destructive or outward-facing actions. Moving the owner's devnet SOL between wallets counts as outward-facing, so it needs a human checkpoint.
- Files under 300 lines, functions under 40 lines, three directory levels maximum, and a README.md in any directory with more than five files.
- Mark deliberate shortcuts with a `ponytail:` comment. Comments say why, not what. Delete dead code.
- One runnable check per non-trivial change. AGENTS.md also says "No test frameworks unless the project already has one". D-09 explicitly locks Vitest, so it is the owner decision and wins.
- Formatter and linter on save and in CI (Biome).
- `scripts/` holds one-command setup, dev, test and deploy.
- Branch per phase; never commit directly to main. Small commits after every green task.
- Default stack: TypeScript, pnpm, Vitest.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @pump-fun/pump-sdk | 4.1.0 (2026-10-13, latest) | Pump bonding curve, fee sharing and multi-hop builders | Locked D-08; official, matches docs @639b87f [VERIFIED: npm registry, pump-public-docs] |
| @pump-fun/pump-swap-sdk | 2.1.0 (latest) | PumpSwap buy_v2, sweeps, transfer_creator_fees_to_pump_v2 | Locked D-08 [VERIFIED: npm registry] |
| @solana/web3.js | 1.99.0 (latest 1.x) | Transactions, v0 messages, lookup tables | The SDKs depend on web3.js 1.x (`^1.98.2`) [VERIFIED: npm view] |
| @solana/spl-token | 0.4.15 | ATAs, `createBurnCheckedInstruction`, `createTransferCheckedInstruction` (Token-2022) | SDK peer, agencybook pin [VERIFIED: npm registry] |
| bn.js | 5.2.5 | SDK amount type | agencybook rule: bn.js, never anchor's BN [VERIFIED: agencybook chain/pump.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 5.0.5 (2026-10-15; engines node ^24) | Pure-math unit checks | D-09 [VERIFIED: npm view] |
| @biomejs/biome | 2.5.15 | Format and lint | agencybook pin, latest [VERIFIED: npm view] |
| typescript | 7.0.2 | Typecheck only (`noEmit`) | agencybook pin; Node 24 runs `.ts` directly via type stripping [VERIFIED: agencybook tsconfig.base.json] |
| @types/node | 24.19.2 | Node 24 types | Match Node 24, not the latest 26.x [VERIFIED: npm view] |
| @types/bn.js | 5.2.0 | bn.js types | [VERIFIED: npm view] |
| Surfpool | 1.6.1 (2026-10-10, latest release) | Mainnet fork for fork-only steps | Binary download, not npm [VERIFIED: gh release list solana-foundation/surfpool] |
| Runtime: Node | 24.x (local v24.13.0) | Runs `.ts` scripts directly | agencybook `engines` [VERIFIED: node --version] |
| pnpm | 10.34.7 as `packageManager` (local 10.28.2) | Workspace | agencybook used 10.34.6; pnpm 12 exists but stay on 10 [VERIFIED: npm view pnpm@10] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| web3.js 1.x | @solana/kit | The SDKs are web3.js 1.x. Mixing both doubles the code. Not now |
| Vitest | `node --test` (agencybook) | D-09 locks Vitest |
| Surfpool | solana-test-validator `--clone` | Needs explicit account clones. Surfpool fetches lazily and agencybook already proved it |
| `multi_hop_swap` dev buy | exact-out two-step buy (Pattern 2) | multi_hop is exact-in, so the burn or sell amount is unknown at signing |

**Installation:**
```bash
pnpm add -F @bondr/core @pump-fun/pump-sdk@4.1.0 @pump-fun/pump-swap-sdk@2.1.0 @solana/web3.js@1.99.0 @solana/spl-token@0.4.15 bn.js@5.2.5
pnpm add -D -w vitest@5.0.5 @biomejs/biome@2.5.15 typescript@7.0.2 @types/node@24.19.2 @types/bn.js@5.2.0
```
Use exact versions with no carets, as agencybook does. Keep `minimumReleaseAge: 1440` in pnpm-workspace.yaml (agencybook D-153).

## Package Legitimacy Audit

slopcheck 1.x was run as `slopcheck scan <manifest>` with npm detected from a package.json. The first `install` run auto-detected PyPI and is ignored.

| Package | Registry | Age | Source Repo | Postinstall | slopcheck | Disposition |
|---------|----------|-----|-------------|-------------|-----------|-------------|
| @pump-fun/pump-sdk 4.1.0 | npm | multi-year package, 4.1.0 from 2026-10-13 | github.com/pump-fun/pump-sdk | none | OK | Approved |
| @pump-fun/pump-swap-sdk 2.1.0 | npm | multi-year | github.com/pump-fun/pump-swap-sdk | none | OK (name-pattern note only) | Approved |
| @solana/web3.js 1.99.0 | npm | 6+ yrs | github.com/solana-foundation/solana-web3.js | none | OK | Approved |
| @solana/spl-token 0.4.15 | npm | 5+ yrs | github.com/solana-program/token-2022 | none | OK | Approved |
| bn.js 5.2.5 | npm | 10+ yrs | github.com/indutny/bn.js | none | OK | Approved |
| vitest 5.0.5 | npm | 4+ yrs | github.com/vitest-dev/vitest | none | SUS ("close to vite") | False positive: the official Vite test runner. Keep it, and add a one-line human confirm at install |
| @biomejs/biome 2.5.15 | npm | 3+ yrs | github.com/biomejs/biome | none | OK | Approved |
| typescript 7.0.2 | npm | 12+ yrs | github.com/microsoft/TypeScript | none | OK | Approved |
| @types/node, @types/bn.js | npm | DefinitelyTyped | DefinitelyTyped | none | OK | Approved |

**Packages removed due to slopcheck [SLOP]:** none.
**Packages flagged [SUS]:** vitest (false positive, see table).
**Transitive note:** pump-sdk 4.1.0 pulls `@pump-fun/agent-payments-sdk` 1.0.7 and a **nested `@pump-fun/pump-swap-sdk` 1.20.0** [VERIFIED: scratch install node_modules]. Always import pump-swap-sdk at top level (2.1.0), never through pump-sdk (agencybook Pitfall 23).

## Architecture Patterns

### System Architecture Diagram

```
  pnpm spike  (SPIKE_NET=devnet | fork | all)
       |
       v
  scripts/spike/run.ts --- reads .env (helius_api_key) --- builds RPC URL (never logged)
       |
       +--> net guard: getGenesisHash + host check
       |      devnet  -> genesis EtWTRABZ... else refuse
       |      fork    -> host 127.0.0.1 only (fork reports mainnet genesis)
       |      anything with mainnet genesis on a non-local host -> refuse
       |
       +--> read live config (Global, FeeConfig, AMM FeeConfig) -> results.config
       |
       v
  steps (ordered list, each = build -> send -> measure -> record row)
       |   build:  packages/core/pump/*  (SDK via createRequire)  + core/math (pure)
       |   keys:   packages/core/keys.ts  HMAC(master, "w:<net>:<mint>")
       |   send:   packages/core/send.ts  v0 msg [+ lookup table] -> sign -> send -> confirm
       |           -> getTransaction meta: computeUnitsConsumed, err; wire bytes
       |   decode: packages/core/events.ts (emit_cpi inner instructions, not logs)
       v
  results/<net>.json  (append rows: env, step, ok, sig, bytes, cu, err code, notes, facts)
       |
       v
  scripts/spike/check.ts  (asserts every SPIKE row) ---> exit 0/1
  scripts/spike/page.ts   (results/*.json -> results/index.html, static)

  Fork only: scripts/spike/fork.sh starts Surfpool 1.6.1 with
  SURFPOOL_DATASOURCE_RPC_URL = Helius mainnet (lazy account fetch on first read)
```

### Recommended Project Structure
```
package.json              # private, "type": "module", packageManager pnpm@10.34.7, engines node 24.x
pnpm-workspace.yaml       # packages: [packages/*]; minimumReleaseAge: 1440
biome.json
tsconfig.base.json        # copy of agencybook (nodenext, erasableSyntaxOnly, allowImportingTsExtensions, noEmit)
.env.example              # helius_api_key=, SPIKE_KEYS_DIR=, SPIKE_NET=
packages/core/
  package.json            # name @bondr/core, exports "./*": "./src/*.ts"
  src/
    pump.ts               # only SDK load (createRequire), re-exports
    keys.ts               # HMAC W/treasury/ops derivation
    rpc.ts                # stdlib JSON-RPC (port as is)
    send.ts               # build v0, sign, send, confirm, measure; allowlist
    alt.ts                # create/extend/wait lookup table
    math.ts               # split 90/10, 105% trigger, cost to complete, exact-out dev buy amounts
    launch.ts             # create + dev buy + exit instruction list
    fees.ts               # sweep+collect, split transfers, fee sharing, distribute
    trade.ts              # v3 buys/sells, forced bond, pool buy, multi-hop
    events.ts             # decode TradeEvent/CompleteEvent/etc from inner ixs
    math.test.ts, keys.test.ts
scripts/spike/
  run.ts                  # one command: picks net, runs step list, writes results
  steps-devnet.ts, steps-fork.ts
  check.ts                # results assertions (Nyquist)
  page.ts                 # static HTML
  fork.sh                 # download (once) + start Surfpool into scratch dir
  README.md
results/                  # gitignore *.json? No: commit the final results.json + index.html as evidence
```
packages/core/src has more than five files, so it needs a README.md (AGENTS.md section 5).

### Pattern 1: SDK loading (port agencybook chain/pump.ts)
**What:** load both SDKs through `createRequire`. Under plain Node 24, the pump-sdk ESM build crashes with "Named export 'BN' not found" because anchor is CommonJS.
**Example:**
```ts
// Source: /Users/uzi/agencybook-phase-15/packages/core/src/chain/pump.ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const amm = require("@pump-fun/pump-swap-sdk") as typeof import("@pump-fun/pump-swap-sdk");
export const { PUMP_SDK, OnlinePumpSdk, newBondingCurve, getBuyV3TokenAmountFromQuoteAmount,
  getBuyV3QuoteAmountFromTokenAmount, bondingCurvePda, feeSharingConfigPda, canonicalPumpPoolPdaWithQuote } = pump;
export const { PUMP_AMM_SDK, OnlinePumpAmmSdk } = amm;
```
Note: `getBuybackFeeRecipientForTokenQuote` is **not exported** by 4.1.0 [VERIFIED: runtime TypeError]. Use `global.buybackFeeRecipients[0]`, read live, and pass `buybackFeeRecipient` explicitly.

### Pattern 2: Exact-out dev buy (the launch tx) - proven on the fork
**What:** the dev pays SOL. Buy Q with `buy_exact_quote_in_v3` (SOL in, Q out at least `qMin`), then buy the child with `buy_v3` for an exact `amount` capped at `qMin`. Then burn or sell exactly `amount`. Leftover Q stays with the dev; it is BONDR, not launch supply.
**Instruction order (fork-verified):**
1. ComputeBudget price
2. ComputeBudget limit (600k)
3. `createV2Instruction` (quote Q, `creatorFeeBps` 150 on fork / omitted on devnet, `pumpQuote: fetchPumpQuote(Q).accounts`)
4. create dev's Q ATA (Token-2022, idempotent)
5. `getBuyExactQuoteInV3InstructionRaw` on Q (`quoteMint` NATIVE_MINT, `quoteTokenProgram` SPL Token, `buybackFeeRecipient` = wallet)
6. create dev's child ATA
7. create the buyback wallet's Q ATA (it must exist; the trade never creates it)
8. `getBuyV3InstructionRaw` child (`quoteMint` Q, `quoteTokenProgram` Token-2022)
9. `createBurnCheckedInstruction(amount, 6, Token-2022)` or `getSellV3InstructionRaw(amount)`

**Amount math:**
- `qMin = 0.99 * getBuyV3TokenAmountFromQuoteAmount({ bondingCurve: Q curve, amount: solIn, curveBaseTokenBalance })`
- Child curve: `newBondingCurve(global, Q, pq.curve.quoteControl, new BN(150), false, pq.curve)`
- `amount = 0.98 * getBuyV3TokenAmountFromQuoteAmount({ bondingCurve: child, amount: qMin, curveBaseTokenBalance: global.tokenTotalSupply })`

Scale `solIn` on devnet. The 0.25 SOL minimum is a mainnet value; devnet curves are 100x cheaper (Pitfall 1).

### Pattern 3: Lookup table for the launch
**What:** v0 message plus one lookup table. Program IDs and signers stay static. web3.js `compileToV0Message` already keeps invoked programs and signers out of the table.
**Measured (offline compile of real SDK instructions, name 32 chars, URI 66 or 96 chars):**

| Variant | No table | Shared-only table (keys common to all launches) | Full table (incl. per-mint keys) |
|---------|----------|-----------------------------------------------|-----------------------------------|
| exact-out buy + burn | 1,576-1,603 (too large) | 1,083-1,110 | 745 (fork, landed) |
| exact-out buy + sell_v3 child to Q | 1,604-1,631 | 1,080-1,107 | 742 (fork, landed) |
| exact-out buy + multi_hop sell child to Q to SOL | 1,832-1,859 | **1,215-1,242 (at or over limit)** | about 900 |
| multi_hop buy + burn | 1,610-1,637 | 1,055-1,082 | about 830 |
| exact-out + burn, Q migrated (+3 pool accounts) | 1,675-1,702 | 1,089-1,116 | about 806 |

**Fork/devnet table creation (agencybook rehearse.ts):**
1. Send `AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot: await conn.getSlot("finalized") })` and `extendLookupTable` (one tx is enough for up to about 30 keys).
2. Wait about 2 s (one slot of warm-up) before using it.
3. Fetch it with `conn.getAddressLookupTable(key)`.

On the fork, the 28-29 key tables cost 1,168-1,200 bytes and about 24.5k CU to create [VERIFIED: fork run].
**Decision for the planner:**
- Phase 1 uses a per-launch table that holds every non-signer key.
- Record both measurements: the shared-only size, and the actual size with the full table.
- Phase 2 then decides between a frozen shared table (agencybook D-193) with "sell to Q" as the sell exit, and a per-mint table pre-built for each pre-ground vanity mint.

### Pattern 4: Burn exactly what was bought (forced bond and fallback)
- **Fallback (pool):** `PUMP_AMM_SDK.buyV2Instructions(state, baseOut, maxQuoteIn)` takes an exact base out, so the burn amount is `baseOut`. agencybook proved an exact-out PumpSwap buy plus Token-2022 BurnChecked twice on a fork: residual 0, supply drop equal to the burn [VERIFIED: agencybook 12-07-SUMMARY.md].
- **Forced bond (curve):** the success criterion names `buy_exact_quote_in_v3`, whose output is variable. Do this:
  1. Build the buy.
  2. Simulate it (`simulateTransaction` with `accounts: [W child ATA]`, `replaceRecentBlockhash`) and read the exact out.
  3. Append `BurnChecked(simOut)`, then sign and send.
  4. Record W's child balance after the transaction (must be 0).
- On mainnet, a front-run between simulate and land either fails the burn (the whole tx reverts, which is safe) or leaves dust. Also run, and record, the `buy_v3` exact-amount variant with `max_sol_cost` = budget. It always burns exactly. Phase 5 chooses between them.

### Pattern 5: Fee sharing after bond (fork)

**Tx A, finalize.** Signer: W. Fee payer: ops. In order:
1. ops sends rent lamports to W.
2. `sweepCreatorFeeInstruction` (curve, creator = W).
3. `sweepPoolCreatorFeeInstruction` (pool).
4. `createFeeSharingConfig({ creator: W, mint, pool })`. Its `payer` is the creator, so W pays the 1,024-byte rent.
5. `updateFeeSharesV2({ authority: W, mint, currentShareholders: [W], newShareholders: [{deployer, 8000}, {treasury, 2000}], quoteMint: Q, quoteTokenProgram: TOKEN_2022, bondingCurveComplete: true })`. The pool goes last in remaining accounts.

Size and CU are unmeasured. If Tx A does not fit, split it: sweeps plus config first, then the update. Calling create twice is a no-op.

**Tx B, second update.** Must fail. Record the error code.

**Tx C, distribute.** After pool trades by the sim wallets: `OnlinePumpSdk.buildDistributeCreatorFeesInstructions(mint, { quoteMint: Q, quoteTokenProgram: TOKEN_2022, payer: ops })`. It prepends the sweeps and `transfer_creator_fees_to_pump_v2`, and with `initialize_ata` true it creates missing shareholder ATAs.

**Pass criteria:** deployer and treasury Q ATAs gain 80/20 of the distributed amount, plus or minus 1 unit. Decode the SharingConfig and show shares 8000/2000 and `admin_revoked`.

### Pattern 6: Stand-in sequencing (fork)

A child's raise is "what about 85 SOL buys of Q at the child's creation", counted in Q tokens. Measured on the fork: with Q only 5 SOL into its curve, a child's seed `virtual_quote_reserves` was 230.4M Q, which implies a raise of about 653M Q. That is most of Q's curve. Forcing such a child to bond would complete Q itself. So use this order:

1. **Q fresh (state 1).** Launch tests (SPIKE-01 and SPIKE-02 on the fork); sim wallets trade child C1 with v3 trades; sweep + collect + 90/10 split on C1.
2. **Q bought to about 90% by a "whale" sim wallet (still state 1).** Create C2, whose raise in Q is now small (about 115M Q by estimate). The whale tops up W2 with Q (D-11, labelled top-up). Forced bond C2 + burn, `migrateV2Instruction` C2, W2 PumpSwap buy + burn on C2's pool, sim pool trades, fee sharing finalize, second update rejected, distribute.
3. **Whale completes Q (state 2).** A child create must fail with 6107.
4. **`migrateV2Instruction` on Q (state 3).** Create C3 (`pumpQuote.accounts.pool` now set); trade it; multi_hop SOL to Q pool to C3, buy and sell.

`migrate_v2`:
- `withdrawAuthority` comes from the live Global (fork: `39azUYF...`, devnet: `5PXxuZk...`).
- Any signer can be `user`.
- The SDK appends two boost accounts.
- Base program is Token-2022. The quote program is SPL Token for SOL pairs and Token-2022 for Q pairs.

### Anti-Patterns to Avoid
- **Parsing `Program data:` logs for events.** Logs get truncated (Surfpool default `--log-bytes-limit 10000`). Decode emit_cpi inner instructions instead (agencybook events.ts). Start Surfpool with `--log-bytes-limit 0` anyway.
- **Hardcoding fee bps, rent or `withdrawAuthority`.** All of them differ between devnet and mainnet (table below).
- **Passing the Helius URL as `--rpc-url`.** It exposes the key in `ps`. Use `SURFPOOL_DATASOURCE_RPC_URL`.
- **Reusing one W for two coins.** The creator vault is keyed by creator, not by mint, so the fees would mix. Derive W per coin.
- **Calling `collectCoinCreatorFeeV2Instructions` without a sweep first.** v3 fees stay on the curve until `sweep_creator_fee`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| create_v2 remaining accounts for a pump-coin quote | Manual account list | `fetchPumpQuote(Q, { global })` then `createV2Instruction({ pumpQuote: .accounts })` | Positional groups change once Q migrates (+3 pool accounts), with depth checks (6101/6109) |
| Child seed reserves | Own chain pricing | `newBondingCurve(global, Q, qc, bps, false, pq.curve)` / `pumpQuoteReserves` | Mirrors the program, including synthetic migration pricing |
| v3 quote including synthetic migration | Own constant-product leg | `getBuyV3TokenAmountFromQuoteAmount` / `getBuyV3QuoteAmountFromTokenAmount` (need `curveBaseTokenBalance` from `fetchBuyState`) | Pool-to-be math and per-leg fees |
| Multi-hop route and min out | Own hop resolution | `resolveMultiHopRoute`, `simulateMultiHopSwap`, `multiHopSwapInstructions` (WSOL ATA, close, buyback ATA) | SOL-curve hops pay lamports and still need a WSOL ATA |
| Distribution prelude | Own sweep ordering | `buildDistributeCreatorFeesInstructions` | Prepends sweeps and consolidation in the right order |
| Fee schedule | Own tier logic | `computeFeesBps` / `selectCurveFeeSchedule` with the live FeeConfig | Exotic falls back to flat when it is all zero (devnet) |
| JSON-RPC with 429 backoff | New client | Port agencybook `chain/rpc.ts` (79 lines, stdlib) | Already handles retry-after and keeps the URL out of errors |

**Key insight:** pump ships breaking changes often (2025-11-11, 2026-03-19, 2026-09-01). The SDK builders track the program and hand-built account lists do not. BONDR code should own only the amounts, the order and the signing.

## Runtime State Inventory

Not a rename or migration phase. Omitted.

## Common Pitfalls

### Pitfall 1: Stand-in curve budget (both networks)
**What goes wrong:** every SOL routed through Q's curve (dev buys, multi_hop, sim trades) moves Q toward completion. Q then sits at "awaiting migration" and blocks child creation (6107) and every route through Q.
**Numbers:**
- Mainnet and fork: a curve completes at about 85 SOL raised.
- Devnet (`initialVirtualSolReserves` 0.3 SOL): about 0.85 SOL. 0.3 x 1073/279.9 - 0.3 = 0.85, plus 0.95% + 0.30% fees [VERIFIED: devnet Global read].
- Two 0.25 SOL devnet dev buys would use about 60% of the devnet Q budget.

**Avoid:** derive every SOL amount from `global.initialVirtualSolReserves` (e.g. `solIn = initialVirtualSolReserves / 120`). Track Q's `realQuoteReserves` before each step, and fail loudly if a step would complete Q outside its planned state.

### Pitfall 2: Surfpool rent is still 6,960 lamports per byte (1.6.1)
**Observed:** fork `getMinimumBalanceForRentExemption(0)` = 890,880. Mainnet = 650,240 [VERIFIED: this session, Surfpool 1.6.1, Agave core 4.2.1].
**Avoid:** pre-fund every fresh pump mint with 5,000,000 lamports in a prior fork-only tx (agencybook 08-10; worked this session). Devnet runs real rent, so no pre-fund is needed there.

### Pitfall 3: W needs some SOL even with an ops fee payer
**Why:** several instructions charge rent to the trading or creating account, not to the fee payer:
- `create_fee_sharing_config` (payer = creator).
- `buy_exact_quote_in_v3` (`user_volume_accumulator`, 137 bytes, paid by `user`).
- PumpSwap `buy_v2` (AMM user volume accumulator).

A system account left below the rent-exempt minimum makes the tx fail.
**Avoid:** first ix of each W tx is `SystemProgram.transfer(ops -> W, rent + buffer)`. Fund W once to at least the rent-exempt minimum (`getMinimumBalanceForRentExemption(0)`). PROJECT.md item 9 still holds for gas. Note the small W lamport float in results.

### Pitfall 4: Burn amount unknown with exact-in instructions
See Patterns 2 and 4. Never burn `min_amount_out`, because the dust stays with the dev or W and breaks "dev holds 0".

### Pitfall 5: Buyback recipient ATA for Q
Every v3 trade and route on a Q-quoted coin needs `buyback_wallet`'s Q ATA to exist, and the program never creates it. Add `createAssociatedTokenAccountIdempotent` before the first trade on each network. Then pass the same wallet (`global.buybackFeeRecipients[0]`) everywhere. SOL-quoted legs pass the wallet itself.

### Pitfall 6: Sweep before collect, config or distribute
v3 and PumpSwap v2 fees wait on the curve or pool:
- `distribute` and `create_fee_sharing_config` fail with 6095 without a prior `sweep_creator_fee` in the same tx.
- `update_fee_shares_v2` fails with 6033 if pool creator fees were not swept.
- `collect_creator_fee_v2` needs W's Q ATA to exist.

### Pitfall 7: Devnet fee schedule differs; devnet post-bond creator fee is zero
| Item | Mainnet / fork (live 2026-10-19) | Devnet (live 2026-10-19) |
|------|----------------------------------|--------------------------|
| `creatorFeeConfigurable` / max bps | true / 300 | false / 0, so 150 fails with 6077 (SDK throws `CreatorFeeNotConfigurableError` client-side) |
| `maxCurveDepth` | 2 | 2 |
| `initialVirtualSolReserves` | 30 SOL | 0.3 SOL |
| Curve flatFees | 95 protocol / 30 creator | 95 / 30 |
| Curve exoticFlatFees (pump-coin quote) | 95 / 30 (creator replaced by curve's 150) | 0/0/0, so flatFees apply (95/30) |
| AMM exoticFlatFees | LP 20 / protocol 5 / creator 5 (150 carried from curve) | 0/0/0, so AMM flat applies: LP 25 / protocol 5 / **creator 0** |
| AMM tier 0 (SOL pools) | 2 / 93 / 30 | 2 / 93 / 30 |
| Quote control mints | about 20 (xStocks etc.) | none; whitelist = devnet USDC |
| Holder rewards enabled | true | false |
| Bytecode | pump = devnet, amm = devnet, fees differs | |

The mainnet values match PROJECT.md (0.95% + 1.5% curve; 0.20% + 0.05% + 1.5% PumpSwap) [VERIFIED: fork read via SDK].

### Pitfall 8: Helius free tier limits
Current Helius docs give the free plan:
- 10 RPC requests/s
- **1 sendTransaction/s**
- 5 getProgramAccounts/s
- 1M credits/month

[CITED: helius.dev/docs/billing/rate-limits]
**Avoid:**
- The send helper paces sends at 1.1 s or more on devnet, and backs off on 429 using the ported rpc.ts.
- Surfpool fetches lazily (one upstream call per first-touched account), so fork warm-up is bursty. agencybook saw transient "from remote" errors on public RPC and retried up to 4 times with 10 s waits. Port that retry.
- Keep public mainnet RPC as a documented fallback upstream.

The fork itself has no limit, since sends go to localhost.

### Pitfall 9: Devnet SOL is scarce
- Public devnet `requestAirdrop` returned `-32603 Internal error` this session.
- faucet.solana.com allows about 2 requests per 8 h (more with GitHub login) [LOW: single secondary source].
- Helius devnet airdrop is about 1 SOL per request "with reasonable daily limits"; the dashboard faucet needs a paid plan [CITED: helius.dev/docs/faqs/accounts].

The devnet budget is in Environment Availability.

## Code Examples

### Sweep + collect + 90/10 split (pre-bond, fork)
```ts
// Source: pump-sdk 4.1.0 src/sdk.ts sweepCreatorFeeInstruction, src/onlineSdk.ts collectCoinCreatorFeeV2Instructions
const ixs = [
  createAta(ops, Q, W),                                    // W's Q ATA must exist
  await PUMP_SDK.sweepCreatorFeeInstruction({ payer: ops, mint: child, creator: W, quoteMint: Q, quoteTokenProgram: TOKEN_2022 }),
  ...(await online.collectCoinCreatorFeeV2Instructions(W, Q, TOKEN_2022, ops)), // permissionless, W not a signer
];
// Then tx 2, signed by W (fee payer ops): createAta(ops, Q, treasury) +
// createTransferCheckedInstruction(ataW, Q, ataTreasury, W, tenPct, 6, [], TOKEN_2022)
// with tenPct = collected * 1000n / 10000n from math.ts (pure, unit-tested).
```

### W derivation (port of agencybook launch/sign.ts claimKeypair)
```ts
// Source: /Users/uzi/agencybook-phase-15/packages/core/src/launch/sign.ts
import { createHmac } from "node:crypto";
import { Keypair } from "@solana/web3.js";
export const derive = (master: Buffer, role: "w" | "treasury" | "ops", net: string, id: string): Keypair =>
  Keypair.fromSeed(createHmac("sha256", master).update(`${role}:${net}:${id}`).digest());
// W: derive(seed, "w", net, mint.toBase58()). The mint is known before launch (pre-ground pool in Phase 2).
```
**Port:** the `claimKeypair` pattern (role and cluster in the HMAC input for domain separation) and its test.
**Drop:**
- `ipHmac`: Phase 2+ consent and abuse.
- `sameMessage` / `signatureOk` / `addSignature` / `slot`: Phase 2 co-sign. Port them then, with their tests.
- `probeTransaction`: agencybook-only.

### agencybook modules: port now vs later
| Module | Phase 1 | Notes |
|--------|---------|-------|
| chain/pump.ts (50 lines) | Port | Refresh the export list for 4.1.0 |
| chain/rpc.ts (79) | Port as is | Stdlib JSON-RPC, 429 backoff, URL-safe errors |
| chain/send.ts (395) | Port the core only | Keep `checkMessage` (allowlist; add SPL Token, which Q legs need for WSOL, and allow one table), `messageFee`, `budgetIxs`. Drop the DB intent rows, caps, alerts and Helius Sender (deferred) |
| chain/events.ts (144) | Port | emit_cpi inner-instruction decoding; add PostCompleteBuyEvent and SweepBondingCurveFeeEvent decoders (SDK has them) |
| chain/decode.ts (41) | Later (Phase 7 contract check) | Its Global offsets are for IDL 3.2.0 (1087 bytes); live Global is now 1088 bytes |
| chain/crank.ts, fees.ts, ledger.ts | Later (Phase 5) | Reference only; SOL-pair specific |
| chain/buyback.ts | Reference for Pattern 4 | Exact-out buy + BurnChecked + landed check |
| launch/build.ts, accounts.ts | Reference | Lookup-table helpers (`launchLutAddresses`, `lutProblem`) are useful in Phase 2 |
| apps/worker/src/cli/rehearse.ts | Reference | Fork send loop, prefund, table creation, migrate fallback |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| buy_v2 / sell_v2 pay fees per trade | buy_v3 / sell_v3 keep fees on the curve until swept | 2026-09 docs | Sweep before collect, config or distribute |
| Buy past the curve end fails | v3 buy completes the curve and continues in the pool-to-be (synthetic migration) | 2026 | Forced bond needs no exact remaining amount |
| `migrate` | `migrate_v2` (any quote, + 2 boost accounts) | 2026 | Use `migrateV2Instruction` for both Q and children |
| update_fee_shares repeatable | update_fee_shares_v2 once only (admin revoked) | 2026-03-19 | The single update is the finalize |
| Depth 1 pump-coin quotes | Depth 2 enabled (`max_curve_depth` 2) | 2026-10-13 | Children of BONDR are depth 1; fine |
| Surfpool 1.6.0 | 1.6.1 (2026-10-10), Agave core 4.2.1, still old rent | 2026-10-10 | Keep the pre-fund |

**Deprecated:** cashback coins (create rejects them), `create` (v1), buy past curve end via v2.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The second update_fee_shares_v2 fails with 6009 or 6024 (not checked on chain yet) | Pattern 5 | Only the recorded code changes; it must still fail |
| A2 | Finalize (2 sweeps + config + update) fits one tx | Pattern 5 | Split into two txs; the order is unchanged |
| A3 | A child's raise after the whale buy is about 115M Q (hand estimate) | Pattern 6 | The W top-up amount differs; read it from `newBondingCurve` at run time |
| A4 | faucet.solana.com allows 2 requests per 8 h | Pitfall 9 | Devnet funding takes longer; the owner may need GitHub login or Helius |
| A5 | Surfpool handles Helius 429s by surfacing an error (no built-in backoff) | Pitfall 8 | Add the retry wrapper either way |
| A6 | Devnet migrate_v2 is permissionless like mainnet (same pump bytecode, so likely) | Steps | 6107 / migration devnet test moves to the fork |
| A7 | `simulateTransaction` with the `accounts` option works on Surfpool | Pattern 4 | Use the confirmed balance delta of a dry-run tx on the fork instead |

## Open Questions

1. **Shared versus per-mint lookup table for Phase 2.**
   - Known: with a shared table only, multi_hop-to-SOL sell does not fit. A full table works.
   - Recommendation: Phase 1 records both. Phase 2 decides, which may mean defining insta sell as "sell to BONDR" (fits a shared table, 1,080-1,107 B).
2. **Should the 0.25 SOL dev-buy minimum be measured before the BONDR hop?** It is in PROJECT.md as a default. The exact-out pattern spends exactly `solIn`, so this is consistent.
3. **Exact second-update error code.** Record what the program returns (A1).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | all scripts | yes | v24.13.0 | - |
| pnpm | workspace | yes | 10.28.2 (pin 10.34.7 via packageManager / corepack) | - |
| solana CLI | balances, keygen, program dump | yes, at ~/.local/share/solana/install/active_release/bin (not on PATH) | 3.0.13 | Use the full path |
| Surfpool | fork steps | not installed; downloaded and run this session in scratch | 1.6.1 darwin-arm64 | `gh release download v1.6.1 -R solana-foundation/surfpool -p surfpool-darwin-arm64.tar.gz` into a gitignored `.cache/` or a scratch dir (agencybook downloaded per run) |
| gh | Surfpool download | yes | - | curl the release asset |
| Helius devnet + mainnet RPC | devnet steps, fork upstream | yes (`helius_api_key` in .env, getHealth ok per coordinator) | free tier assumed | Public RPCs (devnet airdrop currently failing) |
| Devnet SOL | devnet steps | partial, 0.58 SOL across agencybook wallets | - | Faucet / Helius airdrop |

**agencybook devnet wallets** (`/Users/uzi/.agencybook-devnet`, public keys and devnet balances only, 2026-10-19):

| File | Public key | Devnet SOL |
|------|-----------|------------|
| payer.json | 861zDyZ9JJYHhWb8sGDpKqNQmzYCZWCkfCy11V6zC6HK | 0.283864904 |
| phantom.json | DjoyHZmaYaVjkQDkZWTK1BvuH5KcmiMsgh6JMWvNmwbu | 0.099132646 |
| trader.json | AZw4k871BQrCFUYywsMbBMHfVj2a8HhHfSW2DNYTg4gz | 0.076676557 |
| buyback2.json | 9T4MS1rR3ctyqtF6ngVaoQuXKmk9UqjZxLruJ5bC2HtX | 0.057065316 |
| ops.json | EzshZBuxzW57C7YfUJdMHvv63wJvynnHtYNEPkLdemCw | 0.04996 |
| ai-costs.json | 9xuyrWYjqs1ixqFH7Gf1AS8YLcafNqeC788ZS6XmEzAe | 0.006940343 |
| third.json | BukF7j5t1W8N1KPuRPAgJWBGYngtnow5jsqucdwkFUJA | 0.004985 |
| buyback.json | 55sMBqKgwcCSUzTB1gWHkYrtEg9PGS4cG6G846dFp37V | 0.001078202 |
| backpack, solflare, holders-createkey, llm-createkey, treasury-createkey | FmfH..., 6EPb..., SQxf..., 8To6..., 9LQu... | 0 |

The other files are not keypairs: fund.json (a JSON object of multisig/vault addresses), lut.json, seed.bin, claim-seed.b64. The env files hold only variable names that matter here: devnet.env has `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `LAUNCHPAD_*`, `LAUNCH_MINT_SEED_KEY`; admin.env has `ADMIN_SECRET`. One public devnet `requestAirdrop` to payer.json was attempted and failed; nothing moved.

**Devnet SOL budget (estimate):**
- About 0.87 SOL to complete the devnet stand-in for the 6107 test.
- About 0.03 SOL per create (mint, curve, ATAs, mayhem accounts).
- Lookup tables about 0.003 SOL each.
- Small trade amounts.
- **Total: about 1.3 to 1.6 SOL.**

The 0.58 SOL on hand covers everything except the 6107 completion. Either the owner funds about 1 SOL more (faucet or Helius airdrop), or 6107 moves to the fork.

**Recommendation:** generate fresh BONDR spike keys under `~/.bondr-spike/<net>/` (outside the repo, mode 0600). A human checkpoint then moves agencybook payer.json SOL to the BONDR devnet payer.

**Missing with no fallback:** none.
**Missing with fallback:** devnet SOL top-up (fallback: run 6107 on the fork).

## One-Command Scripts (env-selected network)

- `pnpm spike` runs `node --env-file=.env scripts/spike/run.ts`, with `SPIKE_NET` = `devnet` | `fork` | `all` (default `all`: devnet, then fork).
- RPC URLs are built in code and never logged:
  - devnet: `https://devnet.helius-rpc.com/?api-key=${process.env.helius_api_key}`
  - fork: `http://127.0.0.1:18899`
- `pnpm spike:fork-up` runs `scripts/spike/fork.sh`:
  - It downloads Surfpool 1.6.1 once into `.cache/surfpool/`, which must be gitignored.
  - It exports `SURFPOOL_DATASOURCE_RPC_URL="https://mainnet.helius-rpc.com/?api-key=$helius_api_key"`.
  - It runs `surfpool start --no-tui --no-deploy --no-studio --port 18899 --ws-port 18900 --airdrop <ops> --airdrop <whale> --airdrop <dev> --log-bytes-limit 0 --log-path .cache/surfpool/logs`.
  - It polls `getSlot` (served in 3 s this session).
- `pnpm spike:fork-down` runs `pkill -f "surfpool start"`.
- `pnpm spike:check` runs `scripts/spike/check.ts`. `pnpm spike:page` runs `scripts/spike/page.ts`.
- Guards:
  - Fork steps refuse any host but 127.0.0.1.
  - Devnet steps require genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
  - Refuse any non-local URL whose genesis is mainnet `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` [VERIFIED: getGenesisHash both clusters].

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.5 (pure math, keys); results checker script for chain evidence |
| Config file | none. Wave 0: `vitest.config.ts` optional, defaults are fine |
| Quick run command | `pnpm vitest run packages/core` |
| Full suite command | `pnpm vitest run && pnpm spike:check` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPIKE-01 | create rows (devnet default fee; fork 150 bps) have ok + signature. Decoded curve: `creator == W`, `quoteMint == Q`, `depth == 1`, `creatorFeeBps == 150` (fork) | chain evidence | `pnpm spike:check` | Wave 0 |
| SPIKE-02 | Burn and sell launch rows on both nets: ok, sig, `bytes <= 1232`, `cu <= cuLimit`, dev child balance 0. Burn: supply drop == amount | chain evidence | `pnpm spike:check` | Wave 0 |
| SPIKE-03 | Forced-bond row: curve `complete == true` after the tx, a CompleteEvent decoded, W child balance 0 after. Pool buy+burn row: supply drop == baseOut. Migrate rows ok | chain evidence | `pnpm spike:check` | Wave 0 |
| SPIKE-04 | update row ok; decoded SharingConfig shares [8000, 2000] and admin revoked; second-update row `ok == false` with a pump-fees error code; distribute row: deployer delta : treasury delta = 80:20 within 1 unit; both deltas > 0 | chain evidence | `pnpm spike:check` | Wave 0 |
| SPIKE-05 | multi_hop buy and sell rows ok with `outAmount >= minAmountOut > 0`; 6107 row `err == 6107` | chain evidence | `pnpm spike:check` | Wave 0 |
| (math) | `split90_10(x)`: treasury + burn == x, treasury == floor(x/10). `trigger105(budget, cost)`. `costToComplete` equals SDK `getBuyV3QuoteAmountFromTokenAmount(remaining)`. Exact-out amounts never exceed `qMin` | unit | `pnpm vitest run packages/core/src/math.test.ts` | Wave 0 |
| (keys) | Derivation is deterministic; role, net and id each change the key | unit | `pnpm vitest run packages/core/src/keys.test.ts` | Wave 0 |
| (config) | results.config records live Global/FeeConfig for each net, and PROJECT.md fee assumptions are compared (drift flagged, not failed) | chain evidence | `pnpm spike:check` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run` (seconds) plus `biome ci .`
- **Per wave merge:** the affected net's `pnpm spike` (devnet about a few minutes at 1 send/s) and `pnpm spike:check`
- **Phase gate:** `SPIKE_NET=all pnpm spike && pnpm spike:check && pnpm spike:page`, all green, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Root package.json, pnpm-workspace.yaml, biome.json, tsconfig.base.json, `.gitignore` entries (`.cache/`, `.surfpool/`)
- [ ] `packages/core/src/math.test.ts`, `keys.test.ts`
- [ ] `scripts/spike/check.ts` with a results JSON row type shared with run.ts
- [ ] Spike key generation script (writes `~/.bondr-spike/<net>/*.json`, prints pubkeys only)

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | - |
| V3 Session Management | no | - |
| V4 Access Control | yes (which key signs what) | Signer roles fixed per step; program allowlist in `checkMessage` |
| V5 Input Validation | yes (RPC data, env) | Network guard (genesis + host); decoded accounts via SDK decoders |
| V6 Cryptography | yes | node:crypto HMAC-SHA256 + `Keypair.fromSeed`; never hand-roll ed25519 |
| V7 Errors and logging | yes | RPC URL (contains the API key) never logged; signatures fine (public) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leak via logs, `ps`, error strings | Information disclosure | `SURFPOOL_DATASOURCE_RPC_URL` env, redacted errors (agencybook rpc.ts), `.env` gitignored |
| Spike accidentally sends to mainnet | Tampering | Genesis + host guard refuses non-local mainnet |
| Secret key files committed | Information disclosure | Keys outside the repo, mode 0600; print pubkeys only |
| Unexpected program in a signed tx | Elevation | Port the `checkMessage` allowlist (pump, amm, fees, Token, Token-2022, ATA, System, ComputeBudget, ALT program for table txs) |

## Risks That Could Force a PROJECT.md Change (ranked)

1. **Launch tx size (Fee Mechanic item 2).** "Routed SOL to BONDR to coin" with multi_hop sell back to SOL does not fit with a shared table. The likely spec change: insta sell = sell to BONDR (the dev keeps BONDR), or a per-mint lookup table per launch. Measured, high likelihood.
2. **Dev buy routing wording.** Exact-out needs the dev to hold BONDR mid-tx. Leftover BONDR dust stays with the dev, which is not launch supply. The PROJECT.md "measured on the SOL input before the BONDR hop" still holds.
3. **W needs a small SOL float (item 9).** Rent for the sharing config (about 0.006 SOL mainnet) and volume accumulators is paid by W. Ops can fund it in the same tx, but the wording should change.
4. **Forced-bond exactness (item 5).** If `buy_exact_quote_in_v3` + simulated burn shows dust under contention, switch to `buy_v3` exact amount.
5. **pump-fees bytecode differs on devnet.** A devnet-only fee-sharing pass is weaker evidence, so the fork repeat is required.
6. **Stand-in raise size.** A child's raise is about 85 SOL worth of BONDR at creation time. Early children need most of BONDR's curve to bond. This affects the forced-bond trigger economics (105% of a large number) and "Forced bond rarely triggers".
7. **Helius free tier (1 send/s)** slows the devnet run but does not block it.

## Sources

### Primary (HIGH confidence)
- pump-fun/pump-public-docs @639b87f (latest, re-fetched this session): COIN_CREATION, CREATE_WITH_PUMP_COIN_QUOTE, TRADE_V3, SYNTHETIC_MIGRATION, MULTI_HOP_SWAP, SWEEP_FEES, COLLECT_CREATOR_FEE, CREATOR_FEE_SHARING, PUMP_SWAP_TRADE_V2, PUMP_PROGRAM_README, PUMP_SWAP_README, FEE_PROGRAM_README; idl/pump.json, pump_amm.json, pump_fees.json (errors, migrate_v2 accounts)
- @pump-fun/pump-sdk 4.1.0 src (sdk.ts, onlineSdk.ts, bondingCurve.ts, fees.ts) and @pump-fun/pump-swap-sdk 2.1.0 src (offlinePumpAmm.ts, onlinePumpAmm.ts), in the scratch install
- Live reads via the SDK: fork (Surfpool 1.6.1 from mainnet slot 458,703,277) and api.devnet.solana.com; `solana program dump` on both clusters; getGenesisHash on both
- Fork probe runs: scratchpad/probe/launch.cjs, measure.cjs, read-global.cjs, quotes.cjs
- Surfpool 1.6.1 `start --help`; gh release list solana-foundation/surfpool
- agencybook: packages/core/src/chain/{pump,send,rpc,events,decode,crank,buyback}.ts, launch/{build,accounts,sign}.ts, apps/worker/src/cli/rehearse.ts, .planning 08-10 / 10-17 / 12-07 / 14-01 summaries

### Secondary (MEDIUM confidence)
- [Helius rate limits](https://www.helius.dev/docs/billing/rate-limits): 10 rps, 1 sendTransaction/s, 5 gPA/s on Free
- [Helius plans / billing](https://www.helius.dev/docs/billing): 1M credits/month on Free
- [Helius accounts FAQ](https://www.helius.dev/docs/faqs/accounts.md): devnet airdrop about 1 SOL/request

### Tertiary (LOW confidence)
- [Eco support article on the devnet faucet](https://eco.com/support/en/articles/17593748-solana-devnet-faucet-get-devnet-sol-and-connect-to-devnet): 2 requests / 8 h
- [Metaplex airdrop guide](https://developers.metaplex.com/solana/airdrop-sol-for-development): CLI 2 SOL max per request

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Registry-verified versions; agencybook precedent.
- Architecture and launch tx: HIGH. Measured on a live fork with the real SDK and programs.
- Fee sharing and forced bond specifics: MEDIUM. Doc- and SDK-verified, not yet executed this session.
- Devnet funding and Helius limits: MEDIUM to LOW.

**Research date:** 2026-10-19
**Valid until:** about 2026-10-26. pump ships breaking changes on short notice; re-check the docs repo HEAD and the program deploy slots before executing.
