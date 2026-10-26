// Opens the owner console for a spec: the API sign-in through page.request (so the browser shares the
// bondr_admin cookie), then /admin. Skips with the reason when the setup cannot sign in (A10).
import { expect, type Page, test } from "@playwright/test";
import { adminAccount, adminSignIn, type TestAccount } from "./phantom.ts";

export async function openConsole(page: Page): Promise<void> {
  let admin: TestAccount;
  try {
    admin = adminAccount();
  } catch {
    test.skip(true, "needs MASTER_SEED_FILE in the root .env");
    return;
  }
  const res = await adminSignIn(page.request, admin);
  const error = res.ok() ? null : (await res.json().catch(() => null))?.error;
  test.skip(error === "not_configured", "dev server runs without ADMIN_WALLET or SITE_URL (reused server)");
  test.skip(error === "not_admin", "reused dev server has another ADMIN_WALLET");
  expect(res.status()).toBe(200);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Owner console" })).toBeVisible();
  await expect(page.getByText(/^Signed in .+, the allowlisted wallet$/)).toBeVisible();
}
