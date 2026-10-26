// The one audit writer (D-33, D-34). The memory store runs everywhere; the Postgres one runs on the Neon dev
// branch inside a transaction that is always rolled back (the trigger refuses DELETE), and skips without
// DATABASE_URL.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adminAudit, close, db } from "@bondr/core/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test, vi } from "vitest";
import { type AuditStore, memoryAudit, pgAudit, settleStale } from "./admin-audit.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const intent = {
  ...{ actor: "test-actor", action: "sweep_now" as const, mint: "test-mint", params: { intent: "i1" } },
  ...{ simulation: { ok: true, cu: 1000 }, intentSig: "test-sig" },
};

describe("memoryAudit", () => {
  test("a pending row settles once; a landed row is written settled", async () => {
    const a = memoryAudit();
    const id = await a.insertPending(intent);
    expect(await a.settle(id, "landed", { sigs: ["s1"] })).toBe(true);
    expect(await a.settle(id, "failed", { error: "late" })).toBe(false);
    expect(a.rows[0]).toMatchObject({ id, result: "landed", sigs: ["s1"] });
    const sw = { actor: "test-actor", action: "switch" as const, mint: null, params: { job: "sweeps" } };
    const l = await a.insertLanded(sw);
    expect(a.rows[1]).toMatchObject({ id: l, result: "landed", simulation: null, intentSig: null });
    expect((a.rows[1] as { settledAt: Date | null }).settledAt).toBeInstanceOf(Date);
    expect(await a.settle(l, "failed", {})).toBe(false);
  });
});

test("a failed write logs only its SQLSTATE, never the params", async () => {
  const err = Object.assign(new Error("insert failed"), { cause: { code: "23514" } });
  const rejects = { returning: () => Promise.reject(err) };
  const exec = { insert: () => ({ values: () => rejects }) } as never;
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const params = { reason: "secret-looking-value" };
    await expect(pgAudit(exec).insertLanded({ actor: "a", action: "hold", mint: "m", params })).rejects.toBe(
      err,
    );
    expect(spy).toHaveBeenCalledWith("admin audit write failed: 23514");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-looking-value");
  } finally {
    spy.mockRestore();
  }
});

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (a: AuditStore, tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await fn(pgAudit(tx as never), tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

const row = async (tx: Tx, id: string) =>
  (
    await tx
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.id, Number(id)))
  )[0];

describe.skipIf(!process.env.DATABASE_URL)("pgAudit", { timeout: 30_000 }, () => {
  afterAll(() => close());

  test("a pending money row settles once with a guarded update", async () => {
    await rolledBack(async (a, tx) => {
      const id = await a.insertPending(intent);
      expect(await row(tx, id)).toMatchObject({
        ...{ result: "pending", intentSig: "test-sig", simulation: { ok: true, cu: 1000 } },
        ...{ settledAt: null, params: { intent: "i1" } },
      });
      expect(await a.settle(id, "failed", { error: "simulation drifted" })).toBe(true);
      const settled = await row(tx, id);
      expect(settled).toMatchObject({ result: "failed", error: "simulation drifted" });
      expect(settled?.settledAt).toBeInstanceOf(Date);
      // No row matches result = 'pending', so the trigger never fires and nothing throws.
      expect(await a.settle(id, "landed", { sigs: ["s1"] })).toBe(false);
      expect((await row(tx, id))?.result).toBe("failed");
    });
  });

  test("boot settles a pending row from before it as failed, worker restarted, and leaves newer ones (WR-W-06)", async () => {
    await rolledBack(async (a, tx) => {
      const id = await a.insertPending(intent);
      expect(await settleStale(new Date(0), tx as never)).toBe(0);
      expect((await row(tx, id))?.result).toBe("pending");
      expect(await settleStale(new Date(Date.now() + 60_000), tx as never)).toBeGreaterThanOrEqual(1);
      const r = await row(tx, id);
      expect(r).toMatchObject({ result: "failed", error: "worker restarted" });
      expect(r?.settledAt).toBeInstanceOf(Date);
    });
  });

  test("a switch row is written landed with no simulation or intent signature", async () => {
    await rolledBack(async (a, tx) => {
      const params = { job: "sweeps", enabled: false };
      const id = await a.insertLanded({ actor: "test-actor", action: "switch", mint: null, params });
      const r = await row(tx, id);
      expect(r).toMatchObject({ result: "landed", simulation: null, intentSig: null, params });
      expect(r?.settledAt).toBeInstanceOf(Date);
    });
  });
});
