import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { coinRow, coinRows } from "./coin-row.ts";
import {
  adminAudit,
  blockedDeployers,
  close,
  coins,
  db,
  feeLedger,
  launches,
  settings,
  vanityMints,
  wallets,
} from "./db.ts";

// Vitest does not read .env; load it so a local run hits the Neon dev branch. CI has no .env and skips.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const testId = () => `test-${randomBytes(8).toString("hex")}`;

// Postgres SQLSTATE of a failed statement (drizzle wraps the driver error in cause).
async function pgCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}

// The audit trigger refuses DELETE, so every case runs in a transaction that is always rolled back: the dev
// branch never keeps a test row, even when an assertion fails halfway.
const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

// A failed statement aborts its transaction, so each attempt gets its own savepoint.
const attempt = (tx: Tx, run: (t: Tx) => Promise<unknown>) => pgCode(tx.transaction(run));

async function seedCoin(tx: Tx): Promise<string> {
  const mint = testId();
  const id = randomBytes(16).toString("hex");
  await tx.insert(wallets).values({ address: mint, consentedAt: new Date(), termsVersion: "test" });
  // Negative idx never collides with a grinder index.
  await tx.insert(vanityMints).values({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey: mint });
  await tx.insert(launches).values({
    ...{ id, wallet: mint, mint, w: mint, state: "failed", name: "Test", symbol: "TEST" },
    ...{ uri: "ipfs://test", solIn: 1n, exit: "burn" },
  });
  await tx.insert(coins).values({
    ...{ mint, launchId: id, launchedAt: new Date(), bondingCurve: "curve", pool: "pool" },
    ...{ initialRealTokenReserves: "1", realTokenReserves: "1", realQuoteReserves: "0" },
    ...{ virtualTokenReserves: "1", virtualQuoteReserves: "1", mcapSol: 1, launchMcapSol: 1 },
  });
  return mint;
}

const audit = (over: Partial<typeof adminAudit.$inferInsert> = {}): typeof adminAudit.$inferInsert => ({
  actor: "test-actor",
  action: "hold",
  result: "pending",
  ...over,
});

const counts = async () => ({
  audit: await db().$count(adminAudit),
  blocked: await db().$count(blockedDeployers),
  coins: await db().$count(coins),
});

// 30 s: the first query may wake a suspended Neon compute.
describe.skipIf(!process.env.DATABASE_URL)("admin database constraints", { timeout: 30_000 }, () => {
  let before: Awaited<ReturnType<typeof counts>>;
  beforeAll(async () => {
    before = await counts();
  }, 30_000);
  afterAll(async () => {
    try {
      expect(await counts()).toEqual(before);
    } finally {
      await close();
    }
  }, 30_000);

  test("the settings row has every switch on and no evacuation", async () => {
    const [row] = await db().select().from(settings).where(eq(settings.id, 1));
    expect(row).toMatchObject({
      forcedBondEnabled: true,
      sweepsEnabled: true,
      finalizeEnabled: true,
      buybackBurnEnabled: true,
      evacuatedAt: null,
    });
  });

  test("hide and hold need a reason of 1 to 120 characters", async () => {
    await rolledBack(async (tx) => {
      const mint = await seedCoin(tx);
      const set = (v: Partial<typeof coins.$inferInsert>) =>
        attempt(tx, (t) => t.update(coins).set(v).where(eq(coins.mint, mint)).execute());
      expect(await set({ hiddenAt: new Date() })).toBe("23514");
      expect(await set({ heldAt: new Date() })).toBe("23514");
      expect(await set({ hiddenReason: "spam" })).toBe("23514");
      expect(await set({ hiddenAt: new Date(), hiddenReason: "x".repeat(121) })).toBe("23514");
      expect(await set({ heldAt: new Date(), heldReason: "" })).toBe("23514");
      expect(await set({ hiddenAt: new Date(), hiddenReason: "x".repeat(120) })).toBeUndefined();
      expect(await set({ heldAt: new Date(), heldReason: "review" })).toBeUndefined();
    });
  });

  test("a hidden coin leaves coinRows and stays reachable through coinRow (D-29)", async () => {
    await rolledBack(async (tx) => {
      const mint = await seedCoin(tx);
      const listed = async () =>
        (await coinRows(tx, [desc(coins.launchedAt)], 10, 0, eq(coins.mint, mint))).map((c) => c.mint);
      expect(await listed()).toEqual([mint]);
      await tx.update(coins).set({ hiddenAt: new Date(), hiddenReason: "spam" }).where(eq(coins.mint, mint));
      expect(await listed()).toEqual([]);
      expect((await coinRow(tx, mint))?.mint).toBe(mint);
    });
  });

  test("a deployer is blocked once, with a reason", async () => {
    await rolledBack(async (tx) => {
      const wallet = testId();
      const block = (reason: string) =>
        attempt(tx, (t) => t.insert(blockedDeployers).values({ wallet, reason }).execute());
      expect(await block("")).toBe("23514");
      expect(await block("spam launches")).toBeUndefined();
      expect(await block("again")).toBe("23505");
    });
  });

  test("audit rows refuse unknown results and actions and mismatched settle or intent fields", async () => {
    await rolledBack(async (tx) => {
      const put = (over: Partial<typeof adminAudit.$inferInsert>) =>
        attempt(tx, (t) => t.insert(adminAudit).values(audit(over)).execute());
      expect(await put({ result: "bogus", settledAt: new Date() })).toBe("23514");
      expect(await put({ settledAt: new Date() })).toBe("23514");
      expect(await put({ result: "landed" })).toBe("23514");
      expect(await put({ intentSig: "sig" })).toBe("23514");
      expect(await put({ action: "drain" })).toBe("23514");
      expect(await put({ action: "evacuate", intentSig: "sig", simulation: { ok: true } })).toBeUndefined();
    });
  });

  test("a pending audit row settles once with its identity unchanged, and nothing deletes", async () => {
    await rolledBack(async (tx) => {
      const insert = async () =>
        (await tx.insert(adminAudit).values(audit()).returning({ id: adminAudit.id }))[0]?.id as number;
      const settled = await insert();
      const update = (id: number, v: Partial<typeof adminAudit.$inferInsert>) =>
        attempt(tx, (t) => t.update(adminAudit).set(v).where(eq(adminAudit.id, id)).execute());
      const remove = (id: number) =>
        attempt(tx, (t) => t.delete(adminAudit).where(eq(adminAudit.id, id)).execute());
      expect(
        await update(settled, { result: "landed", settledAt: new Date(), sigs: ["s1"] }),
      ).toBeUndefined();
      expect(await update(settled, { result: "failed", error: "late" })).toBe("P0001");
      expect(await remove(settled)).toBe("P0001");
      const open = await insert();
      expect(await update(open, { actor: "test-other" })).toBe("P0001");
      expect(await update(open, { actor: "test-other", result: "landed", settledAt: new Date() })).toBe(
        "P0001",
      );
      expect(await update(open, { params: { x: 1 }, result: "failed", settledAt: new Date() })).toBe("P0001");
      expect(await remove(open)).toBe("P0001");
    });
  });

  test("TRUNCATE admin_audit is refused by the privilege and, if re-granted, by the guard trigger", async () => {
    await rolledBack(async (tx) => {
      const truncate = () => attempt(tx, (t) => t.execute(sql`truncate admin_audit`));
      expect(await truncate()).toBe("42501");
      // The owner can re-grant itself (defence in depth only), so the statement trigger is the real guard.
      await tx.execute(sql`grant truncate on admin_audit to current_user`);
      expect(await truncate()).toBe("P0001");
    });
  });

  test("sniped_bps is null or 0 to 10000", async () => {
    await rolledBack(async (tx) => {
      const mint = await seedCoin(tx);
      const set = (snipedBps: number | null) =>
        attempt(tx, (t) => t.update(coins).set({ snipedBps }).where(eq(coins.mint, mint)).execute());
      expect(await set(10001)).toBe("23514");
      expect(await set(-1)).toBe("23514");
      for (const ok of [null, 0, 10000]) expect(await set(ok)).toBeUndefined();
    });
  });

  test("launches_symbol_live is a partial index on (symbol, landed_at) without failed launches", async () => {
    const r = await db().execute(sql`select indexdef from pg_indexes where indexname = 'launches_symbol_live'`);
    const def = String((r as unknown as { indexdef: string }[])[0]?.indexdef);
    expect(def).toContain("(symbol, landed_at)");
    expect(def).toContain("state <> 'failed'");
  });

  test("one transaction writes an evacuate row per mint, still once per (signature, kind, mint)", async () => {
    await rolledBack(async (tx) => {
      const [a, b] = [await seedCoin(tx), await seedCoin(tx)];
      const signature = randomBytes(32).toString("hex");
      const put = (over: Partial<typeof feeLedger.$inferInsert>) =>
        attempt(tx, (t) =>
          t
            .insert(feeLedger)
            .values({ kind: "evacuate", mint: a, state: "landed", landedAt: new Date(), signature, ...over })
            .execute(),
        );
      expect(await put({})).toBeUndefined();
      expect(await put({ mint: b })).toBeUndefined();
      expect(await put({})).toBe("23505");
      expect(await put({ kind: "leftover_burn" })).toBeUndefined();
      expect(await put({ kind: "bogus", signature: "other" })).toBe("23514");
    });
  });
});
