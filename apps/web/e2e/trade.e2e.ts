// The trade panel on a seeded curve coin, with /api/trade/* stubbed (trade-stubs.ts), so the asserted values
// are the fixtures' literals. The panel is the column one: Desktop Chrome is 1280 wide, above the 1100 switch.
// The devnet group (E2E_DEVNET=1) quotes a real coin, then buys 0.01 SOL and sells it all through the panel,
// signed by the fake Phantom with the sim dev key (owner pre-approved devnet spend, at most 0.05 SOL).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { row } from "./coin.ts";
import { blockTime, dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { injectPhantom, newTestAccount, preConsent, rootEnv, signIn, simDevAccount } from "./phantom.ts";
import { BALANCE, QUOTE_BUY, QUOTE_IMPACT_HIGH, QUOTE_POOL, QUOTE_SELL, stubTrade } from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
const STAGING = process.env.E2E_BASE_URL;
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
  test.skip(!sql || !!STAGING, "seeds a coin in the dev branch: local only");
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
    await input.fill(".5"); // C-WR-08
    await expect(trade.getByText("Enter an amount in SOL, like 0.5.")).toHaveCount(0);
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
    // The error hint's own "1,000" parses (C-WR-08).
    await trade.getByRole("textbox", { name: "You sell" }).fill("1,000");
    await expect
      .poll(() => (calls.quote.at(-1) as { amount?: string } | undefined)?.amount)
      .toBe("1000000000");
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
    await expect(coinHop).toContainText(`Creator 0.3%, to the ${coin.symbol} burn budget`);
    await expect(coinHop).not.toContainText("Pump protocol");
    await expect(hop("SOL to BONDR on the BONDR curve, 0.95%")).toContainText("Pump protocol 0.95%");
    await expect(row(trade, "BONDR platform fee")).toHaveText("0");
    await expect(row(trade, "Network fee")).toHaveText("up to 0.0006 SOL");

    stubs.quote = { json: QUOTE_POOL };
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.6");
    const poolHop = hop(`Fees on ${coin.symbol} PumpSwap, 0.25%`);
    await expect(poolHop).toContainText("LP 0.2%");
    await expect(poolHop).toContainText("Creator 0.05%, shared 80 deployer / 20 treasury once finalized");
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
    // Past 60 s without input the loop stops for good: the pause is announced, then no tick quotes (C-WR-09).
    await page.clock.runFor(60_000);
    await expect(panel(page, coin.symbol).locator('[aria-live="polite"]')).toHaveText("Quote paused.");
    await page.clock.runFor(1);
    const stopped = calls.quote.length;
    expect(stopped).toBeGreaterThan(4);
    await page.clock.runFor(6_000);
    await quotes().toBe(stopped);
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
      trade.getByText("On devnet, buys stay under 0.7 SOL so the curves stay open."),
    ).toBeVisible();
    await expect(chip(page, coin.symbol, "1 SOL")).toBeDisabled();
    await expect(chip(page, coin.symbol, "0.5 SOL")).toBeEnabled();
  });
});

// The newest real curve coin on the dev branch, or staging's first curve coin, as live.e2e.ts picks it.
type Coin = { mint: string; symbol: string; venue?: string };
async function devnetCoin(api: APIRequestContext) {
  const top = async () => ((await (await api.get("/api/coins?sort=top")).json()) as { coins: Coin[] }).coins;
  const [c] = STAGING
    ? (await top()).filter((x) => x.venue === "curve")
    : await db()<Coin[]>`select c.mint, l.symbol from coins c join launches l on l.mint = c.mint
    where l.state = 'landed' and c.venue = 'curve' and l.name not like 'E2E %'
    order by l.created_at desc limit 1`;
  expect(c, "an indexed curve coin").toBeTruthy();
  return c as Coin;
}

const lamports = async (address: string): Promise<number> => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getBalance",
    params: [address, { commitment: "confirmed" }],
  };
  const res = await fetch("https://api.devnet.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return ((await res.json()) as { result: { value: number } }).result.value;
};

/** Waits for the result line, then for its row in the feed; returns the signature and seconds from blockTime. */
async function landed(page: Page, trade: Locator, text: string, side: string) {
  const line = trade.getByRole("status").filter({ hasText: text });
  await line.waitFor({ timeout: 60_000 });
  const href = (await line.getByRole("link").getAttribute("href")) as string;
  const sig = (href.match(/\/tx\/(\w+)/) as RegExpMatchArray)[1] as string;
  const row = page.getByRole("table").locator("tbody tr", { has: page.locator(`a[href*="${sig}"]`) });
  await expect(row).toContainText(side, { timeout: 15_000 });
  const lag = (Date.now() - (await blockTime(sig)) * 1000) / 1000;
  console.log(
    `devnet ${side.toLowerCase()} ${sig}: "${await line.textContent()}", feed row ${lag} s after blockTime`,
  );
  expect(lag).toBeLessThanOrEqual(15);
  return sig;
}

test.describe("devnet", () => {
  test.skip(process.env.E2E_DEVNET !== "1" || !sql, "a real quote, buy and sell: set E2E_DEVNET=1");
  test.describe.configure({ timeout: 240_000 });
  // --fund tops the sim dev up from ops only when it holds under 0.03 SOL.
  test.beforeAll(() => {
    execFileSync("node", ["--env-file=.env", "scripts/devnet-launch.ts", "--fund"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      stdio: "inherit",
      env: { ...process.env, VANITY_THREADS: "0" },
    });
  });
  // signIn's consent row stays while the sim's launches reference it (wallets FK), and always on staging.
  test.afterAll(async () => {
    if (STAGING) return;
    await db()`delete from wallets w where w.address = ${simDevAccount().address}
      and not exists (select 1 from launches l where l.wallet = w.address)`;
  });

  test("devnet quote", async ({ page }) => {
    const c = await devnetCoin(page.request);
    await page.goto(`/coin/${c.mint}`);
    const trade = page.getByRole("region", { name: `Trade ${c.symbol}` });
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.01");
    await expect(row(trade, "Route")).toHaveText(`SOL to BONDR curve to ${c.symbol} curve`, {
      timeout: 20_000,
    });
    await expect(row(trade, "You receive about")).not.toHaveText("–");
    await expect(row(trade, "You receive about")).toContainText(` ${c.symbol}`);
  });

  test("devnet buy and sell through the panel", async ({ page }) => {
    const [c, sim] = [await devnetCoin(page.request), simDevAccount()];
    const before = await lamports(sim.address);
    await injectPhantom(page, sim);
    expect((await signIn(page.request, sim)).status()).toBe(204); // a real session for prepare and submit
    await page.goto(`/coin/${c.mint}`);
    const trade = panel(page, c.symbol);
    const go = trade.locator("form > button");
    await go.click(); // Connect Phantom to trade
    await chip(page, c.symbol, "1%").click();
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.01");
    await expect(go).toHaveText(`Buy ${c.symbol} with 0.01 SOL`, { timeout: 30_000 });
    await go.click();
    const buy = await landed(page, trade, "Bought", "Buy");

    await trade.getByRole("button", { name: "Sell", exact: true }).click();
    // The post-buy balance read can lag the confirmation: wait for a non-zero coin balance (C-WR-09).
    await expect(trade.getByText(new RegExp(`^Balance (?!0 )[\\d,.]+ ${c.symbol}$`))).toBeVisible({
      timeout: 30_000,
    });
    await chip(page, c.symbol, "100%").click();
    // A sell of the whole balance through two curves can pass 15% impact: then it is the "anyway" press (D-13).
    const ready = new RegExp(`^Sell ([\\d,.]+ ${c.symbol}|anyway, [\\d.]+% price impact)$`);
    await expect(go).toHaveText(ready, { timeout: 30_000 });
    await go.click();
    const sell = await landed(page, trade, "Sold for", "Sell");
    const spent = (before - (await lamports(sim.address))) / 1e9;
    console.log(`devnet trade run: buy ${buy}, sell ${sell}, sim dev spent ${spent} SOL`);
    expect(spent).toBeLessThanOrEqual(0.05);
  });
});
