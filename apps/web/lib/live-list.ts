// The live lists' rules (home lists D-12 to D-14, the trade feed D-18), pure so they are tested without a
// browser. The 60 s tick, the pointer and focus hold and the stream itself live in components/home-live.tsx.
import type { CoinLive, CoinRow, TradeRow, Venue } from "@bondr/core/api";

export type Sort = "top" | "latest" | "oldest";
export type TrendMode = "1h" | "24h" | "latest";

const HOUR = 3_600_000;

/** Replaces one coin by mint; the same array when the coin is not listed, so React skips the render. */
function patch(list: CoinRow[], mint: string, fn: (c: CoinRow) => CoinRow): CoinRow[] {
  const i = list.findIndex((c) => c.mint === mint);
  return i < 0 ? list : list.with(i, fn(list[i]));
}

/** A trade carries the coin's full live numbers; the position waits for the next re-rank (D-12). */
export const applyTrade = (list: CoinRow[], { coin }: { coin: CoinLive }): CoinRow[] =>
  patch(list, coin.mint, (c) => ({ ...c, ...coin }));

type Bond = { mint: string; venue: Venue; bondSig?: string | null; bondedAt?: string | null };
export const applyBond = (list: CoinRow[], { mint, venue, bondSig, bondedAt }: Bond): CoinRow[] =>
  patch(list, mint, (c) => ({
    ...c,
    venue,
    progress: 1,
    bondSig: bondSig ?? c.bondSig,
    bondedAt: bondedAt ?? c.bondedAt,
  }));

/** D-14: a new launch goes to the front of Latest with no search; Top and Oldest get it on reload or resync. */
export function insertLaunch(list: CoinRow[], c: CoinRow, view: { sort: Sort; q: string }): CoinRow[] {
  if (view.sort !== "latest" || view.q || list.some((x) => x.mint === c.mint)) return list;
  return [c, ...list];
}

/** RESEARCH Pattern 7: no trade for an hour (a day) means no 1h (24h) volume, with no database read. */
export const decay = (list: CoinRow[], now: number): CoinRow[] =>
  list.map((c) => {
    const quiet = now - (c.lastTradeAt ? Date.parse(c.lastTradeAt) : 0);
    const vol1h = quiet > HOUR ? 0 : c.vol1h;
    const vol24h = quiet > 24 * HOUR ? 0 : c.vol24h;
    return vol1h === c.vol1h && vol24h === c.vol24h ? c : { ...c, vol1h, vol24h };
  });

type Cmp = (a: CoinRow, b: CoinRow) => number;
const byMint: Cmp = (a, b) => (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0);
const older: Cmp = (a, b) => Date.parse(a.launchedAt) - Date.parse(b.launchedAt);
const newer: Cmp = (a, b) => older(b, a) || byMint(a, b);

// The server's orders (lib/coins.ts), so a re-rank matches what a reload would show.
const ORDER: Record<Sort | "trending", Cmp> = {
  top: (a, b) => b.mcapSol - a.mcapSol || newer(a, b),
  latest: newer,
  oldest: (a, b) => older(a, b) || byMint(a, b),
  trending: (a, b) => b.vol1h - a.vol1h || b.vol24h - a.vol24h || newer(a, b),
};

export const rerank = (list: CoinRow[], order: Sort | "trending"): CoinRow[] => list.toSorted(ORDER[order]);

/** D-13 over the whole list: any 1h volume, else any 24h volume, else the latest launches. */
export const trendingMode = (list: CoinRow[]): TrendMode =>
  list.some((c) => c.vol1h > 0) ? "1h" : list.some((c) => c.vol24h > 0) ? "24h" : "latest";

/** Both lists' coins once each, the first list's copy winning. */
export function union(a: CoinRow[], b: CoinRow[]): CoinRow[] {
  const seen = new Set(a.map((c) => c.mint));
  return [...a, ...b.filter((c) => !seen.has(c.mint))];
}

const stamp = (c: CoinRow) => (c.lastTradeAt ? Date.parse(c.lastTradeAt) : 0);

/** A server list (kept up to 10 s) over what the stream already showed: a local copy with a newer trade wins. */
export function fresher(got: CoinRow[], local: CoinRow[]): CoinRow[] {
  const mine = new Map(local.map((c) => [c.mint, c]));
  return got.map((c) => {
    const l = mine.get(c.mint);
    return l && stamp(l) > stamp(c) ? l : c;
  });
}

/** `fresher`, and in Latest with no search, local launches newer than the page's newest stay in front (D-14). */
export function mergePage(got: CoinRow[], local: CoinRow[], view: { sort: Sort; q: string }): CoinRow[] {
  const coins = fresher(got, local);
  if (view.sort !== "latest" || view.q) return coins;
  const newest = got[0] ? Date.parse(got[0].launchedAt) : 0;
  return union(
    rerank(
      local.filter((c) => Date.parse(c.launchedAt) > newest),
      "latest",
    ),
    coins,
  );
}

type Trade = Pick<TradeRow, "signature" | "ix" | "slot" | "seq"> & { fresh?: unknown };
export type Feed<T extends Trade> = { rows: T[]; more: boolean };

const tradeKey = (t: Trade) => `${t.signature}:${t.ix}`;
const desc = (a: string, b: string) => (BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0);
const newestFirst = (a: Trade, b: Trade) => desc(a.slot, b.slot) || desc(a.seq, b.seq);

/** Adds the unseen trades in chain order, newest first; the same array when none is new. */
export function addTrades<T extends Trade>(rows: T[], add: T[]): T[] {
  const seen = new Set(rows.map(tradeKey));
  const unseen = add.filter((t) => {
    const k = tradeKey(t);
    return !seen.has(k) && !!seen.add(k);
  });
  return unseen.length ? [...rows, ...unseen].toSorted(newestFirst) : rows;
}

/**
 * A resync's refetched first page (kept up to 10 s, so live rows may be newer). With older trades beyond it and
 * no server-loaded row (not `fresh`) inside it, a hole may sit below it: the page replaces the rows older than
 * its newest, live rows newer than its oldest stay, and Load more fills down from it. Otherwise it merges.
 */
export function resyncFeed<T extends Trade>(feed: Feed<T>, page: Feed<T>): Feed<T> {
  const keys = new Set(page.rows.map(tradeKey));
  const joined = feed.rows.some((r) => !r.fresh && keys.has(tradeKey(r)));
  const oldest = page.rows.at(-1);
  if (joined || !page.more || !oldest) return { ...feed, rows: addTrades(feed.rows, page.rows) };
  const live = feed.rows.filter((r) => r.fresh && newestFirst(r, oldest) < 0);
  return { rows: addTrades(page.rows, live), more: true };
}

type Entry = { id: string; landedAt: string };
const newestEntry = (a: Entry, b: Entry) =>
  Date.parse(b.landedAt) - Date.parse(a.landedAt) || desc(a.id, b.id);

/** Fee ledger rows merged by id in the server's order (landed time, then id, newest first); same array if none is new. */
export function addLedger<T extends Entry>(rows: T[], add: T[]): T[] {
  const seen = new Set(rows.map((r) => r.id));
  const unseen = add.filter((r) => !seen.has(r.id) && !!seen.add(r.id));
  return unseen.length ? [...unseen, ...rows].toSorted(newestEntry) : rows;
}
