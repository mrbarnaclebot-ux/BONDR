// The route quote, the only trade arithmetic BONDR writes: the PumpSwap SDK prices pool hops and decides which hop
// pays which fee (legs), but leaves curve hops to the caller, so curveHop mirrors pump's v3 math with the masks.
// Worker-side: it loads pump.ts, so web must never import it (D-08).
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { HopFee, TradeQuote, TradeSide } from "./api.ts";
import { applyBps } from "./math.ts";
import { curvePrice, poolPrice, SUPPLY, toSol } from "./price.ts";
import {
  type AmmFeeConfig,
  BN,
  type BondingCurve,
  computeAmmFeesBps,
  computeFeesBps,
  type Global,
  type GlobalConfig,
  type MultiHopLegFees,
  type MultiHopQuoteHop,
  multiHopSwapQuote,
  type Pool,
  resolveMultiHopRoute,
} from "./pump.ts";

export type CurveState = {
  vQ: bigint;
  vT: bigint;
  realTokens: bigint;
  protocolBps: bigint;
  creatorBps: bigint;
};
type Programs = { base: PublicKey; quote: PublicKey };
type PoolInput = {
  kind: "pool";
  pool: Pool;
  poolKey: PublicKey;
  poolBaseAmount: BN;
  poolQuoteAmount: BN;
  baseMintSupply: BN;
  tokenPrograms: Programs;
};
export type HopInput = { kind: "curve"; state: CurveState; tokenPrograms: Programs } | PoolInput;
export type RouteArgs = {
  side: TradeSide;
  bondrMint: PublicKey;
  coinMint: PublicKey;
  bondr: HopInput;
  coin: HopInput;
  amountIn: bigint; // lamports for a buy, coin base units for a sell
  slippageBps: number;
  ammGlobalConfig: GlobalConfig;
  ammFeeConfig: AmmFeeConfig | null;
};
// The worker adds networkMax and, on devnet, maxSolIn.
export type RouteQuote = Omit<TradeQuote, "fees" | "maxSolIn"> & {
  fees: Omit<TradeQuote["fees"], "networkMax">;
};
type PumpFeeConfig = Parameters<typeof computeFeesBps>[0]["feeConfig"];
type Rates = { protocol: bigint; creator: bigint; lp: bigint };

const big = (b: BN): bigint => BigInt(b.toString());
const ceilFee = (x: bigint, bps: bigint): bigint => (x * bps + 9_999n) / 10_000n;

/** One curve hop of a multi_hop_swap, charging only the components `legs` names (pump v3 exact quote in). */
export function curveHop(
  c: CurveState,
  amountIn: bigint,
  isBuy: boolean,
  legs: Pick<MultiHopLegFees, "protocol" | "creator">,
): bigint {
  const p = legs.protocol ? c.protocolBps : 0n;
  const k = legs.creator ? c.creatorBps : 0n; // already 0 when the curve has no creator (curveRates)
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

/** A curve's live rates from pump's schedule; the fixed 1B supply is the basis (routes refuse mayhem curves). */
export function curveRates(global: Global, feeConfig: PumpFeeConfig, curve: BondingCurve) {
  const f = computeFeesBps({
    global,
    feeConfig,
    mintSupply: new BN(SUPPLY.toString()),
    virtualQuoteReserves: curve.virtualQuoteReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
    quoteMint: curve.quoteMint,
    creatorFeeBps: curve.creatorFeeBps,
  });
  // pump charges no creator fee on a curve whose creator is unset.
  const creatorBps = curve.creator.equals(PublicKey.default) ? 0n : big(f.creatorFeeBps);
  return { protocolBps: big(f.protocolFeeBps), creatorBps };
}

// A pool's live rates, from the same inputs the SDK's pool hop prices with.
function poolRates(h: PoolInput, a: RouteArgs): Rates {
  const { pool } = h;
  const f = computeAmmFeesBps({
    globalConfig: a.ammGlobalConfig,
    feeConfig: a.ammFeeConfig,
    creator: pool.creator,
    baseMintSupply: h.baseMintSupply,
    baseMint: pool.baseMint,
    baseReserve: h.poolBaseAmount,
    quoteReserve: h.poolQuoteAmount.add(pool.virtualQuoteReserves),
    quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode,
    creatorFeeBps: pool.creatorFeeBps,
  });
  // As the SDK's pool hop: a pool without a coin creator charges no creator fee.
  const creator = pool.coinCreator.equals(PublicKey.default) ? 0n : big(f.creatorFeeBps);
  return { protocol: big(f.protocolFeeBps), creator, lp: big(f.lpFeeBps) };
}

function hopRates(h: HopInput, legs: MultiHopLegFees, a: RouteArgs): Rates {
  const r =
    h.kind === "curve"
      ? { protocol: h.state.protocolBps, creator: h.state.creatorBps, lp: 0n }
      : poolRates(h, a);
  return {
    protocol: legs.protocol ? r.protocol : 0n,
    creator: legs.creator ? r.creator : 0n,
    lp: legs.lp ? r.lp : 0n,
  };
}

// [quote, base] reserves a hop prices from: virtual on a curve, vault plus virtual quote on a pool.
const reserves = (h: HopInput): [bigint, bigint] =>
  h.kind === "curve"
    ? [h.state.vQ, h.state.vT]
    : [big(h.poolQuoteAmount.add(h.pool.virtualQuoteReserves)), big(h.poolBaseAmount)];

// Lamports per BONDR base unit, from the same state the route is priced from.
function bondrSol(h: HopInput): number {
  const [q, b] = reserves(h);
  return h.kind === "curve" ? curvePrice(q, b) : poolPrice(q, b);
}

// The SDK's hop for an input; curve hops are priced by curveHop with the legs the SDK hands it.
function sdkHop(h: HopInput, baseMint: PublicKey, quoteMint: PublicKey): MultiHopQuoteHop {
  const programs = { baseTokenProgram: h.tokenPrograms.base, quoteTokenProgram: h.tokenPrograms.quote };
  if (h.kind === "pool") {
    const { pool, poolKey, poolBaseAmount, poolQuoteAmount, baseMintSupply } = h;
    return { kind: "pool", pool, poolKey, poolBaseAmount, poolQuoteAmount, baseMintSupply, ...programs };
  }
  const quote = (x: BN, hop: { isBuy: boolean; legs: MultiHopLegFees }) =>
    new BN(curveHop(h.state, big(x), hop.isBuy, hop.legs).toString());
  return { kind: "curve", baseMint, quoteMint, ...programs, quote };
}

// 1 - out / spot out (RESEARCH "Price impact") in floats without the integer rounding, so a 1 lamport trade
// reads about 0: per hop, constant product keeps reserveIn / (reserveIn + netIn) of the spot output, and a
// curve buy capped at its remaining supply keeps only what it pays out. Display only.
function impact(hops: HopInput[], ins: bigint[], rates: Rates[], isBuy: boolean): number {
  let kept = 1;
  hops.forEach((h, i) => {
    const [q, b] = reserves(h).map(Number);
    const [rIn, rOut] = isBuy ? [q, b] : [b, q];
    const total = Number(rates[i].protocol + rates[i].creator + rates[i].lp);
    const x = isBuy ? (Number(ins[i]) * 10_000) / (10_000 + total) : Number(ins[i]);
    let k = rIn / (rIn + x);
    if (h.kind === "curve" && isBuy) k = Math.min(k, Number(h.state.realTokens) / ((x * rOut) / rIn));
    kept *= k;
  });
  return 1 - kept;
}

// A hop's fees from its masked rates: on the input on a buy (exact in), on the output on a sell (Pattern 2).
const hopFee = (x: bigint, r: Rates, isBuy: boolean): bigint => {
  const total = r.protocol + r.creator + r.lp;
  return (x * total) / (isBuy ? 10_000n + total : 10_000n - total);
};
const feeRow = (h: HopInput, r: Rates, sol: bigint): HopFee => ({
  venue: h.kind,
  protocolBps: Number(r.protocol),
  creatorBps: Number(r.creator),
  lpBps: Number(r.lp),
  sol: String(sol),
});

// The BONDR hop trades the SOL end in lamports; the coin hop trades BONDR (mid), valued at BONDR's spot.
function feesFor(
  a: RouteArgs,
  bondrRates: Rates,
  coinRates: Rates,
  mid: bigint,
  out: bigint,
): RouteQuote["fees"] {
  const isBuy = a.side === "buy";
  const bondrFee = hopFee(isBuy ? a.amountIn : out, bondrRates, isBuy);
  const coinFee = toSol(hopFee(mid, coinRates, isBuy), bondrSol(a.bondr));
  return {
    bondrHop: feeRow(a.bondr, bondrRates, bondrFee),
    coinHop: feeRow(a.coin, coinRates, coinFee),
    platformFee: "0",
    totalSol: String(bondrFee + coinFee),
  };
}

/** The SOL to BONDR to coin route (a sell walks it back), priced from pre-trade state with no wallet. */
export function routeQuote(a: RouteArgs): RouteQuote {
  const isBuy = a.side === "buy";
  const bondr = { h: a.bondr, base: a.bondrMint, quote: NATIVE_MINT };
  const coin = { h: a.coin, base: a.coinMint, quote: a.bondrMint };
  const ordered = isBuy ? [bondr, coin] : [coin, bondr];
  const hops = ordered.map((o) => sdkHop(o.h, o.base, o.quote));
  const inMint = isBuy ? NATIVE_MINT : a.coinMint;
  const { legs } = resolveMultiHopRoute(inMint, hops);
  const q = multiHopSwapQuote({
    inMint,
    hops,
    amountIn: new BN(a.amountIn.toString()),
    slippage: 0, // the floor is applyBps below, the same rounding as route.ts
    globalConfig: a.ammGlobalConfig,
    feeConfig: a.ammFeeConfig,
  });
  const [mid, out] = q.hopAmountsOut.map(big);
  const rates = ordered.map((o, i) => hopRates(o.h, legs[i], a));
  const [bondrRates, coinRates] = isBuy ? rates : [rates[1], rates[0]];
  return {
    side: a.side,
    amountIn: String(a.amountIn),
    amountOut: String(out),
    minAmountOut: String(applyBps(out, 10_000 - a.slippageBps)),
    impact: impact(
      ordered.map((o) => o.h),
      [a.amountIn, mid],
      rates,
      isBuy,
    ),
    route: { bondr: a.bondr.kind, coin: a.coin.kind },
    fees: feesFor(a, bondrRates, coinRates, mid, out),
  };
}
