// The trade panel on a seeded curve coin, with /api/trade/* stubbed (trade-stubs.ts), so the asserted values
// are the fixtures' literals. The panel is the column one: Desktop Chrome is 1280 wide, above the 1100 switch.
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { row } from "./coin.ts";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import { QUOTE_BUY, stubTrade } from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as in coin.e2e.ts (a worker may come back to this module).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;

test.describe("trade panel", () => {
  test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
  test.skip(!sql, "needs DATABASE_URL in the root .env");
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(db(), { trades: 2 });
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(db(), coin.mint);
  });

  test("quote preview without a wallet", async ({ page }) => {
    const calls = await stubTrade(page, { quote: { json: QUOTE_BUY } });
    await page.goto(`/coin/${coin.mint}`);
    const trade = page.getByRole("region", { name: `Trade ${coin.symbol}` });
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");

    // No wallet is connected, so the body carries none (D-10).
    await expect
      .poll(() => calls.quote.at(-1))
      .toEqual({ side: "buy", mint: coin.mint, amount: "500000000", slippageBps: 100 });
    await expect(row(trade, "You receive about")).toHaveText(`17,234,567 ${coin.symbol}`);
    await expect(row(trade, "Route")).toContainText(`SOL to BONDR curve to ${coin.symbol} curve`);
    await expect(row(trade, "Price impact")).toHaveText("1.23%");
    await expect(row(trade, "Minimum received")).toHaveText(`17,062,221 ${coin.symbol}`);
    await expect(trade.getByText("Fees 0.0062 SOL")).toBeVisible();
    await expect(trade.getByText("no BONDR platform fee")).toBeVisible();
  });
});
