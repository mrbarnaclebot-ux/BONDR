// The lightweight-charts side of the market cap chart: options from the UI-SPEC table, series, data and the
// live bar. Only types are imported here; the library itself arrives through token-chart.tsx's dynamic import.
import type { Candle, TradeRow } from "@bondr/core/api";
import type {
  ChartOptions,
  DeepPartial,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { mcapSol } from "../lib/format"; // relative, so Vitest loads it without the @ alias

type Lib = typeof import("lightweight-charts");
type Ohlc = Pick<Candle, "open" | "high" | "low" | "close">;
type Colors = Record<
  "text" | "line" | "strong" | "surface3" | "leaf" | "down" | "mint" | "upVol" | "downVol",
  string
>;

export type ChartApi = {
  lib: Lib;
  chart: IChartApi;
  colors: Colors;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time> | null;
  update(bar: Candle): void;
};

/**
 * A CSS color token as rgba. The tokens are oklch color-mix values, which the library's own parser rejects, so a
 * 1px canvas does the conversion.
 */
function rgba(token: string, alpha = 1): string {
  const probe = document.createElement("i");
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return css;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${((a / 255) * alpha).toFixed(3)})`;
}

const colors = (): Colors => ({
  text: rgba("--muted-foreground"),
  line: rgba("--line"),
  strong: rgba("--line-strong"),
  surface3: rgba("--surface-3"),
  leaf: rgba("--leaf"),
  down: rgba("--destructive"),
  mint: rgba("--mint"),
  upVol: rgba("--leaf", 0.28),
  downVol: rgba("--destructive", 0.28),
});

// Year, month, day of month, time, time with seconds (TickMarkType order), in the viewer's local time.
const TICKS: Intl.DateTimeFormatOptions[] = [
  { year: "numeric" },
  { month: "short" },
  { day: "numeric", month: "short" },
  { hour: "2-digit", minute: "2-digit" },
  { hour: "2-digit", minute: "2-digit", second: "2-digit" },
];
const local = (t: Time, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, o).format(new Date((t as number) * 1000));

/** The UI-SPEC lightweight-charts options table. Pure, given the resolved colors and font. */
export function chartOptions(c: Colors, font: string, lib: Lib): DeepPartial<ChartOptions> {
  const cross = { color: c.strong, labelBackgroundColor: c.surface3 };
  return {
    autoSize: true,
    layout: {
      background: { type: lib.ColorType.Solid, color: "transparent" },
      textColor: c.text,
      fontFamily: font,
      fontSize: 12,
      attributionLogo: false, // the footer's "Charts by TradingView" link meets the license link requirement
    },
    grid: { vertLines: { visible: false }, horzLines: { color: c.line, style: lib.LineStyle.Dashed } },
    crosshair: { vertLine: cross, horzLine: cross },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.2 } },
    timeScale: {
      borderVisible: false,
      secondsVisible: false,
      rightOffset: 4,
      tickMarkFormatter: (t: Time, type: number) => local(t, TICKS[type] ?? TICKS[3]),
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    localization: { timeFormatter: (t: Time) => local(t, { dateStyle: "medium", timeStyle: "short" }) },
  };
}

/** The chart, its two series and the hover readout feed. */
export function makeChart(lib: Lib, el: HTMLElement, onHover: (c: Ohlc | null) => void): ChartApi {
  const c = colors();
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-martian").trim();
  const chart = lib.createChart(el, chartOptions(c, font, lib));
  const candles = chart.addSeries(lib.CandlestickSeries, {
    upColor: c.leaf,
    borderUpColor: c.leaf,
    wickUpColor: c.leaf,
    downColor: c.down,
    borderDownColor: c.down,
    wickDownColor: c.down,
    priceLineColor: c.mint,
    priceLineStyle: lib.LineStyle.Dotted,
    priceFormat: { type: "custom", formatter: mcapSol, minMove: 0.01 },
  });
  const volume = chart.addSeries(lib.HistogramSeries, {
    priceScaleId: "",
    priceFormat: { type: "volume" },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  chart.subscribeCrosshairMove((p) => onHover((p.seriesData.get(candles) as Ohlc | undefined) ?? null));
  const api: ChartApi = { lib, chart, colors: c, candles, volume, markers: null, update: () => {} };
  api.update = (bar) => {
    candles.update({ ...bar, time: bar.time as UTCTimestamp });
    volume.update(volumeBar(c, bar));
  };
  return api;
}

const volumeBar = (c: Colors, bar: Candle) => ({
  time: bar.time as UTCTimestamp,
  value: bar.volume,
  color: bar.close >= bar.open ? c.upVol : c.downVol,
});

/** Replaces the data for an interval; returns the last candle. */
export function showCandles(api: ChartApi, rows: Candle[], seconds: number): Candle | null {
  api.candles.setData(rows.map((r) => ({ ...r, time: r.time as UTCTimestamp })));
  api.volume.setData(rows.map((r) => volumeBar(api.colors, r)));
  const scale = api.chart.timeScale();
  scale.applyOptions({ timeVisible: seconds < 86_400 });
  if (rows.length > 120) scale.setVisibleLogicalRange({ from: rows.length - 120, to: rows.length + 4 });
  else scale.fitContent();
  return rows.at(-1) ?? null;
}

/** The "Bonded" marker on the bond candle, or none on the curve. */
export function placeBond(api: ChartApi, seconds: number, bond: number | null): void {
  api.markers?.detach();
  const time = (Math.floor((bond ?? 0) / seconds) * seconds) as UTCTimestamp;
  const marker = {
    time,
    position: "aboveBar",
    shape: "arrowDown",
    color: api.colors.mint,
    text: "Bonded",
  } as const;
  api.markers = bond === null ? null : api.lib.createSeriesMarkers(api.candles, [marker]);
}

/**
 * A live trade as the new last candle: the same bucket widens it, a newer bucket opens at the last close (D-16).
 * Null for a burn, an unpriced trade or a bucket older than the last candle.
 */
export function liveBar(
  last: Candle | null,
  t: TradeRow,
  seconds: number,
  launch: number | null,
): Candle | null {
  if (t.side === "burn" || t.mcapSol === null) return null;
  const time = Math.floor(Date.parse(t.at) / 1000 / seconds) * seconds;
  const sol = Number(t.sol ?? 0) / 1e9;
  const m = t.mcapSol;
  if (last && time < last.time) return null;
  if (last && time === last.time)
    return {
      ...last,
      high: Math.max(last.high, m),
      low: Math.min(last.low, m),
      close: m,
      volume: last.volume + sol,
    };
  const open = last?.close ?? launch ?? m;
  return { time, open, high: Math.max(open, m), low: Math.min(open, m), close: m, volume: sol };
}
