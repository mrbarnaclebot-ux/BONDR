// The live home page (LIST-04, D-12 to D-15) on a stubbed /api/live: a trade updates and flashes every card of
// its coin, a launch slides into Latest with the glow and counts up the hero, a resync refetches once, and the
// 60 s re-rank waits while the pointer is over the grid. Kept apart from home.e2e.ts for the 300-line limit.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeMint, fakeSig, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;

test.describe.configure({ timeout: 60_000, mode: "serial" }); // one worker, one pair of seeded coins
test.skip(!sql, "needs DATABASE_URL in the root .env");

const sse = (events: [string, unknown][]) =>
  `retry: 60000\n\n${events.map(([e, d], i) => `id: e2e-${i}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("")}`;

/** Answers /api/live with `events` once `gate` resolves, so a test can read the server render first. */
async function stubLive(page: Page, events: [string, unknown][], gate?: Promise<void>) {
  await page.route(
    (u) => u.pathname === "/api/live",
    async (r) => {
      await gate;
      await r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) });
    },
  );
}

function gate() {
  let open = () => {};
  const shut = new Promise<void>((r) => {
    open = r;
  });
  return { shut, open };
}

const live = (mint: string, over: Record<string, unknown> = {}) => ({
  mint,
  venue: "curve",
  mcapSol: 861_000,
  progress: 0.25,
  vol1h: 4_000_001,
  vol24h: 4_000_001,
  change1h: 0.1,
  lastTradeAt: new Date().toISOString(),
  bondSol: null,
  bondrAtBond: null,
  realQuoteReserves: "0",
  holders: 7,
  ...over,
});

function trade(mint: string, side: "buy" | "sell", over: Record<string, unknown> = {}) {
  const t = { signature: fakeSig(), ix: 0, side, launch: false, venue: "curve", trader: fakeMint() };
  const rest = { tokenAmount: "1000", sol: "1000000", mcapSol: 1, at: new Date().toISOString() };
  return { trade: { ...t, ...rest, slot: "1", seq: "1", mint }, coin: live(mint, over) };
}

function launchRow() {
  const symbol = `L${Date.now() % 100_000}`;
  const at = new Date().toISOString();
  const row = {
    name: `E2E ${symbol}`,
    symbol,
    imageCid: null,
    exit: "burn",
    launchedAt: at,
    launchMcapSol: 28,
  };
  return { ...live(fakeMint(), { mcapSol: 28, progress: 0, vol1h: 0, vol24h: 0, change1h: null }), ...row };
}

const grid = (page: Page) => page.getByRole("list", { name: "Coins" });
const trending = (page: Page) => page.getByRole("region", { name: "Trending coins" });
const pulse = (page: Page) =>
  page.getByRole("main").getByText(/^\d[\d,]* coins? launched, \d[\d,]* bonded\.$/);
const order = (page: Page) =>
  grid(page)
    .getByRole("link")
    .evaluateAll((a) => a.map((e) => e.getAttribute("href")));

let a: Seeded;
let b: Seeded;
test.beforeAll(async () => {
  a = await seedCoin(db(), { trades: 0, coin: { mcap_sol: 850_000 } });
  b = await seedCoin(db(), { trades: 0, coin: { mcap_sol: 840_000 } });
  // A 1h volume no real coin reaches, so `a` is in Trending whatever else trades on devnet.
  const row = { signature: fakeSig(), ix: 0, mint: a.mint, slot: "2000", at: new Date(Date.now() - 600_000) };
  await db()`insert into trades ${db()({ ...row, side: "buy", venue: "curve", trader: fakeMint(), token_amount: "1000", sol: "4000000000000000", mcap_sol: 850_000 })}`;
});
test.afterAll(async () => {
  if (a) await dropCoin(db(), a.mint);
  if (b) await dropCoin(db(), b.mint);
});

const card = (page: Page, where: typeof grid, mint: string) => where(page).locator(`a[href="/coin/${mint}"]`);

/** The lists are kept 10 s per process, so a page rendered just before the seed can miss the coins. */
async function open(page: Page, path = "/") {
  await expect(async () => {
    await page.goto(path);
    await expect(card(page, grid, a.mint)).toBeVisible({ timeout: 2000 });
    await expect(card(page, trending, a.mint)).toBeAttached({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

for (const [side, dir] of [
  ["buy", "up"],
  ["sell", "down"],
] as const) {
  test(`a ${side} updates the coin's cards in the grid and Trending and flashes ${dir}`, async ({ page }) => {
    await stubLive(page, [["trade", trade(a.mint, side)]]);
    await open(page);
    for (const where of [grid, trending]) {
      const c = card(page, where, a.mint);
      await expect(c.locator("[data-field=mcap]")).toHaveText("861,000 SOL");
      await expect(c.locator("[data-field=curve]")).toHaveText("25.0%");
      await expect(c.locator("[data-field=change]")).toHaveText("+10.0%");
      for (const f of ["mcap", "curve", "change"])
        await expect(c.locator(`[data-field=${f}]`)).toHaveClass(new RegExp(`animate-flash-${dir}`));
    }
    await expect(card(page, trending, a.mint)).toContainText("4,000,001 SOL 1h");
  });
}

test("with reduced motion a trade updates the numbers without a flash", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubLive(page, [["trade", trade(a.mint, "buy")]]);
  await open(page);
  const mcap = card(page, grid, a.mint).locator("[data-field=mcap]");
  await expect(mcap).toHaveText("861,000 SOL");
  await expect(mcap).not.toHaveClass(/animate-/);
});

test("a launch slides into Latest with the glow and counts up the hero", async ({ page }) => {
  const g = gate();
  const fresh = launchRow();
  await stubLive(page, [["launch", fresh]], g.shut);
  await page.goto("/?sort=latest");
  const launched = Number((await pulse(page).innerText()).split(" ")[0].replaceAll(",", ""));
  g.open();
  const first = grid(page).getByRole("listitem").first();
  await expect(first).toContainText(fresh.symbol);
  await expect(first.getByRole("link")).toHaveClass(/animate-launch/);
  await expect(pulse(page)).toContainText(`${(launched + 1).toLocaleString("en-US")} coin`);
});

test("a launch during a search is not inserted, and the hero still counts it", async ({ page }) => {
  const g = gate();
  const fresh = launchRow();
  await stubLive(page, [["launch", fresh]], g.shut);
  await page.goto("/?sort=latest&q=zzzzqq");
  const launched = Number((await pulse(page).innerText()).split(" ")[0].replaceAll(",", ""));
  g.open();
  await expect(pulse(page)).toContainText(`${(launched + 1).toLocaleString("en-US")} coin`);
  await expect(page.getByRole("heading", { name: 'No BONDR coin matches "zzzzqq"' })).toBeVisible();
  await expect(page.getByText(fresh.symbol)).toHaveCount(0);
});

test("a resync refetches the list and Trending in one GET", async ({ page }) => {
  const gets: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/coins") gets.push(r.url());
  });
  await stubLive(page, [["resync", {}]]);
  await open(page);
  await expect.poll(() => gets.length).toBe(1);
  expect(gets[0]).toContain("trending=1");
  await page.waitForTimeout(1000);
  expect(gets.length).toBe(1);
});

test("the re-rank waits while the pointer is over the grid, then reorders", async ({ page }) => {
  await page.clock.install();
  await stubLive(page, [["trade", trade(b.mint, "buy", { mcapSol: 860_000 })]]);
  await open(page);
  await expect(card(page, grid, b.mint).locator("[data-field=mcap]")).toHaveText("860,000 SOL");
  const before = (o: (string | null)[], x: Seeded, y: Seeded) =>
    o.indexOf(`/coin/${x.mint}`) < o.indexOf(`/coin/${y.mint}`);
  expect(before(await order(page), a, b)).toBe(true); // a trade alone never moves a card (D-12)

  await grid(page).hover();
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(500);
  expect(before(await order(page), a, b)).toBe(true);

  await page.mouse.move(0, 0);
  await expect.poll(async () => before(await order(page), b, a)).toBe(true);
});
