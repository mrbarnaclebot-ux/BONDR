// The 24h ticker cooldown (D-40..D-42, RESEARCH Pattern 12). BONDR lists only its own coins, so the lock covers
// the whole BONDR namespace. No join to coins: a hidden coin keeps its lock (D-41).
import type { ApiError } from "@bondr/core/api";
import type { Db } from "@bondr/core/db";
import { launches } from "@bondr/core/schema";
import { and, eq, sql } from "drizzle-orm";

export type TickerLock = { held: number; until: Date | null; lastLanded: Date | null };

/**
 * One indexed read (launches_symbol_live): the rows holding this normalized symbol. prepare's admit runs it beside
 * its other reads, before any spend (D-40). Landed rows hold 24h, signed/sent/unknown hold until settled, and
 * another wallet's prepared row holds for its 3-minute life. The server clock decides every window.
 */
export async function tickerLock(
  exec: Pick<Db, "select">,
  symbol: string,
  wallet: string,
): Promise<TickerLock> {
  // ponytail: race safety comes from prepare's single-flight queue; a ticker_locks upsert if the worker is ever
  // duplicated.
  const [r] = await exec
    .select({
      held: sql<number>`count(*)::int`.mapWith(Number),
      until: sql<Date | null>`max(case when ${launches.state} = 'landed'
        then ${launches.landedAt} + interval '24 hours'
        else ${launches.createdAt} + interval '3 minutes' end)`.mapWith(launches.landedAt),
      lastLanded: sql<Date | null>`max(${launches.landedAt})`.mapWith(launches.landedAt),
    })
    .from(launches)
    .where(
      and(
        eq(launches.symbol, symbol),
        sql`(
          (${launches.state} = 'landed' and ${launches.landedAt} > now() - interval '24 hours')
          or ${launches.state} in ('signed', 'sent', 'unknown')
          or (${launches.state} = 'prepared' and ${launches.createdAt} > now() - interval '3 minutes'
              and ${launches.wallet} <> ${wallet})
        )`,
      ),
    );
  return { held: r?.held ?? 0, until: r?.until ?? null, lastLanded: r?.lastLanded ?? null };
}

/**
 * Pure: refuse whenever a holding row exists. A stale signed, sent or unknown row still holds, because it may land;
 * its hint time can be past, so retryAfter is clamped at 0 and the copy shows the in-flight line.
 */
export function tickerRefusal(lock: TickerLock, now: Date): ApiError | null {
  if (lock.held === 0) return null;
  const left = lock.until ? Math.ceil((lock.until.getTime() - now.getTime()) / 1000) : 0;
  return {
    error: "ticker_locked",
    retryAfter: Math.max(0, left),
    lock: lock.lastLanded ? "landed" : "pending",
  };
}
