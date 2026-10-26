// Proves the owner's way in (D-08 to D-11): /admin is a noindex sign-in card, the test admin key signs in
// through the fake Phantom and gets a 30-minute HttpOnly SameSite=Strict bondr_admin cookie, another wallet
// is refused with no cookie, /api/admin/* answers 401 without the cookie and 403 cross-origin, and Sign out
// drops the cookie. ADMIN_WALLET is the seed-derived test key playwright.config.ts injects (A10).
import { expect, type Page, test } from "@playwright/test";
import {
  adminAccount,
  adminSignIn,
  injectPhantom,
  newTestAccount,
  preConsent,
  type TestAccount,
} from "./phantom.ts";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const REUSED = "reused dev server has another ADMIN_WALLET";
let admin: TestAccount | undefined;
try {
  admin = adminAccount();
} catch {
  admin = undefined;
}

const adminCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "bondr_admin");

// A dev server started earlier without ADMIN_WALLET shows the closed card; that is the setup, not a bug.
async function openAdmin(page: Page) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Owner console" })).toBeVisible();
  const closed = page.getByRole("heading", { level: 2, name: "Admin is not configured" });
  test.skip(await closed.isVisible(), "dev server runs without ADMIN_WALLET or SITE_URL (reused server)");
}

async function signInThroughCard(page: Page, account: TestAccount) {
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await openAdmin(page);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Connect Phantom" }).click();
  const verify = page.waitForResponse(
    (r) => r.url().endsWith("/api/admin/session") && r.request().postDataJSON()?.op === "verify",
  );
  await main.getByRole("button", { name: `Sign in as ${short(account.address)}` }).click();
  return verify;
}

test.describe("admin-signin", () => {
  test.describe.configure({ timeout: 60_000 });
  test.skip(!admin, "needs MASTER_SEED_FILE in the root .env");
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("/admin shows the noindex sign-in card", async ({ page }) => {
    await openAdmin(page);
    await expect(page.getByRole("heading", { level: 2, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Connect Phantom" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("the admin key signs in and sees the console with a 30-minute session", async ({ page }) => {
    const account = admin as TestAccount;
    const res = await signInThroughCard(page, account);
    if (res.status() === 403) test.skip((await res.json()).error === "not_admin", REUSED);
    await expect(page.getByText(`Signed in ${short(account.address)}, the allowlisted wallet`)).toBeVisible();
    await expect(page.getByText(/Session ends in (29|30)m/)).toBeVisible();
    const cookie = await adminCookie(page);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
  });

  test("another wallet is refused and gets no cookie", async ({ page }) => {
    await signInThroughCard(page, newTestAccount());
    await expect(
      page.getByText("This wallet is not the admin wallet. Switch accounts in Phantom and try again."),
    ).toBeVisible();
    expect(await adminCookie(page)).toBeUndefined();
  });

  test("/api/admin/* needs the cookie and the same origin", async ({ request }) => {
    const origin = new URL(test.info().project.use.baseURL as string).origin;
    expect((await request.post("/api/admin/health", { headers: { origin } })).status()).toBe(401);
    const evil = await request.post("/api/admin/health", { headers: { origin: "https://evil.example" } });
    expect(evil.status()).toBe(403);
  });

  test("Sign out ends the session and drops the cookie", async ({ page }) => {
    const res = await adminSignIn(page.request, admin as TestAccount);
    if (res.status() === 403) test.skip((await res.json()).error === "not_admin", REUSED);
    expect(res.status()).toBe(200);
    await openAdmin(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Signed out.")).toBeVisible();
    expect(await adminCookie(page)).toBeUndefined();
  });
});
