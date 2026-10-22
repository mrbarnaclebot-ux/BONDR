import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { close, db, launches, vanityMints, wallets } from "@bondr/core/db";
import bs58 from "bs58";
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import {
  ALPHABET,
  BNDR,
  type Exec,
  isBndr,
  markUsed,
  mintKey,
  mintKeyFor,
  mintPub,
  poolSize,
  release,
  reserve,
  tail4,
} from "./vanity.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
// Ground once for this test seed (about 6 min on 10 threads), so the hit path is checked on a real bndr key.
const HIT = { idx: 16_724_129n, pubkey: "7fGRx4dcwSK9CdFbjgJDhqK92ujdsSXLmVBqMvTybndr" };
const b58 = (s: string) => [...s].reduce((a, c) => a * 58 + ALPHABET.indexOf(c), 0);

test("BNDR is the base58 value of bndr", () => {
  expect(BNDR).toBe(6_787_325);
  expect(BNDR).toBe(b58("bndr"));
});

test("the fast path matches derive and the base58 tail for 2,000 indexes", () => {
  for (let i = 0n; i < 2000n; i++) {
    const want = mintKey(seed, "devnet", "local", i).publicKey.toBase58();
    const pub = mintPub(seed, "devnet", "local", i);
    expect(bs58.encode(pub)).toBe(want);
    expect(tail4(pub)).toBe(b58(want.slice(-4)));
    expect(isBndr(seed, "devnet", "local", i)).toBe(want.endsWith("bndr") ? want : null);
  }
});

test("a known hit is found and its lane twin is not", () => {
  expect(isBndr(seed, "devnet", "local", HIT.idx)).toBe(HIT.pubkey);
  expect(mintKey(seed, "devnet", "local", HIT.idx).publicKey.toBase58()).toBe(HIT.pubkey);
  expect(isBndr(seed, "devnet", "staging", HIT.idx)).toBe(null);
});

test("mintKeyFor refuses a row from another lane or seed", () => {
  expect(mintKeyFor(HIT, seed, "devnet", "local").publicKey.toBase58()).toBe(HIT.pubkey);
  expect(() => mintKeyFor(HIT, seed, "devnet", "staging")).toThrow("does not match");
  expect(() => mintKeyFor(HIT, Buffer.alloc(32, 9), "devnet", "local")).toThrow("does not match");
});

// Everything runs in one transaction that is rolled back, so the dev pool is untouched. The table lock makes
// db.test.ts (run in parallel) wait with its pool row, so the poolSize counts here cannot shift. A test that
// counts nothing skips it, so db.test.ts does not wait out its timeout behind both.
type Tx = Exec & Pick<ReturnType<typeof db>, "insert" | "execute">;
async function rolledBack(fn: (tx: Tx) => Promise<void>, lock = true) {
  try {
    await db().transaction(async (tx) => {
      if (lock) await tx.execute(sql`lock table vanity_mints in exclusive mode`);
      await fn(tx);
      tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }
}

const pastDue = (tx: Exec, idx: bigint) =>
  tx
    .update(vanityMints)
    .set({ reservedUntil: new Date(Date.now() - 60_000) })
    .where(eq(vanityMints.idx, idx));

describe.skipIf(!process.env.DATABASE_URL)("reservation", { timeout: 30_000 }, () => {
  afterAll(() => close(), 30_000);

  test("is per wallet, skips used and in-flight mints, reuses expired ones, releases safely", async () => {
    await rolledBack(async (tx) => {
      // Far below any grinder index, so these rows are picked first.
      const base = -(2n ** 62n);
      const rows = [0n, 1n, 2n].map((k) => ({
        idx: base + k,
        pubkey: `test-${randomBytes(8).toString("hex")}`,
      }));
      await tx.insert(vanityMints).values(rows);
      const [w1, w2, w3, w4, w5] = [1, 2, 3, 4, 5].map((k) => `test-w${k}-${randomBytes(4).toString("hex")}`);
      const before = await poolSize(tx);

      expect(await reserve(tx, w1)).toEqual(rows[0]);
      expect(await reserve(tx, w1)).toEqual(rows[0]);
      expect(await poolSize(tx)).toBe(before - 1);
      expect(await reserve(tx, w2)).toEqual(rows[1]);

      // Used: never returned again, even once its window has passed.
      await markUsed(tx, rows[0].pubkey);
      await pastDue(tx, rows[0].idx);
      expect(await reserve(tx, w3)).toEqual(rows[2]);
      expect((await reserve(tx, w1))?.idx).not.toBe(rows[0].idx);

      // Expired and only prepared: the next wallet gets it.
      await pastDue(tx, rows[1].idx);
      expect(await reserve(tx, w4)).toEqual(rows[1]);

      // Expired but its launch was sent: it may still land, so it is skipped.
      await tx.insert(wallets).values({ address: w4, consentedAt: new Date(), termsVersion: "test" });
      await tx.insert(launches).values({
        ...{ id: randomBytes(8).toString("hex"), wallet: w4, mint: rows[1].pubkey, w: w4, state: "sent" },
        ...{ name: "T", symbol: "T", uri: "ipfs://t", solIn: 1n, exit: "burn" },
      });
      await pastDue(tx, rows[1].idx);
      expect((await reserve(tx, w5))?.idx).not.toBe(rows[1].idx);

      for (const state of ["signed", "sent", "unknown", "landed"])
        await expect(release(tx, rows[2].idx, state)).rejects.toThrow("refusing to release");
      await release(tx, rows[2].idx, "prepared");
      const [after] = await tx.select().from(vanityMints).where(eq(vanityMints.idx, rows[2].idx));
      expect(after?.reservedBy).toBe(null);
    });
  });

  test("a repeat prepare renews the hold, and a fresh prepared tx keeps a released mint out (WR-03)", async () => {
    await rolledBack(async (tx) => {
      const base = -(2n ** 62n);
      const rows = [0n, 1n].map((k) => ({ idx: base + k, pubkey: `test-${randomBytes(8).toString("hex")}` }));
      await tx.insert(vanityMints).values(rows);
      const [w1, w2] = [1, 2].map((k) => `test-w${k}-${randomBytes(4).toString("hex")}`);
      expect(await reserve(tx, w1)).toEqual(rows[0]);
      const soon = new Date(Date.now() + 30_000);
      await tx.update(vanityMints).set({ reservedUntil: soon }).where(eq(vanityMints.idx, rows[0].idx));
      expect(await reserve(tx, w1)).toEqual(rows[0]);
      const [held] = await tx.select().from(vanityMints).where(eq(vanityMints.idx, rows[0].idx));
      expect(held?.reservedUntil?.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);

      // Released by an earlier row's refusal while a newer prepared tx of it can still be signed.
      await tx.insert(wallets).values({ address: w1, consentedAt: new Date(), termsVersion: "test" });
      await tx.insert(launches).values({
        ...{ id: randomBytes(8).toString("hex"), wallet: w1, mint: rows[0].pubkey, w: w1, state: "prepared" },
        ...{ name: "T", symbol: "T", uri: "ipfs://t", solIn: 1n, exit: "burn" },
      });
      await release(tx, rows[0].idx, "failed");
      expect(await reserve(tx, w2)).toEqual(rows[1]);
    }, false);
  });
});
