import { expect, type Page, test } from "@playwright/test";

// 1 x 1 PNG; the drop zone reads its magic bytes and decodes it for the dimensions.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

const field = (page: Page, name: string | RegExp) => page.getByRole("textbox", { name });
const current = (page: Page) => page.locator('ol li[aria-current="step"]');
const cont = (page: Page) => page.getByRole("button", { name: "Continue to dev buy" });

test("/ redirects to /launch, which shows the title, the lede and step 1 current", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/launch$/);
  await expect(page.getByRole("heading", { level: 1, name: "Launch a coin" })).toBeVisible();
  await expect(page.getByText("One Phantom signature creates your coin")).toBeVisible();
  await expect(page.locator("ol li")).toHaveCount(5);
  await expect(current(page)).toHaveText(/01\s*Coin/);
});

test("Continue with everything empty shows the required errors and focuses Name", async ({ page }) => {
  await page.goto("/launch");
  await cont(page).click();
  await expect(page.getByText("Name is required.")).toBeVisible();
  await expect(page.getByText("Symbol is required.")).toBeVisible();
  await expect(page.getByText("Add an image. Square PNG, JPG, GIF or WEBP up to 4 MB.")).toBeVisible();
  await expect(field(page, "Name")).toBeFocused();
  await expect(field(page, "Name")).toHaveAttribute("aria-invalid", "true");
  await expect(current(page)).toHaveText(/01\s*Coin/);
});

test("over-limit, charset and wrong-type errors show live", async ({ page }) => {
  await page.goto("/launch");
  await field(page, "Name").fill("a".repeat(33));
  await expect(page.getByText("Name is 33 characters. Keep it to 32 or fewer.")).toBeVisible();
  await field(page, "Symbol").fill("ab-c");
  await expect(field(page, "Symbol")).toHaveValue("AB-C");
  await expect(page.getByText("Use letters and numbers only.")).toBeVisible();
  await page.getByLabel("Image").setInputFiles({ name: "coin.svg", mimeType: "image/svg+xml", buffer: SVG });
  await expect(page.getByText("That file is not PNG, JPG, GIF or WEBP. Choose another image.")).toBeVisible();
});

test("valid input normalizes the X link and advances to step 2", async ({ page }) => {
  await page.goto("/launch");
  await field(page, "Name").fill("Grubworm");
  await field(page, "Symbol").fill("grub");
  await page.getByLabel("Image").setInputFiles({ name: "grub.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("grub.png")).toBeVisible();
  await expect(page.getByText("uploaded, 1 x 1")).toBeVisible();
  await field(page, /^X/).fill("x.com/coin");
  await field(page, /^X/).blur();
  await expect(field(page, /^X/)).toHaveValue("https://x.com/coin");
  await cont(page).click();
  await expect(current(page)).toHaveText(/02\s*Dev buy and exit/);
  await expect(page.getByRole("heading", { name: "Step 2 of 5: Dev buy and exit" })).toBeFocused();
});

for (const width of [390, 768, 1440]) {
  test(`step 1 has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/launch");
    await expect(cont(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
