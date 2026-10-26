// The genesis launch page (UI-SPEC surface 2, D-28, D-29): the public banner for everyone, the owner variant for
// a signed-in admin. Status, quote, pin and prepare are stubbed, so no worker runs in genesis mode for real.
import type { Status } from "@bondr/core/api";
import { expect, type Page, test } from "@playwright/test";
import { skipRefused } from "./admin.ts";
import { field, receipt, row, solText, toStep2, toStep3 } from "./coin.ts";
import { signRow, stub } from "./launch-stubs.ts";
import {
  adminAccount,
  adminSignIn,
  injectPhantom,
  newTestAccount,
  preConsent,
  type TestAccount,
} from "./phantom.ts";
import { gate, PHASE7_SHOTS } from "./shoot.ts";

const MIN = "250000000";
const TREASURY = "TreasuryBondr111111111111111111111111111111";
const status: Status = {
  ...{ net: "devnet", paused: "genesis", quoteMint: null, genesisTreasury: TREASURY },
  ...{ fees: { protocolBps: 93, creatorBps: 30 }, minLamports: MIN, createCostEstimate: "8829040" },
  ...{ networkFeeEstimate: "10600", senderTipEstimate: null },
};

async function stubGenesis(page: Page) {
  await page.route("**/api/status", (r) => r.fulfill({ json: status }));
  await page.route("**/api/quote", (r) =>
    r.fulfill({ json: { tokensOut: "8000000000000", solBackEstimate: "0" } }),
  );
}

// The admin cookie comes from the real sign-in through page.request, which the browser context shares.
async function asOwner(page: Page): Promise<TestAccount> {
  let admin: TestAccount;
  try {
    admin = adminAccount();
  } catch {
    test.skip(true, "needs MASTER_SEED_FILE in the root .env");
    throw new Error("unreachable");
  }
  const res = await adminSignIn(page.request, admin);
  const error = res.ok() ? null : (await res.json().catch(() => null))?.error;
  skipRefused(error);
  expect(res.status()).toBe(200);
  await stubGenesis(page);
  await injectPhantom(page, admin);
  await preConsent(page, admin.address);
  await page.goto("/launch");
  return admin;
}

const info = (page: Page) => page.getByRole("status").filter({ hasText: "Genesis launch." });

test("without an admin session the public banner shows and Launch stays disabled", async ({ page }) => {
  await stubGenesis(page);
  const account = newTestAccount();
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await page.goto("/launch");
  await expect(page.getByRole("status").filter({ hasText: "Launches are not open yet." })).toBeVisible();
  await expect(info(page)).toHaveCount(0);
  await expect(page.getByText("One Phantom signature creates your coin")).toBeVisible();
  await toStep2(page);
  await toStep3(page, MIN);
  await expect(page.getByRole("button", { name: "Launches paused" })).toBeDisabled();
});

test("the owner gets the genesis variant: BONDR ticker, burn only, SOL pair and the treasury", async ({
  page,
}) => {
  await asOwner(page);
  await expect(info(page)).toContainText("This launch creates the BONDR token itself: SOL pair");
  await expect(page.getByText("Launches are not open yet.")).toHaveCount(0);
  await expect(page.getByText("One Phantom signature creates the BONDR token")).toBeVisible();
  await expect(page.getByText("80% of them are yours")).toHaveCount(0);
  await toStep2(page, "BONDR", "BONDR");
  await expect(page.getByRole("radio", { name: /Insta burn/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Insta sell/ })).toBeDisabled();
  await expect(page.getByText("Not for genesis")).toBeVisible();
  await expect(page.locator("#buy-error")).toHaveCount(0); // preselected burn does not show the error early
  await expect(page.getByText("The genesis launch is insta burn only")).toBeVisible();
  await expect(page.locator("#buy-hint")).toContainText(
    "In the same transaction your SOL buys the new BONDR token, and the tokens are burned.",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "launch-genesis-owner-buy", width, PHASE7_SHOTS);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await field(page, "Dev buy").fill(solText(MIN));
  await page.getByRole("button", { name: "Review launch" }).click();
  const review = page.getByRole("region", { name: /Step 3 of 5/ });
  await expect(row(review, "Pair")).toHaveText("SOL");
  await expect(row(review, "Exit")).toHaveText("Insta burn, in the same transaction");
  await expect(row(review, "Creator of record")).toHaveText(
    "The BONDR treasury Trea…1111. Its creator fees are claimed on pump.fun by the owner.",
  );
  await expect(review.locator('dt:text-is("You after bond")')).toHaveCount(0);
  await expect(review.getByText("builds a burn budget")).toHaveCount(0);
  await expect(row(receipt(page), "Pair")).toHaveText("SOL");
  await expect(row(receipt(page), "BONDR treasury, claimed on pump.fun")).toHaveText("100%");
  await expect(receipt(page).getByRole("heading", { name: "Creator fee", exact: true })).toBeVisible();
  await expect(receipt(page).getByText("Creator fee, before bond")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Connect Phantom to launch|Sign in Phantom/ })).toBeEnabled();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "launch-genesis-owner-review", width, PHASE7_SHOTS);
  }
});

const errors = [
  {
    status: 403,
    error: "forbidden",
    copy: "Only the owner wallet can send the genesis launch. Switch accounts in Phantom and try again.",
  },
  {
    status: 503,
    error: "not_ready",
    copy: "Your admin session ended. Sign in again at /admin, then come back to send the genesis launch.",
  },
  {
    status: 409,
    error: "genesis_landed",
    copy: "The genesis launch already landed. Set BONDR_QUOTE_MINT to the new mint and redeploy to open child launches.",
  },
];

for (const e of errors) {
  test(`step 4 shows the genesis copy for ${e.error}`, async ({ page }) => {
    await stub(page, { prepare: { status: e.status, json: { error: e.error } } });
    await asOwner(page);
    await toStep2(page, "BONDR", "BONDR");
    await toStep3(page, MIN);
    await page.getByRole("button", { name: "Connect Phantom to launch" }).click();
    await page.getByRole("button", { name: "Sign in Phantom" }).click();
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText(e.copy);
    await expect(signRow(page, 2)).toHaveAttribute("data-state", "failed");
    if (e.error === "not_ready")
      await expect(alert.getByRole("link", { name: "/admin" })).toHaveAttribute("href", "/admin");
  });
}
