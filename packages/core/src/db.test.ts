import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { close, db, launches, settings, vanityMints, wallets } from "./db.ts";

// Vitest does not read .env; load it so a local run hits the Neon dev branch. CI has no .env and skips.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const wallet = `test-${randomBytes(8).toString("hex")}`;
const mint = `test-${randomBytes(8).toString("hex")}`;

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

const insert = (row: typeof launches.$inferInsert) => db().insert(launches).values(row).execute();

describe.skipIf(!process.env.DATABASE_URL)("database constraints", () => {
  afterAll(async () => {
    await db().delete(launches).where(eq(launches.wallet, wallet));
    await db().delete(vanityMints).where(eq(vanityMints.pubkey, mint));
    await db().delete(wallets).where(eq(wallets.address, wallet));
    await close();
  });

  test("seed rows for the foreign keys", async () => {
    await db().insert(wallets).values({ address: wallet, consentedAt: new Date(), termsVersion: "test" });
    // Negative idx never collides with a grinder index.
    await db()
      .insert(vanityMints)
      .values({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey: mint });
  });

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

  test("settings has the one seeded row and refuses a second", async () => {
    const rows = await db().select().from(settings).where(eq(settings.id, 1));
    expect(rows).toEqual([{ id: 1, launchesEnabled: true }]);
    expect(await pgCode(db().insert(settings).values({ id: 2 }).execute())).toBe("23514");
  });
});
