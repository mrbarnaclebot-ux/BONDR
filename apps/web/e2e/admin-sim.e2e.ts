// Proves the simulation dialog (ADMIN-01, ADMIN-03, ADMIN-04, D-12, D-14). Stubbed: simulate, execute and the
// intent poll are answered by admin-stubs.ts and the overview carries a fixture coin, so this spec never sends a
// transaction or spends devnet SOL. It checks the preview before signing, Cancel focus and focus return, the
// signed bytes against the worker's intent text, the refused, used and expired paths, and Burn buyback now.
import { createPublicKey, verify } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { openConsole } from "./admin.ts";
import {
  HELD_MINT,
  INTENT_ID,
  MESSAGE,
  type SimStubs,
  simFixture,
  stubConsole,
  stubSim,
} from "./admin-stubs.ts";
import { adminAccount, injectPhantom, preConsent, type TestAccount } from "./phantom.ts";

const dialog = (page: Page) => page.getByRole("dialog");
const SEND = "Sign with owner wallet and send";

/** The fake Phantom on the admin key, the stubbed console, then the held coin's timeline unless `pick` is false. */
async function setup(page: Page, o: SimStubs = {}, pick = true) {
  let admin: TestAccount | null = null;
  try {
    admin = adminAccount();
  } catch {
    test.skip(true, "needs MASTER_SEED_FILE in the root .env");
  }
  if (!admin) throw new Error("unreachable");
  const phantom = await injectPhantom(page, admin);
  await preConsent(page, admin.address);
  await stubConsole(page);
  const calls = await stubSim(page, o);
  await openConsole(page);
  await page.getByRole("button", { name: "Refresh" }).click();
  // The real overview read behind the stub can take a Neon cold start.
  await expect(page.getByRole("button", { name: "HELD, open timeline" })).toBeVisible({ timeout: 30_000 });
  if (pick) {
    await page.getByRole("button", { name: "HELD, open timeline" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Timeline, HELD" })).toBeFocused();
  }
  return { admin, phantom, calls };
}

/** The grid's Finalize split (the held box has one too); returns the opener. */
async function openFinalize(page: Page) {
  const panel = page.getByRole("region", { name: "Timeline, HELD" });
  const opener = panel.getByRole("button", { name: "Finalize split" }).last();
  await opener.click();
  await expect(dialog(page).getByRole("heading", { level: 2, name: "Finalize split, HELD" })).toBeVisible();
  return opener;
}

test.describe("admin-sim", () => {
  test.describe.configure({ timeout: 90_000 });
  // An action's overview reload can still be in flight when a test ends; its route must not fail the run.
  test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("Finalize split previews before anything is signed; Escape returns focus to the opener", async ({
    page,
  }) => {
    const { calls } = await setup(page);
    const opener = await openFinalize(page);
    const d = dialog(page);
    await expect(d.getByText("Simulated, nothing sent yet")).toBeVisible();
    await expect(d.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(d.getByText("Compute")).toContainText("48,210");
    await expect(d.getByRole("row", { name: /Deployer Dep1…1111/ })).toContainText("+0.4 SOL");
    await expect(d.getByText("Destinations check passed:")).toBeVisible();
    await expect(
      d.getByText("This is the single allowed update_fee_shares_v2 for HELD.", { exact: false }),
    ).toBeVisible();
    await expect(
      d.getByText("Later transactions are simulated again by the RPC before they are sent."),
    ).toBeVisible();
    await expect(d.getByRole("button", { name: "Connect Phantom" })).toBeVisible();
    expect(calls.simulate.at(-1)).toEqual({ action: "finalize_split", mint: HELD_MINT });
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(calls.execute).toEqual([]);
  });

  test("send signs the worker's intent text byte for byte and shows both landed transactions", async ({
    page,
  }) => {
    const { admin, phantom, calls } = await setup(page);
    await openFinalize(page);
    const d = dialog(page);
    await d.getByRole("button", { name: "Connect Phantom" }).click();
    await d.getByRole("button", { name: SEND }).click();
    await expect(
      d.getByRole("status").filter({ hasText: "Sent. 2 of 2 transactions landed." }),
    ).toBeVisible();
    await expect(d.getByRole("link", { name: /opens Solscan/ })).toHaveCount(2);
    expect(phantom.messages).toEqual([MESSAGE]);
    const [body] = calls.execute as { id: string; signature: string }[];
    expect(body.id).toBe(INTENT_ID);
    const sig = Buffer.from(body.signature, "base64");
    expect(verify(null, Buffer.from(MESSAGE), createPublicKey(admin.key), sig)).toBe(true);
    expect(calls.intent.length).toBeGreaterThanOrEqual(2);
    await d.getByRole("button", { name: "Done" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a refused destination shows the refusal and no send button", async ({ page }) => {
    const refused = "Evi1111111111111111111111111111111111111111";
    await setup(page, {
      simulate: { json: simFixture({ destinations: { ok: false, refused }, intent: undefined }) },
    });
    await openFinalize(page);
    const d = dialog(page);
    await expect(
      d.getByText(
        `Destination refused: ${refused} is not burn, treasury, buyback or HELD's deployer. Nothing can be sent.`,
      ),
    ).toBeVisible();
    await expect(d.getByRole("button", { name: SEND })).toHaveCount(0);
    await expect(d.getByRole("button", { name: "Connect Phantom" })).toHaveCount(0);
  });

  test("an intent already used says so and sends nothing", async ({ page }) => {
    const { calls } = await setup(page, { execute: { status: 409, json: { error: "intent_used" } } });
    await openFinalize(page);
    const d = dialog(page);
    await d.getByRole("button", { name: "Connect Phantom" }).click();
    await d.getByRole("button", { name: SEND }).click();
    await expect(d.getByText("This simulation was already used. Simulate again.")).toBeVisible();
    await expect(d.getByRole("button", { name: "Simulate again" })).toBeVisible();
    expect(calls.intent).toEqual([]);
  });

  test("the client clock passing Expires ends the simulation", async ({ page }) => {
    await page.clock.install();
    const { calls } = await setup(page);
    await openFinalize(page);
    const d = dialog(page);
    await expect(d.getByText(/^Expires/)).toBeVisible();
    await page.clock.fastForward(121_000);
    await expect(d.getByText("This simulation expired. Simulate again; nothing was sent.")).toBeVisible();
    await expect(d.getByRole("button", { name: SEND })).toHaveCount(0);
    await expect(d.getByRole("button", { name: "Connect Phantom" })).toHaveCount(0);
    expect(calls.execute).toEqual([]);
  });

  test("Burn buyback now opens from the Wallets panel with no coin selected", async ({ page }) => {
    const sim = simFixture({
      action: "burn_buyback",
      mint: null,
      steps: [{ ok: true, cu: 9_000, estimated: false }],
    });
    const { calls } = await setup(page, { simulate: { json: sim } }, false);
    await expect(page.getByRole("heading", { level: 2, name: "Timeline", exact: true })).toBeVisible();
    await page
      .getByRole("region", { name: "Wallets" })
      .getByRole("button", { name: "Burn buyback now" })
      .click();
    const d = dialog(page);
    await expect(d.getByRole("heading", { level: 2, name: "Burn buyback now" })).toBeVisible();
    await expect(d.getByText("Burned tokens cannot be recovered.")).toBeVisible();
    expect(calls.simulate.at(-1)).toEqual({ action: "burn_buyback", mint: null });
  });
});
