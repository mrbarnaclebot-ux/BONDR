// Staging locked matrix (D-08, D-11): with ADMIN_WALLET unset, /admin is the noindex "Admin is not configured"
// card at 390, 768 and 1440 (0 axe violations, no horizontal scroll), /api/admin/* answers 401 without a cookie
// and 403 cross-origin, and a valid signature from any wallet is refused not_configured with no cookie. Runs
// only against a deployed server (E2E_BASE_URL): local runs always inject the test ADMIN_WALLET.
import { expect, type Page, test } from "@playwright/test";
import { adminSignIn, newTestAccount } from "./phantom.ts";
import { gate, PHASE6_SHOTS } from "./shoot.ts";

const STAGING = process.env.E2E_BASE_URL;
const CONFIGURED = "staging admin is configured; the owner signs in under HV-06-01";

test.describe.configure({ timeout: 90_000 }); // a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" });
test.skip(!STAGING, "staging only (E2E_BASE_URL)");

/** Opens /admin; skips the rest of the test when the owner has set ADMIN_WALLET (the Sign in card shows). */
async function openLocked(page: Page) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Owner console" })).toBeVisible();
  const signIn = page.getByRole("heading", { level: 2, name: "Sign in" });
  if (await signIn.isVisible()) {
    await expect(page.getByRole("main").getByRole("button", { name: "Connect Phantom" })).toBeVisible();
    test.skip(true, CONFIGURED);
  }
  await expect(page.getByRole("heading", { level: 2, name: "Admin is not configured" })).toBeVisible();
}

for (const width of [390, 768, 1440]) {
  test(`locked card at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openLocked(page);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await gate(page, "admin-locked", width, PHASE6_SHOTS);
  });
}

test("/api/admin/* answers 401 without a cookie, 403 cross-origin, and only to POST", async ({ request }) => {
  const origin = new URL(STAGING as string).origin;
  expect((await request.post("/api/admin/health", { headers: { origin } })).status()).toBe(401);
  const evil = await request.post("/api/admin/health", { headers: { origin: "https://evil.example" } });
  expect(evil.status()).toBe(403);
  expect((await request.get("/api/admin/health")).status()).not.toBe(200); // POST only (Pitfall 8)
});

test("a valid signature is refused not_configured and sets no cookie", async ({ page }) => {
  await openLocked(page);
  const res = await adminSignIn(page.request, newTestAccount());
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe("not_configured");
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "bondr_admin")).toBeUndefined();
});
