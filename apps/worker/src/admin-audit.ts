// The one admin audit writer (D-33, D-34). Money actions insert a pending row before anything is sent and settle
// it once; the settle is a guarded UPDATE (launches.ts advance), so the admin_audit_guard trigger from migration
// 0007 never fires in normal use. Nothing here deletes.
//
// Params are stored as given. Callers pass only action inputs (job, enabled, mint, reason, intent id, outcome),
// never a secret, seed, key or token.
import type { AdminAuditAction } from "@bondr/core/api-admin";
import { adminAudit, type Db, db } from "@bondr/core/db";
import { and, eq, sql } from "drizzle-orm";

type Base = { actor: string; action: AdminAuditAction; mint: string | null; params: Record<string, unknown> };
export type PendingAudit = Base & { simulation: Record<string, unknown>; intentSig: string };
export type Final = "landed" | "failed" | "refused";
export type SettleSet = { sigs?: string[]; error?: string };

export type AuditStore = {
  insertPending(r: PendingAudit): Promise<string>;
  // false when the row is not pending: it was settled already.
  settle(id: string, result: Final, set: SettleSet): Promise<boolean>;
  insertLanded(r: Base): Promise<string>;
};

// The SQLSTATE only: the error message can quote the params.
async function logged<T>(run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    console.error(`admin audit write failed: ${err.cause?.code ?? err.code ?? "unknown"}`);
    throw e;
  }
}

export function pgAudit(exec: Pick<Db, "insert" | "update"> = db()): AuditStore {
  const insert = async (v: typeof adminAudit.$inferInsert) => {
    const [r] = await logged(exec.insert(adminAudit).values(v).returning({ id: adminAudit.id }));
    return String(r?.id);
  };
  return {
    insertPending: (r) => insert({ ...r, result: "pending" }),
    insertLanded: (r) => insert({ ...r, result: "landed", settledAt: new Date() }),
    async settle(id, result, set) {
      const rows = await logged(
        exec
          .update(adminAudit)
          .set({ ...set, result, settledAt: sql`now()` })
          .where(and(eq(adminAudit.id, Number(id)), eq(adminAudit.result, "pending")))
          .returning({ id: adminAudit.id }),
      );
      return rows.length > 0;
    },
  };
}

type MemoryRow = Base & {
  id: string;
  simulation: Record<string, unknown> | null;
  intentSig: string | null;
  sigs: string[];
  result: "pending" | Final;
  settledAt: Date | null;
  error: string | null;
};

// Tests and the fork stage: the same single pending-to-final transition.
export function memoryAudit(): AuditStore & { rows: MemoryRow[] } {
  const rows: MemoryRow[] = [];
  const push = (r: Omit<MemoryRow, "id" | "sigs" | "error">) => {
    const id = String(rows.length + 1);
    rows.push({ ...r, id, sigs: [], error: null });
    return Promise.resolve(id);
  };
  return {
    rows,
    insertPending: (r) => push({ ...r, result: "pending", settledAt: null }),
    insertLanded: (r) =>
      push({ ...r, simulation: null, intentSig: null, result: "landed", settledAt: new Date() }),
    settle(id, result, set) {
      const r = rows.find((x) => x.id === id && x.result === "pending");
      if (r) Object.assign(r, { ...set, result, settledAt: new Date() });
      return Promise.resolve(!!r);
    },
  };
}
