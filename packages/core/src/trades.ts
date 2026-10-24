// One fetched transaction to trade rows and coin patches. Pure: the stream, the gap fill and the launch
// settle all call it, so every path writes the same rows. Worker-side; web reads the stored values.
// Amounts are decimal strings (base units), display values are numbers. Always quoteAmount, never the
// TradeEvent's SOL field: it is 0 for BONDR-quoted coins.
import { type EventTx, innerEvents, type PumpEvent } from "./events.ts";
import { bondrAtBond, curvePrice, mcapSol, poolPrice, progress, toSol } from "./price.ts";

type Balance = { mint: string; owner?: string; uiTokenAmount: { amount: string } };
export type TradeTx = EventTx & {
  slot: number;
  blockTime?: number | null;
  transaction: { signatures: readonly string[] };
  meta: { postTokenBalances?: readonly Balance[] | null } | null;
};
// BONDR's mint, its BONDR/SOL pool, and its last known price (lamports per BONDR base unit).
export type Bondr = { mint: string; pool: string; sol: number | null };
export type KnownCoin = {
  mint: string;
  bondingCurve: string;
  pool: string;
  initialRealTokenReserves: string;
};
export type Launch = { mint: string; exit: "burn" | "sell" };
export type ParsedTrade = {
  signature: string;
  ix: number;
  mint: string;
  slot: string;
  at: string;
  side: "buy" | "sell" | "burn";
  launch: boolean;
  venue: "curve" | "pool";
  trader: string;
  tokenAmount: string;
  quoteAmount: string | null;
  sol: string | null;
  bondrSol: number | null;
  mcapSol: number | null;
};
export type NewCoin = {
  mint: string;
  bondingCurve: string;
  launchedAt: string;
  initialRealTokenReserves: string;
  realTokenReserves: string;
  realQuoteReserves: string;
  virtualTokenReserves: string;
  virtualQuoteReserves: string;
  launchMcapSol: number | null;
  mcapSol: number | null;
  progress: number;
  bondrAtBond: string;
  bondSol: number | null;
};
type Reserves = "realTokenReserves" | "realQuoteReserves" | "virtualTokenReserves" | "virtualQuoteReserves";
export type CoinPatch = { mint: string } & Partial<Pick<NewCoin, Reserves | "progress" | "bondrAtBond">> & {
    venue?: "curve" | "complete" | "pool";
    mcapSol?: number;
    bondSol?: number;
    bondSig?: string;
    bondedAt?: string;
  };
export type Parsed = {
  trades: ParsedTrade[];
  patches: CoinPatch[];
  bondr: number | null;
  created: NewCoin | null;
  unknown: string[];
};

type Ctx = {
  tx: TradeTx;
  sig: string;
  slot: string;
  at: string;
  bondr: Bondr;
  launch?: Launch;
  init: Map<string, bigint>; // initialRealTokenReserves of every coin this tx may write
  pools: ReadonlyMap<string, KnownCoin>;
  events: PumpEvent[];
  create?: PumpEvent; // the launch coin's CreateEvent, in launch mode
  prices: { ix: number; sol: number }[]; // BONDR price after each BONDR event in this tx
};
type Out = { trade?: ParsedTrade; patch?: CoinPatch };

const HANDLED = new Set(
  "CreateEvent TradeEvent CompleteEvent PostCompleteBuyEvent BuyEvent SellEvent CreatePoolEvent".split(" "),
);
const BURN_IX = 1000; // past every event index of a tx
const big = (v: unknown): bigint => BigInt(String(v));
const sol = (lamports: bigint): number => Number(lamports) / 1e9;

// Price from the pool's post-trade token balances (exact whether the event's own reserves are pre- or
// post-trade) plus its virtual quote reserves.
function poolEventPrice(c: Ctx, e: PumpEvent, baseMint: string): number | null {
  const held = (c.tx.meta?.postTokenBalances ?? []).filter((b) => b.owner === e.data.pool);
  const base = held.find((b) => b.mint === baseMint)?.uiTokenAmount.amount;
  const quote = held.find((b) => b.mint !== baseMint)?.uiTokenAmount.amount;
  return base && quote ? poolPrice(BigInt(quote) + big(e.data.virtualQuoteReserves), BigInt(base)) : null;
}

// BONDR's own price from a BONDR curve trade or a BONDR/SOL pool trade (D-01).
function bondrPrice(c: Ctx, e: PumpEvent): number | null {
  if (e.name === "TradeEvent" && e.data.mint === c.bondr.mint)
    return curvePrice(big(e.data.virtualQuoteReserves), big(e.data.virtualTokenReserves));
  if ((e.name === "BuyEvent" || e.name === "SellEvent") && e.data.pool === c.bondr.pool)
    return poolEventPrice(c, e, c.bondr.mint);
  return null;
}

// The BONDR event nearest to this one (a multi-hop buy is followed by, a sell followed by, its own BONDR
// leg), else the last known price.
function priceAt(c: Ctx, ix: number): number | null {
  let best: Ctx["prices"][number] | undefined;
  for (const p of c.prices) if (!best || Math.abs(p.ix - ix) < Math.abs(best.ix - ix)) best = p;
  return best?.sol ?? c.bondr.sol;
}

type RowIn = { mint: string; side: "buy" | "sell"; venue: "curve" | "pool"; tokens: unknown; quote: unknown };
function row(c: Ctx, e: PumpEvent, r: RowIn, price: number | null): ParsedTrade {
  const b = priceAt(c, e.ix);
  return {
    signature: c.sig,
    ix: e.ix,
    mint: r.mint,
    slot: c.slot,
    at: c.at,
    side: r.side,
    launch: c.launch?.mint === r.mint,
    venue: r.venue,
    trader: String(e.data.user),
    tokenAmount: String(r.tokens),
    quoteAmount: String(r.quote),
    sol: b === null ? null : String(toSol(big(r.quote), b)),
    bondrSol: b,
    mcapSol: b === null || price === null ? null : mcapSol(price, b),
  };
}

// Curve state after a trade: reserves, market cap, progress and what bonding would take.
function curveState(c: Ctx, mint: string, d: Record<string, unknown>, b: number | null): CoinPatch {
  const [vQ, vT] = [big(d.virtualQuoteReserves), big(d.virtualTokenReserves)];
  const [realT, realQ] = [big(d.realTokenReserves), big(d.realQuoteReserves)];
  const atBond = bondrAtBond(vQ, vT, realT, realQ);
  return {
    mint,
    realTokenReserves: String(realT),
    realQuoteReserves: String(realQ),
    virtualTokenReserves: String(vT),
    virtualQuoteReserves: String(vQ),
    ...(b !== null && { mcapSol: mcapSol(curvePrice(vQ, vT), b), bondSol: sol(toSol(atBond, b)) }),
    progress: progress(realT, c.init.get(mint) ?? 0n),
    bondrAtBond: String(atBond),
  };
}

function curveTrade(c: Ctx, e: PumpEvent): Out {
  const d = e.data;
  const mint = String(d.mint);
  if (!c.init.has(mint)) return {};
  const side = d.isBuy ? "buy" : "sell";
  const price = curvePrice(big(d.virtualQuoteReserves), big(d.virtualTokenReserves));
  const trade = row(c, e, { mint, side, venue: "curve", tokens: d.tokenAmount, quote: d.quoteAmount }, price);
  return { trade, patch: curveState(c, mint, d, priceAt(c, e.ix)) };
}

function poolTrade(c: Ctx, e: PumpEvent): Out {
  const mint = c.pools.get(String(e.data.pool))?.mint;
  if (!mint) return {};
  const buy = e.name === "BuyEvent";
  const [tokens, quote] = buy
    ? [e.data.baseAmountOut, e.data.quoteAmountIn]
    : [e.data.baseAmountIn, e.data.quoteAmountOut];
  const price = poolEventPrice(c, e, mint);
  const trade = row(c, e, { mint, side: buy ? "buy" : "sell", venue: "pool", tokens, quote }, price);
  return { trade, ...(trade.mcapSol !== null && { patch: { mint, mcapSol: trade.mcapSol } }) };
}

// The completing buy's migration fill, priced at the reserves it leaves for the pool.
function postCompleteBuy(c: Ctx, e: PumpEvent): Out {
  const d = e.data;
  const mint = String(d.mint);
  if (!c.init.has(mint)) return {};
  const price = poolPrice(big(d.poolQuoteReservesAfter), big(d.poolBaseReservesAfter));
  const trade = row(c, e, { mint, side: "buy", venue: "pool", tokens: d.baseOut, quote: d.quoteIn }, price);
  return { trade, ...(trade.mcapSol !== null && { patch: { mint, mcapSol: trade.mcapSol } }) };
}

function handle(c: Ctx, e: PumpEvent): Out {
  const mint = String(e.data.mint ?? e.data.baseMint);
  if (e.name === "TradeEvent") return curveTrade(c, e);
  if (e.name === "BuyEvent" || e.name === "SellEvent") return poolTrade(c, e);
  if (e.name === "PostCompleteBuyEvent") return postCompleteBuy(c, e);
  if (!c.init.has(mint)) return {};
  if (e.name === "CompleteEvent")
    return { patch: { mint, venue: "complete", bondSig: c.sig, bondedAt: c.at } };
  // Only the coin's canonical pool: create_pool is permissionless, so anyone can open another pool of the coin.
  if (e.name === "CreatePoolEvent" && c.pools.get(String(e.data.pool))?.mint === mint)
    return { patch: { mint, venue: "pool", bondedAt: c.at } };
  return {};
}

// D-16: the launch coin's row, priced at the CreateEvent's initial reserves (the chart opens there), then
// moved to the post-launch state.
function newCoin(c: Ctx, create: PumpEvent, after: CoinPatch | undefined): NewCoin {
  const d = create.data;
  const [vQ, vT, realT] = [
    big(d.virtualQuoteReserves),
    big(d.virtualTokenReserves),
    big(d.realTokenReserves),
  ];
  const b = priceAt(c, create.ix);
  const atBond = bondrAtBond(vQ, vT, realT, 0n);
  const launchMcapSol = b === null ? null : mcapSol(curvePrice(vQ, vT), b);
  return {
    mint: String(d.mint),
    bondingCurve: String(d.bondingCurve),
    launchedAt: c.at,
    initialRealTokenReserves: String(realT),
    realTokenReserves: String(realT),
    realQuoteReserves: "0",
    virtualTokenReserves: String(vT),
    virtualQuoteReserves: String(vQ),
    launchMcapSol,
    mcapSol: launchMcapSol,
    progress: 0,
    bondrAtBond: String(atBond),
    bondSol: b === null ? null : sol(toSol(atBond, b)),
    ...after, // same mint: the launch's own trades
  };
}

// The insta burn is a Token-2022 burn with no event: one synthetic row for the dev buy's tokens.
const burnRow = (buy: ParsedTrade): ParsedTrade => ({
  ...buy,
  ix: BURN_IX,
  side: "burn",
  quoteAmount: null,
  sol: null,
  bondrSol: null,
  mcapSol: null,
});

// ponytail: the mint and pool maps are rebuilt per tx (O(coins)); keep them on the registry if coins reach
// the tens of thousands.
function context(tx: TradeTx, coins: ReadonlyMap<string, KnownCoin>, bondr: Bondr, launch?: Launch): Ctx {
  const events = innerEvents(tx);
  const init = new Map([...coins.values()].map((k) => [k.mint, BigInt(k.initialRealTokenReserves)]));
  const create = events.find((e) => e.name === "CreateEvent" && e.data.mint === launch?.mint);
  if (create) init.set(String(create.data.mint), big(create.data.realTokenReserves));
  const pools = new Map([...coins.values()].map((k) => [k.pool, k]));
  const ts = tx.blockTime ?? Number(events.find((e) => e.data.timestamp)?.data.timestamp ?? 0);
  const c: Ctx = {
    tx,
    sig: tx.transaction.signatures[0] ?? "",
    slot: String(tx.slot),
    at: new Date(ts * 1000).toISOString(),
    bondr,
    init,
    pools,
    events,
    prices: [],
    ...(create && { create }),
    ...(launch && { launch }),
  };
  for (const e of events) {
    const p = bondrPrice(c, e);
    if (p !== null) c.prices.push({ ix: e.ix, sol: p });
  }
  return c;
}

export function parseTx(
  tx: TradeTx,
  coins: ReadonlyMap<string, KnownCoin>,
  bondr: Bondr,
  launch?: Launch,
): Parsed {
  const c = context(tx, coins, bondr, launch);
  const { events, create } = c;
  const trades: ParsedTrade[] = [];
  const patches = new Map<string, CoinPatch>();
  for (const e of events) {
    const { trade, patch } = handle(c, e);
    if (trade) trades.push(trade);
    if (patch) patches.set(patch.mint, { ...patches.get(patch.mint), ...patch });
  }
  const created = create ? newCoin(c, create, patches.get(String(create.data.mint))) : null;
  const devBuy = trades.find((t) => t.launch && t.side === "buy");
  if (launch?.exit === "burn" && devBuy) trades.push(burnRow(devBuy));
  const touched = trades.length > 0 || patches.size > 0;
  const unknown = touched ? [...new Set(events.map((e) => e.name).filter((n) => !HANDLED.has(n)))] : [];
  return { trades, patches: [...patches.values()], bondr: c.prices.at(-1)?.sol ?? null, created, unknown };
}
