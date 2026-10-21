// Shared launch-form helpers for the specs that start past step 1.
import type { Status } from "@bondr/core/api";
import { expect, type Locator, type Page } from "@playwright/test";

// 1 x 1 PNG; the drop zone reads its magic bytes and decodes it for the dimensions.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export const field = (page: Page, name: string | RegExp) => page.getByRole("textbox", { name });
export const current = (page: Page) => page.locator('ol li[aria-current="step"]');
export const receipt = (page: Page) => page.getByRole("complementary", { name: "Launch summary" });
/** A step panel, named by its sr-only heading. */
export const panel = (page: Page, name: string) => page.getByRole("region", { name });
/** The value cell of a dt/dd row, by its exact label. */
export const row = (scope: Page | Locator, label: string) => scope.locator(`dt:text-is("${label}") + dd`);

/** The live status the page itself polls, read through the same web route. */
export async function liveStatus(page: Page): Promise<Status> {
  const res = await page.request.get("/api/status");
  expect(res.ok()).toBe(true);
  return (await res.json()) as Status;
}

/** Lamports as SOL with trailing zeros trimmed, to build expected copy from live values. */
export const solText = (lamports: string) => String(Number(lamports) / 1e9);

/** Fills step 1 with valid values and continues to step 2. */
export async function toStep2(page: Page, name = "Grubworm", symbol = "grub"): Promise<void> {
  await field(page, "Name").fill(name);
  await field(page, "Symbol").fill(symbol);
  await page.getByLabel("Image").setInputFiles({ name: "grub.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("uploaded, 1 x 1")).toBeVisible();
  await page.getByRole("button", { name: "Continue to dev buy" }).click();
  await expect(current(page)).toHaveText(/02\s*Dev buy and exit/);
}

/** From step 2: the live minimum, Insta burn, then Review. */
export async function toStep3(page: Page, min: string): Promise<void> {
  await field(page, "Dev buy").fill(solText(min));
  await page.getByRole("radio", { name: /Insta burn/ }).check();
  await page.getByRole("button", { name: "Review launch" }).click();
  await expect(current(page)).toHaveText(/03\s*Review/);
}
