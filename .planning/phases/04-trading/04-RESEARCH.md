# Phase 4: Trading - Research

**Researched:** 2026-10-24
**Domain:** pump.fun `multi_hop_swap` quoting, building and sending (SOL to BONDR to coin), worker HTTP routes, Phantom signTransaction flow
**Confidence:** HIGH for the quote math, error codes, fee semantics and flow (verified against installed SDK source, fixtures and live devnet probes). MEDIUM for PumpSwap coin-pool quotes (SDK-sourced, not yet run against a fork pool).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried forward (locked earlier)
- **D-01:** No platform trading fee (PROJECT.md decision; TRADE-04). Fee tiers are read from the live FeeConfig and Global, never hardcoded (PROJECT.md Pump coupling). Pinned to `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0.
- **D-02:** The worker owns chain access and the Helius key. The web calls the worker over private HTTP with a token. Phantom signs with `solana:signTransaction` only, never signAndSend (the Phase 2 wallet.tsx pattern). The CSP `connect-src 'self'` stays, so the browser never calls RPC directly.
- **D-03:** SOL-equivalent values everywhere (Phase 3 D-01). Devnet only until Phase 7.
- **D-04:** Neon budget (Phase 3 D-04): quotes, builds and balance reads touch the chain through the worker, never Postgres. No new periodic DB reads.
- **D-05:** Layout follows the approved `token.html` mockup trade panel and Phase 3 D-11a. On wide screens the trade panel takes the 380px right column above Bond and burn. Below the wide breakpoint it is a bottom sheet opened from a sticky Buy / Sell bar. gsd-ui-phase writes the UI-SPEC before planning.

#### Transaction flow
- **D-06:** Mirror the Phase 2 launch flow, with no co-sign:
  1. The browser posts the side, amount and wallet to `/api/trade/prepare`.
  2. The worker resolves the route, simulates it and builds an unsigned v0 transaction with the user as fee payer.
  3. Phantom signs (`signTransaction`).
  4. `/api/trade/submit` hands the signed transaction to the worker, which checks it is byte-for-byte what it built (message unchanged), sends it through Helius and confirms it.
  5. The browser shows confirmed, failed or expired.
- **D-07:** The worker stores the transactions it built (keyed by id) in memory for 2 minutes, not in Postgres (D-04), so submit can compare the signed message against what was prepared. ponytail: per-process, single replica.
- **D-08:** Compute budget: the CU limit comes from the simulation plus 10%. The priority fee is Helius `getPriorityFeeEstimate` (Medium), capped at 0.0005 SOL a trade. The user pays it.
- **D-09:** Consent: trading sends the wallet address to the server, so it requires the existing Phase 2 consent, reusing the session and consent prompt.

#### Quote preview
- **D-10:** Quotes come from the worker via `/api/trade/quote`. The research picks the method. Quotes must work before a wallet connects, so the buy preview cannot depend on simulating as the user. Exact `minAmountOut` is always set from a fresh simulation at prepare time.
- **D-11:** The quote shows:
  - the amount you receive
  - the route (for example "SOL > BONDR curve > GRUB curve")
  - price impact
  - minimum received
  - total fees in SOL, broken down as in the mockup: pump protocol, creator, LP when on a pool, and the SOL to BONDR hop fee
  - "BONDR platform fee 0"
- **D-12:** The quote refreshes every 2 s (the mockup's fine print) while the panel is visible, the tab is in the foreground and an amount is set. It pauses after 60 s without input, showing "Quote paused, tap to refresh". Typing is debounced at 400 ms, the Phase 2 quote pattern.
- **D-13:** A price impact over 5% shows a warning. Over 15%, the button asks to confirm the impact.

#### Amounts and slippage
- **D-14:** Buy presets: 0.1, 0.5, 1 SOL and Max. Max is the balance minus a 0.01 SOL reserve for fees and rent. Sell presets: 25%, 50%, 75% and 100% of the coin balance. Amounts can also be typed.
- **D-15:** Slippage chips are 0.5%, 1% and 3%, plus Custom (0.1% to 50%). The default is 1%, remembered per browser in localStorage.
- **D-16:** Balances (SOL and the coin) come from the worker via `/api/trade/balance`. They are fetched when the wallet connects, after each trade, and when the tab returns to the foreground; never on a timer.

#### Results and errors
- **D-17:** On success the panel shows "Bought X GRUB" or "Sold for X SOL" with a Solscan link, refreshes the balances, and the trade appears in the feed through SSE. On failure it shows plain messages:
  - "Price moved more than your slippage. Try again or raise slippage."
  - "Not enough SOL for this trade and fees."
  - "Trading pauses for a few seconds while BONDR moves to PumpSwap." This is the pump 6107 and complete-but-unmigrated window.
  - "Signature declined."
  - "Transaction expired. Try again."
- **D-18:** No trading kill switch in Phase 4. Phase 6 owns the kill switches; trading never moves platform funds.

#### Testing
- **D-19:** Unit tests (Vitest) cover the quote math, fee breakdown and message-unchanged check. E2E (Playwright) uses the existing Phantom mock for UI states. One real devnet buy and sell runs on a curve coin through the e2e devnet group, paid by the sim wallet with a 0.05 SOL cap. The PumpSwap path is proven against the Phase 1 fork fixtures and the Surfpool fork, because devnet cannot bond a child (Phase 3 A8).

### Claude's Discretion
- The quote method: pure SDK math on fetched curve and pool state, or a simulation from a funded worker-side account. It must meet D-10 and the Helius budget (D-05 of Phase 3).
- Whether the worker caches curve and pool state per coin for a second or two so the 2 s refresh from many viewers costs one read.
- Exact rate limits for `/api/trade/*`, following the guard.ts style.
- How the sell side quotes "you receive about X SOL" through two hops.
- How "Max" accounts for ATA rent on a first buy.

### Deferred Ideas (OUT OF SCOPE)
- Trading kill switch: Phase 6, if needed.
- Limit orders and a portfolio page: out of scope for v1.
- Priority-fee user setting: later, if traders ask.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRADE-01 | Buy a coin with SOL, routed SOL to BONDR to coin through multi_hop_swap, in one Phantom signature | Prepare reuses `routeBuy` (core/route.ts); final message is v0, no lookup table, 1,110 bytes on devnet (probe) and 1,132 on the fork pool route; submit reuses `sameMessage` and `signatureOk` from core/cosign.ts and sig.ts; send and confirm reuse core/send.ts |
| TRADE-02 | Sell back the same way | `routeSell`; sell output is lamports at a SOL curve end (SDK parses the TradeEvent), WSOL closed at a pool end; amounts from `tokenDelta` and `lamportDelta` (scripts/spike/stages/multihop.ts, moved to core) |
| TRADE-03 | Quote preview with tokens out, price impact, fees; slippage before signing | Pure quote: `multiHopSwapQuote` (pump-swap-sdk 2.1.0) with a fee-masked curve hop callback; matches the devnet simulation to the base unit (probe diff 0) and the fixture events exactly. 2 s single-flight state cache per mint |
| TRADE-04 | Curve and PumpSwap, fees from live FeeConfig, no platform fee | Venue per hop from chain state; rates from SDK `computeFeesBps` (pump) and `computeAmmFeesBps` (pump-swap, market-cap tiers, per-pool creator rate); masks from pump-swap `resolveMultiHopRoute().legs`. No BONDR instruction or account touches the trade, so the platform fee is structurally 0 |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Ponytail `full`: reuse before writing; no new dependencies (none are needed, see Standard Stack).
- No emoji anywhere (code, UI, commits, docs).
- Files under 300 lines, functions under 40 lines, three directory levels max, a `README.md` in any directory past five files (apps/worker/src, apps/web/lib, components and core/src already have one; update them).
- Comments say why, never what. Deliberate shortcuts carry a `ponytail:` comment with ceiling and upgrade path (the in-memory trade store, the per-process cache, the per-IP limiter).
- One runnable check per non-trivial change; Vitest for units, Playwright for e2e (both installed). No new test framework.
- Never commit secrets; the Helius key stays in `.env` (`helius_api_key`), reached only through core/net.ts and always `redact`ed in logs.
- Ask before outward-facing actions: the real devnet buy and sell spends sim-wallet SOL (devnet, capped at 0.05 SOL by D-19, no real money), so it is routine; anything mainnet is Phase 7.
- Every UI phase ends with Playwright screenshots at 390, 768 and 1440, axe at 0 violations, Designer critique.
- Branch `phase-04-trading` (current); commit after every green task; PR per phase.
- Devnet only: worker `launchNet` refuses mainnet; keep it that way.

## Summary

The two-hop quote is solved by an SDK function that the Phase 2 code never used: `@pump-fun/pump-swap-sdk` 2.1.0 exports `multiHopSwapQuote`, an offline route quoter that prices pool hops itself and takes a caller-supplied `quote(amountIn, { isBuy, legs })` for each curve hop. The `legs` mask encodes the rule the program enforces (pump-amm `HopFees::for_hop`): **the protocol fee is charged once, on the hop that trades the user's SOL; the creator fee and a pool's LP fee are charged once, on the hop that trades the far coin; a middle hop charges nothing.** The devnet multi-hop fixture confirms it byte for byte: the SOL to BONDR hop charged 95 bps protocol and 0 creator, the BONDR to coin hop charged 0 protocol and 30 bps creator. A curve hop callback that mirrors pump's v3 exact-quote-in arithmetic with the masked rates reproduced both fixture hops exactly and matched a live devnet `simulateMultiHopSwap` of 0.01 SOL to the base unit (87,944,488,296,093 out, diff 0). So quotes need no wallet and no simulation: one batched account read per mint, cached 2 s, serves every viewer.

The build and submit flow is mostly reuse. `routeBuy` and `routeSell` already resolve venues, simulate as the user and build the instructions. Prepare adds a second simulation of the final compiled message (to read `unitsConsumed` for the CU limit plus 10%, and to get structured errors), a priority fee, a blockhash and an in-memory entry. Submit reuses `sameMessage(stored, wire, 1)` and `signatureOk` from the launch co-sign, then `broadcast` and the confirm and settle logic from core/send.ts. The browser polls the worker's in-memory entry (no RPC, no Postgres) until it is landed, failed or unknown. One surprise: **Helius `getPriorityFeeEstimate` returns `-32601 Method not found` on the devnet endpoint** (it works on mainnet), so D-08 needs the existing `PRIORITY_FEE_MICROLAMPORTS` value as the devnet and error fallback.

The fee breakdown in the UI-SPEC lists "Pump protocol" under the coin hop. Under multi-hop semantics that row is always 0 on a two-hop route: the protocol fee lands on the SOL to BONDR hop instead, and BONDR's own curve creator fee and BONDR pool LP fee are not charged at all. The quote must return masked per-hop rates, and the UI copy needs a small amendment (Open Question 1).

**Primary recommendation:** Quote with `multiHopSwapQuote` plus a 20-line masked curve hop function in a new `packages/core/src/quote.ts`, over a 2 s single-flight per-mint cache of one `getMultipleAccountsInfo`; build with `routeBuy`/`routeSell` plus a final-message simulation; verify with `sameMessage` + `signatureOk`; settle in the background and let the browser poll the worker's memory.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trade panel, sheet, debounce, 2 s refresh loop, presets, slippage storage | Browser (`components/trade-*.tsx`, `lib/use-trade.ts`) | — | UI state only; CSP blocks RPC from the browser (D-02) |
| Signing | Browser (Phantom `solana:signTransaction`) | — | Only the user's key signs; worker holds no key for trades |
| Same-origin, JSON caps, per-IP and per-wallet rate limits, consent session | Frontend server (Next route handlers `app/api/trade/*`, `lib/guard.ts`, `lib/session.ts`) | — | Existing guard pattern; wallet always from the HMAC session cookie, never the body (Phase 2 CR-01) |
| Venue resolution, quote math, fee breakdown, state cache | API / Backend (worker `trade-quote.ts`, core `quote.ts`) | — | Needs the SDKs and RPC; core is worker-only for SDK modules (pump.ts must never reach web) |
| Build, simulate, CU and priority fee, in-memory store, byte compare, send, confirm | API / Backend (worker `trade-prepare.ts`, `trade-submit.ts`) | — | Helius key lives here; the byte compare stops the worker from relaying arbitrary transactions |
| Balances | API / Backend (worker `/trade/balance`) | — | One `getMultipleAccountsInfo` of wallet plus coin ATA |
| Feed and chart update after a landed trade | API / Backend (Phase 3 stream and ingest) | Browser (SSE) | Already works: every route passes BONDR's mint, which the stream subscribes to |
| Persistence | none | — | D-04: no Postgres in the trade path. The feed row comes from the existing indexer |

## Standard Stack

No new packages. Everything is installed and pinned.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@pump-fun/pump-swap-sdk` | 2.1.0 (resolved for `@bondr/core`; the nested 1.20.0 copy under pump-sdk must never be imported) | `multiHopSwapQuote`, `resolveMultiHopRoute` (legs mask), `computeFeesBps` (pool tiers), `PUMP_AMM_SDK.decodePool/decodeGlobalConfig/decodeFeeConfig` | Mirrors pump-amm `multi_hop_swap` pool arithmetic (`rust reference: pump-amm multi_hop_swap pool_hop()`) [VERIFIED: node_modules source src/sdk/multiHop.ts; runtime exports checked] |
| `@pump-fun/pump-sdk` | 4.1.0 | `OnlinePumpSdk.resolveMultiHopRoute`, `simulateMultiHopSwap`, `PUMP_SDK.multiHopSwapInstructions`, `computeFeesBps`, `decodeBondingCurve/decodeGlobal/decodeFeeConfig`, PDAs | Already the route builder (core/route.ts, proven in Phase 1) [VERIFIED: node_modules source] |
| `@solana/web3.js` | 1.99.0 | v0 message, simulate, send | Existing |
| `@solana/spl-token` | 0.4.15 | ATA addresses, `unpackAccount`/`AccountLayout` for vault and balance decode | Existing |
| `bn.js` | 5.2.5 | SDK amounts | Existing (never anchor's BN, pump.ts note) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 4.1.11 | Unit tests (`pnpm test`) | quote, error map, store, CU and priority clamp |
| `@playwright/test` | 1.63.0 | E2E (`pnpm e2e`) | panel states with the fake Phantom; `E2E_DEVNET=1` real trade |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure `multiHopSwapQuote` | `simulateMultiHopSwap` as an ops-funded wallet | Needs the ops wallet to hold the full buy amount (it has 2.75 SOL on devnet; a 50 SOL quote cannot run), cannot quote sells at all (ops holds no coin), costs 2 credits plus a 700 ms simulation per quote. Rejected |
| Masked curve callback | pump-sdk `getBuyV3TokenAmountFromQuoteAmount` | Charges protocol plus creator on every hop, so it under-quotes a route (the SDK doc on `MultiHopCurveQuoteHop` says exactly this). Rejected for routes |
| Browser polls worker memory | Hold `/api/trade/submit` open until confirmed | One call fewer, but the confirm can run to blockhash expiry (about 60 s) and a dropped response leaves the browser without a signature (web has no bs58). Polling mirrors Phase 2 `poll()` |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. All libraries above are already in `pnpm-lock.yaml` and pinned by D-01.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | — | — | — | — | not run (nothing to install) | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Browser (trade panel)                     Web (Next route handlers)              Worker (private HTTP)                     Chain (Helius devnet)
 ---------------------                     -------------------------              ---------------------                     ---------------------
 amount/side/slippage --400ms debounce-->  POST /api/trade/quote  --bearer-->     /trade/quote
   (no wallet needed)    + every 2 s        sameOrigin, 120/min/IP                  mint in knownCoins? else 404
                                                                                    state(Q), state(C): 2 s single-flight cache --miss--> getMultipleAccountsInfo (1 credit/mint)
                                                                                    configs: 60 s cache ---------------------------------> Global, FeeConfig, AMM GlobalConfig, AMM FeeConfig
                                                                                    complete && no pool? -> 409 paused awaiting_migration
                                                                                    multiHopSwapQuote(masked curve hops, SDK pool hops)
 <---------- amountOut, minOut, impact, route, per-hop fees (SOL), platformFee 0 ----

 Buy/Sell press  ---------------------->   POST /api/trade/prepare               /trade/prepare
                                            session wallet (no body wallet),       routeBuy/routeSell: resolve + simulateMultiHopSwap as user --> simulate (expectedOut)
                                            30/10min/IP+wallet                     minOut = expectedOut * (1 - slippage)
                                                                                   priority fee (devnet: env; mainnet: getPriorityFeeEstimate) -> clamp
                                                                                   compile v0 [CU price, CU limit, ...ixs], simulate final ----> unitsConsumed, err
                                                                                   err? map 6004/1/AccountNotFound/6107 -> contract error
                                                                                   CU limit = ceil(units*1.1); recompile with blockhash --------> getLatestBlockhash
                                                                                   store {id, wallet, message bytes, lvbh, side, mint} 120 s
 <---------- {tradeId, tx base64, signBy, expectedOut, minOut} --------------------
 Phantom signTransaction (race signBy timer)
 signed wire  -------------------------->  POST /api/trade/submit                /trade/submit
                                            session wallet == entry wallet         entry exists, not expired (block height) -> 410
                                                                                   sameMessage(stored, wire, 1) && signatureOk(slot0, wallet) -> else 422
                                                                                   broadcast (preflight) ------------------------------------> sendRawTransaction
                                                                                   preflight err? map -> failed + code
                                                                                   state=sent; settle in background (confirm, fetchTx) ------> getSignatureStatuses, getTransaction
 <---------- {state: sent, signature} ----
 poll GET /api/trade/{id} every 1 s -->    GET (no RPC) ----------------------->   entry state: sent | landed {amountOut} | failed {code} | unknown
 result callout, balance refetch           POST /api/trade/balance ------------>   /trade/balance: getMultipleAccountsInfo([wallet, coin ATA]) (1 credit)

 Feed and chart: unchanged Phase 3 path. The landed tx mentions BONDR's mint -> logsSubscribe -> ingest -> SSE.
```

### Recommended Project Structure

```
packages/core/src/
  quote.ts           # pure route quote: masked curve hop, multiHopSwapQuote call, fees, impact (worker-side: imports pump.ts)
  quote.test.ts      # fixture exactness (multihop-buy/sell.json), masks, impact, sell path
  trade-error.ts     # sim/preflight/on-chain error -> contract code (or extend build.ts simError and move it here)
  api.ts             # + TradeQuote, TradePrepare, TradeView, TradeErrorCode types (web-safe, types only)
apps/worker/src/
  trade-state.ts     # 2 s per-mint single-flight cache, 60 s config cache, one getMultipleAccountsInfo per mint
  trade-quote.ts     # /trade/quote and /trade/balance handlers, request parsing
  trade-prepare.ts   # /trade/prepare: route, final sim, CU, priority, store
  trade-submit.ts    # /trade/submit and GET /trade/:id: byte check, broadcast, background settle
  trade-store.ts     # in-memory Map with 120 s TTL (ponytail: single replica)
apps/web/
  app/api/trade/{quote,prepare,submit,balance}/route.ts, app/api/trade/[id]/route.ts
  lib/use-trade.ts, lib/trade-run.ts            # UI-SPEC names
  components/trade-panel.tsx, trade-amount.tsx, trade-quote.tsx, trade-sheet.tsx, trade-bar.tsx
```

The worker router keys on exact `METHOD /path`, so a dynamic `GET /trade/:id` does not fit `Routes`. Use `POST /trade/view` with `{ tradeId }` (the web GET handler forwards to it), which keeps http.ts unchanged.

### Pattern 1: Pure route quote with fee masks
**What:** Price each hop from pre-route state; pool hops by the SDK, curve hops by a callback that charges only the components the program charges on that hop.
**When to use:** Every `/trade/quote` call, buy and sell, wallet or not.
**Example:**
```typescript
// Source: pump-swap-sdk 2.1.0 src/sdk/multiHop.ts (multiHopSwapQuote, MultiHopCurveQuoteHop doc);
// curve arithmetic mirrors pump-sdk 4.1.0 bondingCurve.ts v3ExactQuoteInNet / getSellSolAmountFromTokenAmount.
// Verified: reproduces both hops of fixtures/multihop-buy.json and multihop-sell.json exactly, and a live devnet
// simulateMultiHopSwap of 0.01 SOL to the base unit (2026-10-24).
const ceilFee = (x: bigint, bps: bigint): bigint => (x * bps + 9_999n) / 10_000n;

export type CurveState = { vQ: bigint; vT: bigint; realTokens: bigint; protocolBps: bigint; creatorBps: bigint };
type Legs = { protocol: boolean; creator: boolean };

export function curveHop(c: CurveState, amountIn: bigint, isBuy: boolean, legs: Legs): bigint {
  const p = legs.protocol ? c.protocolBps : 0n;
  const k = legs.creator ? c.creatorBps : 0n; // creatorBps is already 0 when the curve has no creator
  if (!isBuy) {
    const gross = (c.vQ * amountIn) / (c.vT + amountIn);
    return gross - ceilFee(gross, p) - ceilFee(gross, k);
  }
  let net = (amountIn * 10_000n) / (10_000n + p + k);
  const cost = net + ceilFee(net, p) + ceilFee(net, k);
  if (cost > amountIn) net -= cost - amountIn;
  if (net <= 1n) return 0n;
  const out = ((net - 1n) * c.vT) / (c.vQ + net - 1n);
  // ponytail: a buy past the remaining supply really completes the curve and buys on from the pool-to-be;
  // the preview caps at the remaining supply and prepare's simulation gives the true figure.
  return out < c.realTokens ? out : c.realTokens;
}
```
Rates for `CurveState` come from pump-sdk `computeFeesBps({ global, feeConfig, mintSupply: SUPPLY, virtualQuoteReserves, virtualTokenReserves, quoteMint: curve.quoteMint, creatorFeeBps: curve.creatorFeeBps })`, with creator forced to 0 when `curve.creator` is the default key (as `v3Rates` does). Use core/price.ts `SUPPLY` (1e15): `ONE_BILLION_SUPPLY` is not exported at runtime (checked: `undefined`), and routes refuse mayhem curves, so the fixed supply is always the basis.

Composition:
```typescript
// Source: pump-swap-sdk 2.1.0 multiHopSwapQuote signature
const { amountOut, hopAmountsOut } = multiHopSwapQuote({
  inMint, // NATIVE_MINT for a buy, the coin mint for a sell
  hops,   // per hop: { kind: "curve", baseMint, quoteMint, baseTokenProgram, quoteTokenProgram, quote: (a, h) => ... }
          //       or { kind: "pool", poolKey, pool, baseTokenProgram, quoteTokenProgram, poolBaseAmount, poolQuoteAmount, baseMintSupply }
  amountIn,
  slippage: 0, // min is applied with core/math applyBps, same rounding as route.ts
  globalConfig: ammGlobalConfig,
  feeConfig: ammFeeConfig, // the PumpSwap FeeConfig (OnlinePumpAmmSdk.fetchFeeConfigAccount), not pump's
});
```
The curve callback receives bigint-able BN; convert at the boundary. `resolveMultiHopRoute(inMint, venues).legs` (pump-swap export) gives the same masks for the fee breakdown, so the masks are SDK-sourced in both places.

### Pattern 2: Fee breakdown in SOL
Per hop, from the masked rates and the hop input:
- Buy hop fee (input side, exact-in): `fee = in * bps / (10_000 + totalBps)` for each charged component (display rounding only).
- Sell hop fee (output side): `fee = grossOut * bps / 10_000`.
- SOL hop fees are lamports. Coin hop fees are BONDR base units; convert with BONDR's spot from the same Q state (`curvePrice(vQ, vT)` or `poolPrice(quote + virtualQuote, base)` in core/price.ts, then `toSol`).
- Return `{ bondrHop: { venue, protocolBps, sol }, coinHop: { venue, creatorBps, lpBps, protocolBps: 0, sol }, platformFee: "0", totalSol }`. The web never computes a rate (UI-SPEC: "All percentages come from the quote").

What the program charges on a two-hop route (from `multiHopLegFees` and the fixture):

| Route hop | Protocol | Creator | LP |
|-----------|----------|---------|----|
| SOL to BONDR (buy) / BONDR to SOL (sell), curve | yes, BONDR curve schedule (SOL tiers by market cap) | no | n/a |
| SOL to BONDR / BONDR to SOL, PumpSwap | yes, pool schedule (SOL tiers by pool market cap) | no | no |
| BONDR to coin / coin to BONDR, curve | no | yes, the curve's rate (exotic schedule or `creatorFeeBps` when configurable) | n/a |
| BONDR to coin / coin to BONDR, PumpSwap | no | yes, pool rate (`pool.creatorFeeBps` override) | yes, exotic or flat schedule |

Live devnet values (2026-10-24): `creatorFeeConfigurable=false`, curve flat 95 protocol / 30 creator, curve exotic all 0 (falls back to flat), AMM flat lp 25 / protocol 5 / creator 0, AMM exotic all 0, AMM tier 0 lp 2 / protocol 93 / creator 30. So on devnet a curve-to-curve buy pays 0.95% (SOL hop) + 0.30% (coin hop). Mainnet coins pay the 150 bps creator rate (Phase 1 fork measured 150.00 bps). The code reads all of it live, so nothing changes at Phase 7.

### Pattern 3: State cache (one read per mint per 2 s)
**What:** The Phase 2 `status.ts` single-flight pattern, keyed by mint.
```typescript
// Source: apps/worker/src/status.ts live() pattern
const TTL_MS = 2_000;
const cache = new Map<string, { at: number; p: Promise<MintState> }>();
export function mintState(ctx: Ctx, mint: PublicKey, quoteMint: PublicKey): Promise<MintState> {
  const key = mint.toBase58();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const entry = { at: Date.now(), p: readMint(ctx, mint, quoteMint) };
  cache.set(key, entry);
  entry.p.catch(() => cache.get(key) === entry && cache.delete(key)); // a failed read is not cached
  return entry.p;
}
```
`readMint` does one `getMultipleAccountsInfo` of `[mint, bondingCurvePda(mint), pool = canonicalPumpPoolPdaWithQuote(mint, quote), ATA(pool, mint, T22), ATA(pool, quote, quoteProgram)]` and decodes with `PUMP_SDK.decodeBondingCurve`, `PUMP_AMM_SDK.decodePool`, spl-token `unpackAccount`/`unpackMint`. Pool vaults are the pool's ATAs (pump-sdk `multiHopHopAccounts` derives them the same way). Configs (pump Global, pump FeeConfig `PUMP_FEE_CONFIG_PDA`, AMM GlobalConfig, AMM FeeConfig) go in one more call cached 60 s. The map is bounded by `knownCoins` (only registered coins are quoted).

Venue per hop: curve if it exists, is not `complete` and its quote mint matches; else the canonical pool if it exists; else "awaiting" (complete, no pool yet: the 6107 window). This is the same rule `OnlinePumpSdk.resolveMultiHopRoute` applies.

### Pattern 4: Prepare
1. Parse and validate (see Security). Wallet from the request the web built from the session.
2. `routeBuy`/`routeSell` with `slippageBps` (one `resolveMultiHopRoute` read, one `simulateMultiHopSwap` as the user). Its thrown `Error` carries the JSON err and logs; map it with `tradeError(text)`.
3. Priority: `microLamports = devnet ? env.priorityFee : estimate ?? env.priorityFee`, then `min(microLamports, floor(500_000 * 1e6 / cuLimit))` so price times limit never exceeds 0.0005 SOL.
4. Compile `[setComputeUnitPrice, setComputeUnitLimit(1_400_000), ...route.ixs]` and simulate with `sigVerify: false, replaceRecentBlockhash: true`. Read `unitsConsumed`; map `err`.
5. `cuLimit = ceil(units * 1.1)`; get the blockhash; compile the final message with `budget(cuLimit, microLamports)`; `checkMessage` (program allowlist) and `messageSize <= PACKET_LIMIT`; store; return `{ tradeId, tx, signBy, expectedOut, minAmountOut }` with `signBy` from prepare.ts.

The final simulation must run on the message with the real `minAmountOut`, so a price move between the two simulations surfaces as 6004 at prepare, not on chain. The CU limit changes no account or data, so the stored message (with the final limit) is the one simulated in spirit; if the planner wants the exact bytes simulated, simulate once more after recompiling (one more credit).

### Pattern 5: Submit and settle
```typescript
// Source: packages/core/src/cosign.ts sameMessage, slot; sig.ts signatureOk; send.ts broadcast
const e = store.get(tradeId);
if (!e || e.wallet !== sessionWallet) throw fail({ error: "not_found" });
if (e.state !== "prepared") return view(e);                      // a repeat submit is a read (Phase 2 D-16)
if ((await conn.getBlockHeight()) > e.lastValidBlockHeight) return refuse(e, "expired");
if (!sameMessage(e.message, wire, 1) || !signatureOk(e.message, slot(wire, 0), e.wallet))
  return refuse(e, "message_changed");
e.state = "signed";
const r = await broadcast(conn, wire, { sig: signatureOf(wire), bytes: wire.length, blockhash: e.blockhash,
  lastValidBlockHeight: e.lastValidBlockHeight, paceMs: SEND_PACE_MS });
if (r?.status === "failed") return finish(e, "failed", r.code);  // preflight rejected: nothing went out
e.state = "sent";
void settleTrade(conn, e);                                        // confirm + fetchTx, sets landed/failed/unknown
return view(e);
```
`settle` in send.ts is private; export it (or a thin `settleSent`) rather than re-implementing confirm and the history lookup. Landed amounts: `tokenDelta(meta, mint, wallet)` for a buy and `lamportDelta(meta)` for a sell, moved from scripts/spike/stages/multihop.ts into core (the spike then imports them).

### Anti-Patterns to Avoid
- **Composing two single-hop SDK quotes:** charges protocol and creator on both hops; under-quotes by about the protocol rate on the coin hop.
- **Re-serializing the signed transaction to compare:** compare raw message bytes (`sameMessage`), as Phase 2 does (RESEARCH Anti-patterns of Phase 2).
- **Taking the wallet or `minAmountOut` from the browser:** both come from the server (session and simulation).
- **Polling the chain from the browser loop or a worker timer:** quotes are on demand with a cache; balances on events only (D-16); settle polls only while a trade is in flight.
- **Putting a trade row in Postgres:** D-04. The indexer writes the trade when it lands.
- **Reusing the launch `prepare` single-flight queue:** it serializes behind 10-18 s launch builds. Trades get their own path; Helius Developer allows 50 RPS.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pool hop pricing, LP/protocol/creator split, quote-vault cap on sells | Constant-product code | `multiHopSwapQuote` pool branch | Mirrors `pool_hop()`, including virtual quote reserves and `sellAmounts` vault cap |
| Fee schedule selection (SOL tiers, stable tiers, exotic, flat fallback, per-coin creator rate) | Tier tables | pump-sdk `computeFeesBps`, pump-swap `computeFeesBps` | Four schedules plus the configurable creator override, all mirrored from pump-fees in the SDK; D-01 forbids hardcoding |
| Which hop pays which fee | Hardcoded first/last logic | pump-swap `resolveMultiHopRoute(inMint, venues).legs` | Same masks the quoter uses |
| Venue choice per hop | Own curve/pool probing at prepare | `OnlinePumpSdk.resolveMultiHopRoute` (inside routeBuy) | Also enforces mayhem and cashback gates |
| SOL wrap, ATA creates, buyback ATA, WSOL close | Instruction assembly | `PUMP_SDK.multiHopSwapInstructions` (inside routeBuy) | Handles SOL-curve-end lamports vs WSOL-pool wrap |
| Sell proceeds at a SOL curve end | Balance diffing in simulation | `simulateMultiHopSwap` (parses the TradeEvent) | The SOL goes to the wallet as lamports, not the WSOL account |
| Byte compare and signature check | New verifier | `sameMessage`, `slot`, `signatureOk`, `signatureOf` | Proven with real Phantom on staging (02-18) |
| Send, preflight classification, confirm, history lookup | New sender | `broadcast`, `settle`, `fetchTx`, `statusOf` | Encodes the "unknown is never resent" rule |
| Rate limiting, CSRF, body caps | New middleware | `sameOrigin`, `json`, `rateLimited` | Same style as Phase 2 routes |
| Landed amounts | Parsing logs | `tokenDelta`, `lamportDelta` | Already evidence-grade in the spike |

**Key insight:** the only arithmetic BONDR writes is the masked curve hop, because the SDK leaves exactly that to the caller. Everything else is SDK or Phase 1-3 code.

## Common Pitfalls

### Pitfall 1: Fee rows that do not match what the program charges
**What goes wrong:** The panel shows protocol plus creator on the coin hop and creator on the BONDR hop, so "Fees" is wrong (TRADE-04).
**Why it happens:** Single-trade intuition; the UI-SPEC rows were written before the masks were known.
**How to avoid:** Quote returns masked per-hop rates; unit test asserts protocol is 0 on the coin hop and creator is 0 on the BONDR hop for both sides and all four venue combinations.
**Warning signs:** "Pump protocol" non-zero under the coin hop.

### Pitfall 2: `getPriorityFeeEstimate` on devnet
**What goes wrong:** Prepare throws on every devnet trade.
**Why it happens:** Helius devnet answers `{"code":-32601,"message":"Method not found"}` [VERIFIED: curl 2026-10-24]; mainnet answers with levels (medium 1000 microlamports at probe time).
**How to avoid:** devnet uses `PRIORITY_FEE_MICROLAMPORTS` (default 1000); mainnet calls the estimate with `accountKeys` of the writable venue accounts and `priorityLevel: "Medium"`, falling back to the env value on any error. Unit test the clamp and the fallback.

### Pitfall 3: Message changed by a recompile
**What goes wrong:** Submit refuses every trade.
**Why it happens:** Prepare stores one message and returns a different serialization (for example compiled twice with different blockhashes, or the CU limit changed after storing).
**How to avoid:** Store `msg.serialize()` of the exact `VersionedMessage` whose `VersionedTransaction` is returned; one compile after the blockhash.

### Pitfall 4: A devnet buy that bonds BONDR
**What goes wrong:** A friend on staging types 1 SOL and graduates BONDR's devnet curve. The trade itself succeeds, but the shared devnet state changes for good: BONDR moves to PumpSwap, launches pause for the migration window, and every devnet path that needs BONDR on its curve is gone until a new stand-in is made.
**Why it happens:** BONDR's devnet curve completes at **0.809 SOL** (`costToComplete`, 2026-10-24), below the locked "1" preset. A route buy past it does not revert: a 0.9 SOL route simulated as the ops wallet returned `err null` at 187,451 CU [VERIFIED: devnet simulation, nothing sent], so hop 1 completes BONDR and the child hop still fills. The devnet scripts already refuse such buys ("refused if it moves BONDR near completion", scripts/devnet-trades.ts).
**How to avoid:** On devnet only, while BONDR is on its curve, the quote returns `maxSolIn` (BONDR's cost to complete less 10%) and prepare refuses larger buys with `invalid_input`. Mainnet gets no cap (BONDR graduating through trades is its normal life; Phase 7 confirms). ponytail: devnet-only guard keyed on `env.net`.
**Warning signs:** BONDR's venue tag flips to PumpSwap on staging after a large test buy.

### Pitfall 5: Quote state serves a stale venue after a bond
**What goes wrong:** For up to 2 s after a migration the quote prices a curve that no longer trades.
**How to avoid:** Acceptable for a preview (prepare re-resolves). Optionally drop the mint's cache entry when the ingest sees a complete or migrate event; the stream already knows.

### Pitfall 6: Sell of the whole balance leaves the coin ATA
**What goes wrong:** Nothing breaks; the user keeps an empty Token-2022 account and its rent (about 0.0015 SOL on devnet).
**How to avoid:** Out of scope (skipped). Upgrade: append a Token-2022 `closeAccount` on a 100% sell; it would also change the allowlisted message shape, so test it.

### Pitfall 7: Rate limit hit by the refresh loop itself
**What goes wrong:** A user with two tabs gets 429 on quotes.
**Why it happens:** 2 s refresh is 30 per minute per tab, plus typing.
**How to avoid:** Quote limit 120 per minute per IP. The worker cache, not the web limiter, protects Helius.

### Pitfall 8: Expired versus unknown
**What goes wrong:** The panel says "expired" for a trade that later lands, or "sent" forever.
**How to avoid:** `expired` only when the worker refuses before sending (block height past `lastValidBlockHeight`) or preflight says the blockhash is not found, and in the browser when the `signBy` timer fires before Phantom returns. A broadcast that settle cannot see is `unknown` (UI-SPEC "Sent, confirmation unknown" with the Solscan link); never resend it.

### Pitfall 9: Phantom rewriting the transaction
**What goes wrong:** Lighthouse assertions or a changed compute budget fail the byte compare.
**How to avoid:** Fail closed with the "did not match" copy. Phase 2 proved real Phantom left a devnet launch untouched (02-18 signature `3khSgMF...`); mainnet behaviour is a Phase 7 check.

## Error Mapping (D-17)

Codes verified by simulating a devnet `multi_hop_swap` (SOL to BONDR curve to child curve) on 2026-10-24, and from the installed IDLs.

| Condition | Where it appears | Signal | Contract code | Copy (UI-SPEC) |
|-----------|------------------|--------|---------------|----------------|
| Out below `minAmountOut` | final prepare simulation, preflight, on chain | `{"InstructionError":[i,{"Custom":6004}]}`, log "Error Code: ExceededSlippage" (pump-amm, multi_hop_swap.rs:388) [VERIFIED: devnet probe] | `slippage` | "Price moved more than your slippage..." |
| Not enough SOL for `amountIn` | simulation | `{"Custom":1}` with log "Transfer: insufficient lamports" (System) [VERIFIED: devnet probe] | `insufficient_balance` | "Not enough SOL for this trade and fees." |
| Wallet does not exist (0 SOL) | simulation | `"AccountNotFound"` [VERIFIED: devnet probe] | `insufficient_balance` | same |
| Fee payer short on fees | simulation, preflight | `InsufficientFundsForFee` / "insufficient funds" | `insufficient_balance` | same |
| Sell more than held | simulation | Token program custom 1 (InsufficientFunds) | `insufficient_balance` (sell copy "Not enough {SYMBOL}") | UI blocks it first |
| BONDR or coin complete, unmigrated | quote state, `resolveMultiHopRoute` throw "No tradable curve or canonical pool", on chain 6107, pump 6005 | `awaiting` venue, `Custom 6107`, `Custom 6005` | `paused` + `awaiting_migration` (409, as Phase 2) | migration callout (BONDR or {SYMBOL}) |
| User cancels in Phantom | browser | wallet error code 4001 or `rejected()` regex (wallet.tsx) | browser-only `rejected` | "Signature declined." |
| Blockhash dead | browser `signBy` timer, worker block height check, preflight "Blockhash not found" | — | `expired` (410) | "Transaction expired. Try again." |
| Signed bytes differ | submit | `sameMessage` or `signatureOk` false | `message_changed` (422) | "did not match" copy |
| Anything else on chain | settle | meta.err with another code | `onchain` | "Your trade failed on-chain..." |

`build.ts simError` already handles 6107, "insufficient lamports|funds", AccountNotFound and custom 1. Extend it with 6004 and 6005 and move it to core (`trade-error.ts`) so both the launch and the trade use one map; keep a regex path for the SDK's text error from `simulateMultiHopSwap` (it embeds `JSON.stringify(value.err)` and the logs).

## Helius Credit Budget

Developer plan: 10M credits a month, 50 RPC requests per second, `sendTransaction` 5 per second [CITED: helius.dev/docs/billing/credits, /plans, /rate-limits]. Standard RPC methods (getMultipleAccounts, simulateTransaction, sendTransaction, getLatestBlockhash, getSignatureStatuses) and `getPriorityFeeEstimate` each cost 1 credit.

| Action | Credits | Notes |
|--------|---------|-------|
| Quote, cache hit | 0 | |
| Quote state refresh for one mint | 1 | one getMultipleAccountsInfo; BONDR's own entry is shared by every coin |
| Config refresh | 1 per 60 s | four accounts in one call |
| Prepare | about 7 | route read, two simulations, priority (mainnet), blockhash, block height |
| Submit and settle | about 4 to 8 | send, a few status and height polls at 800 ms, getTransaction |
| Balance | 1 | |

Watching cost: with the 2 s TTL, cost scales with watched coins, not viewers. One coin watched non-stop for a month costs about 1.3M credits for its own state plus 1.3M for BONDR's (shared across all coins), so roughly 2.6M for a busy single coin and about 1.3M more per extra continuously watched coin. The 60 s idle pause and foreground-only refresh make continuous watching rare. Ceiling and upgrade path (ponytail comment): the ingest stream already decodes every TradeEvent with post-trade virtual reserves, so the cache can be fed by the stream and quotes become free; do that only if the Helius dashboard shows quote reads above about 3M a month.

Whether the project is on the Developer plan today is not confirmed in the repo (code comments still say "Helius free allows about 10 RPS"). See Assumptions A2.

## Amounts, Rent and Max (D-14)

Measured on devnet 2026-10-24 with `getMinimumBalanceForRentExemption`: 165-byte account (WSOL) 1,488,440 lamports, 170-byte account (Token-2022 ATA) 1,513,840 lamports. A first buy needs on top of `amountIn`:

| Item | Lamports (devnet) | Kept? |
|------|-------------------|-------|
| Coin ATA (Token-2022, 170 B) | 1,513,840 | kept (rent stays in the user's ATA) |
| WSOL ATA (165 B), created and closed in the same tx | 1,488,440 | refunded in the same tx, but must be held during it |
| Buyback wallet's WSOL ATA, only if missing | 1,488,440 | paid once by whoever trades first (exists on mainnet for all 8 listed wallets, Phase 1) |
| Base fee + priority cap | 5,000 + up to 500,000 | spent |

Worst case about 0.005 SOL, so the locked 0.01 SOL reserve covers it with margin. Do not compute these in the browser: Max is `balance - 0.01 SOL` (UI-SPEC), and the prepare simulation is the real check (it returns custom 1 with "insufficient lamports" if the reserve was not enough). Read rent live at Phase 7 rather than copying these numbers; devnet rent is lower than the classic 2,039,280.

Sell "you receive about X SOL": the same `multiHopSwapQuote` with `inMint = coin`, hops `[coin/BONDR, BONDR/SOL]`, side sell. The SOL-curve end pays lamports net of the protocol fee; a pool end pays WSOL that `multiHopSwapInstructions` unwraps. The fixture sell reproduced exactly (gross 30,870,891,770,657 BONDR, minus 92,612,675,312 creator, then 9,848,426 lamports gross minus 93,561 protocol).

Price impact: `impact = 1 - amountOut / spotOut`, where `spotOut = amountIn * product over hops of (spot price * (1 - chargedBps / 10_000))`, spot being `vT/vQ` (curve buy), `base/(quote + virtualQuote)` (pool buy) and the inverse for sells, all from the same cached state. Float is fine (display only). It is 0 for an infinitesimal trade and grows with size.

## Code Examples

### Rate limits (guard.ts style)
```typescript
// Source: apps/web/app/api/quote/route.ts pattern
rateLimited(req, "trade-quote", 120, 60_000);                    // 2 s refresh x 2 tabs + typing
rateLimited(req, "trade-balance", 30, 60_000, wallet);           // event-driven only
rateLimited(req, "trade-prepare", 30, 10 * 60_000, wallet);      // about 7 credits each, user pays the tx
rateLimited(req, "trade-submit", 30, 10 * 60_000, wallet);       // refusal is free; blunts loops
rateLimited(req, "trade-view", 240, 60_000);                     // 1 s poll, worker memory only
```
UI-SPEC copy for 429: "Too many trades from this wallet. Wait a minute, then try again."

### Request parsing at the worker (trust nothing from web)
```typescript
// Source: apps/worker/src/status.ts parseQuote, prepare.ts walletOf
const side = b.side === "buy" || b.side === "sell" ? b.side : null;
const amount = typeof b.amount === "string" && /^\d{1,20}$/.test(b.amount) ? BigInt(b.amount) : null;
const slippageBps = Number.isInteger(b.slippageBps) && b.slippageBps >= 10 && b.slippageBps <= 5_000 ? b.slippageBps : null;
const coin = typeof b.mint === "string" && knownCoins.has(b.mint) ? new PublicKey(b.mint) : null; // never BONDR itself
// buy: 1 <= amount <= MAX_SOL_IN (status.ts); sell: 1 <= amount < 2^64
```

### Devnet real trade from Playwright
```typescript
// Source: apps/web/e2e/launch-live.e2e.ts, live.e2e.ts
test.skip(process.env.E2E_DEVNET !== "1", "one real buy and sell: set E2E_DEVNET=1");
execFileSync("node", ["--env-file=.env", "scripts/devnet-launch.ts", "--fund"], { cwd: ROOT }); // tops the sim dev up
const sim = simDevAccount();
await injectPhantom(page, sim);
await signIn(page.request, sim);   // real consent session; the spec deletes the wallets row after
// buy 0.01 SOL of the newest indexed curve coin, wait for "Bought", then Sell 100%, wait for "Sold for"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Quote each hop with single-trade SDK helpers | `multiHopSwapQuote` with legs masks | pump-swap-sdk 2.x (installed 2.1.0) | Exact route quotes offline |
| Phase 2 insta-sell estimate `estimateSolBack` (full fee bps on four legs) | Masked legs | this phase | Phase 2 status legs `[bondr, child, child, bondr]` over-count fees on a routed sell; the launch preview labels it "about". Worth correcting in a later pass, not required here |
| Fixed `PRIORITY_FEE_MICROLAMPORTS` | Helius estimate on mainnet, env on devnet | this phase | Mainnet-ready without a devnet dependency |

**Deprecated/outdated:** none in the installed SDKs for this path. `buy_v2`/`sell_v2` remain for single pool trades; routes use `multi_hop_swap` (pump-amm program `pAMMBay6...`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `multiHopSwapQuote`'s pool branch matches the on-chain `pool_hop()` for a BONDR-quoted coin pool (SDK says "rust reference"; not yet run against a fork pool) | Pattern 1, TRADE-04 | Coin-pool quotes off by rounding or a fee component; prepare's simulation still sets the real floor, so only the preview is wrong. The fork rows in Validation close it |
| A2 | The Helius account is on the Developer plan (50 RPS, 5 sends/s, 10M credits) | Credit Budget | On free tier: 10 RPS and 1 send/s; keep `SEND_PACE_MS` 1100 and the cache; quote refresh still fits |
| A3 | `getPriorityFeeEstimate` units are microlamports per CU, matching `setComputeUnitPrice` | Pattern 4 | Mis-scaled priority; the 0.0005 SOL clamp bounds the damage. Helius docs say "microlamports" without "per CU" explicitly [CITED] |
| A4 | A migrated BONDR coin's pool keeps `creatorFeeBps` 150 from its curve on mainnet | Fee table | Creator row wrong on mainnet pools; the code reads it live, so only expectations change |
| A5 | Phantom does not alter a devnet trade message under `signTransaction` | Pitfall 9 | Every submit refused with the "did not match" copy; proven for launches, assumed for trades until the owner's real-Phantom trade |
| A6 | 2 s staleness of quote state is acceptable to the owner as "live" for the preview | Pattern 3 | Owner may want stream-fed reserves; upgrade path documented |

## Open Questions (RESOLVED)

1. **Fee breakdown copy (UI-SPEC amendment).** RESOLVED (2026-10-24, owner-delegated, as recommended): masked rows, the pump protocol fee on the BONDR hop; UI-SPEC note in 04-03.
   - What we know: on a two-hop route the coin hop never charges the pump protocol fee, and the BONDR hop never charges creator or LP (fixture plus SDK `multiHopLegFees`).
   - What's unclear: the approved rows list "Pump protocol {p}%" under the coin hop and treat the BONDR hop as a separate fee.
   - Recommendation: keep the row structure but feed masked values and hide zero sub-rows: coin hop "Fees on the GRUB curve, 0.30%" with "Creator 0.30%, to the GRUB fee wallet" (plus "LP" on PumpSwap); BONDR hop "SOL to BONDR on the BONDR curve, 0.95%" with sub-row "Pump protocol 0.95%". The planner adds a one-line UI-SPEC note in the first UI task; it is owner-delegated (auto mode), so no stop is needed.
2. **BONDR earns no creator fee on routed trades.** OWNER FLAG (not Phase 4 scope): raised in the 04-13 phase summary.
   - What we know: the SOL to BONDR hop charged creator 0 on the fixture; a migrated BONDR pool hop would charge no LP.
   - Impact: not Phase 4 scope, but PROJECT.md economics for BONDR's own launch (Phase 7) should not count routed volume toward BONDR's creator fees. Flag to the owner in the phase summary.
3. **Coin buy that crosses the coin's completion.** RESOLVED (as recommended): accept; the high price impact shown is the warning.
   - What we know: the program spends the whole input and buys on from the pool-to-be; the preview caps at the remaining supply.
   - Recommendation: accept (Phase 5's forced bond is the normal completion path); the impact number will look high, which is the right warning.

4. **Devnet buy cap while BONDR is on its curve (UI copy).** RESOLVED (as recommended): devnet-only maxSolIn with the field error copy; UI-SPEC note in 04-03.
   - What we know: a route buy above 0.809 SOL bonds BONDR on devnet and succeeds (simulated). The D-14 "1" preset is above it.
   - What's unclear: the UI-SPEC has no copy for a cap.
   - Recommendation: devnet-only `maxSolIn` in the quote; the panel shows a field error "On devnet, buys stay under {max} SOL so BONDR stays on its curve." and disables chips above it. Owner-delegated, so the planner adds it to the UI-SPEC note with Open Question 1. On mainnet no cap.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | worker, scripts | yes | 24.13.0 | — |
| pnpm | workspace | yes | 10.34.6 | — |
| Playwright | e2e | yes | @playwright/test 1.63.0, playwright-cli 0.1.8 | — |
| Helius devnet RPC | worker | yes (key present) | — | — |
| Helius `getPriorityFeeEstimate` on devnet | D-08 | no (`-32601 Method not found`) | — | `PRIORITY_FEE_MICROLAMPORTS` (1000) |
| Surfpool | fork rows for PumpSwap | yes, cached binary `.cache/surfpool/surfpool` (v1.6.1, via `pnpm spike:fork-up`), not on PATH | 1.6.1 | — |
| Devnet ops wallet | sim top-up (`devnet-launch.ts --fund`) | yes | 2.75 SOL | — |
| Devnet sim dev wallet | real buy and sell | yes | 0.059 SOL | `--fund` tops it up from ops |
| Railway staging | owner check | yes (`railway` 5.71.0) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the devnet priority fee estimate (use the env value).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (units), Playwright 1.63.0 (e2e) |
| Config file | none for Vitest (defaults, `*.test.ts` colocated); `playwright.config.ts` at the root (`*.e2e.ts`, starts the worker and web) |
| Quick run command | `pnpm vitest run packages/core/src/quote.test.ts apps/worker/src/trade-*.test.ts` |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRADE-03 | Masked curve hop reproduces fixture hops exactly (buy and sell), pre-state rebuilt from TradeEvent post reserves via `innerEvents` | unit | `pnpm vitest run packages/core/src/quote.test.ts` | no, Wave 0 |
| TRADE-03 | Route quote: protocol only on the SOL hop, creator only on the coin hop, LP only on a coin pool hop, for buy and sell and all four venue combinations | unit | same | no, Wave 0 |
| TRADE-03 | Price impact near 0 for 1 lamport, increasing with size; minimum received equals `applyBps(out, 10000 - slippage)` | unit | same | no, Wave 0 |
| TRADE-03 | Cache: concurrent quotes in one 2 s window cost one read; a failed read is not cached | unit | `pnpm vitest run apps/worker/src/trade-state.test.ts` | no, Wave 0 |
| TRADE-01/02 | Submit refuses a changed byte, a wrong signer, another session wallet, an expired entry; a repeat submit returns the same view | unit | `pnpm vitest run apps/worker/src/trade-submit.test.ts` | no, Wave 0 |
| TRADE-01/02 | Error map: 6004, custom 1 + "insufficient lamports", AccountNotFound, 6107, 6005, unknown code (fed the verified probe shapes) | unit | `pnpm vitest run packages/core/src/trade-error.test.ts` | no, Wave 0 |
| TRADE-01/02 | CU limit is `ceil(units * 1.1)`; priority clamp keeps price x limit at or under 500,000 lamports; devnet uses the env value; estimate failure falls back | unit | `pnpm vitest run apps/worker/src/trade-prepare.test.ts` | no, Wave 0 |
| TRADE-01/02 | Request parsing: side, amount bounds, slippage 10-5000 bps, unknown mint 404, BONDR mint refused, devnet buy above `maxSolIn` refused, mainnet uncapped | unit | same | no, Wave 0 |
| TRADE-01..03 | Web routes: same-origin 403, no session 403 consent_required, body wallet ignored, 429 after the limit | unit + e2e | `pnpm vitest run apps/web/lib/guard.test.ts` and `pnpm e2e apps/web/e2e/trade.e2e.ts` | partial (guard.test.ts exists) |
| TRADE-03 | Panel states with stubbed `/api/trade/*`: not connected full quote, ready buy and sell, impact 5% and 15% states, migration pause, quote paused after 60 s (`page.clock`), every result callout, rejected signature (`injectPhantom(..., { reject: true })`) | e2e | `pnpm e2e apps/web/e2e/trade.e2e.ts` | no, Wave 0 (`trade-stubs.ts`) |
| TRADE-01/02 | Real devnet buy 0.01 SOL then sell 100% on the newest curve coin, signed by the fake Phantom with the sim dev key; the row appears in the feed within 15 s; spend at most 0.05 SOL | e2e (devnet) | `E2E_DEVNET=1 pnpm e2e apps/web/e2e/trade.e2e.ts -g devnet` | no, Wave 0 |
| TRADE-04 | Fork: SOL to Q curve to C2 pool, and SOL to Q pool to C2 pool, buy and sell land; facts record `pureQuote` next to `expectedOut` (simulation) and `outAmount`; rule: `pureQuote == outAmount` within 1 base unit | fork spike rows | `pnpm spike:fork-up && SPIKE_NET=fork pnpm spike` (add `multihopStage("C2", "bonded.")` after `finalizeStage` and `multihopStage("C2", "pooled.")` last in nets/fork.ts) | no, Wave 0 |
| TRADE-04 | No BONDR program, account or transfer in the built message beyond the route (platform fee 0): `checkMessage` allowlist plus a test that the instruction list equals `[budget..., ...routeIxs]` | unit | `pnpm vitest run apps/worker/src/trade-prepare.test.ts` | no, Wave 0 |
| UI | 390, 768, 1440 screenshots, 0 axe violations for the UI-SPEC state list | e2e | `pnpm e2e apps/web/e2e/responsive-trade.e2e.ts` (through `shoot.ts gate`) | no, Wave 0 |
| Bundle | No pump SDK or web3.js in the client bundle | script | `pnpm --filter @bondr/web build && pnpm check:bundle` | yes |

Manual-only: the owner's one real-Phantom devnet trade on staging (byte stability through the real extension, A5).

### Sampling Rate
- **Per task commit:** the quick run command for the files the task touched.
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test` plus the stubbed `trade.e2e.ts`.
- **Phase gate:** full suite green, the devnet group and the fork rows passed, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/core/src/quote.test.ts` with a fixture helper that rebuilds pre-trade curve state from `multihop-buy.json` / `multihop-sell.json` events
- [ ] `packages/core/src/trade-error.test.ts` with the probe's error shapes as literals
- [ ] `apps/worker/src/trade-state.test.ts`, `trade-prepare.test.ts`, `trade-submit.test.ts` (stub `Connection` like `prepare.test.ts` and `submit.test.ts` do)
- [ ] `apps/web/e2e/trade-stubs.ts` (page.route stubs for quote, balance, prepare, submit, view) and `trade.e2e.ts`
- [ ] Fork rows `bonded.multihop.*` and `pooled.multihop.*` with a `pureQuote` fact; `tokenDelta`/`lamportDelta` moved to core

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (wallet proof) | Existing consent: signMessage verified with `signatureOk`, HMAC session cookie (`lib/session.ts`) |
| V3 Session Management | yes | Existing `bondr_session` cookie; trade routes read the wallet only from it |
| V4 Access Control | yes | Submit and view require the entry's wallet to equal the session wallet; worker routes behind the bearer token on private networking |
| V5 Input Validation | yes | Worker re-parses side, amount, slippage, mint against `knownCoins`; web caps JSON bodies (quote 1 KB, submit 4 KB) |
| V6 Cryptography | yes | Ed25519 via `node:crypto` in `sig.ts`; never hand-rolled |

### Trust boundaries and threats (feeds `<threat_model>`)

| # | Boundary | Threat | STRIDE | Mitigation |
|---|----------|--------|--------|------------|
| T1 | Browser to web: amount, side, slippage | Out-of-range or crafted values (zero, negative, over u64, 100% slippage) produce a floorless trade or a crash | Tampering | Worker parses again: digits only, 1 to MAX_SOL_IN for buys (and under `maxSolIn` on devnet while BONDR is on its curve), under 2^64 for sells, slippage 10 to 5,000 bps; `route.ts` already refuses a zero floor |
| T2 | Browser to web: wallet | Prepare for another wallet, or a body wallet different from the session | Spoofing | Wallet only from the session cookie (Phase 2 CR-01); body wallet ignored |
| T3 | Browser to worker via submit: signed wire | Worker used as a free relay for arbitrary transactions on its Helius key | Elevation, Tampering | `sameMessage(stored, wire, 1)` raw byte compare plus `signatureOk` for slot 0 against the stored wallet; stored message passed `checkMessage` allowlist at prepare; wire length capped at 1,232 |
| T4 | Server-built `minAmountOut` | Client lowers the floor | Tampering | Floor is computed in prepare from the simulation and lives inside the stored, compared bytes |
| T5 | Trade id | Guessing or replaying another user's trade | Spoofing, Information disclosure | 16 random bytes hex (`newId`), entry bound to the wallet, 120 s TTL, state machine (prepared, signed, sent, terminal); a repeat submit is a read |
| T6 | Quote and balance routes | Helius credit exhaustion by spam or many mints | Denial of service | Per-IP limits, 2 s single-flight per-mint cache, mints limited to `knownCoins`, worker-only RPC |
| T7 | Worker memory store | Unbounded growth from prepare spam | Denial of service | TTL sweep on insert, per-wallet prepare limit; ponytail: single replica |
| T8 | Settle and resend | Double spend by resending an "unknown" tx | Tampering | Never resend; `unknown` shown with the Solscan link (send.ts rule) |
| T9 | Logs | Helius key or wallet in Sentry | Information disclosure | `redact` on every error path (existing) |
| T10 | MEV / sandwich | Price moved against the user | Tampering | Default 1% slippage, 15% impact confirm; devnet has no MEV; mainnet review in Phase 7 |
| T11 | Fee display | Showing fees the program does not charge, or hiding one | Repudiation (trust) | Masked rates from the SDK and live accounts; "BONDR platform fee 0" is structural (no BONDR instruction) and tested |

## Sources

### Primary (HIGH confidence)
- `packages/core/node_modules/@pump-fun/pump-swap-sdk` 2.1.0: `src/sdk/multiHop.ts` (multiHopSwapQuote, multiHopLegFees, resolveMultiHopRoute, poolHopAmountOut), `src/sdk/fees.ts` (computeFeesBps tiers and creator override), `src/sdk/onlinePumpAmm.ts` (swapSolanaState reads), `dist/index.d.ts` exports
- `packages/core/node_modules/@pump-fun/pump-sdk` 4.1.0: `src/onlineSdk.ts` (resolveMultiHopRoute 1642, simulateMultiHopSwap 1731), `src/sdk.ts` (multiHopSwapInstruction 3611 doc on fee legs, multiHopSwapInstructions 3659), `src/bondingCurve.ts` (v3 arithmetic), `src/fees.ts`, `src/idl/pump.json` and `pump_amm.json` errors
- Fixtures `packages/core/src/fixtures/multihop-buy.json`, `multihop-sell.json` decoded with `core/events.ts innerEvents`; hand check reproduced every amount
- Devnet probes 2026-10-24 (scratch scripts, read-only, nothing sent): BONDR cost to complete 0.809 SOL and a 0.9 SOL route simulated as ops with err null; live config via `readLiveConfig`; pure quote 87,944,488,296,093 vs `simulateMultiHopSwap` 87,944,488,296,093; simulation errors 6004, custom 1, AccountNotFound; 1,110-byte message, 155,235 CU; rent 1,488,440 and 1,513,840; ops 2.75 SOL, sim 0.059 SOL
- `scripts/spike/results/fork.json` rows `migrated.multihop.buy` (pool,curve, 1,132 B, 141,019 CU) and `.sell`
- Repo code: core route.ts, trade.ts, send.ts, cosign.ts, sig.ts, math.ts, price.ts; worker prepare.ts, submit.ts, build.ts, status.ts, http.ts, env.ts, ingest.ts; web guard.ts, worker.ts, launch-run.ts, wallet.tsx, api routes; e2e phantom.ts, launch-live.e2e.ts, live.e2e.ts; playwright.config.ts

### Secondary (MEDIUM confidence)
- [Helius credits](https://www.helius.dev/docs/billing/credits), [plans](https://www.helius.dev/docs/billing/plans), [rate limits](https://www.helius.dev/docs/billing/rate-limits), [getPriorityFeeEstimate](https://www.helius.dev/docs/api-reference/priority-fee/getpriorityfeeestimate); devnet availability contradicted by the live probe (`Method not found`)

### Tertiary (LOW confidence)
- None relied on.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, all installed and runtime-checked.
- Quote method and fee semantics: HIGH for curve hops (fixture and live probe exact), MEDIUM for coin pool hops (SDK source only, closed by the fork rows).
- Architecture and flow: HIGH, reuse of Phase 2 code paths proven on staging.
- Pitfalls and error codes: HIGH, error shapes observed on devnet.
- Credit budget: MEDIUM, depends on the plan actually in use (A2).

**Research date:** 2026-10-24
**Valid until:** 2026-11-23 (30 days; re-check if the pump SDK pins change or pump ships a fee schedule update)
