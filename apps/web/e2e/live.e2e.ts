// The live token page (TOKEN-02, D-15, D-18). The stubbed group answers /api/live with page.route and a fixed
// SSE body (retry 60 s, so the closed stub does not replay itself); the Live indicator test uses the real stream.
// The devnet group (E2E_DEVNET=1) buys 0.01 SOL of a real coin and waits for it on the open page.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeMint, fakeSig, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;

const sse = (events: [string, unknown][]) =>
  `retry: 60000\n\n${events.map(([e, d], i) => `id: e2e-${i}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("")}`;

async function stubLive(page: Page, events: [string, unknown][]) {
  await page.route(
    (u) => u.pathname === "/api/live",
    (r) => r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) }),
  );
}

function trade(mint: string, side: "buy" | "sell", signature = fakeSig()) {
  const at = new Date().toISOString();
  return {
    trade: {
      signature,
      ix: 0,
      side,
      launch: false,
      venue: "curve",
      trader: fakeMint(),
      tokenAmount: "1000000000",
      sol: "10000000",
      mcapSol: 99.5,
      at,
      slot: "999999",
      seq: "999999",
      mint,
    },
    coin: {
      mint,
      venue: "curve",
      mcapSol: 99.5,
      progress: 0.25,
      vol1h: 1.5,
      vol24h: 2,
      change1h: 0.1,
      lastTradeAt: at,
      bondSol: null,
      bondrAtBond: null,
      realQuoteReserves: "0",
      holders: 7,
    },
  };
}

const stat = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`);
const rows = (page: Page) => page.getByRole("table").locator("tbody tr");
const head = (page: Page) => page.getByRole("region", { name: "Trades" });

test.describe.configure({ timeout: 60_000 });
test.skip(!sql, "needs DATABASE_URL in the root .env");

test.describe("stubbed", () => {
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(db(), { trades: 3 });
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(db(), coin.mint);
  });

  for (const [side, dir] of [
    ["buy", "up"],
    ["sell", "down"],
  ] as const) {
    test(`a ${side} lands on top and flashes ${dir}`, async ({ page }) => {
      const sig = fakeSig();
      await stubLive(page, [["trade", trade(coin.mint, side, sig)]]);
      await page.goto(`/coin/${coin.mint}`);
      await expect(rows(page).first().getByRole("link")).toHaveAttribute("href", new RegExp(sig));
      await expect(rows(page).first()).toHaveClass(new RegExp(`animate-row-${dir}`));
      await expect(stat(page, "Mcap")).toHaveText("99.50 SOL");
      await expect(stat(page, "Mcap")).toHaveClass(new RegExp(`animate-flash-${dir}`));
      await expect(stat(page, "Holders")).toHaveText("7");
    });
  }

  test("a bond event switches the venue and a holders event the count", async ({ page }) => {
    const bond = { mint: coin.mint, venue: "pool", bondSig: fakeSig(), bondedAt: new Date().toISOString() };
    await stubLive(page, [
      ["bond", bond],
      ["holders", { mint: coin.mint, holders: 1284 }],
    ]);
    await page.goto(`/coin/${coin.mint}`);
    await expect(page.getByText("Bonded, PumpSwap")).toBeVisible();
    await expect(page.getByRole("region", { name: "Bond and burn" })).toContainText("100.0%");
    await expect(stat(page, "Holders")).toHaveText("1,284");
  });

  test("a resync refetches the first page once and keeps the rows", async ({ page }) => {
    let n = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === `/api/coin/${coin.mint}/trades`) n++;
    });
    await stubLive(page, [["resync", {}]]);
    await page.goto(`/coin/${coin.mint}`);
    await expect.poll(() => n, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(1500);
    expect(n).toBe(1);
    await expect(rows(page)).toHaveCount(4); // 3 trades and the launch caption, no duplicates
  });

  test("the head shows Live on the real stream", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    await expect(head(page).getByText("Live", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("the head shows Reconnecting when the stream fails", async ({ page }) => {
    await page.route(
      (u) => u.pathname === "/api/live",
      (r) => r.abort(),
    );
    await page.goto(`/coin/${coin.mint}`);
    await expect(head(page).getByText("Reconnecting", { exact: true })).toBeVisible();
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("values update with no flash and rows with no rise", async ({ page }) => {
      const sig = fakeSig();
      await stubLive(page, [["trade", trade(coin.mint, "buy", sig)]]);
      await page.goto(`/coin/${coin.mint}`);
      await expect(rows(page).first().getByRole("link")).toHaveAttribute("href", new RegExp(sig));
      await expect(stat(page, "Mcap")).toHaveText("99.50 SOL");
      await expect(stat(page, "Mcap")).not.toHaveClass(/animate-/);
      await expect(rows(page).first()).not.toHaveClass(/animate-/);
    });
  });
});
