// The trade panel on a seeded curve coin, with /api/trade/* stubbed (trade-stubs.ts), so the asserted values
// are the fixtures' literals. The panel is the column one: Desktop Chrome is 1280 wide, above the 1100 switch.
// The devnet group (E2E_DEVNET=1) quotes a real coin through the local web and worker; nothing is signed.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { row } from "./coin.ts";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { injectPhantom, newTestAccount, preConsent, rootEnv } from "./phantom.ts";
import { BALANCE, QUOTE_BUY, QUOTE_IMPACT_HIGH, QUOTE_POOL, QUOTE_SELL, stubTrade } from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as in coin.e2e.ts (a worker may come back to this module).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;

const panel = (page: Page, symbol: string) => page.getByRole("region", { name: `Trade ${symbol}` });
const chip = (page: Page, symbol: string, name: string) =>
  panel(page, symbol).getByRole("button", { name, exact: true });

/** A fake Phantom with a consent session the page believes in, connected from the header. */
async function connect(page: Page, mint: string) {
  const account = newTestAccount();
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await page.goto(`/coin/${mint}`);
  await page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();
}

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

  test("presets and Max", async ({ page }) => {
    await stubTrade(page, {});
    await connect(page, coin.mint);
    const trade = panel(page, coin.symbol);
    const input = trade.getByRole("textbox", { name: "You pay" });
    await expect(trade.getByText("Balance 2.5000 SOL")).toBeVisible();
    await chip(page, coin.symbol, "Max, balance minus 0.01 SOL").click();
    await expect(input).toHaveValue("2.49");
    await chip(page, coin.symbol, "1 SOL").click();
    await expect(input).toHaveValue("1");
    await expect(chip(page, coin.symbol, "1 SOL")).toHaveAttribute("aria-pressed", "true");
    await input.fill("0.7");
    await expect(chip(page, coin.symbol, "1 SOL")).toHaveAttribute("aria-pressed", "false");
    await input.fill("abc");
    await expect(trade.getByText("Enter an amount in SOL, like 0.5.")).toBeVisible();
  });

  test("sell 100% is the raw balance", async ({ page }) => {
    const calls = await stubTrade(page, { quote: { json: QUOTE_SELL } });
    await connect(page, coin.mint);
    const trade = panel(page, coin.symbol);
    await trade.getByRole("button", { name: "Sell", exact: true }).click();
    await expect(trade.getByText(`Balance 17,234,567 ${coin.symbol}`)).toBeVisible();
    await chip(page, coin.symbol, "100%").click();
    await expect(trade.getByRole("textbox", { name: "You sell" })).toHaveValue("17234567");
    await expect
      .poll(() => (calls.quote.at(-1) as { amount?: string } | undefined)?.amount)
      .toBe(BALANCE.tokens);
  });

  test("slippage persists", async ({ page }) => {
    const calls = await stubTrade(page, {});
    await page.goto(`/coin/${coin.mint}`);
    await chip(page, coin.symbol, "3%").click();
    await page.reload();
    await expect(chip(page, coin.symbol, "3%")).toHaveAttribute("aria-pressed", "true");
    await panel(page, coin.symbol).getByRole("textbox", { name: "You pay" }).fill("0.5");
    await expect
      .poll(() => (calls.quote.at(-1) as { slippageBps?: number } | undefined)?.slippageBps)
      .toBe(300);
    await chip(page, coin.symbol, "Custom").click();
    const custom = panel(page, coin.symbol).getByRole("textbox", { name: "Custom slippage" });
    await custom.fill("60");
    await expect(panel(page, coin.symbol).getByText("Enter a slippage from 0.1% to 50%.")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("bondr:slippage"))).toBe("300");
    await custom.fill("10");
    await expect(
      panel(page, coin.symbol).getByText("High slippage. This trade can fill up to 10% below the quote."),
    ).toBeVisible();
    await expect
      .poll(() => (calls.quote.at(-1) as { slippageBps?: number } | undefined)?.slippageBps)
      .toBe(1000);
  });

  test("fees rows are masked", async ({ page }) => {
    const stubs = { quote: { json: QUOTE_BUY } };
    await stubTrade(page, stubs);
    await page.goto(`/coin/${coin.mint}`);
    const trade = panel(page, coin.symbol);
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
    await trade.getByText("Fees 0.0062 SOL").click();
    const hop = (title: string) => trade.locator("details dl > div", { hasText: title });
    const coinHop = hop(`Fees on the ${coin.symbol} curve, 0.3%`);
    await expect(coinHop).toContainText(`Creator 0.3%, to the ${coin.symbol} fee wallet`);
    await expect(coinHop).not.toContainText("Pump protocol");
    await expect(hop("SOL to BONDR on the BONDR curve, 0.95%")).toContainText("Pump protocol 0.95%");
    await expect(row(trade, "BONDR platform fee")).toHaveText("0");
    await expect(row(trade, "Network fee")).toHaveText("up to 0.0006 SOL");

    stubs.quote = { json: QUOTE_POOL };
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.6");
    const poolHop = hop(`Fees on ${coin.symbol} PumpSwap, 0.25%`);
    await expect(poolHop).toContainText("LP 0.2%");
    await expect(poolHop).toContainText(`Creator 0.05%, to the ${coin.symbol} fee wallet`);
    await expect(poolHop).not.toContainText("Pump protocol");
  });

  test("price impact over 15% reads destructive", async ({ page }) => {
    await stubTrade(page, { quote: { json: QUOTE_IMPACT_HIGH } });
    await page.goto(`/coin/${coin.mint}`);
    const trade = panel(page, coin.symbol);
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
    await expect(row(trade, "Price impact")).toHaveText("20.00%");
    await expect(row(trade, "Price impact")).toHaveClass(/text-destructive/);
  });

  test("refresh every 2 s and pause after 60 s", async ({ page }) => {
    const calls = await stubTrade(page, {});
    await page.clock.install();
    await page.goto(`/coin/${coin.mint}`);
    await page.clock.pauseAt(Date.now() + 60_000);
    const input = panel(page, coin.symbol).getByRole("textbox", { name: "You pay" });
    // A quote starts from a timer set after React renders, so each poll moves the fake clock 1 ms.
    const quotes = () =>
      expect.poll(async () => {
        await page.clock.runFor(1);
        return calls.quote.length;
      });
    await input.fill("0.5");
    await page.clock.runFor(400);
    await quotes().toBe(1);
    for (const n of [2, 3, 4]) {
      await page.clock.runFor(2_000);
      await quotes().toBe(n);
    }
    // Past 60 s without input the loop stops for good.
    await page.clock.runFor(60_000);
    await page.clock.runFor(1);
    const stopped = calls.quote.length;
    expect(stopped).toBeGreaterThan(4);
    for (let i = 0; i < 3; i++) {
      await page.clock.runFor(2_000);
      await page.waitForTimeout(200);
    }
    await page.clock.runFor(1);
    expect(calls.quote.length).toBe(stopped);
    // Any input resumes it.
    await input.fill("0.6");
    await page.clock.runFor(400);
    await quotes().toBe(stopped + 1);
    await page.clock.runFor(2_000);
    await quotes().toBe(stopped + 2);
  });

  test("devnet cap", async ({ page }) => {
    await stubTrade(page, { quote: { json: { ...QUOTE_BUY, maxSolIn: "700000000" } } });
    await page.goto(`/coin/${coin.mint}`);
    const trade = panel(page, coin.symbol);
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.8");
    await expect(
      trade.getByText("On devnet, buys stay under 0.7 SOL so BONDR stays on its curve."),
    ).toBeVisible();
    await expect(chip(page, coin.symbol, "1 SOL")).toBeDisabled();
    await expect(chip(page, coin.symbol, "0.5 SOL")).toBeEnabled();
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
