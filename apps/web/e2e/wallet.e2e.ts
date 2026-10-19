import { expect, type Page, test } from "@playwright/test";
import { emitChange, injectPhantom, newTestAccount, preConsent, type TestAccount } from "./phantom.ts";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const header = (page: Page) => page.getByRole("banner");

async function connected(page: Page): Promise<TestAccount> {
  const account = newTestAccount();
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await page.goto("/terms");
  await header(page).getByRole("button", { name: "Connect Phantom" }).click();
  await expect(header(page).getByRole("button", { name: short(account.address) })).toBeVisible();
  return account;
}

test("Connect Phantom shows the short address on a solid button", async ({ page }) => {
  const { address } = await connected(page);
  const button = header(page).getByRole("button", { name: short(address) });
  await page.mouse.move(0, 400); // off the button, so the hover color does not apply
  await expect(button).toHaveCSS("background-color", "rgb(50, 113, 42)");
});

test("the wallet menu copies and disconnects", async ({ page }) => {
  const { address } = await connected(page);
  await header(page)
    .getByRole("button", { name: short(address) })
    .click();
  await expect(page.getByRole("button", { name: "Copy address" })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(header(page).getByRole("button", { name: "Connect Phantom" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeHidden();
});

test("a Phantom account switch updates the header", async ({ page }) => {
  await connected(page);
  const next = newTestAccount();
  await page.evaluate((a) => localStorage.setItem(`bondr:consent:${a}`, "1"), next.address);
  await emitChange(page, next);
  await expect(header(page).getByRole("button", { name: short(next.address) })).toBeVisible();
});

test("without Phantom, Connect shows the not-installed popover", async ({ page }) => {
  await page.goto("/terms");
  await header(page).getByRole("button", { name: "Connect Phantom" }).click();
  await expect(
    page.getByText("Phantom is not installed. BONDR works with the Phantom wallet only."),
  ).toBeVisible();
  const get = page.getByRole("link", { name: /Get Phantom/ });
  await expect(get).toHaveAttribute("href", "https://phantom.com/download");
  await expect(get).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Open BONDR in Phantom" })).toHaveCount(0);
});

test.describe("on a phone without Phantom", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" });
  test("the popover deep-links into Phantom's browser", async ({ page }) => {
    await page.goto("/terms");
    await header(page).getByRole("button", { name: "Connect Phantom" }).click();
    const open = page.getByRole("link", { name: "Open BONDR in Phantom" });
    const here = page.url();
    const ref = new URL(here).origin;
    await expect(open).toHaveAttribute(
      "href",
      `https://phantom.com/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`,
    );
  });
});

test("at 390px the wallet button and menu items are at least 44px tall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { address } = await connected(page);
  const button = header(page).getByRole("button", { name: short(address) });
  await button.click();
  const targets = [
    button,
    page.getByRole("button", { name: "Copy address" }),
    page.getByRole("button", { name: "Disconnect" }),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("on /launch the header connects and disconnects", async ({ page }) => {
  const account = newTestAccount();
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await page.goto("/launch");
  await header(page).getByRole("button", { name: "Connect Phantom" }).click();
  const button = header(page).getByRole("button", { name: short(account.address) });
  await button.click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(header(page).getByRole("button", { name: "Connect Phantom" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Launch a coin" })).toBeVisible();
});
