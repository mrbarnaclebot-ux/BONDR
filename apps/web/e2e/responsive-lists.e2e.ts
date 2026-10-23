// The Phase 3 UI-SPEC accessibility matrix: 8 surfaces at 390, 768 and 1440 (the paused banner is in
// paused.e2e.ts), each with no horizontal scroll, 0 axe violations and a full-page screenshot for the Designer.
// Each worker seeds a curve coin and a bonded coin with trades, so the lists and both token pages are stable.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeMint, fakeSig, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import { gate } from "./shoot.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll: a fullyParallel worker reuses the module (see coin.e2e.ts).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

test.describe.configure({ timeout: 90_000 }); // a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" }); // settled frames: flashes, glows and the hero video would blur shots
test.skip(!sql, "needs DATABASE_URL in the root .env");

let curve: Seeded;
let bonded: Seeded;
test.beforeAll(async () => {
  const db = sql as postgres.Sql;
  curve = await seedCoin(db, { coin: { progress: 0.642, mcap_sol: 61.4, holders: 37 } });
  bonded = await seedCoin(db, {
    coin: { venue: "pool", progress: 1, holders: 1284, bond_sig: fakeSig(), bonded_at: new Date() },
  });
});
test.afterAll(async () => {
  for (const c of [curve, bonded]) if (c) await dropCoin(sql as postgres.Sql, c.mint);
});

const heading = (page: Page, name: string | RegExp) =>
  expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 20_000 });

/** The coin list is kept 10 s per process, so a page rendered just before the seed can miss the coin. */
async function listed(page: Page, path: string, coin: Seeded) {
  const card = page.getByRole("list", { name: "Coins" }).getByRole("link", { name: new RegExp(coin.symbol) });
  await expect(async () => {
    await page.goto(path);
    await expect(card).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

/** The token page with its chart summary and candles drawn. */
async function coinPage(page: Page, coin: Seeded) {
  await page.goto(`/coin/${coin.mint}`);
  await expect(page.getByRole("img", { name: new RegExp(`^${coin.symbol} market cap in SOL`) })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("region", { name: "Market cap chart" }).locator("canvas").first(),
  ).toBeAttached();
  await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible({ timeout: 20_000 });
}

const SURFACES: Record<string, (page: Page) => Promise<void>> = {
  home: (page) => listed(page, "/", curve),
  "home-latest": async (page) => {
    await listed(page, "/?sort=latest", curve);
    await expect(page.getByRole("button", { name: "Latest" })).toHaveAttribute("aria-pressed", "true");
  },
  "home-search": (page) => listed(page, `/?q=${curve.symbol}`, curve),
  "home-nomatch": async (page) => {
    await page.goto("/?q=zzzzqq");
    await heading(page, 'No BONDR coin matches "zzzzqq"');
  },
  "home-mint": async (page) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search coins by name, symbol or mint" }).fill(fakeMint());
    await heading(page, "No BONDR coin at this address");
  },
  "coin-curve": (page) => coinPage(page, curve),
  "coin-bonded": async (page) => {
    await coinPage(page, bonded);
    await expect(page.getByText("Bonded, PumpSwap", { exact: true })).toBeVisible();
  },
  "coin-404": async (page) => {
    await page.goto(`/coin/${Array.from({ length: 44 }, (_, i) => B58[(i * 7) % 58]).join("")}`);
    await heading(page, "No BONDR coin here");
  },
};

for (const width of [390, 768, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const [name, reach] of Object.entries(SURFACES)) {
      test(name, async ({ page }) => {
        await reach(page);
        await gate(page, name, width);
      });
    }
  });
}
