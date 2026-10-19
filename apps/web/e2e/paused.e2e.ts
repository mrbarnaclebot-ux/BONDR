import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { current, liveStatus, toStep2, toStep3 } from "./coin.ts";
import { injectPhantom, newTestAccount, rootEnv } from "./phantom.ts";

// Flips the real kill switch on the Neon dev branch. The "paused" project runs this file after every other
// spec, so no parallel test sees the pause; finally and afterAll make sure launches end up enabled.
const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : undefined;
const enable = (on: boolean) =>
  (sql as postgres.Sql)`update settings set launches_enabled = ${on} where id = 1`;
const PAUSED =
  "The BONDR owner has paused new launches. You can fill this in now; the Launch button unlocks automatically when launches resume.";
// Worker cache 5 s plus the page's 10 s poll, with room for a request in flight.
const WITHIN = { timeout: 20_000 };

test.describe.configure({ timeout: 120_000 });
test.skip(!sql, "needs DATABASE_URL in the root .env");
test.afterAll(async () => {
  if (!sql) return;
  const [settings] = await sql`select launches_enabled from settings where id = 1`;
  expect(settings?.launches_enabled).toBe(true);
  await sql.end({ timeout: 5 });
});

test("the kill switch pauses the form without a reload and clears when lifted", async ({ page }) => {
  const { minLamports } = await liveStatus(page);
  await injectPhantom(page, newTestAccount()); // installed but not connected, so the button can re-enable
  await page.goto("/launch");
  await expect(current(page)).toHaveText(/01\s*Coin/);
  await page.evaluate(() => Object.assign(window, { __sameLoad: true }));
  const callout = page.getByRole("status").filter({ hasText: "Launches are paused." });
  try {
    await enable(false);
    await expect(callout).toBeVisible(WITHIN);
    await expect(callout).toContainText(PAUSED);
    const panel = page.getByRole("region", { name: "Step 1 of 5: Coin" });
    expect((await callout.boundingBox())?.y).toBeLessThan((await panel.boundingBox())?.y ?? 0);
    await toStep2(page); // the form stays fillable while paused
    await expect(callout).toBeVisible();
    await toStep3(page, minLamports as string);
    await expect(page.getByRole("button", { name: "Launches paused" })).toBeDisabled();
  } finally {
    await enable(true);
  }
  await expect(callout).toBeHidden(WITHIN);
  await expect(page.getByRole("button", { name: "Launches paused" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Phantom to launch" })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
});
