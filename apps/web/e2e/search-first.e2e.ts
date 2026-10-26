// Home search with exact ticker matches (D-44, UI-SPEC A3, A5 item 11): the oldest exact match leads and carries
// the plain "First" Tag; a lone exact match carries none. Tickers are random, so no real coin matches.
import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import { gate, PHASE7_SHOTS } from "./shoot.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const ticker = () => `F${randomBytes(4).toString("hex").toUpperCase()}`;

test.describe.configure({ timeout: 90_000 });
test.skip(!sql, "needs DATABASE_URL in the root .env");

const seeded: Seeded[] = [];
async function seed(symbol: string, launched: string): Promise<Seeded> {
  const db = sql as postgres.Sql;
  const c = await seedCoin(db, { trades: 0, coin: { launched_at: new Date(launched) } });
  await db`update launches set symbol = ${symbol} where mint = ${c.mint}`;
  seeded.push(c);
  return c;
}
test.afterAll(async () => {
  for (const c of seeded) await dropCoin(sql as postgres.Sql, c.mint);
});

const cards = (page: Page) => page.getByRole("list", { name: "Coins" }).getByRole("link");
const marked = (page: Page) => page.getByRole("link", { name: /first launched with this ticker/i });

test("three exact matches and a partial: the oldest exact leads and is the only First", async ({ page }) => {
  const key = ticker();
  const oldest = await seed(key, "2099-05-01T00:00:00Z");
  await seed(key, "2099-05-03T00:00:00Z");
  await seed(key, "2099-05-02T00:00:00Z");
  await seed(`${key}X`, "2099-05-04T00:00:00Z"); // newest, so only the exact rule puts it last
  await page.goto(`/?q=${key.toLowerCase()}`);
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).first()).toHaveAttribute("href", `/coin/${oldest.mint}`);
  await expect(marked(page)).toHaveCount(1);
  await expect(marked(page)).toHaveAttribute("href", `/coin/${oldest.mint}`);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "search-first", width, PHASE7_SHOTS);
  }
});

test("a single exact match has no First marker", async ({ page }) => {
  const key = ticker();
  await seed(key, "2099-05-05T00:00:00Z");
  await page.goto(`/?q=${key.toLowerCase()}`);
  await expect(cards(page)).toHaveCount(1);
  await expect(marked(page)).toHaveCount(0);
});
