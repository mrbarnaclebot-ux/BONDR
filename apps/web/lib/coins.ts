// The token page's coin row and the home lists; the row query lives in core so the worker publishes the same
// numbers live.
import "server-only";
import type { CoinRow } from "@bondr/core/api";
import { coinRow, coinRows } from "@bondr/core/coin-row";
import { asc, desc, sql } from "drizzle-orm";
import { coins, db } from "./db";

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

/**
 * One page of BONDR coins (only coins rows, so only launches through BONDR) with the windowed columns.
 * ponytail: offset pages capped at 100; switch to keyset when lists pass 5,000 coins.
 */
export const listCoins = ({ sort, page }: { sort: Sort; page: number }): Promise<CoinPage> =>
  kept(`${sort}:${page}`, async () => {
    const rows = await coinRows(db(), ORDER[sort], LIST_PAGE + 1, page * LIST_PAGE);
    return { coins: rows.slice(0, LIST_PAGE), more: rows.length > LIST_PAGE };
  });

/** The hero's pulse line (D-09): coins launched and bonded (curve complete or on PumpSwap). */
export const heroCounts = (): Promise<{ launched: number; bonded: number }> =>
  kept("counts", async () => {
    const [r] = await db()
      .select({
        launched: sql<number>`count(*)::int`,
        bonded: sql<number>`(count(*) filter (where ${coins.venue} <> 'curve'))::int`,
      })
      .from(coins);
    return r;
  });
