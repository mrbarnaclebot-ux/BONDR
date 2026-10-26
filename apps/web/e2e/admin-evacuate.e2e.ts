// Proves the EVACUATE section (ADMIN-11, D-35 to D-38). Stubbed: simulate, execute and the intent poll are
// answered by stubSim (any unstubbed call of the three never reaches the worker), and the health poll's
// `evacuate` is overridden, so this spec never spends devnet SOL and never pauses a real switch. It checks the
// exact phrase arm, the automatic simulation, Enter sending nothing, the signed bytes against the worker's intent
// text, the done line, the simulate-only and nothing-to-move states, and the 390px layout.
import { createPublicKey, verify } from "node:crypto";
import type { AdminSimResult, EvacuateTotals } from "@bondr/core/api-admin";
import { expect, type Page, test } from "@playwright/test";
import { openConsole } from "./admin.ts";
import { INTENT_ID, intentText, SIGS, type SimStubs, simFixture, stubSim } from "./admin-stubs.ts";
import { adminAccount, injectPhantom, preConsent, type TestAccount } from "./phantom.ts";

const PHRASE = "EVACUATE ALL W TO TREASURY";
const MESSAGE = intentText([
  "Action: evacuate",
  "Coin: platform",
  `Intent: ${INTENT_ID}`,
  "Destinations: Treasury Trea5ury1111111111111111111111111111111111",
  "Expiration Time: 2026-10-26T18:30:00.000Z",
]);
const TOTALS: EvacuateTotals = {
  ...{ wallets: 12, bondr: "18402110000000", bondrSol: "9200000000" },
  ...{ sol: "410000000", burnedIn: 3, failures: 0 },
};
const SUMMARY =
  "Simulated now: 12 W balances, 18,402,110 BONDR (9.2 SOL) and 0.41 SOL to the treasury, child tokens burned in 3 wallets, 0 failures.";

function evacSim(over: Partial<AdminSimResult> = {}): AdminSimResult {
  return simFixture({
    ...{ action: "evacuate", mint: null, balances: [], totals: TOTALS },
    steps: [{ ok: true, cu: 180_000, estimated: false }],
    destinations: { ok: true, passed: ["treasury matches config"] },
    intent: { id: INTENT_ID, message: MESSAGE, expiresAt: Date.now() + 120_000 },
    ...over,
  });
}

// One batch still sending with 4 W moved, then all 12 landed.
const intentAt = (n: number) => ({
  json:
    n === 1
      ? { id: INTENT_ID, state: "sending", sigs: [], landed: 1, total: 1, moved: 4, failed: 0 }
      : { id: INTENT_ID, state: "landed", sigs: SIGS, landed: 2, total: 2, moved: 12, failed: 0 },
});

type Setup = { o?: SimStubs; evacuate?: "simulate" | "on"; reject?: boolean };

/** The fake Phantom on the admin key, the health poll's ADMIN_EVACUATE, the stubbed money path, the console. */
async function setup(page: Page, { o = {}, evacuate = "on", reject = false }: Setup = {}) {
  let admin: TestAccount | null = null;
  try {
    admin = adminAccount();
  } catch {
    test.skip(true, "needs MASTER_SEED_FILE in the root .env");
  }
  if (!admin) throw new Error("unreachable");
  const phantom = await injectPhantom(page, admin, { reject });
  await preConsent(page, admin.address);
  // Before openConsole: the first health poll lands while the console opens.
  await page.route("**/api/admin/health", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), evacuate } });
  });
  const calls = await stubSim(page, { simulate: { json: evacSim() }, intent: intentAt, ...o });
  await openConsole(page);
  const box = page.getByRole("region", { name: "EVACUATE" });
  const input = box.getByLabel(`Type ${PHRASE} to arm`);
  await input.scrollIntoViewIfNeeded();
  return { admin, phantom, calls, box, input };
}

test.describe("admin-evacuate", () => {
  test.describe.configure({ timeout: 90_000 });
  test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a near miss stays disarmed and simulates nothing", async ({ page }) => {
    const { calls, box, input } = await setup(page);
    await input.fill("evacuate all w to treasury");
    await expect(box.getByText("Disarmed. The phrase must match exactly.")).toBeVisible();
    await expect(box.getByRole("button", { name: "Sign and evacuate", exact: true })).toBeDisabled();
    expect(calls.simulate).toEqual([]);
  });

  test("the exact phrase simulates once and Enter in the field sends nothing", async ({ page }) => {
    const { calls, box, input } = await setup(page);
    await input.fill(PHRASE);
    await expect(box.getByText(SUMMARY)).toBeVisible();
    await expect(box.getByText("Armed. Phantom will ask for your signature next.")).toBeVisible();
    expect(calls.simulate).toEqual([{ action: "evacuate", mint: null }]);
    await box.getByRole("button", { name: "Connect Phantom" }).click();
    await expect(box.getByRole("button", { name: "Sign and evacuate 12 wallets" })).toBeEnabled();
    await input.press("Enter");
    await page.waitForTimeout(500); // Enter would send at once if it submitted anything
    expect(calls.simulate).toHaveLength(1);
    expect(calls.execute).toEqual([]);
    await input.fill(`${PHRASE} `);
    await expect(box.getByText(SUMMARY)).toHaveCount(0);
    await expect(box.getByText("Disarmed. The phrase must match exactly.")).toBeVisible();
  });

  test("signing sends the worker's text byte for byte and reports the moved wallets", async ({ page }) => {
    const { admin, phantom, calls, box, input } = await setup(page);
    await input.fill(PHRASE);
    await box.getByRole("button", { name: "Connect Phantom" }).click();
    await box.getByRole("button", { name: "Sign and evacuate 12 wallets" }).click();
    await expect(
      box.getByText("Evacuated. 12 of 12 wallets moved to the treasury, 0 failed. Every job is paused."),
    ).toBeVisible();
    await expect(input).toHaveValue("");
    expect(phantom.messages).toEqual([MESSAGE]);
    const [body] = calls.execute as { id: string; signature: string }[];
    expect(body.id).toBe(INTENT_ID);
    const sig = Buffer.from(body.signature, "base64");
    expect(verify(null, Buffer.from(MESSAGE), createPublicKey(admin.key), sig)).toBe(true);
    expect(calls.intent.length).toBeGreaterThanOrEqual(2);
  });

  test("Phantom rejected sends nothing and leaves the button ready", async ({ page }) => {
    const { calls, box, input } = await setup(page, { reject: true });
    await input.fill(PHRASE);
    await box.getByRole("button", { name: "Connect Phantom" }).click();
    await box.getByRole("button", { name: "Sign and evacuate 12 wallets" }).click();
    await expect(box.getByText("Phantom rejected the request. Nothing was sent.")).toBeVisible();
    await expect(box.getByRole("button", { name: "Sign and evacuate 12 wallets" })).toBeEnabled();
    expect(calls.execute).toEqual([]);
  });

  test("a simulate-only deploy shows the totals and cannot send", async ({ page }) => {
    const o = { simulate: { json: evacSim({ intent: undefined }) } };
    const { calls, box, input } = await setup(page, { o, evacuate: "simulate" });
    await input.fill(PHRASE);
    await expect(box.getByText(SUMMARY)).toBeVisible();
    await expect(box.getByText("This deploy runs EVACUATE as a simulation only.")).toBeVisible();
    await expect(box.getByRole("button", { name: "Simulation only on this deploy" })).toBeDisabled();
    expect(calls.execute).toEqual([]);
  });

  test("empty W wallets read nothing to evacuate", async ({ page }) => {
    const totals = { ...TOTALS, wallets: 0, bondr: "0", bondrSol: "0", sol: "0", burnedIn: 0 };
    const o = { simulate: { json: evacSim({ totals, nothing: true, intent: undefined, steps: [] }) } };
    const { box, input } = await setup(page, { o });
    await input.fill(PHRASE);
    await expect(box.getByText("Every W is empty. Nothing to evacuate.")).toBeVisible();
    await expect(box.getByRole("button", { name: "Sign and evacuate", exact: true })).toBeDisabled();
  });

  test("at 390px the field and button are reachable, 44px tall, and the page does not scroll sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { box, input } = await setup(page);
    await input.fill(PHRASE);
    const button = box.getByRole("button", { name: "Connect Phantom" });
    await button.scrollIntoViewIfNeeded();
    for (const el of [input, button]) {
      await expect(el).toBeInViewport();
      expect((await el.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
