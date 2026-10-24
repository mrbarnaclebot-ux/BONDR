// The Quick trade bar and the trade sheet below 1100px, the column panel from 1100px (D-05), with /api/trade/*
// stubbed (trade-stubs.ts). Locally the coin is a seeded curve coin; against staging (E2E_BASE_URL) nothing can
// be seeded, so it is the first curve coin of that host's /api/coins?sort=top, as in responsive-lists.e2e.ts.
import { expect, type Page, request, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { injectPhantom, newTestAccount, preConsent, rootEnv } from "./phantom.ts";
import { PREPARED, stubTrade } from "./trade-stubs.ts";

const STAGING = process.env.E2E_BASE_URL;
const url = STAGING ? undefined : rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as in coin.e2e.ts (a worker may come back to this module).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.use({ reducedMotion: "reduce" }); // the sheet appears in place, so its box is final at once
test.skip(!STAGING && !sql, "needs DATABASE_URL in the root .env");

type Coin = Pick<Seeded, "mint" | "symbol">;
let coin: Coin;
test.beforeAll(async () => {
  if (STAGING) {
    const api = await request.newContext({ baseURL: STAGING });
    const { coins } = (await (await api.get("/api/coins?sort=top")).json()) as {
      coins: (Coin & { venue: string })[];
    };
    await api.dispose();
    coin = coins.find((c) => c.venue === "curve") as Coin;
    expect(coin, "a curve coin on staging").toBeTruthy();
    return;
  }
  coin = await seedCoin(sql as postgres.Sql, { trades: 2 });
});
test.afterAll(async () => {
  if (sql && coin) await dropCoin(sql, coin.mint);
});

const bar = (page: Page) => page.getByRole("region", { name: "Quick trade" });
const sheet = (page: Page) => page.getByRole("dialog", { name: `Trade ${coin.symbol}` });
const column = (page: Page) => page.getByRole("region", { name: `Trade ${coin.symbol}` });

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await stubTrade(page, {});
  await page.goto(`/coin/${coin.mint}`);
}

test("390: the bar opens the sheet on its side and every close returns focus", async ({ page }) => {
  await open(page, 390);
  await expect(bar(page).getByText("Mcap", { exact: true })).toBeVisible();
  await expect(column(page)).toBeHidden();
  const sell = bar(page).getByRole("button", { name: `Sell ${coin.symbol}` });
  const buy = bar(page).getByRole("button", { name: `Buy ${coin.symbol}` });
  await expect(buy).toBeVisible();

  await sell.click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Sell", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sheet(page).getByRole("textbox", { name: "You sell" })).toBeFocused();
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(sell).toBeFocused();

  await buy.click();
  await expect(sheet(page).getByRole("textbox", { name: "You pay" })).toBeFocused();
  await page.mouse.click(195, 4); // above the sheet: the backdrop
  await expect(sheet(page)).toBeHidden();
  await expect(buy).toBeFocused();

  await buy.click();
  await sheet(page).getByRole("button", { name: "Close trade panel" }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(buy).toBeFocused();
});

test("390: the bar never covers the last content", async ({ page }) => {
  await open(page, 390);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = page.getByRole("contentinfo").getByRole("link", { name: "Terms" });
  const top = (await bar(page).boundingBox())?.y ?? 0;
  const box = await last.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(top);
});

test("768: the sheet is a centered 560px card on the bottom edge", async ({ page }) => {
  await open(page, 768);
  await bar(page)
    .getByRole("button", { name: `Buy ${coin.symbol}` })
    .click();
  // Polled: even under reduced motion the sheet keyframe starts one frame at translateY(100%).
  const bottom = async () => {
    const b = await sheet(page).boundingBox();
    return b && Math.round(b.y + b.height);
  };
  await expect.poll(bottom).toBe(844);
  const box = await sheet(page).boundingBox();
  expect(box?.width).toBe(560);
  expect(box?.x).toBe(104);
});

test("1440: the panel is inline and no bar renders", async ({ page }) => {
  await open(page, 1440);
  await expect(column(page)).toBeVisible();
  await expect(bar(page)).toBeHidden();
});

test("crossing 1100px closes the sheet and the column keeps side and amount", async ({ page }) => {
  await open(page, 390);
  await bar(page)
    .getByRole("button", { name: `Sell ${coin.symbol}` })
    .click();
  await sheet(page).getByRole("textbox", { name: "You sell" }).fill("1000");
  await page.setViewportSize({ width: 1200, height: 844 });
  await expect(sheet(page)).toBeHidden();
  await expect(column(page).getByRole("textbox", { name: "You sell" })).toHaveValue("1000");
  await expect(column(page).getByRole("button", { name: "Sell", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("390: an in-flight trade keeps the sheet open", async ({ page }) => {
  test.skip(!!STAGING, "the fake Phantom's consent needs the local stubs");
  await page.setViewportSize({ width: 390, height: 844 });
  await stubTrade(page, { prepare: { json: PREPARED, delayMs: 5_000 } });
  const account = newTestAccount();
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await page.goto(`/coin/${coin.mint}`);
  const buy = bar(page).getByRole("button", { name: `Buy ${coin.symbol}` });
  await buy.click();
  const go = sheet(page).locator("form > button");
  await go.click(); // Connect Phantom to trade
  await sheet(page).getByRole("textbox", { name: "You pay" }).fill("0.5");
  await expect(go).toHaveText(`Buy ${coin.symbol} with 0.50 SOL`);
  await go.click();
  await expect(go).toHaveText("Preparing trade…");
  const close = sheet(page).getByRole("button", { name: "Close trade panel" });
  await expect(close).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await page.mouse.click(195, 4); // the backdrop
  await expect(sheet(page)).toBeVisible();
  await expect(go).toHaveText("Preparing trade…");
  await expect(
    sheet(page)
      .getByRole("status")
      .filter({ hasText: `Bought 17,234,567 ${coin.symbol}.` }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(close).not.toHaveAttribute("aria-disabled");
  await close.click();
  await expect(sheet(page)).toBeHidden();
  await expect(buy).toBeFocused();
});
