// Launch instruction builders (RESEARCH Pattern 2). BONDR owns amounts, order and signing; the SDK owns
// every account list, because pump changes them on short notice.
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { applyBps } from "./math.ts";
import {
  BN,
  type Global,
  getBuyV3TokenAmountFromQuoteAmount,
  newBondingCurve,
  type OnlinePumpSdk,
  PUMP_SDK,
  type PumpQuoteAccounts,
} from "./pump.ts";
import { budget } from "./send.ts";
import { buyExactIn, buyExactOut, sellExactIn } from "./trade.ts";

export type Coin = { name: string; symbol: string; uri: string };

// creatorFeeBps is passed only when given: devnet refuses any configured rate (Pitfall 7).
export function buildCreate(
  o: Coin & {
    mint: PublicKey;
    creator: PublicKey;
    user: PublicKey;
    quoteMint?: PublicKey;
    pumpQuote?: PumpQuoteAccounts;
    creatorFeeBps?: BN;
  },
): Promise<TransactionInstruction> {
  return PUMP_SDK.createV2Instruction({
    mint: o.mint,
    name: o.name,
    symbol: o.symbol,
    uri: o.uri,
    creator: o.creator,
    user: o.user,
    mayhemMode: false,
    ...(o.quoteMint && {
      quoteMint: o.quoteMint,
      quoteTokenProgram: T22,
      pumpQuote: o.pumpQuote,
    }),
    ...(o.creatorFeeBps && { creatorFeeBps: o.creatorFeeBps }),
  });
}

type Online = InstanceType<typeof OnlinePumpSdk>;
type Curve = Awaited<ReturnType<Online["fetchBuyState"]>>;
type PumpQuote = NonNullable<Awaited<ReturnType<Online["fetchPumpQuote"]>>>;
type FeeConfig = Awaited<ReturnType<Online["fetchFeeConfig"]>>;
// burn: dev burns the bought coins. sell: multi_hop child to Q to SOL (D-14). sellq: sell_v3 child to Q only,
// the evidence variant when the multi_hop sell does not land.
export type Exit = "burn" | "sell" | "sellq";
export type LaunchOpts = Coin & {
  online: Online;
  Q: PublicKey;
  mint: PublicKey;
  W: PublicKey;
  dev: PublicKey;
  solIn: BN;
  exit: Exit;
  creatorFeeBps?: BN;
  cuLimit: number;
};

const big = (x: BN): bigint => BigInt(x.toString());
// burnChecked fails unless this matches the mint; every pump create_v2 mint has 6 decimals.
const COIN_DECIMALS = 6;

// Exact-out (D-16): SOL buys at least qMin of Q, then exactly `amount` of the child costs at most qMin.
// 1% and 2% margins absorb Q's price moving and rounding between quote and landing.
function amounts(g: Global, fc: FeeConfig, q: Curve, pq: PumpQuote, o: LaunchOpts) {
  const qOut = getBuyV3TokenAmountFromQuoteAmount({
    global: g,
    feeConfig: fc,
    mintSupply: q.bondingCurve.tokenTotalSupply,
    bondingCurve: q.bondingCurve,
    amount: o.solIn,
    curveBaseTokenBalance: q.curveBaseTokenBalance,
  });
  const qMin = new BN(applyBps(big(qOut), 9900).toString());
  const child = newBondingCurve(g, o.Q, pq.curve.quoteControl, o.creatorFeeBps, false, pq.curve);
  const childOut = getBuyV3TokenAmountFromQuoteAmount({
    global: g,
    feeConfig: fc,
    mintSupply: g.tokenTotalSupply,
    bondingCurve: child,
    amount: qMin,
    curveBaseTokenBalance: g.tokenTotalSupply,
  });
  return { qMin, amount: new BN(applyBps(big(childOut), 9800).toString()) };
}

async function exitIxs(o: LaunchOpts, amount: BN, g: Global): Promise<TransactionInstruction[]> {
  if (o.exit === "burn") {
    const devAta = getAssociatedTokenAddressSync(o.mint, o.dev, true, T22);
    return [createBurnCheckedInstruction(devAta, o.mint, o.dev, big(amount), COIN_DECIMALS, [], T22)];
  }
  if (o.exit === "sellq")
    return sellExactIn({ global: g, mint: o.mint, user: o.dev, quoteMint: o.Q, amount, minQuote: new BN(1) });
  const buybackFeeRecipient = g.buybackFeeRecipients[0];
  if (!buybackFeeRecipient) throw new Error("Global has no buybackFeeRecipients for the multi_hop sell");
  // ponytail: minAmountOut 1, because the child does not exist before this tx, so simulateMultiHopSwap
  // cannot price it. Phase 2 sets a real floor from the curve math.
  return PUMP_SDK.multiHopSwapInstructions({
    user: o.dev,
    side: "sell",
    amountIn: amount,
    minAmountOut: new BN(1),
    buybackFeeRecipient,
    hops: [
      { venue: "curve", baseMint: o.mint, quoteMint: o.Q, baseTokenProgram: T22, quoteTokenProgram: T22 },
      {
        venue: "curve",
        baseMint: o.Q,
        quoteMint: NATIVE_MINT,
        baseTokenProgram: T22,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      },
    ],
  });
}

// RESEARCH Pattern 2, the fork-verified order: budget, create, Q ATA, SOL to Q, child ATA, buyback Q ATA
// (the trade never creates it, Pitfall 5), exact-out child buy, exit.
export async function buildLaunch(
  o: LaunchOpts,
): Promise<{ ixs: TransactionInstruction[]; amount: BN; qMin: BN }> {
  const g = await o.online.fetchGlobal();
  const [fc, pq, q] = await Promise.all([
    o.online.fetchFeeConfig(),
    o.online.fetchPumpQuote(o.Q, { global: g }),
    o.online.fetchBuyState(o.Q, o.dev, T22),
  ]);
  if (!pq) throw new Error(`fetchPumpQuote returned null for ${o.Q.toBase58()}`);
  const { qMin, amount } = amounts(g, fc, q, pq, o);
  const ixs = [
    ...budget(o.cuLimit),
    await buildCreate({ ...o, creator: o.W, user: o.dev, quoteMint: o.Q, pumpQuote: pq.accounts }),
    ...(await buyExactIn({
      global: g,
      mint: o.Q,
      user: o.dev,
      quoteMint: NATIVE_MINT,
      spend: o.solIn,
      minOut: qMin,
    })),
    ...(await buyExactOut({ global: g, mint: o.mint, user: o.dev, quoteMint: o.Q, amount, maxQuote: qMin })),
    ...(await exitIxs(o, amount, g)),
  ];
  return { ixs, amount, qMin };
}
