// Proves the Fee wallets (W) table (ADMIN-02, D-24): seven stubbed coins, one per state, sort stuck first, the
// first stuck coin is selected after the load, the chip counts, a client-side filter, and the sticky Coin column
// at 390px. Stubbed: the real overview answer is fetched and only its rows and coin memory are replaced, so no
// DB row is written.
import type { AdminCoinMemory } from "@bondr/core/api-admin";
import { expect, type Page, test } from "@playwright/test";
import type { WRow } from "../lib/admin-data.ts";
import { openConsole } from "./admin.ts";

const H = 3_600_000;
const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const W = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const coin = (mint: string, symbol: string, over: Partial<WRow> = {}): WRow => ({
  ...{ mint, symbol, name: symbol, image: null, w: W, venue: "curve", finalize: "none" },
  ...{ feeBudget: "100", feesUnclaimed: "0", cost: "1000", bondrSol: 0.001, launchedAt: iso(5 * H) },
  ...{ lastCollectAt: iso(H), heldAt: null, heldReason: null, bondSent: false, bondedAt: null },
  launch: "landed",
  ...over,
});

const ROWS: WRow[] = [
  coin("Stuck1111", "STUK", { venue: "pool" }),
  coin("Unconf111", "UNCF", { launch: "unconfirmed", cost: null }),
  coin("Held11111", "HELD", { heldAt: iso(H), heldReason: "owner review" }),
  coin("Trig11111", "TRIG", { feeBudget: "2000" }),
  coin("Coll11111", "COLL"),
  coin("Bond11111", "BOND", { venue: "pool", bondedAt: iso(2 * H) }),
  coin("Fin111111", "FINL", { venue: "pool", finalize: "done", bondedAt: iso(3 * H) }),
];
const MEMORY: AdminCoinMemory[] = [
  {
    mint: "Stuck1111",
    stuck: { step: "finalize", attempts: 3, code: "job_error", at: Date.now() },
    hold: null,
    busy: false,
  },
];
const BALANCES = {
  ...{ treasurySol: "0", treasuryBondr: "0", buybackSol: "0", buybackBondr: "0", opsSol: "1000000000" },
  ...{ opsFloor: "100000000", bondrSol: null, nextBurnAt: Date.now() + H },
};

// Replace the rows and coin memory of the real overview answer, then load it through Refresh.
async function stubbed(page: Page) {
  await page.route("**/api/admin/overview", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.rows = ROWS;
    body.worker = { balances: body.worker?.balances ?? BALANCES, coins: MEMORY };
    await route.fulfill({ response: res, json: body });
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  const table = page.getByRole("region", { name: "Fee wallets table, scrolls sideways" });
  await expect(table.getByRole("button", { name: "STUK, open timeline" })).toBeVisible();
  return table;
}

test.describe("admin-wtable", () => {
  test.describe.configure({ timeout: 90_000 });

  test("stuck first and selected, chip counts, and a client-side filter", async ({ page }) => {
    await openConsole(page);
    const table = await stubbed(page);
    const first = table.locator("tbody tr").first();
    await expect(first.getByRole("button", { name: "STUK, open timeline" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(first.getByText("Finalize stuck")).toBeVisible();
    await expect(first.getByText("Retry finalize split")).toBeVisible();
    const filters = page.getByRole("group", { name: "Filter coins by state" });
    for (const name of ["All 7", "Stuck 2", "Trigger ready 1", "Held 1", "Collecting 1", "Finalized 1"])
      await expect(filters.getByRole("button", { name, exact: true })).toBeVisible();
    await filters.getByRole("button", { name: "Held 1" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.getByRole("button", { name: "HELD, open timeline" })).toBeVisible();
    await expect(table.getByText("Held: owner review")).toBeVisible();
  });

  test("the Coin column stays in view while the table scrolls sideways at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openConsole(page);
    const table = await stubbed(page);
    await table.scrollIntoViewIfNeeded();
    await table.evaluate((el) => {
      el.scrollLeft = 400;
    });
    expect(await table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const coin = table.getByRole("button", { name: "STUK, open timeline" });
    await expect(coin).toBeInViewport();
    // Sticky: the Coin cell still starts at the region's left edge after the sideways scroll.
    const [box, region] = [await coin.boundingBox(), await table.boundingBox()];
    expect(box && region && box.x - region.x).toBeLessThan(60);
    const page_ = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(page_[0]).toBeLessThanOrEqual(page_[1]); // only the table scrolls sideways, never the page
  });
});
