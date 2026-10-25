// LedgerStore rules (D-08, D-23). The memory store runs everywhere; the Postgres one runs against the Neon dev
// branch inside a transaction that is rolled back, and skips without DATABASE_URL.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { close, coins, db, launches, vanityMints, wallets } from "@bondr/core/db";
import { eq, TransactionRollbackError } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { type LedgerStore, memoryLedger, pgLedger } from "./fee-ledger.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const M = "mintA";

describe("memoryLedger", () => {
  test("a second live forced_bond is refused, and allowed again once the first failed", async () => {
    const l = memoryLedger();
    expect(await l.insertPending([{ kind: "forced_bond", mint: M }], "s1", 10n)).toHaveLength(1);
    expect(await l.insertPending([{ kind: "forced_bond", mint: M }], "s2", 10n)).toBeNull();
    await l.settle("s1", "failed", { error: "boom" });
    expect(await l.insertPending([{ kind: "forced_bond", mint: M }], "s3", 10n)).toHaveLength(1);
  });

  test("forced_bond then pool_burn on one mint is refused", async () => {
    const l = memoryLedger();
    await l.insertPending([{ kind: "forced_bond", mint: M }], "s1", 10n);
    expect(await l.insertPending([{ kind: "pool_burn", mint: M }], "s2", 10n)).toBeNull();
  });

  test("a window sweeps once and a collect splits once", async () => {
    const l = memoryLedger();
    const sweep = { kind: "sweep_buyback", mint: M, windowIndex: 3 } as const;
    expect(await l.insertPending([sweep], "s1", 10n)).not.toBeNull();
    expect(await l.insertPending([sweep], "s2", 10n)).toBeNull();
    const split = { kind: "split_treasury", mint: M, ref: 7, amount: 1n } as const;
    expect(await l.insertPending([split], "s3", 10n)).not.toBeNull();
    expect(await l.insertPending([split], "s4", 10n)).toBeNull();
  });

  test("two rows on one signature insert together, or neither does", async () => {
    const l = memoryLedger();
    const pair = [
      { kind: "sweep_buyback", mint: M, windowIndex: 1 },
      { kind: "sweep_treasury", mint: M, windowIndex: 1 },
    ] as const;
    expect(await l.insertPending([...pair], "s1", 10n)).toHaveLength(2);
    const clash = [{ kind: "sweep_buyback", mint: M, windowIndex: 2 }, pair[1]] as const;
    expect(await l.insertPending([...clash], "s2", 10n)).toBeNull();
    expect((await l.pending()).map((e) => e.signature)).toEqual(["s1", "s1"]);
  });

  test("settle landed applies the kind's facts, and openCollects lists collects without a split", async () => {
    const l = memoryLedger();
    const [c] = (await l.insertPending([{ kind: "collect", mint: M }], "s1", 10n)) ?? [];
    const [landed] = await l.settle("s1", "landed", { facts: { collect: { amount: 1000n } } });
    expect(landed).toMatchObject({ id: c?.id, state: "landed", amount: 1000n });
    expect(landed?.landedAt).toBeInstanceOf(Date);
    expect(await l.settle("s1", "failed")).toEqual([]); // only pending rows move
    expect((await l.openCollects()).map((e) => e.id)).toEqual([c?.id]);
    await l.insertPending([{ kind: "split_treasury", mint: M, ref: c?.id, amount: 100n }], "s2", 10n);
    expect(await l.openCollects()).toEqual([]);
    await l.settle("s2", "expired");
    expect((await l.openCollects()).map((e) => e.id)).toEqual([c?.id]);
  });

  test("has sees live rows of the kinds; hold and diff write internal rows", async () => {
    const l = memoryLedger();
    await l.insertPending([{ kind: "pool_burn", mint: M }], "s1", 10n);
    expect(await l.has(M, ["forced_bond", "pool_burn"])).toBe(true);
    expect(await l.has("other", ["forced_bond", "pool_burn"])).toBe(false);
    await l.hold(M, "deployer is off curve");
    await l.diff(M, { account: "w", diff: "5" });
    expect(await l.pending()).toHaveLength(1); // held and reconcile_diff have no state
  });
});

const DB = !!process.env.DATABASE_URL;

async function seed(tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0], mint: string) {
  const [id, wallet] = [randomBytes(16).toString("hex"), `test-${randomBytes(8).toString("hex")}`];
  await tx.insert(wallets).values({ address: wallet, consentedAt: new Date(), termsVersion: "test" });
  await tx.insert(vanityMints).values({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey: mint });
  const rest = { name: "T", symbol: "T", uri: "ipfs://t", solIn: 1n, exit: "burn" };
  await tx.insert(launches).values({ id, wallet, mint, w: wallet, state: "landed", ...rest });
  await tx.insert(coins).values({
    ...{ mint, launchId: id, launchedAt: new Date(), bondingCurve: "c", pool: "p" },
    ...{ initialRealTokenReserves: "1", realTokenReserves: "1", realQuoteReserves: "0" },
    ...{ virtualTokenReserves: "1", virtualQuoteReserves: "1", mcapSol: 1, launchMcapSol: 1 },
    ...{ lastSlot: "100", feesUnclaimed: "500" },
  });
}

// Runs fn in a transaction that always rolls back, so nothing seeded survives the test.
async function rolledBack(
  fn: (l: LedgerStore, read: () => Promise<typeof coins.$inferSelect>) => Promise<void>,
) {
  const mint = `test-${randomBytes(8).toString("hex")}`;
  try {
    await db().transaction(async (tx) => {
      await seed(tx, mint);
      const read = async () => (await tx.select().from(coins).where(eq(coins.mint, mint)))[0];
      await fn(
        pgLedger(() => tx as never),
        read,
      );
      tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }
}

describe.skipIf(!DB)("pgLedger", { timeout: 60_000 }, () => {
  afterAll(() => close());

  test("a landed collect then split move the coin totals in the same transaction", async () => {
    await rolledBack(async (l, read) => {
      const mint = (await read()).mint;
      const [c] = (await l.insertPending([{ kind: "collect", mint }], `a${mint}`, 10n)) ?? [];
      expect(c?.state).toBe("pending");
      await l.settle(`a${mint}`, "landed", { facts: { collect: { amount: 1000n } }, slot: 100n });
      expect((await l.openCollects()).some((e) => e.id === c?.id)).toBe(true);
      const split = { kind: "split_treasury", mint, ref: c?.id, amount: 100n } as const;
      expect(await l.insertPending([split], `b${mint}`, 10n)).toHaveLength(1);
      expect(await l.insertPending([split], `c${mint}`, 10n)).toBeNull(); // 23505, not thrown
      const [s] = await l.settle(`b${mint}`, "landed", { slot: 101n });
      expect(s).toMatchObject({ state: "landed", amount: 100n, ref: c?.id });
      const coin = await read();
      expect([coin.feeBudget, coin.toTreasury, coin.feesUnclaimed]).toEqual(["900", "100", "0"]);
    });
  });

  test("a second pending forced_bond returns null; hold, release and markFinal move finalize", async () => {
    await rolledBack(async (l, read) => {
      const mint = (await read()).mint;
      expect(await l.insertPending([{ kind: "forced_bond", mint }], `f${mint}`, 10n)).toHaveLength(1);
      expect(await l.insertPending([{ kind: "forced_bond", mint }], `g${mint}`, 10n)).toBeNull();
      expect(await l.has(mint, ["forced_bond"])).toBe(true);
      await l.hold(mint, "deployer is not the launch wallet");
      expect((await read()).finalize).toBe("held");
      await l.release(mint);
      expect((await read()).finalize).toBe("none");
      expect(await l.has(mint, ["held"])).toBe(false); // held rows are history, never live
      await l.markFinal(mint, 8000);
      expect([(await read()).finalize, (await read()).deployerBps]).toEqual(["done", 8000]);
    });
  });
});
