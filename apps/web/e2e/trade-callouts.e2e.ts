// The trade panel's pre-sign callouts (UI-SPEC Callouts), the quote pause and the polite live region, with
// /api/trade/* stubbed. page.clock drives the 2 s refresh where a test counts refreshes.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { row } from "./coin.ts";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import {
  button,
  openPanel,
  panel,
  QUOTE_BUY,
  QUOTE_IMPACT,
  QUOTE_IMPACT_HIGH,
  stubTrade,
  type TradeCalls,
  type TradeStubs,
} from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

/** A quote starts from a timer set after React renders, so each poll moves the fake clock 1 ms. */
const quotes = (page: Page, calls: TradeCalls) =>
  expect.poll(async () => {
    await page.clock.runFor(1);
    return calls.quote.length;
  });

/** Freezes the fake clock a few seconds ahead, so every refresh from here on is one `runFor`. */
const freeze = (page: Page) => page.clock.pauseAt(Date.now() + 5_000);

test.describe("results and callouts", () => {
  test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
  test.skip(!sql, "needs DATABASE_URL in the root .env");
  let coin: Seeded;
  let complete: Seeded;
  test.beforeAll(async () => {
    const db = sql as postgres.Sql;
    coin = await seedCoin(db, { trades: 2 });
    complete = await seedCoin(db, {
      trades: 2,
      coin: { venue: "complete", progress: 1, bonded_at: new Date() },
    });
  });
  test.afterAll(async () => {
    for (const c of [coin, complete]) if (sql && c) await dropCoin(sql, c.mint);
  });

  test("callout: high price impact mounts once", async ({ page }) => {
    const calls = await stubTrade(page, { quote: { json: QUOTE_IMPACT } });
    await page.clock.install();
    await page.goto(`/coin/${coin.mint}`);
    await freeze(page);
    await panel(page, coin.symbol).getByRole("textbox", { name: "You pay" }).fill("0.5");
    await page.clock.runFor(400);
    await quotes(page, calls).toBe(1);
    const warn = panel(page, coin.symbol).getByRole("status").filter({ hasText: "High price impact." });
    await expect(warn).toHaveText(
      "High price impact. This trade moves the price 10.00%. A smaller amount fills closer to the current price.",
    );
    // The refreshed percentage is outside the announced text (C-WR-03).
    await expect(warn.locator('[aria-live="off"]')).toHaveText("10.00%");
    // A remount would drop this attribute, which React does not manage.
    await warn.evaluate((el) => el.setAttribute("data-first", ""));
    for (const n of [2, 3]) {
      await page.clock.runFor(2_000);
      await quotes(page, calls).toBe(n);
    }
    await expect(warn).toHaveAttribute("data-first", "");
  });

  test("callout: very high price impact, then the anyway press", async ({ page }) => {
    const calls = await stubTrade(page, { quote: { json: QUOTE_IMPACT_HIGH } });
    await openPanel(page, coin);
    const trade = panel(page, coin.symbol);
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
    await expect(trade.getByRole("alert")).toHaveText(
      "Very high price impact. This trade moves the price 20.00%, so you receive far less than the current price suggests. Check the amounts before you continue.",
    );
    await expect(button(page, coin.symbol)).toHaveText("Buy anyway, 20.00% price impact");
    await button(page, coin.symbol).click();
    await expect.poll(() => calls.prepare.length).toBe(1);
  });

  test("callout: quote failed until the next good quote", async ({ page }) => {
    const stubs: TradeStubs = { quote: { status: 500, json: { error: "build_failed" } } };
    await stubTrade(page, stubs);
    await page.goto(`/coin/${coin.mint}`);
    const trade = panel(page, coin.symbol);
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
    const warn = trade.getByRole("status").filter({ hasText: "Could not get a quote. Trying again." });
    await expect(warn).toBeVisible();
    stubs.quote = { status: 200, json: QUOTE_BUY };
    await expect(row(trade, "You receive about")).toHaveText(`17,234,567 ${coin.symbol}`);
    await expect(warn).toHaveCount(0);
  });

  test("callout: the coin waits for PumpSwap", async ({ page }) => {
    await stubTrade(page, {});
    await openPanel(page, complete);
    const trade = panel(page, complete.symbol);
    await expect(trade.getByRole("status")).toHaveText(
      `Trading pauses for a few seconds while ${complete.symbol} moves to PumpSwap.`,
    );
    await expect(button(page, complete.symbol)).toHaveText("Trading paused");
    await expect(button(page, complete.symbol)).toBeDisabled();
  });

  test("quote paused after 60 s, tap to refresh", async ({ page }) => {
    const calls = await stubTrade(page, {});
    await page.clock.install();
    await openPanel(page, coin);
    await freeze(page);
    const trade = panel(page, coin.symbol);
    const ready = `Buy ${coin.symbol} with 0.50 SOL`;
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
    await page.clock.runFor(400);
    await quotes(page, calls).toBe(1);
    await expect(button(page, coin.symbol)).toHaveText(ready);
    await page.clock.runFor(62_000);
    await expect(button(page, coin.symbol)).toHaveText("Quote paused, tap to refresh");
    await expect(trade.locator('[aria-live="polite"]')).toHaveText("Quote paused.");
    const before = calls.quote.length;
    await button(page, coin.symbol).click();
    await quotes(page, calls).toBe(before + 1);
    await expect(button(page, coin.symbol)).toHaveText(ready);
    // The press only quotes: it never starts a trade.
    expect(calls.prepare).toHaveLength(0);
  });

  test("live region: a user's quote once, never the refresh", async ({ page }) => {
    const stubs: TradeStubs = { quote: { json: QUOTE_BUY } };
    await stubTrade(page, stubs);
    await page.goto(`/coin/${coin.mint}`);
    const trade = panel(page, coin.symbol);
    const live = trade.locator('[aria-live="polite"]');
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
    const first = `You receive about 17,234,567 ${coin.symbol}. Price impact 1.23%.`;
    await expect(live).toHaveText(first);
    // A refresh with a new amount replaces the row in place and stays silent.
    stubs.quote = { json: { ...QUOTE_BUY, amountOut: "18000000000000" } };
    await expect(row(trade, "You receive about")).toHaveText(`18,000,000 ${coin.symbol}`);
    await expect(live).toHaveText(first);
    // The next user change is announced.
    await trade.getByRole("textbox", { name: "You pay" }).fill("0.6");
    await expect(live).toHaveText(`You receive about 18,000,000 ${coin.symbol}. Price impact 1.23%.`);
  });
});
