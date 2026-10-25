// Display helpers for live values (UI-SPEC Live values). Pure, so the unit test can load them.
import type { Net, TradeSide } from "@bondr/core/api";

/**
 * Lamports as SOL with at most `decimals` places, trailing zeros trimmed. `up` rounds up, for costs the dev
 * pays: an estimate that reads 0 SOL would hide a real fee.
 */
export function sol(lamports: bigint | string, decimals = 9, up = false): string {
  const unit = 10n ** BigInt(9 - decimals);
  const n = BigInt(lamports);
  const scaled = up ? (n + unit - 1n) / unit : (n + unit / 2n) / unit;
  const base = 10n ** BigInt(decimals);
  const frac = (scaled % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${scaled / base}.${frac}` : `${scaled / base}`;
}

/** Basis points as a percent: the receipt keeps two decimals ("1.50%"), prose trims them ("1.5%"). */
export function pct(bps: number, prose = false): string {
  const s = (bps / 100).toFixed(2);
  return `${prose ? String(Number(s)) : s}%`;
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Token base units (6 decimals, pump) as "12.4M". */
export const compact = (base: bigint | string): string => COMPACT.format(Number(BigInt(base)) / 1e6);

/** 4 characters, ellipsis, 4 characters (UI-SPEC {mintShort}, {sigShort}, {walletShort}). */
export const short = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Solscan link; devnet appends the cluster param. */
export const explorer = (kind: "tx" | "account" | "token", value: string, net: Net): string =>
  `https://solscan.io/${kind}/${value}${net === "devnet" ? "?cluster=devnet" : ""}`;

/** Time since `iso` as "3d 7h", "5h 12m" or "4m" (the token page meta row). */
export function age(iso: string, now = Date.now()): string {
  const m = Math.max(1, Math.floor((now - Date.parse(iso)) / 60_000));
  const [d, h] = [Math.floor(m / 1440), Math.floor((m % 1440) / 60)];
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

const fixed = (n: number, d: number) =>
  n.toLocaleString("en", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Market cap, volume or bond SOL: "18,400", "140.7", "61.40", "0.842" (UI-SPEC Number formats). */
export const mcapSol = (n: number): string => fixed(n, n >= 1000 ? 0 : n >= 100 ? 1 : n >= 1 ? 2 : 3);

/** A fee row's lamports: "0", "<0.001", else the mcapSol places with trailing zeros trimmed ("0.42", "140.7"). */
export function feeSol(lamports: string): string {
  const n = BigInt(lamports);
  if (n === 0n) return "0";
  if (n < 1_000_000n) return "<0.001";
  const s = mcapSol(Number(n) / 1e9);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** "2026-10-18 21:14", the UTC date and minute. */
export const utcStamp = (iso: string): string => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

/** Trade lamports as SOL with 3 decimals, "<0.001" below that. */
export const tradeSol = (lamports: string): string =>
  BigInt(lamports) < 1_000_000n ? "<0.001" : (Number(lamports) / 1e9).toFixed(3);

/** A fraction as a signed percent, "+18.2%", "−2.2%" (U+2212 minus), "0.0%". */
export function signedPct(f: number): string {
  const s = (Math.abs(f) * 100).toFixed(1);
  if (s === "0.0") return "0.0%";
  return `${f > 0 ? "+" : "−"}${s}%`;
}

/** Curve filled, floored to 1 decimal so it never reads full early; "100%" once complete. */
export const curvePct = (f: number): string =>
  f >= 1 ? "100%" : `${(Math.floor(Math.max(0, f) * 1000 + 1e-9) / 10).toFixed(1)}%`;

/** Feed time: "now" under 5 s, then "12s", "4m", "3h", "2d". */
export function relTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`;
}

/** Integer with a thousands separator: "2,940,180". */
export const thousands = (n: number | bigint): string => fixed(Number(n), 0);

/** 6-decimal base units (BONDR, a coin) as whole tokens, floored: "2,940,180". */
export const whole = (base: string): string => thousands(BigInt(base) / 1_000_000n);

export type Interval = "1m" | "5m" | "1h" | "1d";

/** The chart's default candle (D-17), from coin age at page load: 1m under 6 hours, 5m under 3 days, else 1h. */
export function chartInterval(launchedAt: string, now = Date.now()): Interval {
  const hours = (now - Date.parse(launchedAt)) / 3_600_000;
  return hours < 6 ? "1m" : hours < 72 ? "5m" : "1h";
}

/** A quote's price impact fraction as "1.23%", "<0.01%" below that. */
export const impactPct = (f: number): string => (f < 0.0001 ? "<0.01%" : `${(f * 100).toFixed(2)}%`);

/** D-13: 5% up to 15% warns, over 15% is an error; under 5% has no band. */
export const impactBand = (f: number): "warn" | "error" | null =>
  f > 0.15 ? "error" : f >= 0.05 ? "warn" : null;

/** A quote amount: a buy receives the coin (integer, thousands), a sell receives SOL (4 decimals). */
export const outText = (side: TradeSide, base: string, symbol: string): string =>
  side === "buy" ? `${thousands(BigInt(base) / 1_000_000n)} ${symbol}` : `${sol(base, 4)} SOL`;

/** Budget over cost in tenths of a percent, floored from base units; null when the cost is unknown or 0. */
export function ratio1000(budget: string, cost: string | null): number | null {
  if (cost === null || BigInt(cost) <= 0n) return null;
  return Number((BigInt(budget) * 1000n) / BigInt(cost));
}

/** "104.9%", floored so the ratio never reads the 105% trigger early; "–" when the cost is unknown. */
export function ratioPct(budget: string, cost: string | null): string {
  const r = ratio1000(budget, cost);
  return r === null ? "–" : `${Math.floor(r / 10)}.${r % 10}%`;
}

/** Time left in a fee window: "13h 22m", "42m", "<1m". */
export function windowLeft(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1m";
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Burned base units as a percent of `supply`, floored to 2 decimals: "3.42%". */
export function burnedPct(burned: string, supply: bigint): string {
  const q = (BigInt(burned) * 10_000n) / supply;
  return `${q / 100n}.${(q % 100n).toString().padStart(2, "0")}%`;
}
