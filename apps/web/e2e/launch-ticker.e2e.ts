// The ticker refusals in step 4 and step 1 (D-43, D-44, UI-SPEC A1, A2, A5 items 8-10). Prepare is stubbed, so
// the worker's own cooldown plays no part; the copy itself is pinned in lib/ticker-copy.test.ts.
import { expect, type Page, test } from "@playwright/test";
import { current, field } from "./coin.ts";
import { back, signRow, stub, toSign } from "./launch-stubs.ts";
import { newTestAccount } from "./phantom.ts";
import { gate, PHASE7_SHOTS } from "./shoot.ts";

const TAIL = ", or change the ticker in step 1. Nothing was sent.";
const cases = [
  {
    name: "landed lock, 21h left",
    json: { error: "ticker_locked", retryAfter: 75600, lock: "landed" },
    copy: `$PEPE launched on BONDR 3h ago. Try again in 21h${TAIL}`,
  },
  {
    name: "landed lock, 25 minutes left",
    json: { error: "ticker_locked", retryAfter: 1500, lock: "landed" },
    copy: `$PEPE launched on BONDR 23h ago. Try again in 25 minutes${TAIL}`,
  },
  {
    name: "in-flight lock",
    json: { error: "ticker_locked", retryAfter: 120, lock: "pending" },
    copy: `Another launch of $PEPE is being signed on BONDR right now. Try again in a few minutes${TAIL}`,
  },
  {
    name: "missing retryAfter",
    json: { error: "ticker_locked" },
    copy: `$PEPE launched on BONDR in the last 24 hours. Try again later${TAIL}`,
  },
  {
    name: "reserved",
    json: { error: "ticker_reserved" },
    copy: "$PEPE is reserved on BONDR. Change the ticker in step 1. Nothing was sent.",
  },
];

const callout = (page: Page) => page.getByRole("main").getByRole("alert");
const symbolError = (page: Page) => page.locator("#coin-symbol-error");

async function refused(page: Page, json: object) {
  await stub(page, { prepare: { status: 409, json } });
  await toSign(page, newTestAccount(), { symbol: "pepe" });
}

for (const c of cases) {
  test(`${c.name}: row 2 fails with its copy and no retry`, async ({ page }) => {
    await refused(page, c.json);
    await expect(callout(page)).toHaveText(c.copy);
    await expect(signRow(page, 2)).toHaveAttribute("data-state", "failed");
    await expect(page.getByRole("button", { name: /Try again|Build again/ })).toHaveCount(0);
  });
}

// Back from step 4 to step 1 through the review and dev buy steps.
async function toStep1(page: Page) {
  await back(page).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(current(page)).toHaveText(/01\s*Coin/);
}

test("after a ticker_locked refusal step 1 names the lock until the symbol changes", async ({ page }) => {
  await refused(page, cases[0]?.json as object);
  await expect(callout(page)).toHaveText(cases[0]?.copy as string);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "launch-ticker-locked", width, PHASE7_SHOTS);
  }
  await toStep1(page);
  await expect(symbolError(page)).toHaveText("$PEPE launched on BONDR 3h ago. Try again in 21h.");
  await expect(field(page, "Symbol")).toHaveAttribute("aria-invalid", "true");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "launch-ticker-field", width, PHASE7_SHOTS);
  }
  await field(page, "Symbol").fill("pepex");
  await expect(symbolError(page)).toHaveCount(0);
  // Not blocking: the creator may wait the lock out and continue with the same ticker.
  await field(page, "Symbol").fill(" pepe");
  await expect(symbolError(page)).toBeVisible();
  await page.getByRole("button", { name: "Continue to dev buy" }).click();
  await expect(current(page)).toHaveText(/02\s*Dev buy and exit/);
});

test("a reserved ticker shows its field error live and blocks Continue", async ({ page }) => {
  await page.goto("/launch");
  await field(page, "Symbol").fill("sol");
  await expect(symbolError(page)).toHaveText("$SOL is reserved on BONDR. Choose another ticker.");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "launch-ticker-reserved", width, PHASE7_SHOTS);
  }
  await page.getByRole("button", { name: "Continue to dev buy" }).click();
  await expect(current(page)).toHaveText(/01\s*Coin/);
  await field(page, "Symbol").fill("pepe");
  await expect(symbolError(page)).toHaveCount(0);
});
