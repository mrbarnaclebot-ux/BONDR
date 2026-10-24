"use client";

// The token page trade feed (UI-SPEC Trades, D-16, D-18): the 50 newest trades, Load more by keyset back to
// the launch transaction, whose two rows prove the dev's exit. Live trades from CoinLiveProvider are inserted on
// top, batched per animation frame; loaded rows are never removed and overflow-anchor stays at its default, so
// a reader further down is not pushed. No aria-live on the table: a hot coin trades several times a second.
import type { Exit, Net, TradeRow } from "@bondr/core/api";
import { type Dispatch, Fragment, type SetStateAction, useEffect, useState } from "react";
import { flashClass, type Side } from "@/lib/flash";
import { compact, relTime, short, sol, tradeSol } from "@/lib/format";
import { addTrades, type Feed, resyncFeed } from "@/lib/live-list";
import { useCoinLive } from "./coin-live";
import { TxLink } from "./tx-link";
import { Button } from "./ui-button";

type Props = {
  initial: TradeRow[];
  more: boolean;
  mint: string;
  symbol: string;
  net: Net;
  solIn: string;
  exit: Exit;
};

const SIDE = {
  buy: ["Buy", "text-leaf"],
  sell: ["Sell", "text-destructive"],
  burn: ["Burn", "text-muted-foreground"],
} as const;
const TH = "py-2 font-semibold tracking-[0.05em] uppercase";
const TD = "border-t border-line py-2";
const TRADER = "max-md:hidden";

/** `fresh` marks a row that arrived live: it rises with its side's flash once, on mount. */
type Shown = TradeRow & { fresh?: Side };

/** `local` turns on after mount, so the tooltip is the viewer's time zone and locale, not the server's. */
function Row({ t, net, now, local }: { t: Shown; net: Net; now: number; local: boolean }) {
  const [label, tone] = t.launch ? ["Launch", "text-mint"] : SIDE[t.side];
  return (
    <tr className={t.fresh && flashClass(t.fresh, "row")}>
      <td className={`${TD} num`}>
        <time
          dateTime={t.at}
          title={local ? new Date(t.at).toLocaleString() : undefined}
          suppressHydrationWarning
        >
          {relTime(t.at, now)}
        </time>
      </td>
      <td className={`${TD} font-semibold tracking-[0.05em] uppercase ${tone}`}>{label}</td>
      <td className={`${TD} num text-right`}>
        {t.sol === null ? <span className="text-muted-foreground">burned</span> : tradeSol(t.sol)}
      </td>
      <td className={`${TD} num text-right`}>{compact(t.tokenAmount)}</td>
      <td className={`${TD} num pl-4 text-muted-foreground ${TRADER}`}>{short(t.trader)}</td>
      <td className={`${TD} text-right`}>
        <TxLink signature={t.signature} net={net} label={`Transaction ${short(t.signature)}`} />
      </td>
    </tr>
  );
}

type Setter = Dispatch<SetStateAction<Feed<Shown>>>;

/** Appends the next older page; `more` turns false once the launch rows are in. */
function useOlder(mint: string, initial: Feed<Shown>) {
  const [feed, setFeed] = useState(initial);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function load() {
    const last = feed.rows.at(-1);
    if (!last) return;
    setState("loading");
    try {
      const res = await fetch(`/api/coin/${mint}/trades?before=${last.slot}.${last.seq}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { trades: TradeRow[]; more: boolean };
      setFeed((f) => ({ rows: addTrades(f.rows, page.trades), more: page.more }));
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return { ...feed, setFeed, state, load };
}

/** Live trades batched per frame (a burst is one render); a resync merges the refetched first page in order. */
function useLiveRows(setFeed: Setter) {
  const subscribe = useCoinLive()?.subscribe;
  useEffect(() => {
    if (!subscribe) return;
    let pending: Shown[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const add = pending;
      pending = [];
      setFeed((f) => ({ ...f, rows: addTrades(f.rows, add) }));
    };
    const off = subscribe((e) => {
      if ("trades" in e) return setFeed((f) => resyncFeed(f, { rows: e.trades, more: e.more }));
      pending.push({ ...e.trade, fresh: e.side });
      frame ||= requestAnimationFrame(flush);
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [subscribe, setFeed]);
}

/** UI-SPEC Live indicator; the polite span announces a state change once. Empty until the stream first opens. */
function LiveIndicator() {
  const state = useCoinLive()?.state;
  const dot = state === "live" ? "animate-live bg-leaf text-leaf" : "bg-muted-foreground";
  return (
    <span aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {state && (
        <>
          <span aria-hidden="true" className={`size-[7px] rounded-full ${dot}`} />
          {state === "live" ? "Live" : "Reconnecting"}
        </>
      )}
    </span>
  );
}

const HEADS = [
  ["Time", ""],
  ["Side", ""],
  ["SOL", "text-right"],
  [null, "text-right"],
  ["Trader", `pl-4 ${TRADER}`],
  ["Tx", "text-right"],
] as const;

function FeedHead({ symbol }: { symbol: string }) {
  return (
    <thead className="text-left text-muted-foreground">
      <tr>
        {HEADS.map(([name, cls]) => (
          <th key={name ?? "symbol"} scope="col" className={`${TH} ${cls}`}>
            {name ?? symbol}
          </th>
        ))}
      </tr>
    </thead>
  );
}

type TableProps = { rows: Shown[]; symbol: string; net: Net; solIn: string; exit: Exit };

/** Relative times on a 15 s tick; `local` flips on after mount (see Row). */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  const [local, setLocal] = useState(false);
  useEffect(() => {
    setLocal(true);
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return { now, local };
}

function FeedTable({ rows, symbol, net, solIn, exit }: TableProps) {
  const clock = useClock();
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">{`Trades for ${symbol}, newest first`}</caption>
      <FeedHead symbol={symbol} />
      <tbody>
        {rows.map((t, i) => (
          <Fragment key={`${t.signature}:${t.ix}`}>
            {t.launch && !rows[i - 1]?.launch && (
              <tr>
                <td
                  colSpan={6}
                  className="border-t border-dashed border-line-strong py-2 text-muted-foreground"
                >
                  {`Launch transaction: ${sol(solIn)} SOL dev buy, then insta ${exit}.`}
                </td>
              </tr>
            )}
            <Row t={t} net={net} {...clock} />
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

type MoreProps = { shown: boolean; more: boolean; state: "idle" | "loading" | "error"; load(): void };

function LoadMore({ shown, more, state, load }: MoreProps) {
  if (!more)
    return shown ? (
      <p className="mt-4 text-xs text-muted-foreground">That is every trade since launch.</p>
    ) : null;
  return (
    <>
      <Button
        className="mt-4 w-full"
        disabled={state === "loading"}
        aria-busy={state === "loading"}
        onClick={load}
      >
        {state === "loading" ? "Loading…" : "Load 50 older trades"}
      </Button>
      {state === "error" && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Could not load older trades. Try again.
        </p>
      )}
    </>
  );
}

export function TradeFeed({ initial, more: initialMore, mint, ...table }: Props) {
  const { rows, more, setFeed, state, load } = useOlder(mint, { rows: initial, more: initialMore });
  useLiveRows(setFeed);
  return (
    <section
      aria-labelledby="trades-h"
      className="min-w-0 rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-4 shadow-elev-1 md:p-8"
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="trades-h" className="display text-[28px] leading-none">
          Trades
        </h2>
        <LiveIndicator />
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No trades yet. New trades show up here as they land.
        </p>
      ) : (
        <FeedTable rows={rows} {...table} />
      )}
      <LoadMore shown={rows.length > 0} more={more} state={state} load={load} />
    </section>
  );
}
