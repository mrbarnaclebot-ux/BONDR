// One coin's indexed row for the token page, with the windowed values (1h and 24h volume, 1h change)
// computed at read time (RESEARCH Pattern 7). Burn rows never count: they carry no SOL and their market cap
// is not a trade price. Web reads it for the token page; the worker reads it after a write to publish the
// coin's new numbers, so both always agree.
import { eq, sql } from "drizzle-orm";
import type { CoinRow, Exit, Venue } from "./api.ts";
import type { Db } from "./db.ts";
import { coins, launches } from "./schema.ts";

const vol = (window: "1 hour" | "24 hours") =>
  sql<string>`(select coalesce(sum(t.sol), 0) from trades t
    where t.mint = ${coins.mint} and t.side <> 'burn' and t.at > now() - ${window}::interval)`;

// The last trade price an hour ago; null when the coin had no trade before then (change1h then uses launch).
const mcap1hAgo = sql<number | null>`(select t.mcap_sol from trades t
  where t.mint = ${coins.mint} and t.side <> 'burn' and t.at <= now() - interval '1 hour'
  order by t.slot desc, t.seq desc limit 1)`;

const COLUMNS = {
  mint: coins.mint,
  venue: coins.venue,
  mcapSol: coins.mcapSol,
  progress: coins.progress,
  lastTradeAt: coins.lastTradeAt,
  bondSol: coins.bondSol,
  bondrAtBond: coins.bondrAtBond,
  realQuoteReserves: coins.realQuoteReserves,
  holders: coins.holders,
  launchedAt: coins.launchedAt,
  launchMcapSol: coins.launchMcapSol,
  bondSig: coins.bondSig,
  bondedAt: coins.bondedAt,
  name: launches.name,
  symbol: launches.symbol,
  imageCid: launches.imageCid,
  exit: launches.exit,
  vol1h: vol("1 hour"),
  vol24h: vol("24 hours"),
  mcap1hAgo,
};

/** Market cap change over the last hour, against the launch price for a coin with no older trade. */
export const change1h = (mcap: number, before: number | null, launch: number): number | null => {
  const base = before ?? launch;
  return base > 0 ? mcap / base - 1 : null;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The indexed coin of a mint, or null before the indexer has its row. The caller checks the mint format. */
export async function coinRow(exec: Pick<Db, "select">, mint: string): Promise<CoinRow | null> {
  const [r] = await exec
    .select(COLUMNS)
    .from(coins)
    .innerJoin(launches, eq(launches.id, coins.launchId))
    .where(eq(coins.mint, mint))
    .limit(1);
  if (!r) return null;
  const { mcap1hAgo: before, ...rest } = r;
  return {
    ...rest,
    venue: r.venue as Venue,
    exit: r.exit as Exit,
    vol1h: Number(r.vol1h) / 1e9,
    vol24h: Number(r.vol24h) / 1e9,
    change1h: change1h(r.mcapSol, before === null ? null : Number(before), r.launchMcapSol),
    lastTradeAt: iso(r.lastTradeAt),
    launchedAt: r.launchedAt.toISOString(),
    bondedAt: iso(r.bondedAt),
  };
}
