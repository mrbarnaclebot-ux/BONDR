// The console's Audit log (ADMIN-10, D-33): every admin action, newest first, paged by an (at, id) keyset the
// same way the token page Fee ledger is. Read-only here; the worker is the only writer (D-34).
import "server-only";
import type { AdminAuditRow } from "@bondr/core/api-admin";
import { desc, eq, sql } from "drizzle-orm";
import { adminAudit, coins, db, launches } from "./db";
import { type LedgerCursor, parseLedgerCursor } from "./ledger";

export const AUDIT_PAGE = 50;

export type AuditPage = { rows: AdminAuditRow[]; more: boolean; next: string | null };

/** "atMs.id" from the client, or null for anything else (the ledger cursor's exact rules). */
export const parseAuditCursor = parseLedgerCursor;

// Only the keys the Action copy reads leave the server (T-06-14-03): a hold reason or an intent id never does.
const PARAMS = ["job", "enabled", "wallet", "wallets"] as const;

function shownParams(raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of PARAMS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function shownSim(raw: unknown): AdminAuditRow["simulation"] {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { ok?: unknown; cu?: unknown };
  return { ok: s.ok === true, cu: Number(s.cu) || 0 };
}

// Microseconds in Postgres, milliseconds in the cursor: order and compare on the same truncated value, as
// ledger.ts does. ponytail: this skips the admin_audit_page index order; a few actions a day, add an
// expression index if the log ever reaches hundreds of thousands of rows.
const AT_MS = sql`date_trunc('milliseconds', ${adminAudit.at})`;

/** One page of the audit log, older than `before` when given. */
export async function auditPage(before?: LedgerCursor): Promise<AuditPage> {
  const older = before
    ? sql`(${AT_MS}, ${adminAudit.id}) < (timestamptz 'epoch' + ${before.ms}::bigint * interval '1 millisecond', ${String(before.id)}::bigint)`
    : undefined;
  const found = await db()
    .select({
      ...{ id: adminAudit.id, at: adminAudit.at, actor: adminAudit.actor, action: adminAudit.action },
      ...{ mint: adminAudit.mint, symbol: launches.symbol, params: adminAudit.params },
      ...{ simulation: adminAudit.simulation, result: adminAudit.result, sigs: adminAudit.sigs },
    })
    .from(adminAudit)
    .leftJoin(coins, eq(coins.mint, adminAudit.mint))
    .leftJoin(launches, eq(launches.id, coins.launchId))
    .where(older)
    .orderBy(desc(AT_MS), desc(adminAudit.id))
    .limit(AUDIT_PAGE + 1);
  const rows: AdminAuditRow[] = found.slice(0, AUDIT_PAGE).map((r) => ({
    ...r,
    id: String(r.id),
    at: r.at.toISOString(),
    action: r.action as AdminAuditRow["action"], // admin_audit_action CHECK
    result: r.result as AdminAuditRow["result"], // admin_audit_result CHECK
    params: shownParams(r.params),
    simulation: shownSim(r.simulation),
  }));
  const more = found.length > AUDIT_PAGE;
  const last = rows.at(-1);
  return { rows, more, next: more && last ? `${Date.parse(last.at)}.${last.id}` : null };
}
