// The token page Sniped line (D-35, D-36, UI-SPEC surface 4) on throwaway seeded coins. Its own file because
// coin.e2e.ts sits at the 300-line limit.
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import { gate, PHASE7_SHOTS } from "./shoot.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const LINE =
  "Sniped 3.2% of supply. BONDR cannot stop third-party buys at launch. This shows how much was bought in the first 3 slots.";
// Any wording that promises protection is forbidden on the product (D-36).
const FORBIDDEN = /sniper-proof|anti-snipe|snipe protection|no snipers|fair launch guaranteed/i;

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");

const seeded: Seeded[] = [];
test.afterAll(async () => {
  for (const c of seeded) await dropCoin(db(), c.mint);
});

const seed = async (coin: Record<string, string | number | null>) => {
  const c = await seedCoin(db(), { trades: 3, coin });
  seeded.push(c);
  return c;
};

test("a coin with a create slot shows the Sniped line under the proof, outside it", async ({ page }) => {
  const c = await seed({ create_slot: "1000", sniped_bps: 320 });
  await page.goto(`/coin/${c.mint}`);
  const proof = page.getByRole("complementary", { name: "Launch supply proof" });
  await expect(proof).toBeVisible();
  const line = page.getByText(LINE, { exact: true });
  await expect(line).toBeVisible();
  await expect(proof.getByText("Sniped")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(line).toBeVisible();
    await gate(page, "coin-sniped", width, PHASE7_SHOTS);
  }
});

test("a coin without a create slot shows no Sniped text", async ({ page }) => {
  const c = await seed({ create_slot: null, sniped_bps: null });
  await page.goto(`/coin/${c.mint}`);
  await expect(page.getByRole("complementary", { name: "Launch supply proof" })).toBeVisible();
  await expect(page.getByText(/Sniped/)).toHaveCount(0);
});
