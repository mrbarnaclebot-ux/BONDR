// Prepared trades: the exact message bytes submit compares against, and the state the browser polls. No row
// in Postgres (D-04): the indexer writes the trade once it lands.
// ponytail: per-process memory while the worker runs one replica (D-07); move entries to a shared store if
// the worker scales out.
import { randomBytes } from "node:crypto";
import type { LaunchState, TradeErrorCode, TradeSide } from "@bondr/core/api";

export type TradeEntry = {
  id: string;
  wallet: string;
  mint: string;
  side: TradeSide;
  message: Buffer;
  blockhash: string;
  lastValidBlockHeight: number;
  state: LaunchState;
  signature?: string;
  amountOut?: string;
  code?: TradeErrorCode;
  at: number; // last update, ms
};
type NewTrade = Omit<TradeEntry, "id" | "state" | "at">;
// Only the outcome changes after prepare; the wallet and the bytes never do.
type Patch = Partial<Pick<TradeEntry, "state" | "signature" | "amountOut" | "code">>;

export const TRADE_TTL_MS = 120_000;
export const TRADE_MAX = 5_000;
const trades = new Map<string, TradeEntry>();

const live = (e: TradeEntry, now: number) => now - e.at < TRADE_TTL_MS;

// Sweep on insert, then drop the oldest while full (a Map keeps insertion order; updates re-insert), T7.
export function putTrade(t: NewTrade, now = Date.now()): TradeEntry {
  for (const [k, v] of trades) if (!live(v, now)) trades.delete(k);
  while (trades.size >= TRADE_MAX) trades.delete(trades.keys().next().value as string);
  const e: TradeEntry = { ...t, id: randomBytes(16).toString("hex"), state: "prepared", at: now };
  trades.set(e.id, e);
  return e;
}

export function getTrade(id: string, now = Date.now()): TradeEntry | undefined {
  const e = trades.get(id);
  if (e && live(e, now)) return e;
  trades.delete(id);
  return undefined;
}

export function updateTrade(id: string, patch: Patch, now = Date.now()) {
  const e = getTrade(id, now);
  if (!e) return undefined;
  trades.delete(id);
  const next = { ...e, ...patch, at: now };
  trades.set(id, next);
  return next;
}
