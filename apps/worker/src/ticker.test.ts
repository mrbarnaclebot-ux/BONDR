import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { close, coins, db, launches, vanityMints, wallets } from "@bondr/core/db";
import { checkSymbol } from "@bondr/core/rules";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import type { Exec } from "./launches.ts";
import { tickerLock, tickerRefusal } from "./ticker.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) console.log("ticker.test.ts: skipped, DATABASE_URL is not set");

type Tx = Exec & Pick<ReturnType<typeof db>, "execute">;
const hex = (n: number) => randomBytes(n).toString("hex");
// A fresh ticker per case, so real dev-branch rows never collide with the matrix.
const ticker = () => `T${hex(5).toUpperCase()}`;

// Every case runs in a transaction that is always rolled back: the dev branch keeps no test row.
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

type Row = { wallet?: string; created?: string; landed?: string; hidden?: boolean };
async function launch(tx: Tx, symbol: string, state: string, o: Row = {}): Promise<void> {
  const mint = `test-${hex(8)}`;
  const wallet = o.wallet ?? mint;
  await tx
    .insert(wallets)
    .values({ address: wallet, consentedAt: new Date(), termsVersion: "test" })
    .onConflictDoNothing();
  await tx.insert(vanityMints).values({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey: mint });
  const ago = (i: string) => sql`now() - ${i}::interval`;
  const id = hex(16);
  await tx.insert(launches).values({
    ...{
      id,
      wallet,
      mint,
      w: mint,
      state,
      name: "Test",
      symbol,
      uri: "ipfs://test",
      solIn: 1n,
      exit: "burn",
    },
    ...(o.created ? { createdAt: ago(o.created) } : {}),
    ...(o.landed ? { landedAt: ago(o.landed) } : {}),
  });
  if (!o.hidden) return;
  await tx.insert(coins).values({
    ...{ mint, launchId: id, launchedAt: new Date(), bondingCurve: "curve", pool: "pool" },
    ...{ initialRealTokenReserves: "1", realTokenReserves: "1", realQuoteReserves: "0" },
    ...{ virtualTokenReserves: "1", virtualQuoteReserves: "1", mcapSol: 1, launchMcapSol: 1 },
    ...{ hiddenAt: new Date(), hiddenReason: "test" },
  });
}

const refusal = async (tx: Tx, symbol: string, wallet = "test-asker") =>
  tickerRefusal(await tickerLock(tx, symbol, wallet), new Date());

describe.skipIf(!process.env.DATABASE_URL)("ticker cooldown (D-42 matrix)", { timeout: 60_000 }, () => {
  afterAll(() => close(), 30_000);

  test("a landing holds 24h from landed_at; older, failed and expired rows free the ticker", async () => {
    await rolledBack(async (tx) => {
      const fresh = ticker();
      await launch(tx, fresh, "landed", { landed: "1 hour" });
      const r = await refusal(tx, fresh);
      expect(r).toMatchObject({ error: "ticker_locked", lock: "landed" });
      expect(Math.abs((r?.retryAfter ?? 0) - 82_800)).toBeLessThanOrEqual(60);

      const old = ticker();
      await launch(tx, old, "landed", { landed: "25 hours" });
      expect(await refusal(tx, old)).toBe(null);
      const failed = ticker();
      await launch(tx, failed, "failed");
      expect(await refusal(tx, failed)).toBe(null);
      // Expired = a prepared row past its 3-minute life (never signed).
      const expired = ticker();
      await launch(tx, expired, "prepared", { created: "4 minutes" });
      expect(await refusal(tx, expired)).toBe(null);
    });
  });

  test("signed, sent and unknown rows hold with a pending lock; a stale one still holds at retryAfter 0", async () => {
    await rolledBack(async (tx) => {
      for (const state of ["signed", "sent", "unknown"]) {
        const t = ticker();
        await launch(tx, t, state);
        expect(await refusal(tx, t)).toMatchObject({ error: "ticker_locked", lock: "pending" });
      }
      const stale = ticker();
      await launch(tx, stale, "unknown", { created: "10 minutes" });
      expect(await refusal(tx, stale)).toEqual({ error: "ticker_locked", retryAfter: 0, lock: "pending" });
    });
  });

  test("another wallet's fresh prepared row holds; the asker's own and a 4-minute-old one do not", async () => {
    await rolledBack(async (tx) => {
      const other = ticker();
      await launch(tx, other, "prepared", { created: "1 minute" });
      const r = await refusal(tx, other);
      expect(r).toMatchObject({ error: "ticker_locked", lock: "pending" });
      expect(r?.retryAfter).toBeGreaterThan(60);
      expect(r?.retryAfter).toBeLessThanOrEqual(120);

      const mine = ticker();
      await launch(tx, mine, "prepared", { wallet: "test-asker", created: "1 minute" });
      expect(await refusal(tx, mine, "test-asker")).toBe(null);
      const stale = ticker();
      await launch(tx, stale, "prepared", { created: "4 minutes" });
      expect(await refusal(tx, stale)).toBe(null);
    });
  });

  test("a hidden coin keeps its lock and the key is checkSymbol's normalized value", async () => {
    await rolledBack(async (tx) => {
      const hidden = ticker();
      await launch(tx, hidden, "landed", { landed: "2 hours", hidden: true });
      expect(await refusal(tx, hidden)).toMatchObject({ error: "ticker_locked", lock: "landed" });

      const stored = ticker();
      await launch(tx, stored, "landed", { landed: "1 hour" });
      const typed = checkSymbol(` ${stored.toLowerCase()}`);
      expect(typed.ok && (await refusal(tx, typed.value))).toMatchObject({ error: "ticker_locked" });
    });
  });

  test("the partial index from 0008 exists", async () => {
    const r = await db().execute(sql`select 1 from pg_indexes where indexname = 'launches_symbol_live'`);
    expect(r.length).toBe(1);
  });
});
