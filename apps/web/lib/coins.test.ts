// coinByMint's windowed values, listCoins orders, nextToBond and heroCounts against the Neon dev branch (seeded coins,
// removed after); CI has no .env and skips.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CoinRow } from "@bondr/core/api";
import postgres from "postgres";
import { afterAll, describe, expect, test, vi } from "vitest";
import { dropCoin, fakeMint, fakeSig, seedCoin, seedLedger } from "../e2e/fixtures.ts";
import { coinByMint, escapeLike, heroCounts, listCoins, nextToBond, trending, trendMode } from "./coins";
import { close } from "./db";

vi.mock("server-only", () => ({}));

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

test("escapeLike escapes the LIKE wildcards and the escape character", () => {
  expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
});

test("trendMode reads the first ranked row: 1h volume, else 24h volume, else the latest launches", () => {
  const row = (vol1h: number, vol24h: number) => ({ vol1h, vol24h }) as CoinRow;
  expect(trendMode([row(0.5, 2), row(0, 9)])).toBe("1h");
  expect(trendMode([row(0, 3), row(0, 1)])).toBe("24h");
  expect(trendMode([row(0, 0)])).toBe("latest");
  expect(trendMode([])).toBe("latest");
});

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
  }, 120_000); // about 30 seeded coins, six deletes each, one connection

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

  // Market caps no real coin reaches and launch times outside any real launch, so the seeded coins lead each
  // order: top A, B, C (B and C tie on mcap, newer first); latest B; oldest C, A.
  test("listCoins orders Top, Latest and Oldest with ties by newest launch", async () => {
    const seed = async (launched: string, mcap: number) => {
      const coin = { launched_at: new Date(launched), mcap_sol: mcap, launch_mcap_sol: mcap };
      const { mint } = await seedCoin(sql, { trades: 0, coin });
      mints.push(mint);
      return mint;
    };
    const a = await seed("1990-01-02T00:00:00Z", 3e7);
    const b = await seed("2099-01-01T00:00:00Z", 2e7);
    const c = await seed("1990-01-01T00:00:00Z", 2e7);
    const head = async (sort: "top" | "latest" | "oldest", n: number) =>
      (await listCoins({ sort, page: 0 })).coins.slice(0, n).map((r) => r.mint);
    expect(await head("top", 3)).toEqual([a, b, c]);
    expect(await head("latest", 1)).toEqual([b]);
    expect(await head("oldest", 2)).toEqual([c, a]);
    const top = (await listCoins({ sort: "top", page: 0 })).coins[0];
    expect(top.symbol).toMatch(/^E\d+$/);
    expect(top.launchedAt).toBe("1990-01-02T00:00:00.000Z");
  });

  test("pages hold 50 coins and say whether another exists; heroCounts counts coins and bonds", async () => {
    const coin = { venue: "pool", bonded_at: new Date(), bond_sig: fakeSig(), progress: 1 };
    mints.push((await seedCoin(sql, { trades: 0, coin })).mint);
    const [n] = await sql<{ all: number; bonded: number }[]>`select count(*)::int as all,
      count(*) filter (where venue in ('complete', 'pool'))::int as bonded from coins`;
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 20_000 }); // past the 10 s list cache of the last test
    expect(await heroCounts()).toMatchObject({ launched: n.all, bonded: n.bonded });
    const [p0, p1] = await Promise.all([0, 1].map((page) => listCoins({ sort: "latest", page })));
    expect(p0.coins.length).toBe(Math.min(50, n.all));
    expect(p0.more).toBe(n.all > 50);
    expect(p1.coins.length).toBe(Math.max(0, Math.min(50, n.all - 50)));
    expect(p1.coins.some((c) => p0.coins.some((d) => d.mint === c.mint))).toBe(false);
    vi.useRealTimers();
  });

  // Names carry a random tag so the dev branch's other coins never match; launched in 2099 so Latest leads.
  test("search matches name or symbol (contains, any case) or mint prefix; % and _ are literal", async () => {
    const tag = `q${fakeMint().slice(0, 8)}`;
    const seed = async (name: string, symbol: string, launched: string) => {
      const coin = { launched_at: new Date(launched) };
      const { mint } = await seedCoin(sql, { trades: 0, coin });
      await sql`update launches set name = ${name}, symbol = ${symbol} where mint = ${mint}`;
      mints.push(mint);
      return mint;
    };
    const grubby = await seed(`Grubby ${tag}`, "XQ1", "2099-02-01T00:00:00Z");
    const grub = await seed(`Plain ${tag}`, "GRUB", "2099-02-02T00:00:00Z");
    const pct = await seed(`50% ${tag}`, "XQ2", "2099-02-03T00:00:00Z");
    const fifty = await seed(`50x ${tag}`, "XQ3", "2099-02-04T00:00:00Z");
    const under = await seed(`a_b ${tag}`, "XQ4", "2099-02-05T00:00:00Z");
    const plain = await seed(`aXb ${tag}`, "XQ5", "2099-02-06T00:00:00Z");
    const find = async (q: string, sort: "latest" | "oldest" = "latest") =>
      (await listCoins({ sort, page: 0, q })).coins.map((c) => c.mint);

    expect(await find("grub")).toEqual(expect.arrayContaining([grubby, grub]));
    expect(await find(`0% ${tag}`)).toEqual([pct]);
    expect(await find(`a_b ${tag}`)).toEqual([under]);
    expect(await find(grubby.slice(0, 6))).toContain(grubby);
    expect(await find(`  ${grubby}  `)).toEqual([grubby]);
    expect(await find(fakeMint())).toEqual([]);
    expect(await find(tag)).toEqual([plain, under, fifty, pct, grub, grubby]);
    expect(await find(tag, "oldest")).toEqual([grubby, grub, pct, fifty, under, plain]);
    expect(await find("G")).toEqual(await find(""));
  });

  // Volumes no real coin reaches, so the seeded coins lead the 1h ranking; a 24h-only coin ranks below them.
  test("trending ranks up to 10 coins by 1h volume, then 24h volume", async () => {
    const a = await coin(30, 28, 28, [[10, 28, "buy", 9e15]]);
    const b = await coin(30, 28, 28, [
      [10, 28, "buy", 8e15],
      [9, 99, "burn", null],
    ]);
    const c = await coin(400, 28, 28, [[300, 28, "buy", 9.5e15]]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 20_000 }); // past any cached trending read
    const t = await trending();
    vi.useRealTimers();
    expect(t.mode).toBe("1h");
    expect(t.coins.length).toBeLessThanOrEqual(10);
    expect(t.coins.slice(0, 2).map((r) => r.mint)).toEqual([a, b]);
    expect(t.coins[1].vol1h).toBeCloseTo(8e6);
    const i = t.coins.findIndex((r) => r.mint === c);
    if (i >= 0) expect(t.coins.slice(0, i).every((r) => r.vol1h > 0)).toBe(true);
  });

  // Budgets far above any real coin's ratio (real ones fire at 105%), so the seeded coins lead the rail.
  test("nextToBond ranks curve coins with a budget by budget / cost, newer first on a tie, at most 4", async () => {
    const seed = async (
      budget: number,
      cost: number | null,
      extra: Record<string, string | number | Date> = {},
    ) => {
      const fees = { fee_budget: String(budget), cost_to_complete: cost === null ? null : String(cost) };
      const coin = { launched_at: new Date("2099-03-01T00:00:00Z"), ...fees, ...extra };
      const { mint } = await seedCoin(sql, { trades: 0, coin });
      mints.push(mint);
      return mint;
    };
    const a = await seed(9e9, 1e9);
    const newer = await seed(9e9, 1e9, { launched_at: new Date("2099-03-02T00:00:00Z") });
    // 5e9 counted as 4e9 in the bank plus the 90% share of 1.2e9 unclaimed (the token page's budget).
    const b = await seed(4e9, 1e9, { fees_unclaimed: "1200000000" });
    const c = await seed(0, 1e9);
    const d = await seed(9e9, 1e9, { venue: "pool", bonded_at: new Date(), progress: 1 });
    const nocost = await seed(9e9, null);
    const fifth = await seed(3e9, 1e9);
    const last = await seed(2e9, 1e9);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 20_000 }); // past any cached read
    const rail = await nextToBond();
    vi.useRealTimers();
    expect(rail.map((r) => r.mint)).toEqual([newer, a, b, fifth]);
    expect(rail[2].fees?.budget).toBe("5080000000");
    for (const m of [c, d, nocost, last]) expect(rail.some((r) => r.mint === m)).toBe(false);
  });

  test("heroCounts forced counts coins with a landed forced bond only", async () => {
    const before = await sql<{ n: number }[]>`select count(distinct mint)::int as n from fee_ledger
      where kind = 'forced_bond' and state = 'landed'`;
    const seed = async () => {
      const { mint } = await seedCoin(sql, {
        trades: 0,
        coin: { venue: "pool", bonded_at: new Date(), progress: 1 },
      });
      mints.push(mint);
      return mint;
    };
    await seedLedger(sql, await seed(), [{ kind: "forced_bond" }]);
    await seedLedger(sql, await seed(), [{ kind: "forced_bond", state: "pending" }]);
    await seedLedger(sql, await seed(), [{ kind: "pool_burn" }]);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 40_000 }); // past the cached counts
    const counts = await heroCounts();
    vi.useRealTimers();
    expect(counts.forced).toBe(before[0].n + 1);
  });
});
