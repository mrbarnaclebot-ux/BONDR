// Proves the transaction inspector (ADMIN-09, D-32): the curve-buy fixture's devnet signature decodes through the
// real local worker (a getTransaction read, no spend) with a success status and a pump line; a short string shows
// the field error and sends nothing; a routed found false and a routed 503 show their exact copy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { openConsole } from "./admin.ts";

const fixture = fileURLToPath(new URL("../../../packages/core/src/fixtures/curve-buy.json", import.meta.url));
const SIG = (JSON.parse(readFileSync(fixture, "utf8")) as { source: string }).source;
const NOT_FOUND = "Transaction not found. It may be too new, too old for this RPC, or on another cluster.";

const panel = (page: Page) => page.getByRole("region", { name: "Transaction inspector", exact: true });
const input = (page: Page) => panel(page).getByLabel("Paste a transaction signature");

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openConsole(page);
});
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("a devnet signature decodes through the worker with its status and a pump instruction", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await expect(
    panel(page).getByText("Works for any signature on this cluster, not only BONDR's."),
  ).toBeVisible();
  await input(page).fill(SIG);
  await input(page).press("Enter"); // Enter submits
  const pre = panel(page).locator("pre");
  await expect(pre.or(panel(page).getByRole("alert"))).toBeVisible({ timeout: 30_000 });
  const alerts = panel(page).getByRole("alert");
  const alert = (await alerts.count()) ? await alerts.textContent() : "";
  test.skip(
    alert === NOT_FOUND,
    "the devnet RPC no longer has the curve-buy fixture transaction (history pruned)",
  );
  await expect(pre).toContainText(/Status {2}success, slot 514,267,874/);
  await expect(pre).toContainText(/#5 {2}pump: /);
  await expect(pre).toContainText("Compute Budget: SetComputeUnitLimit");
  await expect(pre.getByRole("link", { name: "Open in Solscan (opens Solscan)" })).toHaveAttribute(
    "href",
    `https://solscan.io/tx/${SIG}?cluster=devnet`,
  );
  await expect(panel(page).getByRole("status")).toHaveText(/^Decoded\. Status success, \d+ instructions\.$/);
});

test("a short string shows the field error and sends no request", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/admin/inspect", (route) => {
    calls++;
    return route.abort();
  });
  await input(page).fill("abc123");
  await panel(page).getByRole("button", { name: "Decode" }).click();
  await expect(panel(page).getByText("That is not a transaction signature.")).toBeVisible();
  await expect(input(page)).toHaveAttribute("aria-invalid", "true");
  expect(calls).toBe(0);
});

test("found false shows the not-found copy", async ({ page }) => {
  await page.route("**/api/admin/inspect", (route) => route.fulfill({ json: { found: false } }));
  await input(page).fill("5".repeat(88));
  await panel(page).getByRole("button", { name: "Decode" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText(NOT_FOUND);
  await expect(panel(page).locator("pre")).toHaveCount(0);
});

test("an RPC failure shows the RPC copy", async ({ page }) => {
  await page.route("**/api/admin/inspect", (route) =>
    route.fulfill({ status: 503, json: { error: "rpc_failed" } }),
  );
  await input(page).fill("5".repeat(88));
  await panel(page).getByRole("button", { name: "Decode" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText("Could not reach the RPC. Try again.");
});
