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

// UI-SPEC Bond and burn on curve (TOKEN-03) and the pre-bond totals (TOKEN-05), from seeded coin fee columns.
// bondr_sol 1e6 lamports per base unit, so 504 base units read 0.504 SOL.
test.describe("Bond and burn", () => {
  const seeded: Seeded[] = [];
  const seed = async (coin: Record<string, string | number | null>) => {
    const c = await seedCoin(db(), { trades: 60, coin });
    seeded.push(c);
    return c;
  };
  test.afterAll(async () => {
    for (const c of seeded) await dropCoin(db(), c.mint);
  });
  const bond = (page: Page) => page.getByRole("region", { name: "Bond and burn" });
  const step = (page: Page) => bond(page).locator('[aria-current="step"]');

  test("no fees yet reads 0 and the flow sits on Collect", async ({ page }) => {
    const c = await seed({ fee_budget: "0", cost_to_complete: "1000", bondr_sol: 1e6 });
    await page.goto(`/coin/${c.mint}`);
    const panel = bond(page);
    await expect(panel).toContainText("0.0%");
    await expect(panel).toContainText("No creator fees yet.");
    await expect(panel.getByText("0", { exact: true })).toBeVisible();
    await expect(step(page)).toContainText("Collect");
  });

  test("a half budget shows its ratio, track label, window and Split step", async ({ page }) => {
    const c = await seed({ fee_budget: "504", cost_to_complete: "1000", bondr_sol: 1e6 });
    await page.goto(`/coin/${c.mint}`);
    const panel = bond(page);
    await expect(panel).toContainText("50.4%");
    await expect(panel).toContainText("0.504");
    await expect(
      panel.getByRole("img", {
        name: "Burn budget is 50.4 percent of the cost to complete the curve. Forced bond fires at 105 percent.",
      }),
    ).toBeVisible();
    await expect(step(page)).toContainText("Split 90/10");
    await expect(panel.getByText("Window 1 closes in")).toBeVisible();
    await expect(panel.getByText(/^\d+h \d+m$/)).toBeVisible();
  });

  test("an unknown cost is not measured yet", async ({ page }) => {
    const c = await seed({ fee_budget: "504", cost_to_complete: null, bondr_sol: 1e6 });
    await page.goto(`/coin/${c.mint}`);
    await expect(bond(page).getByRole("img", { name: "Burn budget not measured yet." })).toBeVisible();
  });

  test("past 105% the flow is on Force bond", async ({ page }) => {
    const c = await seed({ fee_budget: "1060", cost_to_complete: "1000", bondr_sol: 1e6 });
    await page.goto(`/coin/${c.mint}`);
    await expect(bond(page)).toContainText("106.0%");
    await expect(bond(page)).toContainText("The budget is past 105%.");
    await expect(step(page)).toContainText("Force bond");
  });

  test("totals show treasury and the launch burn; the stats row shows Supply burned", async ({ page }) => {
    // The seeded launch burns 31,120,363.129479 tokens: 3.11% of the 1B supply, 31.1M.
    const c = await seed({ to_treasury: "5000000000", to_treasury_sol: "150000000", bondr_sol: 1e6 });
    await page.goto(`/coin/${c.mint}`);
    const total = (label: string) => ledger(page).locator(`dt:text-is("${label}") + dd`);
    await expect(total("To treasury")).toHaveText("0.15 SOL");
    await expect(ledger(page)).toContainText("5,000 BONDR, the 10% share");
    await expect(total("Supply burned")).toHaveText("3.11%");
    await expect(ledger(page)).toContainText(`31.1M ${c.symbol} burned`);
    await expect(total("To buyback")).toHaveText("0 SOL");
    await expect(total("Deployer share")).toHaveText("After bond");
    await expect(page.locator('dt:text-is("Supply burned") + dd').first()).toHaveText("3.11%");
  });
});
