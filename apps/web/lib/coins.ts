// The token page's coin row and the home lists; the row query lives in core so the worker publishes the same
// numbers live.
import "server-only";
import type { CoinRow } from "@bondr/core/api";
import { coinRow, coinRows, vol } from "@bondr/core/coin-row";
import { asc, desc, sql } from "drizzle-orm";
import { coins, db, launches } from "./db";

export const coinByMint = (mint: string) => coinRow(db(), mint);

export const SORTS = ["top", "latest", "oldest"] as const;
export type Sort = (typeof SORTS)[number];
export const LIST_PAGE = 50;
export const MAX_PAGE = 99;

export const parseSort = (s: string | null | undefined): Sort | null =>
  !s ? "top" : SORTS.includes(s as Sort) ? (s as Sort) : null;

/** "0".."99" from the client, 0 when absent, null for anything else. */
export const parsePage = (s: string | null): number | null =>
  s === null ? 0 : /^\d{1,2}$/.test(s) ? Number(s) : null;

/** Search text from the client: trimmed; "" under 2 characters (too broad); null over 64. */
export const parseQ = (s: string | null | undefined): string | null => {
  const q = s?.trim() ?? "";
  return q.length > 64 ? null : q.length < 2 ? "" : q;
};

/** LIKE pattern text matching `s` literally: the escape character, % and _ get a backslash. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, "\\$&");

// Name or symbol contains q (any case), or the mint starts with it (base58 is case-sensitive). Values are bound
// parameters; escapeLike keeps a user's % and _ literal.
const matches = (q: string) => {
  const e = escapeLike(q);
  return sql`(${launches.name} ilike ${`%${e}%`} escape '\\' or ${launches.symbol} ilike ${`%${e}%`} escape '\\'
    or ${coins.mint} like ${`${e}%`} escape '\\')`;
};

// D-03 orders; ties break by newest launch, then mint so offset pages never repeat or skip a coin.
const ORDER = {
  top: [desc(coins.mcapSol), desc(coins.launchedAt), asc(coins.mint)],
  latest: [desc(coins.launchedAt), asc(coins.mint)],
  oldest: [asc(coins.launchedAt), asc(coins.mint)],
};

// The home page and its route are kept 10 s per key, so a burst of visitors is one Neon read; a failed read is
// not kept. ponytail: per-process map cleared at 1000 entries; a shared cache if web runs more than one instance.
const seen = new Map<string, { at: number; v: Promise<unknown> }>();

function kept<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.v as Promise<T>;
  const v = read();
  if (seen.size >= 1000) seen.clear();
  seen.set(key, { at: Date.now(), v });
  v.catch(() => seen.delete(key));
  return v;
}

export type CoinPage = { coins: CoinRow[]; more: boolean };

// D-44: exact ticker matches first, oldest first, then the sort's own order. Symbols are stored uppercase.
const exactFirst = (key: string) => {
  const exact = sql`(${launches.symbol} = ${key})`;
  return [sql`${exact} desc`, sql`case when ${exact} then ${coins.launchedAt} end asc`];
};

/**
 * Marks the oldest exact match "First" on page 0 when two or more visible coins share the ticker. Exact matches
 * lead the order, so page 0 holds them all (or a full page of them): no extra read.
 */
export function markFirst(rows: CoinRow[], key: string, page: number): CoinRow[] {
  const [head] = rows;
  if (page !== 0 || head?.symbol !== key || rows.filter((r) => r.symbol === key).length < 2) return rows;
  return [{ ...head, first: true }, ...rows.slice(1)];
}

/**
 * One page of BONDR coins (only coins rows, so only launches through BONDR) with the windowed columns, filtered
 * by the search text `q` when it has 2 or more characters (LIST-05). A full mint matches only that coin.
 * ponytail: offset pages capped at 100; switch to keyset when lists pass 5,000 coins. Search is a sequential
 * scan; add pg_trgm when coins pass tens of thousands.
 */
export const listCoins = ({ sort, page, q }: { sort: Sort; page: number; q?: string }): Promise<CoinPage> => {
  const term = parseQ(q) ?? "";
  return kept(`${sort}:${page}:${term}`, async () => {
    const where = term ? matches(term) : undefined;
    const key = term.toUpperCase();
    const order = term ? [...exactFirst(key), ...ORDER[sort]] : ORDER[sort];
    const rows = await coinRows(db(), order, LIST_PAGE + 1, page * LIST_PAGE, where);
    const list = rows.slice(0, LIST_PAGE);
    return { coins: term ? markFirst(list, key, page) : list, more: rows.length > LIST_PAGE };
  });
};

export type TrendMode = "1h" | "24h" | "latest";
export type Trending = { mode: TrendMode; coins: CoinRow[] };

// D-03 and D-13 in one order: 1h volume, then 24h volume, then the newest launch. Burns never count (vol).
const TRENDING = [desc(vol("1 hour")), desc(vol("24 hours")), desc(coins.launchedAt), asc(coins.mint)];

/** Which key decided the order: the first row has 1h volume, else 24h volume, else none traded in 24 h. */
export const trendMode = (rows: CoinRow[]): TrendMode =>
  !rows[0] ? "latest" : rows[0].vol1h > 0 ? "1h" : rows[0].vol24h > 0 ? "24h" : "latest";

/** The Trending scroller (LIST-01): up to 10 coins and the mode its caption and chips follow. */
export const trending = (): Promise<Trending> =>
  kept("trending", async () => {
    const rows = await coinRows(db(), TRENDING, 10, 0);
    return { mode: trendMode(rows), coins: rows };
  });

// D-15's budget (fee_budget plus the 90% share of the unclaimed fees, treasury floored), as budgetOf computes it.
const BUDGET = sql`(${coins.feeBudget} + ${coins.feesUnclaimed} - ${coins.feesUnclaimed} / 10)`;
const RAIL_WHERE = sql`${coins.venue} = 'curve' and ${coins.costToComplete} > 0 and ${BUDGET} > 0`;
// budget / (1.05 x cost) orders the same as budget / cost; ties by newest launch, then mint.
const RAIL = [
  sql`${BUDGET}::numeric / ${coins.costToComplete} desc`,
  desc(coins.launchedAt),
  asc(coins.mint),
];

/** The Next to bond rail (Phase 3 D-08, D-24): up to 4 curve coins closest to forcing their bond. */
export const nextToBond = (): Promise<CoinRow[]> =>
  kept("next", () => coinRows(db(), RAIL, 4, 0, RAIL_WHERE));

export type Counts = { launched: number; bonded: number; forced: number };

/**
 * The hero's pulse line (D-09, D-24): coins launched, bonded (curve complete or on PumpSwap), and bonded by their
 * own fees (a landed forced bond; a pending one or a fallback pool burn does not count).
 */
export const heroCounts = (): Promise<Counts> =>
  kept("counts", async () => {
    const [r] = await db()
      .select({
        launched: sql<number>`count(*)::int`,
        bonded: sql<number>`(count(*) filter (where ${coins.venue} <> 'curve'))::int`,
        forced: sql<number>`(select count(distinct l.mint) from fee_ledger l
          where l.kind = 'forced_bond' and l.state = 'landed')::int`,
      })
      .from(coins);
    return r;
  });

// The worker's fee window length (D-10), so a countdown closes when the sweep runs. Shortened only for local e2e.
const DAY = 86_400_000;
export const feeWindowMs = (): number => {
  const n = Number(process.env.FEE_WINDOW_MS ?? DAY);
  return Number.isInteger(n) && n >= 60_000 ? n : DAY;
};
