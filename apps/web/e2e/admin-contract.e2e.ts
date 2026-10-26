// The Pump contract check cell and the mismatch callout (UI-SPEC surfaces 5 and 6, D-18, D-20). Health polls
// answer the worker's real snapshot with `contract` replaced, and Run check now is answered in the browser, so
// no check runs and no switch moves.
import type { AdminContract } from "@bondr/core/api-admin";
import { expect, type Page, test } from "@playwright/test";
import { openConsole } from "./admin.ts";
import { stubConsole } from "./admin-stubs.ts";

const AT = new Date(Date.now() - 60_000).toISOString();
const FACTS = [
  "creator fee not configurable, assumed 150 bps per coin",
  "Global account is 1096 bytes, expected 1088",
];
const state = (over: Partial<AdminContract>): AdminContract => ({
  ...{ kind: "passed", at: AT, facts: [], programs: [], lastPass: AT },
  ...over,
});

async function open(page: Page, contract: AdminContract) {
  await stubConsole(page, { health: { contract } });
  await openConsole(page);
  const health = page.getByRole("region", { name: "Health", exact: true });
  const cell = health.locator("dl > div").filter({ has: page.locator('dt:text-is("Pump contract check")') });
  await expect(cell).toBeVisible();
  return cell;
}

test("passed reads Passed with the time in the leaf tone", async ({ page }) => {
  const cell = await open(page, state({}));
  const value = cell.locator("dd").first();
  await expect(value).toHaveText(/^Passed \d{2}:\d{2}:\d{2}$/);
  await expect(value).toHaveClass(/text-leaf/);
  await expect(cell).toContainText("Program IDs, IDL layouts, Global flags. Runs at boot and weekly.");
});

test("a redeploy is amber and names the program", async ({ page }) => {
  const cell = await open(page, state({ kind: "redeployed", programs: ["pump", "pump AMM"] }));
  const value = cell.locator("dd").first();
  await expect(value).toHaveText("Passed, pump redeployed");
  await expect(value).toHaveClass(/text-warn/);
  await expect(cell).toContainText("pump and pump AMM redeployed since the last check.");
});

test("a mismatch shows the dot, both facts and the Kill switches callout", async ({ page }) => {
  const cell = await open(page, state({ kind: "mismatch", facts: FACTS }));
  await expect(cell.locator("dd").first()).toHaveText("Mismatch, jobs paused");
  await expect(cell.locator("dt span.bg-destructive")).toHaveCount(1);
  for (const fact of FACTS) await expect(cell).toContainText(fact);
  await expect(cell).toContainText("Launches stay paused until Run check now passes.");
  const callout = page
    .getByRole("region", { name: /^Kill switches/ })
    .getByRole("alert")
    .filter({ hasText: "The pump contract check failed." });
  await expect(callout).toContainText("The failed facts are in Health.");
  await expect(callout).toContainText("Launches stay paused until Run check now passes.");
});

test("could not run names the last pass", async ({ page }) => {
  const cell = await open(page, state({ kind: "failed" }));
  await expect(cell.locator("dd").first()).toHaveText("Could not run");
  await expect(cell).toContainText(/The RPC did not answer\. Last pass \d{2}:\d{2}:\d{2}\./);
});

test("Run check now shows the answer in the cell at once", async ({ page }) => {
  const cell = await open(page, state({ kind: "not_run", at: null, lastPass: null }));
  await expect(cell.locator("dd").first()).toHaveText("Not run since boot");
  await page.route("**/api/admin/contract-check", (r) => r.fulfill({ json: state({}) }));
  await cell.getByRole("button", { name: "Run check now" }).click();
  await expect(cell.locator("dd").first()).toHaveText(/^Passed \d{2}:\d{2}:\d{2}$/);
});

test("a failed Run check now says so in an alert", async ({ page }) => {
  const cell = await open(page, state({}));
  await page.route("**/api/admin/contract-check", (r) =>
    r.fulfill({ status: 500, json: { error: "worker_unavailable" } }),
  );
  await cell.getByRole("button", { name: "Run check now" }).click();
  await expect(cell.getByRole("alert")).toHaveText("Could not run the check. Try again.");
  await expect(cell.getByRole("button", { name: "Run check now" })).toBeVisible();
});
