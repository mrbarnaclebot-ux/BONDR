// The home page /: the hero with its counts and links, the header Launch link, and the All coins grid on a
// seeded coin with the highest market cap and the newest launch time, so it is first in Top and Latest.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeMint, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll: a fullyParallel worker reuses the module (see coin.e2e.ts).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds

test.describe("hero", () => {
  test("/ is the home page with the hero, its links and the pulse line", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle("BONDR: built to bond");
    await expect(page.getByRole("heading", { level: 1, name: "Built to bond." })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Launch a coin" }).first()).toHaveAttribute(
      "href",
      "/launch",
    );
    await expect(main.getByRole("link", { name: "See all coins" })).toHaveAttribute("href", "#all-coins");
    await expect(
      main.getByText(/^(\d[\d,]* coins? launched, \d[\d,]* bonded\.|No coins launched yet\.)$/),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "All coins" })).toBeVisible();
    await expect(page.getByText("Next to bond")).toHaveCount(0); // D-08
  });

  for (const path of ["/", "/terms"]) {
    test(`the header links to /launch on ${path}`, async ({ page }) => {
      await page.goto(path);
      const link = page.getByRole("banner").getByRole("link", { name: "Launch a coin" });
      await expect(link).toHaveAttribute("href", "/launch");
      await expect(link).not.toHaveAttribute("aria-current", "page");
    });
  }

  test("the header link is current on /launch", async ({ page }) => {
    await page.goto("/launch");
    await expect(page.getByRole("banner").getByRole("link", { name: "Launch a coin" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

test.describe("grid", () => {
  test.skip(!sql, "needs DATABASE_URL in the root .env");
  test.describe.configure({ mode: "serial" }); // one worker, one seeded coin: parallel workers would each seed one
  let coin: Seeded;
  test.beforeAll(async () => {
    const at = new Date(Date.now() + 60_000); // newest launch, even next to a launch that lands mid-run
    coin = await seedCoin(sql as postgres.Sql, {
      trades: 0,
      coin: { launched_at: at, mcap_sol: 900_000, launch_mcap_sol: 750_000, progress: 0.642 },
    });
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(sql as postgres.Sql, coin.mint);
  });

  const card = (page: Page) =>
    page.getByRole("list", { name: "Coins" }).getByRole("link", { name: new RegExp(`E2E ${coin.symbol}`) });

  /** The list is kept 10 s per process, so a page rendered just before the seed can miss the coin. */
  async function open(page: Page, path: string) {
    await expect(async () => {
      await page.goto(path);
      await expect(card(page)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  }

  test("a seeded coin is a card with its numbers", async ({ page }) => {
    await open(page, "/");
    const c = card(page);
    await expect(c).toHaveAttribute("href", `/coin/${coin.mint}`);
    await expect(c).toContainText(coin.symbol);
    await expect(c).toContainText("900,000 SOL");
    await expect(c.locator("[data-field=change]")).toHaveText("+20.0%");
    await expect(c).toContainText("curve 64.2%");
    await expect(c.getByRole("img", { name: "Curve 64.2 percent filled" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Coins" }).getByRole("listitem").first()).toContainText(
      coin.symbol,
    );
  });

  test("Top, Latest and Oldest switch in place and keep the sort in the URL", async ({ page }) => {
    await open(page, "/");
    const group = page.getByRole("group", { name: "Sort coins" });
    const tab = (name: string) => group.getByRole("button", { name });
    await expect(tab("Top")).toHaveAttribute("aria-pressed", "true");
    const before = await page.evaluate(() => history.length);

    await tab("Latest").click();
    await expect(tab("Latest")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\?sort=latest$/);
    await expect(page.getByRole("list", { name: "Coins" }).getByRole("listitem").first()).toContainText(
      coin.symbol,
    );

    await tab("Oldest").click();
    await expect(page).toHaveURL(/\?sort=oldest$/);
    await expect(page.getByRole("list", { name: "Coins" })).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("list", { name: "Coins" }).getByRole("listitem").first()).not.toContainText(
      coin.symbol,
    );

    await tab("Top").click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test("?sort=latest renders Latest on the server", async ({ page }) => {
    await open(page, "/?sort=latest");
    await expect(
      page.getByRole("group", { name: "Sort coins" }).getByRole("button", { name: "Latest" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("the coins route checks sort and page", async ({ request }) => {
    for (const q of ["sort=bad", "page=-1", "page=100", "page=1.5", `q=${"a".repeat(65)}`])
      expect((await request.get(`/api/coins?${q}`)).status(), q).toBe(400);
    const res = await request.get("/api/coins?sort=latest&page=0");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = (await res.json()) as { coins: { mint: string }[]; more: boolean };
    expect(typeof body.more).toBe("boolean");
    expect(body.coins.length).toBeLessThanOrEqual(50);
  });
});

test.describe("search", () => {
  test.skip(!sql, "needs DATABASE_URL in the root .env");
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(sql as postgres.Sql, { trades: 0, coin: { mcap_sol: 800_000 } });
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(sql as postgres.Sql, coin.mint);
  });

  const box = (page: Page) => page.getByRole("searchbox", { name: "Search coins by name, symbol or mint" });
  const grid = (page: Page) => page.getByRole("list", { name: "Coins" });
  const card = (page: Page) => grid(page).getByRole("link", { name: new RegExp(`E2E ${coin.symbol}`) });

  test("2+ characters search by symbol in any case, one character does nothing, Escape clears", async ({
    page,
  }) => {
    await page.goto("/");
    const first = await grid(page).getByRole("listitem").first().textContent();
    await box(page).fill("z");
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/\/$/);
    await expect(grid(page).getByRole("listitem").first()).toHaveText(first ?? "");

    await box(page).fill(coin.symbol.toLowerCase());
    await expect(card(page)).toBeVisible();
    await expect(page.getByText(/^(\d+ coins match|1 coin matches)$/)).toBeAttached();
    await expect(page).toHaveURL(new RegExp(`\\?q=${coin.symbol.toLowerCase()}$`));
    await page.reload();
    await expect(box(page)).toHaveValue(coin.symbol.toLowerCase());
    await expect(card(page)).toBeVisible();

    await box(page).press("Escape");
    await expect(box(page)).toHaveValue("");
    await expect(box(page)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await expect(grid(page).getByRole("listitem").first()).toHaveText(first ?? "");
  });

  test("a mint prefix finds the coin; a full BONDR mint opens it", async ({ page }) => {
    await page.goto("/");
    await box(page).fill(coin.mint.slice(0, 6));
    await expect(card(page)).toBeVisible();
    await expect(page.getByText("1 coin matches")).toBeAttached();
    await box(page).fill(coin.mint);
    await expect(page).toHaveURL(new RegExp(`/coin/${coin.mint}$`));
  });

  test("a mint not on BONDR and a miss show their empty states with Clear search", async ({ page }) => {
    await page.goto("/");
    await box(page).fill(fakeMint());
    await expect(page.getByRole("heading", { name: "No BONDR coin at this address" })).toBeVisible();
    await box(page).fill("zzzzqq");
    await expect(page.getByRole("heading", { name: 'No BONDR coin matches "zzzzqq"' })).toBeVisible();
    await expect(page.getByText("No coins match")).toBeAttached();
    await page.getByRole("main").getByRole("button", { name: "Clear search" }).last().click();
    await expect(box(page)).toHaveValue("");
    await expect(box(page)).toBeFocused();
    await expect(grid(page)).toBeVisible();
  });
});
