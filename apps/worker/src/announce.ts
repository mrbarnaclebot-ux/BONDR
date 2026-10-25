// After a commit, to whoever listens on GET /events. Nobody listening: no read, so Neon can sleep.
import type { LedgerRow } from "@bondr/core/api";
import { coinRow } from "@bondr/core/coin-row";
import { db } from "@bondr/core/db";
import { PUBLIC_KINDS } from "@bondr/core/fees";
import { listening, publish } from "./events-route.ts";
import type { Entry } from "./fee-ledger.ts";

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
