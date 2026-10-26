// Proves the kill switches and the audit log (ADMIN-05, ADMIN-10, D-13, D-18, D-33): a flip needs no dialog,
// persists across a reload and writes one landed audit row with no simulation; flipping back resumes; a failed
// flip reverts with the error line; the fee engine callout shows when the health payload says the engine is not
// on; the audit op refuses a malformed cursor. The switches are shared worker and Neon state, so this file runs
// in the serial admin-serial project, and afterAll turns every switch it touched back on.
import { expect, type Locator, type Page, request, test } from "@playwright/test";
import postgres from "postgres";
import { openConsole } from "./admin.ts";
import { adminAccount, adminSignIn, rootEnv } from "./phantom.ts";

const TOUCHED = ["sweeps", "finalize"] as const;

test.describe.configure({ mode: "serial", timeout: 90_000 });

const origin = () => ({ origin: new URL(test.info().project.use.baseURL as string).origin });

test.afterAll(async () => {
  let admin: ReturnType<typeof adminAccount>;
  try {
    admin = adminAccount();
  } catch {
    return; // no MASTER_SEED_FILE: every test skipped
  }
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  const res = await adminSignIn(api, admin);
  const error = res.ok() ? null : (await res.json().catch(() => null))?.error;
  if (error === "not_configured" || error === "not_admin") return api.dispose(); // openConsole skipped every test
  try {
    // Anything else would leave Sweeps or Finalize paused on the shared worker and DB (WR-E-04).
    expect(res.status(), "afterAll sign-in to undo shared state").toBe(200);
    for (const job of TOUCHED) {
      const r = await api.post("/api/admin/switch", { headers: origin(), data: { job, enabled: true } });
      expect(r.status()).toBe(200);
    }
    const health = await (await api.post("/api/admin/health", { headers: origin(), data: {} })).json();
    expect(Object.values(health.switches).every((on) => on === true)).toBe(true);
  } finally {
    await api.dispose();
    await dbBackstop();
  }
});

// The touched switches on in Postgres even when the route failed, as admin-devnet's restore does.
async function dbBackstop() {
  const url = rootEnv().DATABASE_URL;
  if (!url) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`update settings set sweeps_enabled = true, finalize_enabled = true`;
  } finally {
    await sql.end();
  }
}

const panel = (page: Page) => page.getByRole("region", { name: "Kill switches", exact: true });
const toggle = (page: Page, name: string) => panel(page).getByRole("switch", { name, exact: true });
const word = (sw: Locator) => sw.locator("xpath=preceding-sibling::span[1]");
const firstAudit = (page: Page) =>
  page.getByRole("region", { name: "Audit log", exact: true }).getByRole("row").nth(1).getByRole("cell");

async function ready(page: Page, name: string, on: boolean) {
  const sw = toggle(page, name);
  await expect(sw).not.toHaveAttribute("aria-disabled", "true"); // the first poll landed
  await expect(sw).toHaveAttribute("aria-checked", String(on));
  return sw;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openConsole(page);
});

test("pausing Sweeps persists across a reload and is audited", async ({ page }) => {
  const sw = await ready(page, "Sweeps", true);
  await sw.click();
  await expect(word(sw)).toHaveText("Paused");
  await expect(firstAudit(page).nth(2)).toHaveText("Pause sweeps");
  await page.reload();
  const again = await ready(page, "Sweeps", false);
  await expect(word(again)).toHaveText("Paused");
  const cells = firstAudit(page);
  await expect(cells.nth(2)).toHaveText("Pause sweeps");
  await expect(cells.nth(3)).toHaveText("–");
  await expect(cells.nth(4)).toHaveText("Landed");
});

test("resuming Sweeps reads Running and is audited", async ({ page }) => {
  const sw = await ready(page, "Sweeps", false);
  await sw.click();
  await expect(word(sw)).toHaveText("Running");
  await expect(firstAudit(page).nth(2)).toHaveText("Resume sweeps");
});

test("a failed flip reverts Finalize and says so", async ({ page }) => {
  const sw = await ready(page, "Finalize", true);
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(
    "**/api/admin/switch",
    async (route) => {
      await held;
      await route.fulfill({ status: 503, json: { error: "worker_unavailable" } });
    },
    { times: 1 },
  );
  await sw.click();
  await expect(word(sw)).toHaveText("Saving…");
  await expect(sw).toHaveAttribute("aria-disabled", "true");
  release();
  await expect(panel(page).getByRole("alert")).toHaveText("Could not change Finalize. Try again.");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(word(sw)).toHaveText("Running");
});

test("the engine and evacuated callouts follow the health payload", async ({ page }) => {
  await page.route("**/api/admin/health", async (route) => {
    const res = await route.fetch();
    const body = { ...(await res.json()), feeEngine: "dry", evacuatedAt: "2026-10-25T09:30:00.000Z" };
    await route.fulfill({ response: res, json: body });
  });
  await page.reload(); // the console's first poll landed before the route was in place
  const box = panel(page);
  await expect(box.getByRole("status").filter({ hasText: "fee engine" })).toHaveText(
    "The fee engine is in dry run for this deploy. Fee switches take effect when it is on.",
  );
  await expect(box.getByRole("status").filter({ hasText: "Evacuated" })).toHaveText(
    "Evacuated 2026-10-25 09:30 UTC. Every job stays paused until you turn it back on, one at a time.",
  );
});

test("the audit op refuses a malformed cursor and pages from a valid one", async ({ page }) => {
  const bad = await page.request.post("/api/admin/audit", { headers: origin(), data: { before: "1e5.x" } });
  expect(bad.status()).toBe(400);
  const before = `${Date.now() + 60_000}.9223372036854775807`;
  const ok = await page.request.post("/api/admin/audit", { headers: origin(), data: { before } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.rows.length).toBeGreaterThan(0);
  expect(body.rows.length).toBeLessThanOrEqual(50);
  expect(
    Object.keys(body.rows[0].params).every((k) => ["job", "enabled", "wallet", "wallets"].includes(k)),
  ).toBe(true);
});
