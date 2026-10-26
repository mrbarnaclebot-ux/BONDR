// D-35: the share of supply bought in a coin's first 3 slots by wallets other than the dev and W. It stays null
// until a trade past the window is stored, so the page never states a share while slots createSlot+1 and +2 may
// still be missing. It is recomputed inside the ingest transaction only when a trade closes the window or a late
// buy falls inside a closed one, so it never runs on a timer and never wakes Neon by itself (C-03). Errors are not caught here: a failed statement aborts the
// ingest transaction anyway, and ingestOrKeep keeps and retries the signature, which is the error path.
import { coins, launches, trades } from "@bondr/core/db";
import { SUPPLY } from "@bondr/core/price";
import type { KnownCoin } from "@bondr/core/trades";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Inserted } from "./announce.ts";
import type { Exec } from "./launches.ts";

const WINDOW = 2n; // createSlot..createSlot+2 is 3 slots
const past = (slot: string, start: string) => BigInt(slot) > BigInt(start) + WINDOW;

// Mints to recompute: an inserted non-launch buy inside the window (who bought is filtered by the query; the
// write waits for the window to close), or the first trades past the window while no figure exists yet.
export function windowMints(inserted: Inserted[], known: ReadonlyMap<string, KnownCoin>): Set<string> {
  const out = new Set<string>();
  for (const t of inserted) {
    const c = known.get(t.mint);
    if (c?.createSlot == null) continue;
    if (past(t.slot, c.createSlot) ? !c.windowClosed : t.side === "buy" && !t.launch) out.add(t.mint);
  }
  return out;
}

// Called after the ingest transaction commits, so a rolled-back write never marks a window closed.
export function closeWindows(inserted: Inserted[], known: ReadonlyMap<string, KnownCoin>): void {
  for (const t of inserted) {
    const c = known.get(t.mint);
    if (c?.createSlot != null && past(t.slot, c.createSlot)) c.windowClosed = true;
  }
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
  const closed = sql`exists (select 1 from ${trades} where ${trades.mint} = ${mint}
    and ${trades.slot} > ${coins.createSlot} + ${String(WINDOW)})`;
  await exec
    .update(coins)
    .set({ snipedBps: bps })
    .where(and(eq(coins.mint, mint), isNotNull(coins.createSlot), changed, closed));
}
