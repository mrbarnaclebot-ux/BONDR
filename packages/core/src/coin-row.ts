// One coin's indexed row for the token page, with the windowed values (1h and 24h volume, 1h change)
// computed at read time (RESEARCH Pattern 7). Burn rows never count: they carry no SOL and their market cap
// is not a trade price. Web reads it for the token page; the worker reads it after a write to publish the
// coin's new numbers, so both always agree. The home lists read pages of the same rows (coinRows).
import { eq, type SQL, sql } from "drizzle-orm";
import type { CoinFees, CoinRow, Exit, Venue } from "./api.ts";
import type { Db } from "./db.ts";
import { budgetOf } from "./fees.ts";
import { toSol } from "./price.ts";
import { coins, launches } from "./schema.ts";

export const vol = (window: "1 hour" | "24 hours") =>
  sql<string>`(select coalesce(sum(t.sol), 0) from trades t
    where t.mint = ${coins.mint} and t.side <> 'burn' and t.at > now() - ${window}::interval)`;

// The last trade price an hour ago; null when the coin had no trade before then (change1h then uses launch).
const mcap1hAgo = sql<number | null>`(select t.mcap_sol from trades t
  where t.mint = ${coins.mint} and t.side <> 'burn' and t.at <= now() - interval '1 hour'
  order by t.slot desc, t.seq desc limit 1)`;

// The coin's one bond burn (forced bond or fallback) and its finalize, read from landed ledger rows.
const bondBurn = (col: "kind" | "signature") =>
  sql<string | null>`(select l.${sql.raw(col)} from fee_ledger l where l.mint = ${coins.mint}
    and l.state = 'landed' and l.kind in ('forced_bond','pool_burn') limit 1)`;
const finalizeSig = sql<string | null>`(select l.signature from fee_ledger l where l.mint = ${coins.mint}
  and l.state = 'landed' and l.kind = 'finalize_update' limit 1)`;
// A5: supply burned counts the launch transaction's insta burn too.
const launchBurn = sql<string>`(select coalesce(sum(t.token_amount), 0) from trades t
  where t.mint = ${coins.mint} and t.launch and t.side = 'burn')`;

const FEE = {
  w: launches.w,
  feeBudget: coins.feeBudget,
  feesUnclaimed: coins.feesUnclaimed,
  costToComplete: coins.costToComplete,
  bondrSol: coins.bondrSol,
  toBuyback: coins.toBuyback,
  toBuybackSol: coins.toBuybackSol,
  toTreasury: coins.toTreasury,
  toTreasurySol: coins.toTreasurySol,
  bondSpent: coins.bondSpent,
  bondSpentSol: coins.bondSpentSol,
  bondBurned: coins.bondBurned,
  deployerEarned: coins.deployerEarned,
  deployerEarnedSol: coins.deployerEarnedSol,
  finalize: coins.finalize,
  deployerBps: coins.deployerBps,
  bondKind: bondBurn("kind"),
  bondBurnSig: bondBurn("signature"),
  finalizeSig,
  launchBurn,
};

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
  fee: FEE,
};

/** Market cap change over the last hour, against the launch price for a coin with no older trade. */
export const change1h = (mcap: number, before: number | null, launch: number): number | null => {
  const base = before ?? launch;
  return base > 0 ? mcap / base - 1 : null;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

const select = (exec: Pick<Db, "select">) =>
  exec.select(COLUMNS).from(coins).innerJoin(launches, eq(launches.id, coins.launchId));

type Raw = Awaited<ReturnType<typeof select>>[number];

const BOND_KIND = { forced_bond: "forced", pool_burn: "fallback" } as const;

/** The panel's fee numbers: base units and lamports as strings; SOL values need the stored BONDR price. */
function feesOf({
  bondrSol,
  feeBudget,
  feesUnclaimed,
  launchBurn,
  bondKind,
  costToComplete,
  ...f
}: Raw["fee"]): CoinFees {
  const sol = (x: string | null) =>
    x === null || bondrSol === null ? null : toSol(BigInt(x), bondrSol).toString();
  const budget = budgetOf(BigInt(feeBudget), BigInt(feesUnclaimed)).toString();
  return {
    ...f,
    budget,
    budgetSol: sol(budget),
    cost: costToComplete,
    costSol: sol(costToComplete),
    burnedSupply: (BigInt(f.bondBurned) + BigInt(launchBurn)).toString(),
    bondKind: bondKind ? (BOND_KIND[bondKind as keyof typeof BOND_KIND] ?? null) : null,
    finalize: f.finalize as CoinFees["finalize"],
  };
}

function toRow({ mcap1hAgo: before, fee, ...r }: Raw): CoinRow {
  return {
    ...r,
    fees: feesOf(fee),
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

/** The indexed coin of a mint, or null before the indexer has its row. The caller checks the mint format. */
export async function coinRow(exec: Pick<Db, "select">, mint: string): Promise<CoinRow | null> {
  const [r] = await select(exec).where(eq(coins.mint, mint)).limit(1);
  return r ? toRow(r) : null;
}

/** A page of indexed coins in `order` (fixed column orders from the caller, never user text), optionally filtered. */
export async function coinRows(
  exec: Pick<Db, "select">,
  order: SQL[],
  limit: number,
  offset: number,
  where?: SQL,
): Promise<CoinRow[]> {
  const rows = await select(exec)
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
  return rows.map(toRow);
}
