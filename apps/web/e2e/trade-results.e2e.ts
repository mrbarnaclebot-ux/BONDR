// Every UI-SPEC Results row (D-17) with /api/trade/* stubbed: a 0.5 SOL buy through the fake Phantom ends in
// the row's fixed copy, with the callout role its variant sets (error alert, warn and info status).
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { emitChange, newTestAccount, rootEnv } from "./phantom.ts";
import { button, openPanel, PREPARED, panel, stubTrade, type TradeStubs, tradeView } from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

const BUILD = "Could not build your trade. Nothing was sent. Try again.";
const fail = (status: number, error: string) => ({ status, json: { error } });
const failedView = (code: string) => () => ({ json: tradeView("failed", { code }) });

// [row, stubs, callout role, copy]
const ROWS: [string, TradeStubs, "alert" | "status", string][] = [
  [
    "slippage at prepare",
    { prepare: fail(409, "slippage") },
    "alert",
    "Price moved more than your slippage. Try again or raise slippage.",
  ],
  [
    "slippage on-chain",
    { view: failedView("slippage") },
    "alert",
    "Price moved more than your slippage. Try again or raise slippage.",
  ],
  [
    "not enough SOL",
    { prepare: fail(402, "insufficient_balance") },
    "alert",
    "Not enough SOL for this trade and fees.",
  ],
  [
    "BONDR migration window",
    { prepare: fail(409, "paused") },
    "status",
    "Trading pauses for a few seconds while BONDR moves to PumpSwap.",
  ],
  ["expired", { submit: fail(410, "expired") }, "alert", "Transaction expired. Try again."],
  [
    "rate limited",
    { prepare: fail(429, "rate_limited") },
    "alert",
    "Too many trades from this wallet. Wait a minute, then try again.",
  ],
  [
    "message changed",
    { submit: fail(422, "message_changed") },
    "alert",
    "The signed transaction did not match the one BONDR built, so nothing was sent. Try again.",
  ],
  [
    "failed on-chain",
    { view: failedView("onchain") },
    "alert",
    "Your trade failed on-chain. Only the network fee left your wallet. Try again.",
  ],
  ["build failed", { prepare: fail(500, "build_failed") }, "alert", BUILD],
  ["a code with no copy", { prepare: fail(400, "pin_failed") }, "alert", BUILD],
];

/** Types 0.5 SOL and presses the ready button. */
async function buy(page: Page, coin: Seeded) {
  await panel(page, coin.symbol).getByRole("textbox", { name: "You pay" }).fill("0.5");
  await expect(button(page, coin.symbol)).toHaveText(`Buy ${coin.symbol} with 0.50 SOL`);
  await button(page, coin.symbol).click();
}

test.describe("results and callouts", () => {
  test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
  test.skip(!sql, "needs DATABASE_URL in the root .env");
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(sql as postgres.Sql, { trades: 2 });
  });
  test.afterAll(async () => {
    if (sql && coin) await dropCoin(sql, coin.mint);
  });

  for (const [name, stubs, role, copy] of ROWS)
    test(`result: ${name}`, async ({ page }) => {
      await stubTrade(page, stubs);
      await openPanel(page, coin);
      await buy(page, coin);
      await expect(panel(page, coin.symbol).getByRole(role).filter({ hasText: copy })).toBeVisible();
      // Only the fixed copy renders: no raw code reaches the page (T9).
      await expect(panel(page, coin.symbol).getByRole(role)).toHaveText(copy);
    });

  test("result: signature declined", async ({ page }) => {
    await stubTrade(page, {});
    await openPanel(page, coin, { reject: true });
    await buy(page, coin);
    const trade = panel(page, coin.symbol);
    await expect(trade.getByRole("status").filter({ hasText: "Signature declined." })).toBeVisible();
  });

  test("result: consent required", async ({ page }) => {
    await stubTrade(page, { prepare: fail(403, "consent_required") });
    await openPanel(page, coin);
    await buy(page, coin);
    await expect(button(page, coin.symbol)).toHaveText("Accept terms to trade");
    await expect(panel(page, coin.symbol).getByText(BUILD)).toHaveCount(0);
  });

  test("result: account switched", async ({ page }) => {
    // The switch lands while prepare is slow; the run checks it after the signature, before submit.
    const calls = await stubTrade(page, { prepare: { json: PREPARED, delayMs: 1500 } });
    await openPanel(page, coin);
    await buy(page, coin);
    await expect(button(page, coin.symbol)).toHaveText("Preparing trade…");
    await expect(panel(page, coin.symbol).locator('[aria-live="polite"]')).toHaveText("Preparing trade");
    await emitChange(page, newTestAccount());
    const copy = "Phantom switched accounts. Nothing was sent. Try again.";
    await expect(panel(page, coin.symbol).getByRole("alert")).toHaveText(copy);
    expect(calls.submit).toHaveLength(0);
  });

  // C-WR-05: after the signed wire is posted, an error that proves nothing is never "Nothing was sent".
  for (const [name, stubs] of [
    [
      "worker lost the trade",
      { submit: fail(502, "worker_unavailable"), view: () => fail(404, "not_found") },
    ],
    ["submit error without copy", { submit: fail(500, "build_failed"), view: () => fail(404, "not_found") }],
  ] as [string, TradeStubs][])
    test(`result: ${name} after posting is unknown`, async ({ page }) => {
      await stubTrade(page, stubs);
      await openPanel(page, coin);
      await buy(page, coin);
      const warn = panel(page, coin.symbol).getByRole("status").filter({
        hasText: "Your trade was sent but is not confirmed yet. Check Solscan before you trade again.",
      });
      // The slot 0 signature is the transaction id, so the link works with no answer from the worker.
      await expect(warn.getByRole("link", { name: /View on Solscan/ })).toHaveAttribute(
        "href",
        /\/tx\/[1-9A-HJ-NP-Za-km-z]{80,}\?/,
      );
      await expect(panel(page, coin.symbol).getByText(/nothing was sent/i)).toHaveCount(0);
    });

  test("result: sent, confirmation unknown", async ({ page }) => {
    const submit = { json: { state: "sent" }, delayMs: 800 };
    await stubTrade(page, { submit, view: () => ({ json: tradeView("unknown") }) });
    await openPanel(page, coin);
    await buy(page, coin);
    await expect(panel(page, coin.symbol).locator('[aria-live="polite"]')).toHaveText("Confirming");
    const warn = panel(page, coin.symbol).getByRole("status").filter({
      hasText: "Your trade was sent but is not confirmed yet. Check Solscan before you trade again.",
    });
    await expect(warn.getByRole("link", { name: /View on Solscan/ })).toHaveAttribute(
      "href",
      /cluster=devnet/,
    );
  });
});
