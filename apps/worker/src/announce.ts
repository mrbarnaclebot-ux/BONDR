// After a commit, to whoever listens on GET /events, and to the fee engine's memory. Nobody listening: no
// read, so Neon can sleep.
import type { LedgerRow, TradeRow } from "@bondr/core/api";
import { coinRow } from "@bondr/core/coin-row";
import { db, type trades } from "@bondr/core/db";
import { PUBLIC_KINDS } from "@bondr/core/fees";
import { redact } from "@bondr/core/net";
import type { Connection } from "@solana/web3.js";
import { listening, publish, skipId } from "./events-route.ts";
import { onIngest } from "./fee-boot.ts";
import type { Ingested } from "./fee-engine.ts";
import type { Entry } from "./fee-ledger.ts";
import { touch } from "./holders.ts";
import { knownCoins } from "./ingest.ts";

export type Inserted = typeof trades.$inferSelect;
// What one committed ingest wrote, for the events, the holder recount and the engine.
export type Written = Ingested & { inserted: Inserted[]; bonded: Set<string> };

const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

const tradeRow = (t: Inserted): TradeRow & { mint: string } => ({
  ...{ signature: t.signature, ix: t.ix, launch: t.launch, trader: t.trader, tokenAmount: t.tokenAmount },
  ...{ side: t.side as TradeRow["side"], venue: t.venue as TradeRow["venue"], mint: t.mint },
  ...{ sol: t.sol, mcapSol: t.mcapSol, at: t.at.toISOString(), slot: t.slot, seq: String(t.seq) },
});

// The coin's new numbers (one read per coin, the database is awake from the write), then launch, trade and
// bond events.
async function announce(inserted: Inserted[], bonded: ReadonlySet<string>, launched?: string) {
  if (!listening()) return;
  for (const mint of new Set([...inserted.map((t) => t.mint), ...bonded])) {
    const coin = await coinRow(db(), mint);
    if (!coin) continue;
    if (mint === launched) publish({ type: "launch", data: coin });
    for (const t of inserted.filter((t) => t.mint === mint))
      publish({ type: "trade", data: { trade: tradeRow(t), coin } });
    const { venue, bondSig, bondedAt } = coin;
    if (bonded.has(mint)) publish({ type: "bond", data: { mint, venue, bondSig, bondedAt } });
  }
}

// Every coin with a new trade gets a (throttled) holder recount, after the write has committed. Live writes go
// out as events. A gap fill's trades are history, not live ticks: it skips an id instead, so open pages resync.
// The engine sees both; it keeps only the newest state and enqueues nothing before it is ready (Pitfall 10).
export async function arm(conn: Connection, w: Written, live = true) {
  const { inserted, bonded } = w;
  for (const mint of new Set(inserted.map((t) => t.mint))) {
    const coin = knownCoins.get(mint);
    if (coin) touch(conn, coin);
  }
  onIngest(w);
  if (live) await announce(inserted, bonded, w.launched?.mint).catch(logged("publish"));
  else if (inserted.length || bonded.size) skipId();
  return inserted;
}

const PUBLIC: ReadonlySet<string> = new Set(PUBLIC_KINDS);
const DETAIL = ["dBps", "tBps", "deployer", "treasury", "deployerAmount", "treasuryAmount"] as const;

// Key by key, as web's ledger read does: a held reason or a diff never reaches a page (T-05-05-05).
function publicDetail(raw: Entry["detail"]): LedgerRow["detail"] {
  const out: Record<string, unknown> = {};
  for (const k of DETAIL) if (raw?.[k] !== undefined) out[k] = raw[k];
  return Object.keys(out).length ? (out as LedgerRow["detail"]) : null;
}

const str = (x: bigint | undefined): string | null => (x === undefined ? null : String(x));

export const ledgerRow = (e: Entry): LedgerRow => ({
  ...{ id: String(e.id), kind: e.kind as LedgerRow["kind"], signature: e.signature ?? "" },
  ...{ amount: str(e.amount), burned: str(e.burned), sol: str(e.sol), windowIndex: e.windowIndex ?? null },
  ...{ detail: publicDetail(e.detail), landedAt: (e.landedAt ?? new Date()).toISOString() },
});

// Landed public rows only, with the coin's new numbers (one read, the database is awake from the landing).
export async function publishFee(mint: string | null, rows: Entry[]): Promise<void> {
  if (!listening()) return;
  const out = rows.filter((r) => r.state === "landed" && PUBLIC.has(r.kind)).map(ledgerRow);
  if (!out.length) return;
  const coin = mint ? await coinRow(db(), mint) : null;
  publish({ type: "fee", data: { mint, rows: out, coin } });
}
