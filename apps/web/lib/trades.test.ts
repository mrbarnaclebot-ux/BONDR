// The feed's keyset pages against the Neon dev branch (seeded coin, removed after); CI has no .env and skips.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { dropCoin, fakeSig, type Seeded, seedCoin } from "../e2e/fixtures.ts";
import { close } from "./db";
import { candles, parseCursor, parseInterval, tradesPage } from "./trades";

vi.mock("server-only", () => ({}));

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

test("parseCursor takes slot.seq and nothing else", () => {
  expect(parseCursor("123.45")).toEqual({ slot: 123n, seq: 45n });
  for (const bad of ["x", "1.", "-1.2", "1e3.2", `${"9".repeat(30)}.1`, "9223372036854775808.1"])
    expect(parseCursor(bad)).toBeNull();
});

test("parseInterval takes 1m, 5m, 1h and 1d only", () => {
  expect(["1m", "5m", "1h", "1d"].map(parseInterval)).toEqual([60, 300, 3600, 86_400]);
  for (const bad of ["2m", "1M", "", "60", "1d "]) expect(parseInterval(bad)).toBeNull();
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

describe.skipIf(!process.env.DATABASE_URL)("candles", { timeout: 60_000 }, () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
  let coin: Seeded;
  const day = 1_767_225_600; // 2026-01-01T00:00:00Z: a 1m, 5m, 1h and 1d bucket boundary
  beforeAll(async () => {
    coin = await seedCoin(sql, { trades: 0, coin: { launch_mcap_sol: 8 } });
    const t = (s: number, side: string, mcap: number, lamports: number | null) => ({
      signature: fakeSig(),
      ix: 0,
      mint: coin.mint,
      slot: String(2000 + s),
      at: new Date((day + s) * 1000),
      side,
      venue: "curve",
      trader: coin.wallet,
      token_amount: "1000",
      sol: lamports === null ? null : String(lamports),
      mcap_sol: mcap,
    });
    // A burn's market cap is not a trade price: if it leaked, the first high would be 999.
    const rows = [
      t(10, "buy", 10, 1e9),
      t(20, "buy", 12, 2e9),
      t(30, "burn", 999, null),
      t(70, "sell", 9, 5e8),
    ];
    await sql`insert into trades ${sql(rows)}`;
  }, 60_000);
  afterAll(async () => {
    if (coin) await dropCoin(sql, coin.mint);
    await sql.end();
    await close();
  }, 30_000);

  test("1m candles open at the launch price, then at the previous trade", async () => {
    expect(await candles(coin.mint, 60)).toEqual([
      { time: day, open: 8, high: 12, low: 8, close: 12, volume: 3 },
      { time: day + 60, open: 12, high: 12, low: 9, close: 9, volume: 0.5 },
    ]);
  });

  test("5m, 1h and 1d group every trade into one bucket", async () => {
    for (const s of [300, 3600, 86_400])
      expect(await candles(coin.mint, s)).toEqual([
        { time: day, open: 8, high: 12, low: 8, close: 9, volume: 3.5 },
      ]);
  });
});
