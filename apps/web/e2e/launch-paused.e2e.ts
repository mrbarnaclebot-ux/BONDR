// The launch banner per pause reason (D-22, UI-SPEC surface 1). /api/status is stubbed, so no worker switch flips
// and the contract check never has to fail for real.
import type { PauseReason, Status } from "@bondr/core/api";
import { expect, type Page, test } from "@playwright/test";
import { toStep2, toStep3 } from "./coin.ts";
import { injectPhantom, newTestAccount } from "./phantom.ts";
import { gate, PHASE7_SHOTS } from "./shoot.ts";

const MIN = "250000000";
const QUOTE = "BondrQuote1111111111111111111111111111bndr";
// Genesis mode has no BONDR quote mint yet (D-29).
const status = (paused: PauseReason): Status => ({
  ...{ net: "devnet", paused, quoteMint: paused === "genesis" ? null : QUOTE },
  ...{ fees: { protocolBps: 95, creatorBps: 30 }, minLamports: MIN, createCostEstimate: "8829040" },
  ...{ networkFeeEstimate: "10600", senderTipEstimate: null },
});

async function open(page: Page, paused: PauseReason, title = "Launches are paused.") {
  await page.route("**/api/status", (r) => r.fulfill({ json: status(paused) }));
  await injectPhantom(page, newTestAccount());
  await page.goto("/launch");
  return page.getByRole("status").filter({ hasText: title });
}

test("a failed contract check names the check, says trading continues and keeps Launch disabled", {
  tag: "@smoke",
}, async ({ page }) => {
  const banner = await open(page, "contract_check");
  await expect(banner).toContainText("A weekly safety check found that pump.fun changed something");
  await expect(banner).toContainText("Trading is not affected.");
  await toStep2(page);
  await toStep3(page, MIN);
  await expect(page.getByRole("button", { name: "Launches paused" })).toBeDisabled();
});

test("the kill switch keeps its own body", async ({ page }) => {
  const banner = await open(page, "kill_switch");
  await expect(banner).toContainText("The BONDR owner has paused new launches.");
  await expect(banner).not.toContainText("Trading is not affected.");
});

test("genesis mode says launches are not open yet and keeps Launch disabled", { tag: "@smoke" }, async ({
  page,
}) => {
  const banner = await open(page, "genesis", "Launches are not open yet.");
  await expect(banner).toContainText(
    "Launches open after the BONDR token is live. You can fill this in now; the Launch button unlocks automatically when launches open.",
  );
  await expect(page.getByRole("status").filter({ hasText: "Launches are paused." })).toHaveCount(0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gate(page, "launch-genesis-banner", width, PHASE7_SHOTS);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await toStep2(page);
  await toStep3(page, MIN);
  await expect(page.getByRole("button", { name: "Launches paused" })).toBeDisabled();
});
