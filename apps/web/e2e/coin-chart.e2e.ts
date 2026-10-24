// The token page's market cap chart (TOKEN-01) on a seeded 60-trade coin: candles, the interval switch, the
// footer license credit, and the candles route's checks. Split from coin.e2e.ts for the 300-line limit.
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll (see coin.e2e.ts).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");

test.describe("chart", () => {
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(db(), { trades: 60 }); // launched an hour ago, so the default interval is 1m (D-17)
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(db(), coin.mint);
  });

  test("the market cap chart draws candles and switches interval", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    await expect(page.getByRole("heading", { name: "Market cap chart" })).toBeAttached();
    const group = page.getByRole("group", { name: "Candle interval" });
    for (const name of ["1m", "5m", "1h", "1d"])
      await expect(group.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(group.getByRole("button", { name: "1m" })).toHaveAttribute("aria-pressed", "true");
    const chart = page.getByRole("img", {
      name: new RegExp(`^${coin.symbol} market cap in SOL, 1 minute candles\\. Last`),
    });
    await expect(chart).toBeVisible();
    // The text summary overlays the canvas; the license link is the footer credit, not an in-chart logo.
    const panel = page.getByRole("region", { name: "Market cap chart" });
    await expect(panel.locator("canvas").first()).toBeAttached({ timeout: 20_000 });
    await expect(page.getByText(/^O [\d,.]+ H [\d,.]+ L [\d,.]+ C [\d,.]+ SOL mcap$/)).toBeVisible();

    const req = page.waitForRequest((r) => r.url().includes("candles?interval=1h"));
    await group.getByRole("button", { name: "1h" }).click();
    await req;
    await expect(group.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("img", {
        name: new RegExp(`^${coin.symbol} market cap in SOL, 1 hour candles\\. Last`),
      }),
    ).toBeVisible();
    await expect(panel.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Charts by TradingView/ })).toHaveAttribute(
      "href",
      "https://www.tradingview.com/",
    );
  });

  test("the candles route checks the mint and the interval", async ({ request }) => {
    expect((await request.get("/api/coin/not-a-mint/candles?interval=1m")).status()).toBe(404);
    expect((await request.get(`/api/coin/${coin.mint}/candles?interval=2m`)).status()).toBe(400);
    const res = await request.get(`/api/coin/${coin.mint}/candles?interval=5m`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = (await res.json()) as { candles: { time: number; open: number }[]; bondTime: number | null };
    expect(body.candles[0].open).toBe(28); // the launch price (D-16)
    expect(body.bondTime).toBeNull();
  });
});
