// Steps 4 and 5. The stubbed group fakes the launch routes with page.route (no chain, no spend); the devnet
// group (E2E_DEVNET=1) runs one real minimum launch, signed by the fake Phantom with the sim dev key.
import { execFileSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { current } from "./coin.ts";
import { blockTime } from "./fixtures.ts";
import {
  back,
  FACTS,
  ID,
  MINT,
  PREPARED,
  SIG,
  type Stubs,
  signRow,
  stub,
  toSign,
  view,
} from "./launch-stubs.ts";
import { emitChange, newTestAccount, simDevAccount } from "./phantom.ts";

const BUILD_FAILED = "Could not build your launch transaction. Nothing was sent. Try again.";
const REJECTED =
  "Phantom rejected the request. Nothing was sent and no SOL left your wallet. Your mint address stays reserved for 10 minutes.";
const PAUSED =
  "Launches were paused before your launch was sent. Nothing was sent. Your details are kept; launch when the pause lifts.";

test.describe("stubbed", () => {
  test("one signature runs the five rows and lands on the success screen", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const account = newTestAccount();
    const calls = await stub(page, {
      view: (n) => ({ json: n < 4 ? view("sent") : view("landed", { facts: FACTS }) }),
    });
    await toSign(page, account);
    await expect(page.getByText("CID bafk…cccc")).toBeVisible();
    await expect(page.getByText("769 of 1,232 bytes, create + buy + burn")).toBeVisible();
    await expect(page.getByRole("heading", { name: "GRUB is live." })).toBeFocused({ timeout: 15_000 });
    const wire = Buffer.from(calls.signed, "base64");
    expect(verify(null, wire.subarray(129), createPublicKey(account.key), wire.subarray(1, 65))).toBe(true);
    const proof = page.getByRole("complementary", { name: "Launch supply proof" });
    await expect(proof).toContainText("Dev holds 0 launch supply");
    await expect(proof).toContainText("dev buy (31.1M tokens) was burned in the launch transaction.");
    await expect(proof.getByRole("link")).toHaveAttribute(
      "href",
      `https://solscan.io/tx/${SIG}?cluster=devnet`,
    );
    await page.getByRole("button", { name: "Copy address" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MINT);
    await expect(page.getByRole("link", { name: "Open GRUB" })).toHaveAttribute("href", `/coin/${MINT}`);
  });

  test("Back to review hides after submit, and a reload restores step 4 without a new sign", async ({
    page,
  }) => {
    const calls = await stub(page, {
      prepare: { json: PREPARED, delayMs: 1500 },
      view: () => ({ json: view("sent") }),
    });
    await toSign(page, newTestAccount());
    await expect(signRow(page, 2)).toHaveAttribute("data-state", "now");
    await expect(back(page)).toBeVisible();
    await expect(signRow(page, 5)).toHaveAttribute("data-state", "now");
    await expect(back(page)).toBeHidden();
    const polled = calls.view;
    await page.reload();
    await expect(current(page)).toHaveText(/04\s*Sign/);
    await expect(signRow(page, 5)).toHaveAttribute("data-state", "now");
    await expect.poll(() => calls.view).toBeGreaterThan(polled + 1);
    await expect(page.getByRole("button", { name: "Sign in Phantom" })).toHaveCount(0);
    expect([calls.prepare, calls.submit]).toEqual([1, 1]);
  });

  test("Launch another stays on step 1 when a facts read lands after it (web WR-06)", async ({ page }) => {
    const calls = await stub(page, {
      view: (n) =>
        n === 1 ? { json: view("landed") } : { json: view("landed", { facts: FACTS }), delayMs: 2500 },
    });
    await toSign(page, newTestAccount());
    await expect(page.getByRole("heading", { name: "GRUB is live." })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => calls.view).toBeGreaterThanOrEqual(2); // a facts read is in flight
    const late = page.waitForResponse(/\/api\/launch\/[0-9a-f]{32}$/);
    await page.getByRole("button", { name: "Launch another" }).click();
    await late;
    await page.waitForTimeout(500); // a render after the late read would show step 5 again
    await expect(current(page)).toHaveText(/01\s*Coin/);
  });

  test("a Phantom rejection fails row 3 with Try again and sends nothing", async ({ page }) => {
    const calls = await stub(page, {});
    await toSign(page, newTestAccount(), { reject: true });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(REJECTED);
    await expect(signRow(page, 3)).toHaveAttribute("data-state", "failed");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(back(page)).toBeVisible();
    expect(calls.submit).toBe(0);
  });

  test("an account switch before signing cancels with the switch copy", async ({ page }) => {
    await stub(page, { prepare: { json: {}, status: 503, delayMs: 3000 } });
    await toSign(page, newTestAccount());
    await emitChange(page, newTestAccount());
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Phantom switched accounts. Nothing was sent.",
    );
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  const cases: {
    code: string;
    at: keyof Stubs;
    status: number;
    row: number;
    copy: string;
    action?: string;
  }[] = [
    {
      code: "pin_failed",
      at: "pin",
      status: 502,
      row: 1,
      copy: "Could not pin your image",
      action: "Try again",
    },
    {
      code: "worker_unavailable",
      at: "prepare",
      status: 503,
      row: 2,
      copy: BUILD_FAILED,
      action: "Try again",
    },
    { code: "invalid_input", at: "prepare", status: 400, row: 2, copy: BUILD_FAILED, action: "Try again" },
    { code: "toString", at: "prepare", status: 500, row: 2, copy: BUILD_FAILED, action: "Try again" },
    {
      code: "pool_empty",
      at: "prepare",
      status: 503,
      row: 2,
      copy: "No bndr addresses",
      action: "Try again",
    },
    { code: "rate_limited", at: "prepare", status: 429, row: 2, copy: "Too many launch attempts" },
    {
      code: "expired",
      at: "submit",
      status: 410,
      row: 3,
      copy: "This transaction expired",
      action: "Build again",
    },
    {
      code: "cosign_refused",
      at: "submit",
      status: 422,
      row: 4,
      copy: "BONDR did not co-sign.",
      action: "Try again",
    },
    { code: "paused", at: "submit", status: 409, row: 4, copy: PAUSED },
    {
      code: "onchain",
      at: "view",
      status: 200,
      row: 5,
      copy: "Your launch failed on-chain.",
      action: "Try again",
    },
  ];
  for (const c of cases) {
    test(`${c.code} fails row ${c.row} with its copy`, async ({ page }) => {
      const reply = { status: c.status, json: { error: c.code } };
      const failed = { json: view("failed", { error: "onchain" }) };
      await stub(page, c.at === "view" ? { view: () => failed } : { [c.at]: reply });
      await toSign(page, newTestAccount());
      await expect(page.getByRole("main").getByRole("alert")).toContainText(c.copy);
      await expect(signRow(page, c.row)).toHaveAttribute("data-state", "failed");
      for (const name of ["Try again", "Build again"])
        await expect(page.getByRole("button", { name })).toHaveCount(name === c.action ? 1 : 0);
      if (c.at === "view")
        await expect(page.getByRole("main").getByRole("alert").getByRole("link")).toBeVisible();
    });
  }

  test("paused before send also switches the page to the paused state", async ({ page }) => {
    const calls = await stub(page, {
      submit: { status: 409, json: { error: "paused", paused: "kill_switch" } },
    });
    // The pause starts with the submit: before it, Sign in Phantom must be enabled.
    await page.route("**/api/status", async (r) => {
      const real = await (await r.fetch()).json();
      await r.fulfill({ json: { ...real, paused: calls.submit ? "kill_switch" : real.paused } });
    });
    await toSign(page, newTestAccount());
    await expect(page.getByRole("main").getByRole("alert")).toContainText(PAUSED);
    await expect(page.getByRole("status").filter({ hasText: "Launches are paused." })).toBeVisible();
  });

  test("unknown keeps row 5 spinning with the unknown copy and no retry", async ({ page }) => {
    await stub(page, { view: () => ({ json: view("unknown") }) });
    await toSign(page, newTestAccount());
    const note = page.getByRole("status").filter({ hasText: "Still confirming." });
    await expect(note).toContainText("Do not launch again until this finishes; it can take up to a minute.");
    await expect(note.getByRole("link")).toHaveAttribute("href", /cluster=devnet/);
    await expect(signRow(page, 5)).toHaveAttribute("data-state", "now");
    await expect(page.getByRole("button", { name: /Try again|Build again/ })).toHaveCount(0);
  });

  test("insufficient_balance returns to step 2 with the dev buy focused", async ({ page }) => {
    await stub(page, { prepare: { status: 402, json: { error: "insufficient_balance" } } });
    await toSign(page, newTestAccount());
    await expect(current(page)).toHaveText(/02\s*Dev buy and exit/);
    await expect(page.getByRole("textbox", { name: "Dev buy" })).toBeFocused();
  });

  test("consent_required reopens the consent dialog on step 3", async ({ page }) => {
    await stub(page, { pin: { status: 403, json: { error: "consent_required" } } });
    await toSign(page, newTestAccount());
    await expect(page.getByRole("dialog", { name: "Before BONDR remembers this wallet" })).toBeVisible();
    await expect(current(page)).toHaveText(/03\s*Review/);
  });

  test("a stored launch the server does not know returns to step 1", async ({ page }) => {
    await stub(page, { view: () => ({ status: 404, json: { error: "not_found" } }) });
    await page.addInitScript((id) => sessionStorage.setItem("bondr:launch", id), ID);
    await page.goto("/launch");
    await expect(page.getByText("We could not find that launch. Start again.")).toBeVisible();
    await expect(current(page)).toHaveText(/01\s*Coin/);
  });
});

test.describe("devnet", () => {
  test.skip(process.env.E2E_DEVNET !== "1", "one real launch: set E2E_DEVNET=1");
  test.describe.configure({ timeout: 180_000 });
  test.beforeAll(() => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    execFileSync("node", ["--env-file=.env", "scripts/devnet-launch.ts", "--fund"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, VANITY_THREADS: "0" },
    });
  });

  test("a real launch shows the success screen within 5 s of confirmation", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const symbol = `E${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await toSign(page, simDevAccount(), { symbol, signIn: true }); // real pin and prepare need a real session
    const heading = page.getByRole("heading", { name: `${symbol} is live.` });
    await heading.waitFor({ timeout: 150_000 });
    const seen = Date.now();
    const href = (await page.getByRole("link", { name: /Launch tx/ }).getAttribute("href")) as string;
    expect(href).toContain("cluster=devnet");
    const signature = (href.match(/\/tx\/(\w+)/) as RegExpMatchArray)[1] as string;
    const lag = seen - (await blockTime(signature)) * 1000;
    console.log(`devnet launch ${signature}: success screen ${lag} ms after blockTime`);
    expect(lag).toBeLessThanOrEqual(6000);
    await expect(page.getByText("Dev holds 0 launch supply")).toBeVisible();
    await page.getByRole("button", { name: "Copy address" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const mint = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`devnet launch mint ${mint}`);
    expect(mint).toMatch(/bndr$/);
    await expect(page.getByRole("link", { name: `Open ${symbol}` })).toHaveAttribute("href", `/coin/${mint}`);
  });
});
