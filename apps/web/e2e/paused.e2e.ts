import { expect, test } from "@playwright/test";
import { current, liveStatus, toStep2, toStep3 } from "./coin.ts";
import { injectPhantom, newTestAccount, rootEnv } from "./phantom.ts";
import { gate } from "./shoot.ts";

// Flips the real kill switch through the worker's route, which writes the Neon dev branch and the worker's
// memory. The "paused" project runs this file after every other spec, so no parallel test sees the pause;
// finally and afterAll make sure launches end up enabled.
const { WORKER_URL, WORKER_TOKEN } = rootEnv();
async function enable(on: boolean) {
  const r = await fetch(`${WORKER_URL}/kill-switch`, {
    method: "POST",
    headers: { authorization: `Bearer ${WORKER_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ enabled: on }),
  });
  expect(await r.json()).toEqual({ enabled: on });
}
const PAUSED =
  "The BONDR owner has paused new launches. You can fill this in now; the Launch button unlocks automatically when launches resume.";
// The page's 10 s poll, with room for a request in flight.
const WITHIN = { timeout: 20_000 };

// Both tests flip the one switch, so they run in order in one worker, not in parallel.
test.describe.configure({ mode: "default", timeout: 120_000 });
test.skip(!WORKER_URL || !WORKER_TOKEN, "needs WORKER_URL and WORKER_TOKEN in the root .env");
test.afterAll(async () => {
  if (WORKER_URL && WORKER_TOKEN) await enable(true);
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

// The home paused surface of the Phase 3 matrix: the banner and the disabled hero button at three widths.
// The banner is read once per server render, so a reload picks the pause up.
test("home shows the paused banner and a disabled Launches paused at every width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    await enable(false);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(async () => {
        await page.goto("/");
        await expect(page.getByText("Launches paused.", { exact: true })).toBeVisible({ timeout: 2000 });
      }).toPass(WITHIN);
      await expect(
        page.getByText("The BONDR owner has paused new launches. Browsing is unaffected."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Launches paused" })).toBeDisabled();
      await gate(page, "home-paused", width);
    }
  } finally {
    await enable(true);
  }
});
