// Proves the console's top row and the Neon rule (ADMIN-02, ADMIN-06, D-21, D-22): the Wallets rows and the
// Health panel render for the signed-in owner; health polls every 10 s only while the tab is visible and the
// timer never calls the Postgres-backed overview; Refresh sends exactly one overview call and updates "Loaded";
// a 401 on a poll swaps the console for the session-ended sign-in card. The clock is Playwright's fake clock,
// advanced a second at a time with no health request left in flight, so the 10 s cadence is exact.
import { expect, type Page, type Request, test } from "@playwright/test";
import { openConsole } from "./admin.ts";

type Calls = { health: number; overview: number; open: number };

const kind = (r: Request): "health" | "overview" | null => {
  if (r.method() !== "POST") return null;
  const path = new URL(r.url()).pathname;
  return path === "/api/admin/health" ? "health" : path === "/api/admin/overview" ? "overview" : null;
};

function track(page: Page): Calls {
  const c: Calls = { health: 0, overview: 0, open: 0 };
  page.on("request", (r) => {
    const k = kind(r);
    if (!k) return;
    c[k]++;
    c.open++;
  });
  const done = (r: Request) => {
    if (kind(r)) c.open--;
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return c;
}

async function advance(page: Page, c: Calls, ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    await page.clock.runFor(1000);
    await expect.poll(() => c.open).toBe(0);
    await page.waitForTimeout(30); // the page schedules its next poll just after the answer lands
  }
}

// The tab's visibility, flipped from the spec: headless Chromium always reports visible.
const visibility = () =>
  Object.defineProperty(Document.prototype, "visibilityState", {
    configurable: true,
    get: () => ((window as unknown as { hidden_?: boolean }).hidden_ ? "hidden" : "visible"),
  });

const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    (window as unknown as { hidden_?: boolean }).hidden_ = h;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test.describe("admin-console", () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the owner sees the Wallets rows and the Health panel", async ({ page }) => {
    await openConsole(page);
    const wallets = page.getByRole("region", { name: "Wallets" });
    for (const name of ["Treasury", "Buyback", "Ops, fee payer"])
      await expect(wallets.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Health" })).toBeVisible();
  });

  test("health polls every 10 s only while visible and the timer never loads the overview", async ({
    page,
  }) => {
    await page.addInitScript(visibility);
    await page.clock.install();
    const c = track(page);
    await openConsole(page);
    // Dev StrictMode mounts the poll twice, so the first poll can be two requests; one chain survives.
    await expect.poll(() => c.health).toBeGreaterThan(0);
    await expect.poll(() => c.open).toBe(0);
    const start = c.health;
    await advance(page, c, 35_000);
    expect(c.health - start).toBeGreaterThanOrEqual(3);
    expect(c.overview).toBe(0);

    await setHidden(page, true);
    const hiddenAt = c.health;
    await advance(page, c, 60_000);
    expect(c.health).toBe(hiddenAt);

    await setHidden(page, false);
    await expect.poll(() => c.health).toBe(hiddenAt + 1);
    expect(c.overview).toBe(0);
  });

  test("Refresh sends exactly one overview call and updates Loaded", async ({ page }) => {
    const c = track(page);
    await openConsole(page);
    const loadedAt = new Date(2026, 0, 2, 3, 7).getTime();
    await page.route("**/api/admin/overview", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), loadedAt } });
    });
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Loaded 03:07")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(c.overview).toBe(1);
  });

  test("a 401 on a health poll swaps to the session-ended card", async ({ page }) => {
    await page.clock.install();
    const c = track(page);
    await openConsole(page);
    await expect.poll(() => c.health).toBeGreaterThan(0);
    await page.route("**/api/admin/health", (r) =>
      r.fulfill({ status: 401, json: { error: "unauthorized" } }),
    );
    await advance(page, c, 11_000);
    await expect(page.getByText("Your admin session ended after 30 minutes. Sign in again.")).toBeVisible();
  });
});
