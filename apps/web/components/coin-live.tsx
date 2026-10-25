"use client";

// The token page's one live stream (D-18): one useLive per page, shared through context by the venue tag, stats,
// bond panel and trade feed. Trades carry the coin's full CoinLive, so every number follows the last trade.
import type { CoinLive, CoinRow, LedgerRow, TradeRow, Venue } from "@bondr/core/api";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Side } from "@/lib/flash";
import { type LiveState, useLive } from "@/lib/use-live";
import { Tag } from "./tag";

export type LiveCoin = CoinLive & Pick<CoinRow, "bondSig" | "bondedAt">;
/** A live trade, or the first page refetched after a resync. */
export type FeedEvent = { trade: TradeRow; side: Side } | { trades: TradeRow[]; more: boolean };
/** Landed fee rows from one `fee` event, or a resync after which the ledger refetches its first page. */
export type FeeEvent = { rows: LedgerRow[] } | { resync: true };
type Ctx = {
  coin: LiveCoin | null;
  /** The last trade's side; `n` changes per trade so a flashing value remounts and replays its animation. */
  flash: { side: Side; n: number } | null;
  state: LiveState;
  subscribe(fn: (e: FeedEvent) => void): () => void;
  subscribeFees(fn: (e: FeeEvent) => void): () => void;
};

const LiveCtx = createContext<Ctx | null>(null);
export const useCoinLive = () => useContext(LiveCtx);

const stamp = (c: CoinLive) => (c.lastTradeAt ? Date.parse(c.lastTradeAt) : 0);

type Page = { trades: TradeRow[]; more: boolean; coin?: CoinRow | null };

/** A subscriber set: the trade feed and the fee ledger each take their events from the one stream. */
function useSubs<E>() {
  const subs = useRef(new Set<(e: E) => void>());
  const emit = useCallback((e: E) => {
    for (const fn of subs.current) fn(e);
  }, []);
  const subscribe = useCallback((fn: (e: E) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);
  return { emit, subscribe };
}

export function CoinLiveProvider(props: {
  mint: string;
  initial: LiveCoin | null;
  last: string | null;
  children: ReactNode;
}) {
  const { mint } = props;
  const [coin, setCoin] = useState(props.initial);
  const [flash, setFlash] = useState<Ctx["flash"]>(null);
  const { emit, subscribe } = useSubs<FeedEvent>();
  const fees = useSubs<FeeEvent>();
  const state = useLive({
    mint,
    last: props.last,
    onTrade: ({ trade, coin: c }) => {
      const side: Side = trade.side === "buy" ? "buy" : "sell";
      setCoin((p) => ({ bondSig: null, bondedAt: null, ...p, ...c }));
      setFlash((f) => ({ side, n: (f?.n ?? 0) + 1 }));
      emit({ trade, side });
    },
    onBond: ({ venue, bondSig, bondedAt }) => setCoin((p) => p && { ...p, venue, bondSig, bondedAt }),
    onHolders: ({ holders }) => setCoin((p) => p && { ...p, holders }),
    // D-22: the landed rows go to the ledger and the coin's fee fields to the panel, totals and stats. Only the
    // fee fields: the snapshot can predate a trade or bond already applied.
    onFee: ({ mint: m, rows, coin: c }) => {
      if (m !== mint) return;
      const f = c?.fees;
      if (f) setCoin((p) => p && { ...p, fees: f });
      if (rows.length) fees.emit({ rows });
    },
    // A real gap (T-03-09-03): one read of the first page and the coin, through the rate-limited route; the
    // ledger refetches its own first page.
    onResync: () => {
      fees.emit({ resync: true });
      void fetch(`/api/coin/${mint}/trades`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Page>) : Promise.reject(r.status)))
        .then(
          (page) => {
            const row = page.coin; // kept up to 10 s, so a live copy with a newer trade wins
            if (row) setCoin((p) => (p && stamp(p) > stamp(row) ? p : row));
            emit({ trades: page.trades, more: page.more });
          },
          () => {}, // the next trade event carries the numbers again
        );
    },
  });
  const subscribeFees = fees.subscribe;
  const value = useMemo(
    () => ({ coin, flash, state, subscribe, subscribeFees }),
    [coin, flash, state, subscribe, subscribeFees],
  );
  return <LiveCtx.Provider value={value}>{props.children}</LiveCtx.Provider>;
}

/** The meta row venue tag; follows a live bond event inside the provider, else the server's venue. */
export function VenueTag({ venue }: { venue: Venue }) {
  const v = useCoinLive()?.coin?.venue ?? venue;
  if (v === "pool") return <Tag tone="leaf">Bonded, PumpSwap</Tag>;
  return v === "complete" ? <Tag>Curve complete</Tag> : <Tag live>On curve</Tag>;
}
