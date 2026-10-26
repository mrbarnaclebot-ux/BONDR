// The launch banner per pause reason (D-22, UI-SPEC surface 1). /api/status is stubbed, so no worker switch flips
// and the contract check never has to fail for real.
import type { PauseReason, Status } from "@bondr/core/api";
import { expect, type Page, test } from "@playwright/test";
import { toStep2, toStep3 } from "./coin.ts";
import { injectPhantom, newTestAccount } from "./phantom.ts";

const MIN = "250000000";
const status = (paused: PauseReason): Status => ({
  ...{ net: "devnet", paused, quoteMint: "BondrQuote1111111111111111111111111111bndr" },
  ...{ fees: { protocolBps: 95, creatorBps: 30 }, minLamports: MIN, createCostEstimate: "8829040" },
  ...{ networkFeeEstimate: "10600", senderTipEstimate: null },
});

async function open(page: Page, paused: PauseReason) {
  await page.route("**/api/status", (r) => r.fulfill({ json: status(paused) }));
  await injectPhantom(page, newTestAccount());
  await page.goto("/launch");
  return page.getByRole("status").filter({ hasText: "Launches are paused." });
}

test("a failed contract check names the check, says trading continues and keeps Launch disabled", async ({
  page,
}) => {
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
