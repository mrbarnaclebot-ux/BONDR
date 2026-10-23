// Display helpers for live values (UI-SPEC Live values). Pure, so the unit test can load them.
import type { Net } from "@bondr/core/api";

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
