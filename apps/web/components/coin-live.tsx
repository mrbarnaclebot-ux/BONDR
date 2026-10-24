"use client";

// The token page's one live stream (D-18): one useLive per page, shared through context by the venue tag, stats,
// bond panel and trade feed. Trades carry the coin's full CoinLive, so every number follows the last trade.
import type { CoinLive, CoinRow, TradeRow, Venue } from "@bondr/core/api";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Side } from "@/lib/flash";
import { type LiveState, useLive } from "@/lib/use-live";
import { Tag } from "./tag";

export type LiveCoin = CoinLive & Pick<CoinRow, "bondSig" | "bondedAt">;
/** A live trade, or the first page refetched after a resync. */
export type FeedEvent = { trade: TradeRow; side: Side } | { trades: TradeRow[]; more: boolean };
type Ctx = {
  coin: LiveCoin | null;
  /** The last trade's side; `n` changes per trade so a flashing value remounts and replays its animation. */
  flash: { side: Side; n: number } | null;
  state: LiveState;
  subscribe(fn: (e: FeedEvent) => void): () => void;
};

const LiveCtx = createContext<Ctx | null>(null);
export const useCoinLive = () => useContext(LiveCtx);

const stamp = (c: CoinLive) => (c.lastTradeAt ? Date.parse(c.lastTradeAt) : 0);

type Page = { trades: TradeRow[]; more: boolean; coin?: CoinRow | null };

export function CoinLiveProvider(props: { mint: string; initial: LiveCoin | null; children: ReactNode }) {
  const { mint } = props;
  const [coin, setCoin] = useState(props.initial);
  const [flash, setFlash] = useState<Ctx["flash"]>(null);
  const subs = useRef(new Set<(e: FeedEvent) => void>());
  const emit = (e: FeedEvent) => {
    for (const fn of subs.current) fn(e);
  };
  const state = useLive({
    mint,
    onTrade: ({ trade, coin: c }) => {
      const side: Side = trade.side === "buy" ? "buy" : "sell";
      setCoin((p) => ({ bondSig: null, bondedAt: null, ...p, ...c }));
      setFlash((f) => ({ side, n: (f?.n ?? 0) + 1 }));
      emit({ trade, side });
    },
    onBond: ({ venue, bondSig, bondedAt }) => setCoin((p) => p && { ...p, venue, bondSig, bondedAt }),
    onHolders: ({ holders }) => setCoin((p) => p && { ...p, holders }),
    // A real gap (T-03-09-03): one read of the first page and the coin, through the rate-limited route.
    onResync: () =>
      void fetch(`/api/coin/${mint}/trades`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Page>) : Promise.reject(r.status)))
        .then(
          (page) => {
            const row = page.coin; // kept up to 10 s, so a live copy with a newer trade wins
            if (row) setCoin((p) => (p && stamp(p) > stamp(row) ? p : row));
            emit({ trades: page.trades, more: page.more });
          },
          () => {}, // the next trade event carries the numbers again
        ),
  });
  const subscribe = useCallback((fn: (e: FeedEvent) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);
  const value = useMemo(() => ({ coin, flash, state, subscribe }), [coin, flash, state, subscribe]);
  return <LiveCtx.Provider value={value}>{props.children}</LiveCtx.Provider>;
}

/** The meta row venue tag; follows a live bond event inside the provider, else the server's venue. */
export function VenueTag({ venue }: { venue: Venue }) {
  const v = useCoinLive()?.coin?.venue ?? venue;
  if (v === "pool") return <Tag tone="leaf">Bonded, PumpSwap</Tag>;
  return v === "complete" ? <Tag>Curve complete</Tag> : <Tag live>On curve</Tag>;
}
