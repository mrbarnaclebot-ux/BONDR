// coinByMint's windowed values against the Neon dev branch (seeded coins, removed after); CI has no .env and
// skips.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, test, vi } from "vitest";
import { dropCoin, fakeMint, fakeSig, seedCoin } from "../e2e/fixtures.ts";
import { coinByMint } from "./coins";
import { close } from "./db";

vi.mock("server-only", () => ({}));

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

type Trade = [minutesAgo: number, mcap: number, side: "buy" | "sell" | "burn", lamports: number | null];

describe.skipIf(!process.env.DATABASE_URL)("coinByMint", { timeout: 60_000 }, () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
  const mints: string[] = [];
  const ago = (m: number) => new Date(Date.now() - m * 60_000);

  async function coin(launchedMinAgo: number, launchMcap: number, mcap: number, trades: Trade[]) {
    const coin = { launched_at: ago(launchedMinAgo), launch_mcap_sol: launchMcap, mcap_sol: mcap };
    const { mint } = await seedCoin(sql, { trades: 0, coin });
    mints.push(mint);
    const rows = trades.map(([m, mcapSol, side, lamports], i) => ({
      signature: fakeSig(),
      ix: 0,
      mint,
      slot: String(1000 + i),
      at: ago(m),
      side,
      venue: "curve",
      trader: fakeMint(),
      token_amount: "1000",
      sol: lamports === null ? null : String(lamports),
      mcap_sol: mcapSol,
    }));
    if (rows.length) await sql`insert into trades ${sql(rows)}`;
    return mint;
  }

  afterAll(async () => {
    for (const m of mints) await dropCoin(sql, m);
    await sql.end();
    await close();
  }, 30_000);

  test("1h change runs from the last trade before the hour; burns never count", async () => {
    const mint = await coin(180, 8, 12, [
      [120, 10, "buy", 1e9],
      [90, 99, "burn", null],
      [10, 12, "buy", 5e8],
    ]);
    const c = await coinByMint(mint);
    expect(c?.change1h).toBeCloseTo(0.2);
    expect(c?.vol1h).toBeCloseTo(0.5);
    expect(c?.vol24h).toBeCloseTo(1.5);
    expect(c?.realQuoteReserves).toBe("0");
    expect(c?.launchedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(c?.symbol).toMatch(/^E\d+$/);
  });

  test("a coin under an hour old changes against its launch price", async () => {
    const c = await coinByMint(await coin(20, 5, 6, [[10, 6, "buy", 1e8]]));
    expect(c?.change1h).toBeCloseTo(0.2);
    expect(c?.vol1h).toBeCloseTo(0.1);
  });

  test("a coin with no trades has no volume and no change", async () => {
    const c = await coinByMint(await coin(5, 28, 28, []));
    expect(c?.vol1h).toBe(0);
    expect(c?.vol24h).toBe(0);
    expect(c?.change1h).toBe(0);
    expect(c?.holders).toBeNull();
  });

  test("an unknown mint is null", async () => {
    expect(await coinByMint(fakeMint())).toBeNull();
  });
});
