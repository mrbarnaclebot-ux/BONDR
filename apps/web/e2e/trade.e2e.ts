// The trade panel on a seeded curve coin, with /api/trade/* stubbed (trade-stubs.ts), so the asserted values
// are the fixtures' literals. The panel is the column one: Desktop Chrome is 1280 wide, above the 1100 switch.
// The devnet group (E2E_DEVNET=1) quotes a real coin through the local web and worker; nothing is signed.
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

test.describe("devnet", () => {
  test.skip(process.env.E2E_DEVNET !== "1" || !sql, "a real quote from the local worker: set E2E_DEVNET=1");
  test.describe.configure({ timeout: 60_000 });

  test("devnet quote", async ({ page }) => {
    // The newest real curve coin on the dev branch, as live.e2e.ts picks it.
    const [c] = await db()<{ mint: string; symbol: string }[]>`select c.mint, l.symbol from coins c
      join launches l on l.mint = c.mint
      where l.state = 'landed' and c.venue = 'curve' and l.name not like 'E2E %'
      order by l.created_at desc limit 1`;
    expect(c, "an indexed curve coin").toBeTruthy();
    await page.goto(`/coin/${c?.mint}`);
    const trade = page.getByRole("region", { name: `Trade ${c?.symbol}` });
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.01");
    await expect(row(trade, "Route")).toHaveText(`SOL to BONDR curve to ${c?.symbol} curve`, {
      timeout: 20_000,
    });
    await expect(row(trade, "You receive about")).not.toHaveText("–");
    await expect(row(trade, "You receive about")).toContainText(` ${c?.symbol}`);
  });
});
