// The feed's keyset pages against the Neon dev branch (seeded coin, removed after); CI has no .env and skips.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { dropCoin, type Seeded, seedCoin } from "../e2e/fixtures.ts";
import { close } from "./db";
import { parseCursor, tradesPage } from "./trades";

vi.mock("server-only", () => ({}));

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

test("parseCursor takes slot.seq and nothing else", () => {
  expect(parseCursor("123.45")).toEqual({ slot: 123n, seq: 45n });
  for (const bad of ["x", "1.", "-1.2", "1e3.2", `${"9".repeat(30)}.1`, "9223372036854775808.1"])
    expect(parseCursor(bad)).toBeNull();
});

// 60 s: the first query may wake a suspended Neon compute, and the seed is 60 inserts.
describe.skipIf(!process.env.DATABASE_URL)("tradesPage", { timeout: 60_000 }, () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
  let coin: Seeded;
  beforeAll(async () => {
    coin = await seedCoin(sql, { trades: 60, exit: "sell" });
  }, 60_000);
  afterAll(async () => {
    if (coin) await dropCoin(sql, coin.mint);
    await sql.end();
    await close();
  }, 30_000);

  test("pages run newest first with no overlap and no gap, down to both launch rows", async () => {
    const first = await tradesPage(coin.mint);
    expect(first.trades).toHaveLength(50);
    expect(first.more).toBe(true);
    expect(first.trades[0].signature).toBe(coin.sigs.at(-1));
    const last = first.trades[49];
    const second = await tradesPage(coin.mint, { slot: BigInt(last.slot), seq: BigInt(last.seq) });
    expect(second.more).toBe(false);
    const all = [...first.trades, ...second.trades];
    expect(all.map((t) => t.signature).reverse()).toEqual(coin.sigs);
    expect(all.slice(-2).map((t) => [t.side, t.launch])).toEqual([
      ["sell", true],
      ["buy", true],
    ]);
    expect(typeof all[0].tokenAmount).toBe("string");
    expect(typeof all[0].sol).toBe("string");
    expect(all[0].at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });
});
