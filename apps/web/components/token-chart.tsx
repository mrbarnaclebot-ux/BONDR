"use client";

// TOKEN-01 market cap chart (UI-SPEC Market cap chart). lightweight-charts loads by dynamic import inside an
// effect, so it never reaches the server or the first-load bundle. Candles come from the candles route once per
// load or interval switch; after that each live trade updates the last candle or appends one (no polling).
import type { Candle, TradeRow } from "@bondr/core/api";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { type Interval, mcapSol } from "@/lib/format";
import { useCoinLive } from "./coin-live";
import { type ChartApi, liveBar, makeChart, placeBond, showCandles } from "./token-chart-draw";
import { Seg } from "./ui-seg";

const INTERVALS = ["1m", "5m", "1h", "1d"] as const;
const SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86_400 };
const WORDS: Record<Interval, string> = { "1m": "1 minute", "5m": "5 minute", "1h": "1 hour", "1d": "1 day" };

type Loaded = { iv: Interval; candles: Candle[]; bondTime: number | null };
type Ohlc = Pick<Candle, "open" | "high" | "low" | "close">;

/** The interval's candles; `reload` refetches the same interval (a click on it after a failure, or a resync). */
function useCandles(mint: string, iv: Interval, reload: number) {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    setFailed(false);
    fetch(`/api/coin/${mint}/candles?interval=${iv}`, { cache: "no-store", signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Omit<Loaded, "iv">>) : Promise.reject(r.status)))
      .then(
        (d) => setData({ ...d, iv }),
        () => ctl.signal.aborted || setFailed(true),
      );
    return () => ctl.abort();
  }, [mint, iv, reload]);
  return { data, failed };
}

/** Creates the chart once on mount and removes it on unmount. */
function useChart(el: React.RefObject<HTMLDivElement | null>, onHover: (c: Ohlc | null) => void) {
  const [api, setApi] = useState<ChartApi | null>(null);
  const hover = useRef(onHover);
  hover.current = onHover;
  useEffect(() => {
    let gone = false;
    let made: ChartApi | null = null;
    import("lightweight-charts").then((lib) => {
      if (gone || !el.current) return;
      made = makeChart(lib, el.current, (c) => hover.current(c));
      setApi(made);
    });
    return () => {
      gone = true;
      made?.chart.remove();
    };
  }, [el]);
  return api;
}

/** The Bonded marker: the live bond time once a bond event lands, else the candles route's. */
function useBondMarker(api: ChartApi | null, seconds: number | null, fallback: number | null) {
  const bondedAt = useCoinLive()?.coin?.bondedAt;
  const bond = bondedAt ? Math.floor(Date.parse(bondedAt) / 1000) : fallback;
  useEffect(() => {
    if (api && seconds) placeBond(api, seconds, bond);
  }, [api, seconds, bond]);
}

/**
 * Draws the loaded candles and the Bonded marker, then applies live trades: a trade in the current or a newer
 * bucket updates or appends, an older one is dropped (D-16). Trades that land before the chart and its candles
 * are ready wait and replay on the first draw. Returns the last candle.
 * ponytail: a waiting trade the candle read already counted adds its volume to that bar twice; a per-trade
 * watermark from the candles route would make the replay exact.
 */
function useDrawn(api: ChartApi | null, data: Loaded | null, launchMcap: number | null, resync: () => void) {
  const [last, setLast] = useState<Candle | null>(null);
  const lastRef = useRef<Candle | null>(null);
  const early = useRef<TradeRow[]>([]);
  const seconds = data && SECONDS[data.iv];
  useBondMarker(api, seconds, data?.bondTime ?? null);
  const apply = useRef<(t: TradeRow) => void>(() => {});
  apply.current = (t: TradeRow) => {
    const bar = api && seconds ? liveBar(lastRef.current, t, seconds, launchMcap) : null;
    if (!api || !bar) return;
    api.update(bar);
    lastRef.current = bar;
    setLast(bar);
  };
  useEffect(() => {
    if (!api || !data) return;
    lastRef.current = showCandles(api, data.candles, SECONDS[data.iv]);
    setLast(lastRef.current);
    for (const t of early.current.splice(0)) apply.current(t);
  }, [api, data]);
  const subscribe = useCoinLive()?.subscribe;
  const onResync = useRef(resync);
  onResync.current = resync;
  const ready = !!api && !!seconds;
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((e) => {
      if ("trades" in e) return onResync.current(); // a resync: the last candle refetches once
      if (ready) apply.current(e.trade);
      else early.current.push(e.trade);
    });
  }, [subscribe, ready]);
  return last;
}

type FrameProps = {
  el: React.RefObject<HTMLDivElement | null>;
  label: string;
  busy: boolean;
  data: Loaded | null;
  last: Candle | null;
  failed: boolean;
};

/** The canvas host, its text summary for screen readers and the state note. */
function ChartFrame({ el, label, busy, data, last, failed }: FrameProps) {
  return (
    <div className="relative h-[280px] md:h-[380px]">
      <div
        ref={el}
        className={cn(
          "absolute inset-0 touch-pan-y",
          busy && data && "opacity-50",
          data && !last && "invisible",
        )}
      />
      {/* The text summary sits over the canvas instead of around it, so the library's DOM stays outside the
        img role (axe nested-interactive if it ever renders a link). */}
      <div role="img" aria-label={label} aria-busy={busy} className="pointer-events-none absolute inset-0" />
      <ChartNote failed={failed} loading={!data} empty={!!data && !last} />
    </div>
  );
}

export function McapChart(props: {
  mint: string;
  symbol: string;
  initial: Interval;
  launchMcap: number | null;
}) {
  const [iv, setIv] = useState<Interval>(props.initial);
  const [reload, setReload] = useState(0);
  const [hover, setHover] = useState<Ohlc | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const api = useChart(el, setHover);
  const { data, failed } = useCandles(props.mint, iv, reload);
  const last = useDrawn(api, data, props.launchMcap, () => setReload((n) => n + 1));
  const busy = !failed && data?.iv !== iv;
  const shown = hover ?? last;
  const label = `${props.symbol} market cap in SOL, ${WORDS[iv]} candles. ${last ? `Last ${mcapSol(last.close)} SOL.` : "No candles yet."}`;
  const pick = (v: Interval) => (v === iv ? setReload((n) => n + 1) : setIv(v));
  return (
    <section
      aria-labelledby="chart-h"
      className="rounded-lg border border-line bg-[radial-gradient(60%_80%_at_100%_0%,color-mix(in_oklch,var(--leaf)_9%,transparent),transparent),linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-2 shadow-elev-2 md:p-4"
    >
      <h2 id="chart-h" className="sr-only">
        Market cap chart
      </h2>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Seg label="Candle interval" options={INTERVALS} value={iv} onChange={pick} />
        {shown && <Readout c={shown} />}
      </div>
      <ChartFrame el={el} label={label} busy={busy} data={data} last={last} failed={failed} />
    </section>
  );
}

const OHLC = [
  ["O", "open"],
  ["H", "high"],
  ["L", "low"],
  ["C", "close"],
] as const;

/** "O {o} H {h} L {l} C {c} SOL mcap" for the hovered candle, else the last. */
const Readout = ({ c }: { c: Ohlc }) => (
  <p className="text-xs text-muted-foreground">
    {OHLC.map(([k, f]) => (
      <span key={k}>
        {k} <span className="num text-foreground">{mcapSol(c[f])}</span>{" "}
      </span>
    ))}
    SOL mcap
  </p>
);

function ChartNote({ failed, loading, empty }: { failed: boolean; loading: boolean; empty: boolean }) {
  const note = failed
    ? "Could not load the chart. Pick an interval to try again."
    : loading
      ? "Loading chart…"
      : empty
        ? "The chart starts at the launch price once BONDR has read the launch transaction, usually within a few seconds."
        : null;
  if (!note) return null;
  return (
    <p
      role={failed ? "alert" : undefined}
      className="absolute inset-0 flex items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground"
    >
      {failed && <CircleAlert aria-hidden className="size-4 flex-none text-destructive" />}
      {note}
    </p>
  );
}
