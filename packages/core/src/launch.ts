// Launch instruction builders (RESEARCH Pattern 2). BONDR owns amounts, order and signing; the SDK owns
// every account list, because pump changes them on short notice.
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { readCurve } from "./curve.ts";
import { applyBps } from "./math.ts";
import {
  BN,
  canonicalPumpPoolPdaWithQuote,
  type Global,
  getBuyV3TokenAmountFromQuoteAmount,
  newBondingCurve,
  OnlinePumpAmmSdk,
  type OnlinePumpSdk,
  PUMP_SDK,
  type PumpQuoteAccounts,
} from "./pump.ts";
import { budget } from "./send.ts";
import {
  buybackRecipient,
  buyExactIn,
  buyExactOut,
  type PoolState,
  poolBaseFor,
  poolBuy,
  poolState,
  sellExactIn,
} from "./trade.ts";

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

// D-01: BONDR's 150 bps per coin only where the live Global allows a per-coin rate; elsewhere (devnet) the
// network default. Quotes, the status fees and the build all read it here, so they never disagree (WR-07).
export const creatorFeeFor = (g: Global): BN | undefined =>
  g.creatorFeeConfigurable ? new BN(150) : undefined;

type Online = InstanceType<typeof OnlinePumpSdk>;
type PumpQuote = NonNullable<Awaited<ReturnType<Online["fetchPumpQuote"]>>>;
type FeeConfig = Awaited<ReturnType<Online["fetchFeeConfig"]>>;
// burn: dev burns the bought coins. sell: multi_hop child to Q to SOL (D-14). sellq: sell_v3 child to Q only,
// the evidence variant when the multi_hop sell does not land.
export type Exit = "burn" | "sell" | "sellq";
// Where SOL and Q trade (D-18): Q's bonding curve until it bonds, then Q's canonical PumpSwap pool.
export type Venue = "curve" | "pool";
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
  // micro-lamports per CU; the worker passes PRIORITY_FEE_MICROLAMPORTS, the spike keeps budget()'s default.
  priorityFee?: number;
  // The worker sets minSolOut from its own prepare simulation (02-11), because the child does not exist
  // before the tx, so no quote can price the sell. The default 1 is the spike's.
  minSolOut?: BN;
};

const big = (x: BN): bigint => BigInt(x.toString());
const pct = (x: BN, bps: number): BN => new BN(applyBps(big(x), bps).toString());
// burnChecked fails unless this matches the mint; every pump create_v2 mint has 6 decimals.
export const COIN_DECIMALS = 6;

// Q's curve is complete but its pool does not exist yet (pump 6107 window). The worker maps it to paused.
export class AwaitingMigration extends Error {
  constructor(Q: PublicKey) {
    super(`BONDR ${Q.toBase58()} completed its curve and awaits migration to its pool`);
    this.name = "AwaitingMigration";
  }
}

// The SDK keeps its connection private; reading it spares every caller passing a second one.
const connOf = (online: Online): Connection => (online as unknown as { connection: Connection }).connection;

export async function quoteVenue(online: Online, Q: PublicKey): Promise<Venue> {
  if (!(await readCurve(online, Q)).complete) return "curve";
  const pool = await connOf(online).getAccountInfo(canonicalPumpPoolPdaWithQuote(Q, NATIVE_MINT));
  if (!pool) throw new AwaitingMigration(Q);
  return "pool";
}

type Fees = { online: Online; g: Global; fc: FeeConfig; Q: PublicKey };
type Pooled = PoolState & { amm: InstanceType<typeof OnlinePumpAmmSdk> };

async function curveQOut(f: Fees, solIn: BN): Promise<BN> {
  const q = await f.online.fetchBuyState(f.Q, PublicKey.default, T22);
  return getBuyV3TokenAmountFromQuoteAmount({
    global: f.g,
    feeConfig: f.fc,
    mintSupply: q.bondingCurve.tokenTotalSupply,
    bondingCurve: q.bondingCurve,
    amount: solIn,
    curveBaseTokenBalance: q.curveBaseTokenBalance,
  });
}

// Exact-out (D-16): the child amount that qMin of Q buys on the new curve, 2% under for rounding.
function childAmount(f: Fees, pq: PumpQuote, qMin: BN, creatorFeeBps?: BN): BN {
  const child = newBondingCurve(f.g, f.Q, pq.curve.quoteControl, creatorFeeBps, false, pq.curve);
  const out = getBuyV3TokenAmountFromQuoteAmount({
    global: f.g,
    feeConfig: f.fc,
    mintSupply: f.g.tokenTotalSupply,
    bondingCurve: child,
    amount: qMin,
    curveBaseTokenBalance: f.g.tokenTotalSupply,
  });
  return pct(out, 9800);
}

// SOL buys at least qMin of Q on Q's venue (1% under the quote for Q's price moving), then exactly `amount`
// of the child costs at most qMin. `user` only shapes the pool state the pool buy reuses.
async function price(online: Online, Q: PublicKey, solIn: BN, user: PublicKey, creatorFeeBps?: BN) {
  const venue = await quoteVenue(online, Q);
  const g = await online.fetchGlobal();
  const [fc, pq] = await Promise.all([online.fetchFeeConfig(), online.fetchPumpQuote(Q, { global: g })]);
  if (!pq) throw new Error(`fetchPumpQuote returned null for ${Q.toBase58()}`);
  const fee = creatorFeeBps ?? creatorFeeFor(g);
  const f: Fees = { online, g, fc, Q };
  let pool: Pooled | undefined;
  if (venue === "pool") {
    const amm = new OnlinePumpAmmSdk(connOf(online));
    pool = { amm, ...(await poolState({ amm, mint: Q, quoteMint: NATIVE_MINT, user })) };
  }
  const qMin = pct(pool ? poolBaseFor(pool.state, solIn) : await curveQOut(f, solIn), 9900);
  return { venue, g, pq, pool, qMin, fee, amount: childAmount(f, pq, qMin, fee) };
}
type Priced = Awaited<ReturnType<typeof price>>;

// The worker's quote route (tokensOut): no wallet needed, nothing is built.
export async function launchQuote(online: Online, Q: PublicKey, solIn: BN, creatorFeeBps?: BN) {
  const { venue, qMin, amount } = await price(online, Q, solIn, PublicKey.default, creatorFeeBps);
  return { venue, qMin, amount };
}

// Pool venue: exact out, so the dev gets exactly qMin of Q and spends at most solIn.
function qBuyIxs(o: LaunchOpts, p: Priced): Promise<TransactionInstruction[]> {
  const side = { mint: o.Q, quoteMint: NATIVE_MINT, user: o.dev };
  if (p.pool)
    return poolBuy({ ...side, amm: p.pool.amm, fetched: p.pool, baseOut: p.qMin, maxQuoteIn: o.solIn });
  return buyExactIn({ ...side, global: p.g, spend: o.solIn, minOut: p.qMin });
}

// Hop 1 is always the child's curve (the child is new); hop 2 trades Q on Q's venue. The pool's buyback
// wallet is the one whose WSOL ATA the pool buy just created.
async function exitIxs(o: LaunchOpts, p: Priced): Promise<TransactionInstruction[]> {
  if (o.exit === "burn") {
    const devAta = getAssociatedTokenAddressSync(o.mint, o.dev, true, T22);
    return [createBurnCheckedInstruction(devAta, o.mint, o.dev, big(p.amount), COIN_DECIMALS, [], T22)];
  }
  const side = { global: p.g, mint: o.mint, user: o.dev, quoteMint: o.Q, amount: p.amount };
  if (o.exit === "sellq") return sellExactIn({ ...side, minQuote: new BN(1) });
  const qHop = {
    baseMint: o.Q,
    quoteMint: NATIVE_MINT,
    baseTokenProgram: T22,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  };
  return PUMP_SDK.multiHopSwapInstructions({
    user: o.dev,
    side: "sell",
    amountIn: p.amount,
    minAmountOut: o.minSolOut ?? new BN(1),
    buybackFeeRecipient: p.pool ? p.pool.buyback : buybackRecipient(p.g),
    hops: [
      { venue: "curve", baseMint: o.mint, quoteMint: o.Q, baseTokenProgram: T22, quoteTokenProgram: T22 },
      { venue: p.venue, ...qHop },
    ],
  });
}

// RESEARCH Pattern 2, the fork-verified order: budget, create, SOL to Q on Q's venue (with its ATAs), child
// ATA, buyback Q ATA (the trade never creates it, Pitfall 5), exact-out child buy, exit.
export async function buildLaunch(o: LaunchOpts) {
  const p = await price(o.online, o.Q, o.solIn, o.dev, o.creatorFeeBps);
  const create = await buildCreate({
    ...o,
    creatorFeeBps: p.fee,
    creator: o.W,
    user: o.dev,
    quoteMint: o.Q,
    pumpQuote: p.pq.accounts,
  });
  const childBuy = {
    global: p.g,
    mint: o.mint,
    user: o.dev,
    quoteMint: o.Q,
    amount: p.amount,
    maxQuote: p.qMin,
  };
  const ixs: TransactionInstruction[] = [
    ...budget(o.cuLimit, o.priorityFee),
    create,
    ...(await qBuyIxs(o, p)),
    ...(await buyExactOut(childBuy)),
    ...(await exitIxs(o, p)),
  ];
  return { ixs, amount: p.amount, qMin: p.qMin, venue: p.venue };
}
