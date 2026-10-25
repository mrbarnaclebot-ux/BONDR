// The token page trade feed, newest first, paged by (slot, seq) keyset so a page never skips or repeats a row
// while new trades land on top.
import "server-only";
import type { Candle, TradeRow } from "@bondr/core/api";
import { and, desc, eq, sql } from "drizzle-orm";
import { coinByMint } from "./coins";
import { coins, db, trades } from "./db";

export const PAGE = 50;
const INT8_MAX = 2n ** 63n - 1n;

export type Cursor = { slot: bigint; seq: bigint };

/** "slot.seq" from the client, or null for anything else (no signs, no exponent, int8 range only). */
export function parseCursor(s: string): Cursor | null {
  if (!/^\d{1,19}\.\d{1,19}$/.test(s)) return null;
  const [slot, seq] = s.split(".").map(BigInt);
  return slot > INT8_MAX || seq > INT8_MAX ? null : { slot, seq };
}

const COLUMNS = {
  signature: trades.signature,
  ix: trades.ix,
  side: trades.side,
  launch: trades.launch,
  venue: trades.venue,
  trader: trades.trader,
  tokenAmount: trades.tokenAmount,
  sol: trades.sol,
  mcapSol: trades.mcapSol,
  at: trades.at,
  slot: trades.slot,
  seq: trades.seq,
};

/** One page of a coin's trades, older than `before` when given; `more` says whether an older page exists. */
export async function tradesPage(
  mint: string,
  before?: Cursor,
): Promise<{ trades: TradeRow[]; more: boolean }> {
  const older = before
    ? sql`(${trades.slot}, ${trades.seq}) < (${String(before.slot)}::bigint, ${String(before.seq)}::bigint)`
    : undefined;
  const rows = await db()
    .select(COLUMNS)
    .from(trades)
    .where(and(eq(trades.mint, mint), older))
    .orderBy(desc(trades.slot), desc(trades.seq))
    .limit(PAGE + 1);
  return {
    more: rows.length > PAGE,
    trades: rows.slice(0, PAGE).map((r) => ({
      ...r,
      side: r.side as TradeRow["side"],
      venue: r.venue as TradeRow["venue"],
      at: r.at.toISOString(),
      seq: String(r.seq),
    })),
  };
}

const INTERVALS: Record<string, number> = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86_400 };

/** Candle seconds for the chart's interval buttons, or null for anything else. */
export const parseInterval = (s: string): number | null =>
  Object.hasOwn(INTERVALS, s) ? INTERVALS[s] : null;

type CandleSql = { time: string; open: number; high: number; low: number; close: number; volume: number };

/**
 * Market cap candles in SOL, computed on read (RESEARCH Pattern 6). Each candle opens at the previous trade's
 * market cap, so candles are continuous and the first opens at the launch price (D-16). Burns are not prices.
 */
async function read(mint: string, seconds: number): Promise<Candle[]> {
  const rows = await db().execute<CandleSql>(sql`
    with t as (
      select at, slot, seq, mcap_sol, coalesce(sol, 0) as sol,
        coalesce(lag(mcap_sol) over (order by slot, seq),
          (select launch_mcap_sol from coins where mint = ${mint})) as prev
      from trades where mint = ${mint} and side <> 'burn' and mcap_sol is not null
    )
    select (floor(extract(epoch from at) / ${seconds}) * ${seconds})::float8 as time,
      (array_agg(prev order by slot, seq))[1] as open,
      greatest(max(mcap_sol), max(prev)) as high,
      least(min(mcap_sol), min(prev)) as low,
      (array_agg(mcap_sol order by slot desc, seq desc))[1] as close,
      (sum(sol) / 1e9)::float8 as volume
    from t group by 1 order by 1`);
  return rows.map((r) => ({ ...r, time: Number(r.time) }));
}

// Kept 10 s per key, so every open page answering one resync (a worker restart) is one Neon read (D-04); a
// failed read is not kept. ponytail: per-process map cleared at 1000 entries, the same shape as lib/coins.ts.
const seen = new Map<string, { at: number; v: Promise<unknown> }>();

export function kept<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.v as Promise<T>;
  const v = read();
  if (seen.size >= 1000) seen.clear();
  seen.set(key, { at: Date.now(), v });
  v.catch(() => seen.delete(key));
  return v;
}

// ponytail: scans every trade of the coin per (mint, interval) every 10 s; store rollups past about 100k trades
// per coin.
export const candles = (mint: string, seconds: number): Promise<Candle[]> =>
  kept(`candles:${mint}:${seconds}`, () => read(mint, seconds));

/** The bond time in UTC seconds for the chart's Bonded marker, or null on the curve or before indexing. */
export const bondTime = (mint: string): Promise<number | null> =>
  kept(`bond:${mint}`, async () => {
    const [r] = await db().select({ at: coins.bondedAt }).from(coins).where(eq(coins.mint, mint)).limit(1);
    return r?.at ? Math.floor(r.at.getTime() / 1000) : null;
  });

/** The token page's resync: the first page plus the coin row, so the stats catch up too. */
export const resyncPage = (mint: string) =>
  kept(`resync:${mint}`, async () => {
    const [page, coin] = await Promise.all([tradesPage(mint), coinByMint(mint)]);
    return { ...page, coin };
  });
