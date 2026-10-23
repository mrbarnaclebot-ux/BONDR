// The token page trade feed, newest first, paged by (slot, seq) keyset so a page never skips or repeats a row
// while new trades land on top.
import "server-only";
import type { TradeRow } from "@bondr/core/api";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, trades } from "./db";

export const PAGE = 50;
const INT8_MAX = 2n ** 63n - 1n;

export type Cursor = { slot: bigint; seq: bigint };

/** "slot.seq" from the client, or null for anything else (no signs, no exponent, int8 range only). */
export function parseCursor(s: string): Cursor | null {
  if (!/^\d{1,19}\.\d{1,19}$/.test(s)) return null;
  const [slot, seq] = s.split(".").map(BigInt);
  return slot > INT8_MAX || seq > INT8_MAX ? null : { slot, seq };
}

const COLUMNS = {
  signature: trades.signature,
  ix: trades.ix,
  side: trades.side,
  launch: trades.launch,
  venue: trades.venue,
  trader: trades.trader,
  tokenAmount: trades.tokenAmount,
  sol: trades.sol,
  mcapSol: trades.mcapSol,
  at: trades.at,
  slot: trades.slot,
  seq: trades.seq,
};

/** One page of a coin's trades, older than `before` when given; `more` says whether an older page exists. */
export async function tradesPage(
  mint: string,
  before?: Cursor,
): Promise<{ trades: TradeRow[]; more: boolean }> {
  const older = before
    ? sql`(${trades.slot}, ${trades.seq}) < (${String(before.slot)}::bigint, ${String(before.seq)}::bigint)`
    : undefined;
  const rows = await db()
    .select(COLUMNS)
    .from(trades)
    .where(and(eq(trades.mint, mint), older))
    .orderBy(desc(trades.slot), desc(trades.seq))
    .limit(PAGE + 1);
  return {
    more: rows.length > PAGE,
    trades: rows.slice(0, PAGE).map((r) => ({
      ...r,
      side: r.side as TradeRow["side"],
      venue: r.venue as TradeRow["venue"],
      at: r.at.toISOString(),
      seq: String(r.seq),
    })),
  };
}
