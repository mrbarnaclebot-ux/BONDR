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
  await expect(page.getByText("Short on purpose. Last updated 2026-10-26.")).toBeVisible();
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings).toHaveCount(8);
  for (const [i, title] of SECTIONS.entries()) {
    await expect(headings.nth(i)).toHaveText(new RegExp(`^0${i + 1}\\s*${title}$`));
  }
});

test("/terms names the contact, the network and the 24h ticker cooldown (D-17, D-43)", async ({ page }) => {
  await page.goto("/terms");
  const main = page.getByRole("main");
  const mail = main.getByRole("link", { name: "hello@trybondr.fun", exact: true });
  await expect(mail).toHaveAttribute("href", "mailto:hello@trybondr.fun");
  await expect(main.locator("#t01")).toContainText(
    "BONDR runs on Solana mainnet at trybondr.fun, where SOL and coins are real money. A separate test copy runs on devnet, where coins have no value.",
  );
  await expect(main.locator("#t04")).toContainText(
    "After a coin launched through BONDR lands, BONDR refuses new launches with the same ticker for 24 hours; this covers only BONDR launches, not the same ticker used elsewhere.",
  );
  await expect(main.locator("#t08")).toContainText(
    "Questions and data deletion requests go to the owner at hello@trybondr.fun.",
  );
  await expect(main).not.toContainText(/@BONDR\s+on X/); // the pre-go-live placeholder
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
