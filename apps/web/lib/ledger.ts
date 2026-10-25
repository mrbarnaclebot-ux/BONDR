// The token page Fee ledger (TOKEN-04, D-22): landed public rows only, newest first, paged by a (landed_at, id)
// keyset. The kind list is an allowlist, never a blacklist, so a new internal kind can never leak.
import "server-only";
import type { LedgerRow } from "@bondr/core/api";
import { PUBLIC_KINDS } from "@bondr/core/fees";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, feeLedger } from "./db";
import { kept } from "./trades";

export const PAGE = 20;
const INT8_MAX = 2n ** 63n - 1n;

export type LedgerCursor = { ms: number; id: bigint };
export type LedgerPage = { rows: LedgerRow[]; more: boolean; next: string | null };

/** "landedMs.id" from the client, or null for anything else (no signs, no exponent, int8 id only). */
export function parseLedgerCursor(s: string): LedgerCursor | null {
  if (!/^\d{1,15}\.\d{1,19}$/.test(s)) return null;
  const [ms, id] = s.split(".");
  return BigInt(id) > INT8_MAX ? null : { ms: Number(ms), id: BigInt(id) };
}

const DETAIL = ["dBps", "tBps", "deployer", "treasury", "deployerAmount", "treasuryAmount"] as const;

/** Only the public detail keys leave the server; a held reason or a diff never does. */
function publicDetail(raw: unknown): LedgerRow["detail"] {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of DETAIL) if (src[k] !== undefined) out[k] = src[k];
  return Object.keys(out).length ? (out as LedgerRow["detail"]) : null;
}

// Postgres keeps microseconds, the cursor carries milliseconds: order and compare on the same truncated value,
// so a page never repeats or skips a row. ponytail: the truncation skips the fee_ledger_public index order; a
// few rows a day per coin, add an expression index if a coin ever has thousands.
const LANDED_MS = sql`date_trunc('milliseconds', ${feeLedger.landedAt})`;

const COLUMNS = {
  id: feeLedger.id,
  kind: feeLedger.kind,
  amount: feeLedger.amount,
  burned: feeLedger.burned,
  sol: feeLedger.sol,
  signature: feeLedger.signature,
  windowIndex: feeLedger.windowIndex,
  detail: feeLedger.detail,
  landedAt: feeLedger.landedAt,
};

/** One page of a coin's landed public fee rows, older than `before` when given. */
export async function ledgerPage(mint: string, before?: LedgerCursor): Promise<LedgerPage> {
  const older = before
    ? sql`(${LANDED_MS}, ${feeLedger.id}) < (timestamptz 'epoch' + ${before.ms}::bigint * interval '1 millisecond', ${String(before.id)}::bigint)`
    : undefined;
  const found = await db()
    .select(COLUMNS)
    .from(feeLedger)
    .where(
      and(
        eq(feeLedger.mint, mint),
        eq(feeLedger.state, "landed"),
        inArray(feeLedger.kind, [...PUBLIC_KINDS]),
        older,
      ),
    )
    .orderBy(desc(LANDED_MS), desc(feeLedger.id))
    .limit(PAGE + 1);
  const rows: LedgerRow[] = found.slice(0, PAGE).map((r) => ({
    ...r,
    id: String(r.id),
    kind: r.kind as LedgerRow["kind"],
    signature: r.signature as string, // fee_ledger_tx: a landed row always has one
    detail: publicDetail(r.detail),
    landedAt: (r.landedAt as Date).toISOString(), // fee_ledger_landed
  }));
  const more = found.length > PAGE;
  const last = rows.at(-1);
  return { rows, more, next: more && last ? `${Date.parse(last.landedAt)}.${last.id}` : null };
}

/** The token page's first ledger page, kept 10 s per mint with its other reads (D-04). */
export const firstLedgerPage = (mint: string): Promise<LedgerPage> =>
  kept(`ledger:${mint}`, () => ledgerPage(mint));
