// D-35: the share of supply bought in a coin's first 3 slots by wallets other than the dev and W. It is
// recomputed inside the ingest transaction only when a newly inserted buy falls in that window, so it never runs
// on a timer and never wakes Neon by itself (C-03). Errors are not caught here: a failed statement aborts the
// ingest transaction anyway, and ingestOrKeep keeps and retries the signature, which is the error path.
import { coins, launches, trades } from "@bondr/core/db";
import { SUPPLY } from "@bondr/core/price";
import type { KnownCoin } from "@bondr/core/trades";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Inserted } from "./announce.ts";
import type { Exec } from "./launches.ts";

const WINDOW = 2n; // createSlot..createSlot+2 is 3 slots

// Mints with an inserted non-launch buy inside their window; who bought is filtered by the query.
export function windowMints(inserted: Inserted[], known: ReadonlyMap<string, KnownCoin>): Set<string> {
  const out = new Set<string>();
  for (const t of inserted) {
    const start = known.get(t.mint)?.createSlot;
    if (start == null || t.side !== "buy" || t.launch) continue;
    if (BigInt(t.slot) <= BigInt(start) + WINDOW) out.add(t.mint);
  }
  return out;
}

// Rounded up, so one sniped base unit never reads as 0% (T-07-07-04).
export const snipedBps = (bought: bigint): number => {
  const scaled = bought * 10_000n;
  return Math.min(10_000, Number(scaled / SUPPLY + (scaled % SUPPLY > 0n ? 1n : 0n)));
};

export async function recomputeSniped(exec: Exec, mint: string): Promise<void> {
  const [r] = await exec
    .select({ sum: sql<string>`coalesce(sum(${trades.tokenAmount}), 0)::text` })
    .from(trades)
    .innerJoin(coins, eq(coins.mint, trades.mint))
    .innerJoin(launches, eq(launches.id, coins.launchId))
    .where(
      and(
        ...[eq(trades.mint, mint), eq(trades.side, "buy"), eq(trades.launch, false)],
        sql`${trades.slot} between ${coins.createSlot} and ${coins.createSlot} + ${String(WINDOW)}`,
        ...[ne(trades.trader, launches.wallet), ne(trades.trader, launches.w)],
      ),
    );
  const bps = snipedBps(BigInt(r?.sum ?? "0"));
  const changed = sql`${coins.snipedBps} is distinct from ${bps}`;
  await exec
    .update(coins)
    .set({ snipedBps: bps })
    .where(and(eq(coins.mint, mint), isNotNull(coins.createSlot), changed));
}
