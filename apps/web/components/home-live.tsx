"use client";

// The home page's one live stream (D-12 to D-15): one useLive shared through context by the hero counts,
// Trending and All coins. A trade updates every card of its coin at once; positions move only on the 60 s tick,
// which waits while the pointer is over, or focus is inside, a region spreading `hold`. The tick never reads;
// the only fetch is the resync catch-up (T-03-13-02).
import type { CoinRow } from "@bondr/core/api";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Side } from "@/lib/flash";
import {
  applyBond,
  applyTrade,
  decay,
  fresher,
  insertLaunch,
  mergePage,
  rerank,
  type Sort,
  type TrendMode,
  trendingMode,
  union,
} from "@/lib/live-list";
import { useLive } from "@/lib/use-live";

export type CoinPage = { coins: CoinRow[]; more: boolean };
export type Trend = { mode: TrendMode; coins: CoinRow[] };
type Counts = { launched: number; bonded: number };
type Setter<T> = Dispatch<SetStateAction<T>>;
type State<T> = [T, Setter<T>];

type Ctx = {
  list: State<CoinPage | null>;
  sort: State<Sort>;
  q: State<string>;
  trend: Trend | null;
  counts: Counts | null;
  /** The last trade side per mint; `n` changes per trade so a flashing value remounts and replays. */
  flash: Record<string, { side: Side; n: number }>;
  /** Launches that just slid into Latest, glowing for 3.6 s (UI-SPEC Motion). */
  fresh: ReadonlySet<string>;
  /** Spread on the grid and the scroller: hovering or focusing them holds the re-rank (D-12). */
  hold: { "data-hold": ""; onPointerLeave(): void; onBlur(): void };
};

const LiveCtx = createContext<Ctx | null>(null);
/** Null outside the home page, so a CoinCard elsewhere simply does not flash. */
export const useHomeLive = () => useContext(LiveCtx);
export function useHome(): Ctx {
  const c = useContext(LiveCtx);
  if (!c) throw new Error("useHome outside HomeLiveProvider");
  return c;
}

const HELD = "[data-hold]:hover, [data-hold]:focus-within";
const TOP = 10;

type Props = { list: CoinPage | null; sort: Sort; q: string; trend: Trend | null; counts: Counts | null };
/** The provider's state as of the last render, read when an event or a fetch lands instead of captured. */
type View = { sort: Sort; q: string; list: CoinPage | null; trend: Trend | null };

/** An updater applying `fn` to a list; an unchanged array keeps the old state, so nothing re-renders. */
const keep =
  (fn: (l: CoinRow[]) => CoinRow[]) =>
  <T extends { coins: CoinRow[] }>(s: T | null): T | null => {
    const coins = s && fn(s.coins);
    return s && coins !== s.coins ? { ...s, coins } : s;
  };

/**
 * The one 60 s tick (D-12): decay, re-sort both lists and refresh ages, unless a `hold` region is hovered or
 * holds focus; then it runs when the pointer or focus leaves. Trending is re-picked from every coin on the page,
 * so a grid coin that starts trading can enter it and the mode and caption follow (D-13). No reads here.
 */
function useReRank(now: RefObject<View>, setList: Setter<CoinPage | null>, setTrend: Setter<Trend | null>) {
  const due = useRef(false);
  const release = useCallback(() => {
    if (!due.current || document.querySelector(HELD)) return;
    due.current = false;
    const at = Date.now();
    const { sort, list } = now.current;
    setList((l) => l && { ...l, coins: rerank(decay(l.coins, at), sort) });
    setTrend((t) => {
      const coins = rerank(decay(union(t?.coins ?? [], list?.coins ?? []), at), "trending").slice(0, TOP);
      return { mode: trendingMode(coins), coins };
    });
  }, [now, setList, setTrend]);
  useEffect(() => {
    const id = setInterval(() => {
      due.current = true;
      release();
    }, 60_000);
    return () => clearInterval(id);
  }, [release]);
  // After the event, so :hover and :focus-within already describe where the pointer and focus went.
  const later = useCallback(() => void setTimeout(release), [release]);
  return { "data-hold": "", onPointerLeave: later, onBlur: later } as const;
}

/** Mints that just slid into Latest, each kept 3.6 s (the rise, the 3 s glow and its fade). */
function useFresh() {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const glow = useCallback((mint: string) => {
    setFresh((s) => new Set(s).add(mint));
    setTimeout(() => setFresh((s) => new Set([...s].filter((m) => m !== mint))), 3600);
  }, []);
  return [fresh, glow] as const;
}

/** A real gap (resync): one read of page 0, Trending and the hero counts through the 10 s kept coins route. */
async function catchUp(sort: Sort, q: string) {
  const p = new URLSearchParams({ sort, page: "0", q, trending: "1" });
  const res = await fetch(`/api/coins?${p}`, { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json()) as CoinPage & { trending: Trend; counts: Counts }) : null;
}

type Sets = {
  setList: Setter<CoinPage | null>;
  setTrend: Setter<Trend | null>;
  setCounts: Setter<Counts | null>;
  setFlash: Setter<Ctx["flash"]>;
  glow(mint: string): void;
};

const listed = (mint: string, p: { coins: CoinRow[] } | null) => !!p?.coins.some((c) => c.mint === mint);
// Counts only grow; the kept server count may lag a live launch by 10 s, a live count may have missed a gap.
const most = (c: Counts | null, s: Counts): Counts =>
  c ? { launched: Math.max(c.launched, s.launched), bonded: Math.max(c.bonded, s.bonded) } : s;

/** A resync's catch-up, dropped when the sort or search changed while it was in flight. */
function resync(view: RefObject<View>, s: Sets) {
  const at = view.current;
  void catchUp(at.sort, at.q).then((got) => {
    const now = view.current;
    if (!got || now.sort !== at.sort || now.q !== at.q) return;
    // Page 0 merges over its coins and later pages stay below; a failed read waits for the next events.
    s.setList((l) => ({
      coins: union(mergePage(got.coins, l?.coins ?? [], at), l?.coins ?? []),
      more: got.more || !!l?.more,
    }));
    s.setTrend((t) => ({
      ...got.trending,
      coins: fresher(got.trending.coins, [...(t?.coins ?? []), ...(now.list?.coins ?? [])]),
    }));
    s.setCounts((c) => most(c, got.counts));
  });
}

function useHomeStream(view: RefObject<View>, s: Sets) {
  const both = (fn: (l: CoinRow[]) => CoinRow[]) => {
    s.setList(keep(fn));
    s.setTrend(keep(fn));
  };
  useLive({
    onTrade: (d) => {
      both((l) => applyTrade(l, d));
      const { mint } = d.coin;
      if (!listed(mint, view.current.list) && !listed(mint, view.current.trend)) return;
      const side: Side = d.trade.side === "buy" ? "buy" : "sell";
      s.setFlash((f) => ({ ...f, [mint]: { side, n: (f[mint]?.n ?? 0) + 1 } }));
    },
    onBond: (d) => {
      both((l) => applyBond(l, d));
      if (d.venue === "complete") s.setCounts((c) => c && { ...c, bonded: c.bonded + 1 });
    },
    onLaunch: (c) => {
      const at = view.current;
      s.setCounts((n) => n && { ...n, launched: n.launched + 1 });
      s.setList(keep((l) => insertLaunch(l, c, at)));
      if (at.sort === "latest" && !at.q) s.glow(c.mint);
    },
    onResync: () => resync(view, s),
  });
}

export function HomeLiveProvider({ children, ...init }: Props & { children: ReactNode }) {
  const list = useState(init.list);
  const sort = useState(init.sort);
  const q = useState(init.q);
  const [trend, setTrend] = useState(init.trend);
  const [counts, setCounts] = useState(init.counts);
  const [flash, setFlash] = useState<Ctx["flash"]>({});
  const [fresh, glow] = useFresh();
  const view = useRef<View>({ sort: sort[0], q: q[0], list: list[0], trend });
  useEffect(() => {
    view.current = { sort: sort[0], q: q[0], list: list[0], trend };
  });
  const hold = useReRank(view, list[1], setTrend);
  useHomeStream(view, { setList: list[1], setTrend, setCounts, setFlash, glow });
  const value = { list, sort, q, trend, counts, flash, fresh, hold };
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}
