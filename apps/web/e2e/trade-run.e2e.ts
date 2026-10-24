// The trade panel's run with /api/trade/* stubbed (trade-stubs.ts): the button states, a buy and a sell from
// prepare through the fake Phantom's one signature to the result line. Nothing reaches the worker or the chain.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { SIG } from "./launch-stubs.ts";
import { rootEnv } from "./phantom.ts";
import {
  button,
  openPanel,
  PREPARED,
  panel,
  QUOTE_IMPACT_HIGH,
  QUOTE_SELL,
  stubTrade,
  tradeView,
} from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

/** Every label the submit button shows from now on, in order, without repeats. */
async function recordLabels(page: Page, symbol: string): Promise<() => Promise<string[]>> {
  await button(page, symbol).evaluate((b) => {
    const seen: string[] = [b.textContent ?? ""];
    (window as unknown as { labels: string[] }).labels = seen;
    new MutationObserver(() => {
      const t = b.textContent ?? "";
      if (seen.at(-1) !== t) seen.push(t);
    }).observe(b, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { labels: string[] }).labels);
}

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");

let coin: Seeded;
test.beforeAll(async () => {
  coin = await seedCoin(sql as postgres.Sql, { trades: 2 });
});
test.afterAll(async () => {
  if (sql && coin) await dropCoin(sql, coin.mint);
});

test("buy happy path", async ({ page }) => {
  // Slow prepare and submit answers, so each in-flight label holds long enough to check focus on it.
  const calls = await stubTrade(page, {
    prepare: { json: PREPARED, delayMs: 800 },
    submit: { json: { state: "sent", signature: SIG }, delayMs: 800 },
  });
  await openPanel(page, coin);
  const trade = panel(page, coin.symbol);
  const go = button(page, coin.symbol);
  await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
  await expect(go).toHaveText(`Buy ${coin.symbol} with 0.50 SOL`);
  const balances = calls.balance;
  const labels = await recordLabels(page, coin.symbol);
  await go.click();
  await expect(go).toHaveText("Preparing trade…");
  await expect(go).toBeFocused();
  await expect(go).toHaveAttribute("aria-disabled", "true");
  await expect(trade.getByRole("textbox", { name: "You pay" })).toBeDisabled();
  await expect(go).toHaveText("Confirming…");
  await expect(go).toBeFocused();

  const done = trade.getByRole("status").filter({ hasText: `Bought 17,234,567 ${coin.symbol}.` });
  await expect(done).toBeVisible();
  await expect(done.getByRole("link", { name: /View on Solscan/ })).toHaveAttribute("href", /cluster=devnet/);
  expect((await labels()).slice(1, 4)).toEqual(["Preparing trade…", "Waiting for Phantom…", "Confirming…"]);
  // No wallet in the body: the session names it (T2).
  expect(calls.prepare).toEqual([{ side: "buy", mint: coin.mint, amount: "500000000", slippageBps: 100 }]);
  // The signed wire is the prepared one with only the trader's signature slot (bytes 1-64) filled in.
  const sent = Buffer.from((calls.submit[0] as { signed: string }).signed, "base64");
  const prepared = Buffer.from(PREPARED.tx, "base64");
  expect(sent.length).toBe(prepared.length);
  expect(sent.subarray(65).equals(prepared.subarray(65))).toBe(true);
  expect(sent[0]).toBe(prepared[0]);
  expect(sent.subarray(1, 65).equals(prepared.subarray(1, 65))).toBe(false);
  await expect.poll(() => calls.balance).toBeGreaterThan(balances);
  await expect(trade.getByRole("textbox", { name: "You pay" })).toHaveValue("");
});

test("sell happy path", async ({ page }) => {
  await stubTrade(page, {
    quote: { json: QUOTE_SELL },
    view: () => ({ json: tradeView("landed", { amountOut: QUOTE_SELL.amountOut }) }),
  });
  await openPanel(page, coin);
  const trade = panel(page, coin.symbol);
  await trade.getByRole("button", { name: "Sell", exact: true }).click();
  await trade.getByRole("button", { name: "100%", exact: true }).click();
  const go = button(page, coin.symbol);
  await expect(go).toHaveText(`Sell 17,234,567 ${coin.symbol}`);
  await go.click();
  await expect(trade.getByRole("status").filter({ hasText: "Sold for 0.4877 SOL." })).toBeVisible();
  await expect(trade.getByRole("textbox", { name: "You sell" })).toHaveValue("");
});

test("button states", async ({ page }) => {
  const stubs = { quote: { json: QUOTE_IMPACT_HIGH } };
  await stubTrade(page, stubs);
  await openPanel(page, coin, { connect: false });
  const trade = panel(page, coin.symbol);
  const go = button(page, coin.symbol);
  await expect(go).toHaveText("Connect Phantom to trade");
  await go.click();
  await expect(go).toHaveText("Enter an amount");
  await expect(go).toBeDisabled();
  await trade.getByRole("textbox", { name: "You pay" }).fill("2.5");
  await expect(go).toHaveText("Not enough SOL");
  await expect(trade.getByText("Your wallet has 2.5 SOL. Keep about 0.01 SOL for fees.")).toBeVisible();
  await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
  await expect(go).toHaveText("Buy anyway, 20.00% price impact");
  await expect(go).toHaveClass(/bg-destructive/);
});
