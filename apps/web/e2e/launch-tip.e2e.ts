// The Sender tip in the launch summary and the balance check (D-34, UI-SPEC surface 3). /api/status and the
// quote are stubbed, so the worker's own net and the chain play no part.
import type { Status } from "@bondr/core/api";
import { expect, type Page, test } from "@playwright/test";
import { field, receipt, row, solText, toStep2 } from "./coin.ts";
import { injectPhantom, newTestAccount, preConsent } from "./phantom.ts";

const MIN = "250000000";
const status = (net: Status["net"], senderTipEstimate: string | null): Status => ({
  net,
  paused: null,
  quoteMint: "BondrQuote1111111111111111111111111111bndr",
  fees: { protocolBps: 95, creatorBps: 30 },
  minLamports: MIN,
  createCostEstimate: "8829040",
  networkFeeEstimate: "10600",
  senderTipEstimate,
});

async function stubStatus(page: Page, s: Status) {
  await page.route("**/api/status", (r) => r.fulfill({ json: s }));
}

test("mainnet shows the Sender tip row after Network fee, in the summary's order", async ({ page }) => {
  await stubStatus(page, status("mainnet", "1000000"));
  await page.goto("/launch");
  await expect(row(receipt(page), "Sender tip")).toHaveText("about 0.001 SOL");
  const dts = await receipt(page).locator("dt").allTextContents();
  const at = dts.indexOf("Pump create and accounts");
  expect(dts.slice(at - 1, at + 4)).toEqual([
    "Dev buy",
    "Pump create and accounts",
    "Network fee",
    "Sender tip",
    "Back to you on insta sell",
  ]);
});

test("devnet hides the Sender tip row once the status has loaded", async ({ page }) => {
  await stubStatus(page, status("devnet", null));
  await page.goto("/launch");
  await expect(row(receipt(page), "Network fee")).toHaveText(/about/);
  await expect(receipt(page).locator('dt:text-is("Sender tip")')).toHaveCount(0);
});

// IN-B-02: with no status, the server's SOLANA_NET (devnet here) decides, so no "Unavailable" tip row.
test("devnet shows no Sender tip row when the status read fails", async ({ page }) => {
  await page.route("**/api/status", (r) => r.fulfill({ status: 503, json: { error: "worker_unavailable" } }));
  await page.goto("/launch");
  await expect(row(receipt(page), "Network fee")).toHaveText(/Unavailable/);
  await expect(receipt(page).locator('dt:text-is("Sender tip")')).toHaveCount(0);
});

test("a balance that covers everything but the tip gets the balance error", async ({ page }) => {
  const s = status("mainnet", "1000000");
  const covered = BigInt(MIN) + BigInt(s.createCostEstimate ?? 0) + BigInt(s.networkFeeEstimate ?? 0);
  await stubStatus(page, s);
  await page.route("**/api/quote", (r) =>
    r.fulfill({ json: { tokensOut: "1", solBackEstimate: "1", balance: String(covered) } }),
  );
  const account = newTestAccount();
  await injectPhantom(page, account);
  await preConsent(page, account.address);
  await page.goto("/launch");
  await page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();
  await toStep2(page);
  await page.getByRole("radio", { name: /Insta burn/ }).check();
  await field(page, "Dev buy").fill(solText(MIN));
  await expect(
    page.getByText(/^Your wallet has [\d.]+ SOL\. This launch needs about [\d.]+ SOL/),
  ).toBeVisible({
    timeout: 20_000,
  });
});
