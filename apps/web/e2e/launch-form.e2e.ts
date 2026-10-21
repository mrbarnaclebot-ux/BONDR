import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { current, field, liveStatus, PNG, panel, receipt, row, solText, toStep2, toStep3 } from "./coin.ts";
import { injectPhantom, newTestAccount, preConsent, rootEnv } from "./phantom.ts";

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
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

// Steps 2 and 3 read live devnet values through the worker, so a Neon or RPC cold start can take seconds.
const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll: a fullyParallel worker runs afterAll when it leaves this file
// and reuses the module if it comes back, and an ended client refuses every query (CONNECTION_ENDED).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const consented: string[] = [];
test.afterAll(async () => {
  if (sql && consented.length) await sql`delete from wallets where address in ${sql(consented)}`;
});
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const devBuy = (page: Page) => field(page, "Dev buy");

test.describe("steps 2 and 3", () => {
  test.describe.configure({ timeout: 60_000 });

  test("step 2 shows the live minimum, scaled presets and the button states", async ({ page }) => {
    const { minLamports } = await liveStatus(page);
    const min = solText(minLamports as string);
    await page.goto("/launch");
    await toStep2(page);
    await expect(page.getByText(`Minimum ${min} SOL.`)).toBeVisible({ timeout: 20_000 });
    await expect(devBuy(page)).toHaveAttribute("placeholder", min);
    await page
      .getByRole("button", { name: solText(String(BigInt(minLamports as string) * 4n)), exact: true })
      .click();
    await expect(devBuy(page)).toHaveValue(solText(String(BigInt(minLamports as string) * 4n)));
    await expect(page.getByText(/About [\d.,]+[KMB]? tokens\./)).toBeVisible({ timeout: 20_000 });
    await expect(button(page, "Choose an exit to continue")).toBeDisabled();

    await page.getByRole("radio", { name: /Insta burn/ }).check();
    await devBuy(page).fill("");
    await expect(button(page, "Fix the dev buy")).toBeDisabled();
    await expect(page.getByText(`Minimum dev buy is ${min} SOL. Enter ${min} or more.`)).toBeVisible();
    await devBuy(page).fill(String(Number(min) / 2));
    await expect(page.getByText(`Minimum dev buy is ${min} SOL. Enter ${min} or more.`)).toBeVisible();
    await expect(devBuy(page)).toHaveAttribute("aria-invalid", "true");
    await devBuy(page).fill("abc");
    await expect(page.getByText("Enter an amount in SOL, like 0.5.")).toBeVisible();
    await expect(button(page, "Fix the dev buy")).toBeDisabled();
    await devBuy(page).fill(min);
    await expect(button(page, "Review launch")).toBeEnabled();
  });

  test("both exits start unchecked and Streamflow is disabled, coming later", async ({ page }) => {
    await page.goto("/launch");
    await toStep2(page);
    await expect(page.getByRole("radio", { name: /Insta sell/ })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: /Insta burn/ })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: /Streamflow lock/ })).toBeDisabled();
    await expect(page.getByText("Coming later")).toBeVisible();
    await expect(page.getByRole("group", { name: /What happens to your dev buy/ })).toBeVisible();
  });

  test("the receipt shows the live pump fees and a zero platform fee", async ({ page }) => {
    const { fees } = await liveStatus(page);
    expect(fees).not.toBeNull();
    const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
    await page.goto("/launch");
    await expect(receipt(page)).toBeVisible();
    await expect(row(receipt(page), "Pump protocol")).toHaveText(pct(fees?.protocolBps ?? -1), {
      timeout: 20_000,
    });
    await expect(row(receipt(page), "Creator fee")).toHaveText(pct(fees?.creatorBps ?? -1));
    await expect(row(receipt(page), "BONDR platform fee")).toHaveText("0");
    await field(page, "Name").fill("Grubworm");
    await expect(receipt(page).getByText("Grubworm")).toBeVisible();
  });

  test("a consented wallet with too little SOL gets the balance error", async ({ page }) => {
    const account = newTestAccount(); // fresh, so its devnet balance is 0
    const { minLamports } = await liveStatus(page);
    await injectPhantom(page, account);
    await preConsent(page, account.address);
    await page.goto("/launch");
    await page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();
    await toStep2(page);
    await page.getByRole("radio", { name: /Insta sell/ }).check();
    await devBuy(page).fill(solText(minLamports as string));
    await expect(
      page.getByText(/^Your wallet has 0 SOL\. This launch needs about [\d.]+ SOL including fees\./),
    ).toBeVisible({ timeout: 20_000 });
    await expect(button(page, "Fix the dev buy")).toBeDisabled();
  });

  test("step 3 asks for Phantom and consent, then offers Sign in Phantom", async ({ page }) => {
    test.skip(!sql, "needs DATABASE_URL in the root .env");
    const account = newTestAccount();
    consented.push(account.address);
    const leaks: string[] = [];
    page.on("request", (r) => {
      if (`${r.url()} ${r.postData() ?? ""}`.includes(account.address)) leaks.push(r.url());
    });
    const { minLamports } = await liveStatus(page);
    await injectPhantom(page, account);
    await page.goto("/launch");
    await toStep2(page);
    await toStep3(page, minLamports as string);
    await expect(page.getByRole("heading", { name: "Step 3 of 5: Review" })).toBeFocused();
    const review = panel(page, "Step 3 of 5: Review");
    await expect(row(review, "Coin")).toHaveText("Grubworm (GRUB)");
    await expect(row(review, "Mint")).toHaveText("Assigned when you sign, ends in bndr");
    await expect(row(review, "Exit")).toHaveText("Insta burn, in the same transaction");

    await button(page, "Connect Phantom to launch").click();
    const dialog = page.getByRole("dialog", { name: "Before BONDR remembers this wallet" });
    await dialog.getByRole("checkbox").check();
    expect(leaks).toEqual([]); // nothing carried the wallet before Accept (PLAT-02)
    await dialog.getByRole("button", { name: "Accept and continue" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(button(page, "Sign in Phantom")).toBeEnabled({ timeout: 20_000 });
    await expect(current(page)).toHaveText(/03\s*Review/);
  });

  test("at 390px the exit cards stack and every chip is at least 44px tall", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/launch");
    await toStep2(page);
    // The panel's rise animation scales it, so measure once it has finished.
    await page.waitForFunction(() =>
      document
        .querySelector("section")
        ?.getAnimations()
        .every((a) => a.playState === "finished"),
    );
    const sell = await page
      .locator("label", { has: page.getByRole("radio", { name: /Insta sell/ }) })
      .boundingBox();
    const burn = await page
      .locator("label", { has: page.getByRole("radio", { name: /Insta burn/ }) })
      .boundingBox();
    expect(burn?.x).toBe(sell?.x);
    expect((burn?.y ?? 0) > (sell?.y ?? 0)).toBe(true);
    const chips = page.getByRole("group", { name: "Presets" }).getByRole("button");
    await expect(chips).toHaveCount(4, { timeout: 20_000 });
    for (const box of await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
      expect(box).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
