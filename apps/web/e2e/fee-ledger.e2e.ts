// The token page's Fee ledger panel on seeded fee_ledger rows (TOKEN-04): landed rows newest first, each with
// its Solscan transaction link, the launch row last, no pending or held row ever shown, and paging by 20.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeSig, type Seeded, seedCoin, seedLedger } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as coin.e2e.ts explains.
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const HELD_REASON = "deployer is off curve";

test.describe.configure({ timeout: 90_000 }); // a Neon cold start and a first route compile
test.skip(!sql, "needs DATABASE_URL in the root .env");
test.use({ reducedMotion: "reduce" });

const ledger = (page: Page) => page.getByRole("region", { name: "Fee ledger" });
const entries = (page: Page) =>
  ledger(page).getByRole("list", { name: "Fee movements, newest first" }).getByRole("listitem");

test.describe("seeded ledger", () => {
  let coin: Seeded;
  let landed: string[] = []; // signatures, newest first
  let pendingSig = "";

  test.beforeAll(async () => {
    coin = await seedCoin(db(), { trades: 60 }); // launched an hour ago
    const [collect] = await seedLedger(db(), coin.mint, [
      { kind: "collect", amount: "1000000000", sol: "3000000", window_index: 0, landed_at: ago(40) },
    ]);
    const sweepSig = fakeSig();
    const [split] = await seedLedger(db(), coin.mint, [
      {
        kind: "split_treasury",
        amount: "100000000",
        sol: "300000",
        ref: Number(collect.id),
        landed_at: ago(39),
      },
    ]);
    await seedLedger(db(), coin.mint, [
      {
        kind: "sweep_buyback",
        amount: "810000000",
        sol: "2430000",
        window_index: 0,
        signature: sweepSig,
        landed_at: ago(10),
      },
      {
        kind: "sweep_treasury",
        amount: "90000000",
        sol: "270000",
        window_index: 0,
        signature: sweepSig,
        landed_at: ago(10),
      },
    ]);
    pendingSig = fakeSig();
    await seedLedger(db(), coin.mint, [
      { kind: "collect", state: "pending", amount: "5000000", signature: pendingSig },
      { kind: "held", state: null, signature: null, detail: { reason: HELD_REASON } },
    ]);
    landed = [sweepSig, sweepSig, split.signature as string, collect.signature as string];
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(db(), coin.mint);
  });

  test("lists the four landed fee rows newest first, then the launch row", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    await expect(ledger(page).getByRole("heading", { name: "Fee ledger", level: 2 })).toBeVisible();
    const items = entries(page);
    await expect(items).toHaveCount(5);
    const tags = ["Sweep", "Sweep", "Split 90/10", "Collect", "Launch burn"];
    for (const [i, tag] of tags.entries()) await expect(items.nth(i)).toContainText(tag);
  });

  test("every fee row links its transaction on Solscan", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    const items = entries(page);
    await expect(items).toHaveCount(5);
    for (const [i, sig] of landed.entries()) {
      const href = await items.nth(i).getByRole("link").first().getAttribute("href");
      expect(href?.startsWith("https://solscan.io/tx/")).toBe(true);
      expect(href).toContain(sig);
    }
  });

  test("a pending or held row never renders", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    await expect(ledger(page)).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(pendingSig);
    expect(html).not.toContain(`${pendingSig.slice(0, 4)}…${pendingSig.slice(-4)}`);
    expect(html).not.toContain(HELD_REASON);
  });
});

test.describe("paging", () => {
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(db(), { trades: 60 });
    const rows = Array.from({ length: 25 }, (_, i) => ({
      kind: "collect",
      amount: String(1_000_000 + i),
      sol: "3000",
      window_index: 0,
      landed_at: new Date(Date.now() - 5 * 60_000 - i * 60_000),
    }));
    await seedLedger(db(), coin.mint, rows);
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(db(), coin.mint);
  });

  test("shows 20 rows, then loads the rest back to the launch", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    const items = entries(page);
    await expect(items).toHaveCount(20);
    const more = ledger(page).getByRole("button", { name: "Load 20 older entries" });
    await more.click();
    // 20 s: a dev server compiles the route on its first request, and Neon may be waking.
    await expect(ledger(page).getByText("That is every fee movement since launch.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(items).toHaveCount(26); // 25 collects and the launch row
    await expect(more).toHaveCount(0);
  });
});
