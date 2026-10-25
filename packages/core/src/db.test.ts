import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { close, coins, db, feeLedger, launches, settings, trades, vanityMints, wallets } from "./db.ts";

// Vitest does not read .env; load it so a local run hits the Neon dev branch. CI has no .env and skips.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const wallet = `test-${randomBytes(8).toString("hex")}`;
const mint = `test-${randomBytes(8).toString("hex")}`;
const other = `test-${randomBytes(8).toString("hex")}`;
const feeMint = `test-${randomBytes(8).toString("hex")}`;
const mints = [mint, other, feeMint];

function launch(over: Partial<typeof launches.$inferInsert> = {}): typeof launches.$inferInsert {
  return {
    id: randomBytes(16).toString("hex"),
    wallet,
    mint,
    w: wallet,
    state: "prepared",
    name: "Test",
    symbol: "TEST",
    uri: "ipfs://test",
    solIn: 1n,
    exit: "burn",
    ...over,
  };
}

// Postgres SQLSTATE of a failed insert (drizzle wraps the driver error in cause).
async function pgCode(insert: Promise<unknown>): Promise<string | undefined> {
  try {
    await insert;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}

const coinOf = (
  launchId: string,
  over: Partial<typeof coins.$inferInsert> = {},
): typeof coins.$inferInsert => ({
  mint: other,
  launchId,
  launchedAt: new Date(),
  bondingCurve: "curve",
  pool: "pool",
  initialRealTokenReserves: "793100000000000",
  realTokenReserves: "793100000000000",
  realQuoteReserves: "0",
  virtualTokenReserves: "1073000000000000",
  virtualQuoteReserves: "30000000000",
  mcapSol: 1,
  launchMcapSol: 1,
  ...over,
});
const sig = randomBytes(16).toString("hex");
const tradeOf = (over: Partial<typeof trades.$inferInsert> = {}): typeof trades.$inferInsert => ({
  signature: sig,
  ix: 0,
  mint: other,
  slot: "1",
  at: new Date(),
  side: "buy",
  venue: "curve",
  trader: "t",
  tokenAmount: "1",
  quoteAmount: "1",
  sol: "1",
  ...over,
});

const insert = (row: typeof launches.$inferInsert) => db().insert(launches).values(row).execute();

// 30 s: the first query may wake a suspended Neon compute.
describe.skipIf(!process.env.DATABASE_URL)("database constraints", { timeout: 30_000 }, () => {
  afterAll(async () => {
    await db().delete(feeLedger).where(inArray(feeLedger.mint, mints));
    await db().delete(trades).where(inArray(trades.mint, mints));
    await db().delete(coins).where(inArray(coins.mint, mints));
    await db().delete(launches).where(eq(launches.wallet, wallet));
    await db().delete(vanityMints).where(inArray(vanityMints.pubkey, mints));
    await db().delete(wallets).where(eq(wallets.address, wallet));
    await close();
  }, 30_000);

  beforeAll(async () => {
    await db().insert(wallets).values({ address: wallet, consentedAt: new Date(), termsVersion: "test" });
    // Negative idx never collides with a grinder index.
    await db()
      .insert(vanityMints)
      .values(mints.map((pubkey) => ({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey })));
  }, 30_000);

  test("an unknown state or exit is refused", async () => {
    expect(await pgCode(insert(launch({ state: "pending" })))).toBe("23514");
    expect(await pgCode(insert(launch({ exit: "lock" })))).toBe("23514");
  });

  test("a second landed launch for one mint is refused, prepared rows are not", async () => {
    expect(await pgCode(insert(launch()))).toBeUndefined();
    expect(await pgCode(insert(launch()))).toBeUndefined();
    expect(await pgCode(insert(launch({ state: "landed" })))).toBeUndefined();
    expect(await pgCode(insert(launch({ state: "landed" })))).toBe("23505");
  });

  test("a second in-flight launch for one mint is refused, a failed one is not (IN-06)", async () => {
    expect(await pgCode(insert(launch({ mint: other, state: "failed" })))).toBeUndefined();
    expect(await pgCode(insert(launch({ mint: other, state: "signed" })))).toBeUndefined();
    expect(await pgCode(insert(launch({ mint: other, state: "sent" })))).toBe("23505");
  });

  test("settings has the one seeded row and refuses a second", async () => {
    const rows = await db().select().from(settings).where(eq(settings.id, 1));
    expect(rows).toEqual([{ id: 1, launchesEnabled: true }]);
    expect(await pgCode(db().insert(settings).values({ id: 2 }).execute())).toBe("23514");
  });
  test("coins refuses an unknown venue and a venue that disagrees with bonded_at", async () => {
    const l = launch({ mint: other, state: "failed" });
    await insert(l);
    const coin = (over: Partial<typeof coins.$inferInsert>) =>
      db().insert(coins).values(coinOf(l.id, over)).execute();
    expect(await pgCode(coin({ venue: "other" }))).toBe("23514");
    expect(await pgCode(coin({ venue: "curve", bondedAt: new Date() }))).toBe("23514");
    expect(await pgCode(coin({ venue: "pool" }))).toBe("23514");
    expect(await pgCode(coin({ progress: 1.5 }))).toBe("23514");
    expect(await pgCode(coin({}))).toBeUndefined();
  });

  test("trades enforce side and sol, a coin, and one row per (signature, ix)", async () => {
    const trade = (over: Partial<typeof trades.$inferInsert>) =>
      db().insert(trades).values(tradeOf(over)).onConflictDoNothing().returning();
    expect(await pgCode(trade({ side: "burn" }))).toBe("23514");
    expect(await pgCode(trade({ sol: null }))).toBe("23514");
    expect(await pgCode(trade({ mint }))).toBe("23503");
    expect(await trade({})).toHaveLength(1);
    expect(await trade({})).toHaveLength(0);
    expect(await db().$count(trades, eq(trades.signature, sig))).toBe(1);
  });

  // The D-08 guards: a second live intent fails in Postgres before anything is signed or sent.
  describe("fee ledger", () => {
    type Row = Partial<typeof feeLedger.$inferInsert>;
    const row = (over: Row): typeof feeLedger.$inferInsert => ({
      kind: "collect",
      mint: feeMint,
      state: "pending",
      signature: randomBytes(32).toString("hex"),
      ...over,
      ...(over.state === "landed" ? { landedAt: new Date() } : {}),
    });
    const put = (over: Row) => pgCode(db().insert(feeLedger).values(row(over)).execute());
    const clear = () => db().delete(feeLedger).where(eq(feeLedger.mint, feeMint));

    beforeAll(async () => {
      const l = launch({ mint: feeMint, state: "landed", signature: randomBytes(32).toString("hex") });
      await insert(l);
      await db()
        .insert(coins)
        .values(coinOf(l.id, { mint: feeMint }))
        .execute();
    }, 30_000);

    test("a once-only kind takes one live intent per mint", async () => {
      await clear();
      expect(await put({ kind: "forced_bond" })).toBeUndefined();
      expect(await put({ kind: "forced_bond" })).toBe("23505");
      expect(await put({ kind: "finalize_config" })).toBeUndefined();
      expect(await put({ kind: "finalize_config", state: "landed" })).toBe("23505");
    });

    test("a forced bond and a pool burn never both run on one mint", async () => {
      await clear();
      expect(await put({ kind: "forced_bond", state: "landed" })).toBeUndefined();
      expect(await put({ kind: "pool_burn" })).toBe("23505");
    });

    test("one sweep per kind and window, and a failed intent frees the slot", async () => {
      await clear();
      expect(await put({ kind: "sweep_buyback", windowIndex: 3 })).toBeUndefined();
      expect(await put({ kind: "sweep_buyback", windowIndex: 3 })).toBe("23505");
      expect(await put({ kind: "sweep_treasury", windowIndex: 3 })).toBeUndefined();
      expect(await put({ kind: "sweep_buyback", windowIndex: 4 })).toBeUndefined();
    });

    test("one split per collect, after a failed one", async () => {
      await clear();
      expect(await put({ kind: "split_treasury", ref: 1, state: "failed" })).toBeUndefined();
      expect(await put({ kind: "split_treasury", ref: 1 })).toBeUndefined();
      expect(await put({ kind: "split_treasury", ref: 1 })).toBe("23505");
    });

    test("row shape checks refuse bad kinds, states and links", async () => {
      await clear();
      expect(await put({ kind: "bogus" })).toBe("23514");
      expect(await put({ kind: "buyback_burn" })).toBe("23514"); // has a mint
      expect(await put({ kind: "held", state: null })).toBe("23514"); // has a signature
      expect(await put({ kind: "held", state: null, signature: null })).toBeUndefined();
      expect(await put({ kind: "sweep_buyback" })).toBe("23514"); // no window
      expect(await put({ kind: "split_treasury" })).toBe("23514"); // no ref
      expect(await put({ state: "landed", landedAt: undefined })).toBeUndefined();
      expect(await put({ state: "sent" })).toBe("23514");
    });

    test("coins refuses an unknown finalize state and a negative total", async () => {
      const set = (v: Partial<typeof coins.$inferInsert>) =>
        pgCode(db().update(coins).set(v).where(eq(coins.mint, feeMint)).execute());
      expect(await set({ finalize: "x" })).toBe("23514");
      expect(await set({ toBuyback: "-1" })).toBe("23514");
      expect(await set({ finalize: "held" })).toBeUndefined();
    });
  });
});
