// writeParsed against the Neon dev branch, inside a transaction that is rolled back; skips without DATABASE_URL.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { close, coins, db, launches, trades, vanityMints, wallets } from "@bondr/core/db";
import { type KnownCoin, parseTx, type TradeTx } from "@bondr/core/trades";
import { and, eq, TransactionRollbackError } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { bondrPrice } from "./bondr-price.ts";
import { writeParsed } from "./ingest.ts";
import type { Exec } from "./launches.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const fixture = (name: string): TradeTx =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/core/src/fixtures/${name}.json`, import.meta.url), "utf8"),
  ).response;
const DEV = "F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr"; // the launch-burn and curve-buy fixtures' coin
const BONDR = { mint: "4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA", pool: "unused" };

test("the BONDR price is null until set, then the set value", () => {
  expect(bondrPrice.get()).toBeNull();
  bondrPrice.set(3e-7);
  expect(bondrPrice.get()).toBe(3e-7);
});

// The landed launch of DEV on this branch, or a test one (negative idx never collides with the grinder).
async function launchOf(tx: Exec): Promise<string> {
  const [row] = await tx
    .select({ id: launches.id })
    .from(launches)
    .where(and(eq(launches.mint, DEV), eq(launches.state, "landed")));
  if (row) return row.id;
  const [id, wallet] = [randomBytes(16).toString("hex"), `test-${randomBytes(8).toString("hex")}`];
  await tx.insert(wallets).values({ address: wallet, consentedAt: new Date(), termsVersion: "test" });
  const idx = -BigInt(randomInt(1, 2 ** 47));
  await tx.insert(vanityMints).values({ idx, pubkey: DEV }).onConflictDoNothing();
  const rest = { name: "T", symbol: "T", uri: "ipfs://t", solIn: 1n, exit: "burn" };
  await tx.insert(launches).values({ id, wallet, mint: DEV, w: wallet, state: "landed", ...rest });
  return id;
}

const coinOf = async (tx: Exec) => (await tx.select().from(coins).where(eq(coins.mint, DEV)))[0];

describe.skipIf(!process.env.DATABASE_URL)("ingest", { timeout: 60_000 }, () => {
  afterAll(() => close());

  test("a launch and a trade are written once, and a replay changes nothing", async () => {
    try {
      await db().transaction(async (tx) => {
        await tx.delete(trades).where(eq(trades.mint, DEV));
        await tx.delete(coins).where(eq(coins.mint, DEV));
        const launch = { id: await launchOf(tx), pool: "pool" };
        const bondr = { ...BONDR, sol: null };
        const parsed = parseTx(fixture("launch-burn"), new Map(), bondr, { mint: DEV, exit: "burn" });
        expect(await writeParsed(tx, parsed, launch)).toHaveLength(2);
        expect(await writeParsed(tx, parsed, launch)).toHaveLength(0);
        expect(await tx.$count(coins, eq(coins.mint, DEV))).toBe(1);

        const init = parsed.created?.initialRealTokenReserves ?? "";
        const known: KnownCoin = {
          mint: DEV,
          bondingCurve: "c",
          pool: "pool",
          initialRealTokenReserves: init,
        };
        const buy = parseTx(fixture("curve-buy"), new Map([[DEV, known]]), { ...BONDR, sol: 3e-7 });
        expect(await writeParsed(tx, buy)).toHaveLength(1);
        const [patch, trade] = [buy.patches[0], buy.trades[0]];
        expect(await coinOf(tx)).toMatchObject({
          mcapSol: patch?.mcapSol,
          progress: patch?.progress,
          lastSig: trade?.signature,
          lastTradeAt: new Date(trade?.at ?? 0),
        });

        await tx.update(coins).set({ mcapSol: 1 }).where(eq(coins.mint, DEV));
        expect(await writeParsed(tx, buy)).toHaveLength(0);
        expect((await coinOf(tx))?.mcapSol).toBe(1);
        tx.rollback();
      });
    } catch (e) {
      if (!(e instanceof TransactionRollbackError)) throw e;
    }
  });

  // A gap fill can write an older trade after a newer one: its row lands, the coin keeps the newer state.
  test("an older trade inserts its row but does not roll the coin back", async () => {
    try {
      await db().transaction(async (tx) => {
        await tx.delete(trades).where(eq(trades.mint, DEV));
        await tx.delete(coins).where(eq(coins.mint, DEV));
        const bondr = { ...BONDR, sol: 3e-7 };
        const launch = parseTx(fixture("launch-burn"), new Map(), bondr, { mint: DEV, exit: "burn" });
        await writeParsed(tx, launch, { id: await launchOf(tx), pool: "pool" });
        const init = launch.created?.initialRealTokenReserves ?? "";
        const known = new Map([
          [DEV, { mint: DEV, bondingCurve: "c", pool: "pool", initialRealTokenReserves: init }],
        ]);
        const newer = parseTx(fixture("curve-sell"), known, bondr);
        const older = parseTx(fixture("curve-buy"), known, bondr);
        await writeParsed(tx, newer);
        expect(await writeParsed(tx, older)).toHaveLength(1);
        expect(await coinOf(tx)).toMatchObject({
          mcapSol: newer.patches[0]?.mcapSol,
          realTokenReserves: newer.patches[0]?.realTokenReserves,
          lastSig: newer.trades[0]?.signature,
          lastSlot: newer.trades[0]?.slot,
        });
        tx.rollback();
      });
    } catch (e) {
      if (!(e instanceof TransactionRollbackError)) throw e;
    }
  });
});
