import { expect, test } from "@playwright/test";

const SECTIONS = [
  "What BONDR is",
  "Your wallet, your responsibility",
  "Fees",
  "Launching",
  "Risk",
  "Your data",
  "No warranty",
  "Changes and contact",
];
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

test("the footer links to /terms from any page", async ({ page }) => {
  await page.goto("/no-such-page");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("BONDR adds no platform fee.");
  await footer.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
});

test("/terms shows the eight numbered sections in order", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByText("Short on purpose. Last updated 2026-10-19.")).toBeVisible();
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings).toHaveCount(8);
  for (const [i, title] of SECTIONS.entries()) {
    await expect(headings.nth(i)).toHaveText(new RegExp(`^0${i + 1}\\s*${title}$`));
  }
  await expect(page.getByText("@BONDR on X (handle to be confirmed before go-live)")).toBeVisible();
});

test("the first Tab reaches Skip to content", async ({ page }) => {
  await page.goto("/terms");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

for (const { width, height } of WIDTHS) {
  test(`/terms at ${width}px has no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "On this page" });
    if (width >= 768) await expect(nav).toBeVisible();
    else await expect(nav).toBeHidden();

    const badge = page.getByRole("banner").getByText("Devnet", { exact: true });
    if (process.env.SOLANA_NET === "devnet") await expect(badge).toBeVisible();
    else await expect(badge).toHaveCount(0);

    const [scroll, client] = await page.evaluate(() => {
      const root = document.scrollingElement as Element;
      return [root.scrollWidth, root.clientWidth];
    });
    expect(scroll).toBe(client);
  });
}
