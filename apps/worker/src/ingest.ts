// The one write path for launches and trades (RESEARCH Patterns 2-4). parseTx is pure; this writes its result
// in one transaction. Trades are keyed by (signature, ix), so a replay or an overlapping gap fill inserts
// nothing, and a coin moves only when one of its trades was new. Writes happen only when a launch or trade
// lands: nothing here runs on a timer (D-04, Neon budget).
import { coins, db, launches, trades } from "@bondr/core/db";
import { redact } from "@bondr/core/net";
import { bondingCurvePda, canonicalPumpPoolPdaWithQuote } from "@bondr/core/pump";
import { fetchTx, pace } from "@bondr/core/send";
import { type CoinPatch, type KnownCoin, type Parsed, parseTx, type TradeTx } from "@bondr/core/trades";
import { type Connection, PublicKey } from "@solana/web3.js";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { bondr, bondrPrice } from "./bondr-price.ts";
import type { Exec, LaunchRow } from "./launches.ts";

export const knownCoins = new Map<string, KnownCoin>();
type Inserted = typeof trades.$inferSelect;
// The created coin's launch row and PumpSwap pool, which the tx itself does not name.
type LaunchRef = { id: string; pool: string };

const warned = new Set<string>(); // Pitfall 10: each unknown event name is logged once per process
const BACKFILL_PACE_MS = 100; // 10 fetches a second, well under Helius' 50 req/s

const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

export async function loadCoins(exec: Exec): Promise<void> {
  const rows = await exec
    .select({
      mint: coins.mint,
      bondingCurve: coins.bondingCurve,
      pool: coins.pool,
      initialRealTokenReserves: coins.initialRealTokenReserves,
    })
    .from(coins);
  for (const r of rows) knownCoins.set(r.mint, r);
}

// created carries the launch's own patch, so a launch that already completed the curve brings venue and bondedAt.
async function insertCoin(exec: Exec, created: NonNullable<Parsed["created"]>, launch: LaunchRef) {
  const { mcapSol, launchMcapSol, launchedAt, ...rest } = created;
  if (mcapSol === null || launchMcapSol === null)
    throw new Error(`no BONDR price in launch of ${created.mint}`);
  const { bondedAt } = created as { bondedAt?: string };
  await exec
    .insert(coins)
    .values({
      ...rest,
      ...{ launchId: launch.id, pool: launch.pool, launchedAt: new Date(launchedAt), mcapSol, launchMcapSol },
      ...(bondedAt && { bondedAt: new Date(bondedAt) }),
    })
    .onConflictDoNothing();
}

// Curve state moves only forward in slots, so a gap fill writing an older trade after a newer one inserts
// its row and leaves the coin alone (Pitfall 4). Same-slot txs have no known order: the later write wins.
// Venue only advances (curve, complete, pool); the coins_bonded check refuses pool before complete.
async function applyPatch(exec: Exec, p: CoinPatch, fresh: Inserted | undefined): Promise<void> {
  const { mint, venue, bondSig, bondedAt, ...state } = p;
  if (fresh) {
    const seen = { lastSig: fresh.signature, lastTradeAt: fresh.at, lastSlot: fresh.slot };
    const newer = or(isNull(coins.lastSlot), lte(coins.lastSlot, fresh.slot));
    await exec
      .update(coins)
      .set({ ...state, ...seen })
      .where(and(eq(coins.mint, mint), newer));
  }
  if (!venue) return;
  const from = venue === "pool" ? ["curve", "complete"] : ["curve"];
  await exec
    .update(coins)
    .set({ venue, bondSig, ...(bondedAt && { bondedAt: new Date(bondedAt) }) })
    .where(and(eq(coins.mint, mint), inArray(coins.venue, from)));
}

// Runs in the caller's transaction. A patch applies when its mint got a new trade, or when the tx has no trade
// of that mint at all (a migration's CreatePoolEvent), which only ever advances the venue.
export async function writeParsed(exec: Exec, parsed: Parsed, launch?: LaunchRef): Promise<Inserted[]> {
  if (parsed.created && launch) await insertCoin(exec, parsed.created, launch);
  const rows = parsed.trades.map((t) => ({ ...t, at: new Date(t.at) }));
  const inserted = rows.length
    ? await exec.insert(trades).values(rows).onConflictDoNothing().returning()
    : [];
  for (const p of parsed.patches) {
    const fresh = inserted.filter((t) => t.mint === p.mint).at(-1);
    if (!fresh && parsed.trades.some((t) => t.mint === p.mint)) continue;
    await applyPatch(exec, p, fresh);
  }
  return inserted;
}

function parse(tx: TradeTx, launch?: { mint: string; exit: "burn" | "sell" }): Parsed {
  const b = bondr();
  if (!b) throw new Error("BONDR price not seeded");
  const parsed = parseTx(tx, knownCoins, b, launch);
  if (parsed.bondr !== null) bondrPrice.set(parsed.bondr);
  for (const name of parsed.unknown.filter((n) => !warned.has(n))) {
    warned.add(name);
    console.warn(`unknown pump event on a known coin: ${redact(name)}`);
  }
  return parsed;
}

export async function ingestTx(conn: Connection, sig: string): Promise<Inserted[]> {
  const tx = await fetchTx(conn, sig);
  if (!tx) return [];
  const parsed = parse(tx);
  if (!parsed.trades.length && !parsed.patches.length) return [];
  return db().transaction((t) => writeParsed(t, parsed));
}

// The launch tx the settle already fetched: the coin row, its Launch rows, then the coin joins the registry.
export async function ingestLaunch(
  row: Pick<LaunchRow, "id" | "mint" | "exit">,
  tx: TradeTx,
): Promise<Inserted[]> {
  const b = bondr();
  if (!b) throw new Error("BONDR price not seeded");
  const mint = new PublicKey(row.mint);
  const pool = canonicalPumpPoolPdaWithQuote(mint, new PublicKey(b.mint)).toBase58();
  const parsed = parse(tx, { mint: row.mint, exit: row.exit as "burn" | "sell" });
  const inserted = await db().transaction((t) => writeParsed(t, parsed, { id: row.id, pool }));
  const init = parsed.created?.initialRealTokenReserves;
  if (init) {
    const bondingCurve = bondingCurvePda(mint).toBase58();
    knownCoins.set(row.mint, { mint: row.mint, bondingCurve, pool, initialRealTokenReserves: init });
  }
  return inserted;
}

// Boot: every landed launch without a coin row (Phase 2 launches, or one whose ingest failed), one pass.
export async function backfillLaunches(conn: Connection): Promise<number> {
  const rows = await db()
    .select({ id: launches.id, mint: launches.mint, exit: launches.exit, signature: launches.signature })
    .from(launches)
    .leftJoin(coins, eq(coins.launchId, launches.id))
    .where(and(eq(launches.state, "landed"), isNull(coins.mint)));
  let done = 0;
  for (const row of rows) {
    await pace(BACKFILL_PACE_MS);
    const tx = row.signature ? await fetchTx(conn, row.signature) : undefined;
    if (!tx) {
      console.error(`backfill ${row.id}: tx not found`);
      continue;
    }
    await ingestLaunch(row, tx).then(() => done++, logged(`backfill ${row.id}`));
  }
  return done;
}
