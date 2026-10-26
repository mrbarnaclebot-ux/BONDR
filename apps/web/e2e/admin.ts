// Opens the owner console for a spec: the API sign-in through page.request (so the browser shares the
// bondr_admin cookie), then /admin. Skips with the reason when the setup cannot sign in (A10).
import { expect, type Page, test } from "@playwright/test";
import { adminAccount, adminSignIn, type TestAccount } from "./phantom.ts";

// Only an external server (E2E_BASE_URL: staging, CI's next start) may lack this run's ADMIN_WALLET or SITE_URL.
// When Playwright starts the servers it sets both (playwright.config.ts), so a refusal there is a regression in
// the owner's sign-in and fails instead of skipping. A local dev server reused without them fails too: point
// E2E_BASE_URL at it to skip.
export const EXTERNAL = !!process.env.E2E_BASE_URL;
export function skipRefused(error: unknown): void {
  const refused = error === "not_configured" || error === "not_admin";
  test.skip(EXTERNAL && refused, `external server refused the owner sign-in: ${error}`);
}

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
  skipRefused(error);
  expect(res.status()).toBe(200);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Owner console" })).toBeVisible();
  await expect(page.getByText(/^Signed in .+, the allowlisted wallet$/)).toBeVisible();
}
