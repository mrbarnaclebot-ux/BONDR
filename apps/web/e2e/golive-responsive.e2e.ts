// The Phase 7 UI-SPEC accessibility matrix at 390, 768 and 1440, each through shoot.ts gate (no horizontal page
// scroll, 0 axe violations, a screenshot in PHASE7_SHOTS) named golive-{state}-{width}. States: the public genesis
// and contract_check banners; the owner genesis variant at step 2, step 3 and its summary; the Sender tip row; the
// ticker refusal at step 4 and in the step 1 field; the reserved field error; search with the First marker; the
// Sniped line; the admin contract cell passed, redeployed, mismatch (with the Kill switches callout) and could not
// run; the admin genesis callout; and the terms contact section. Below 768px the new controls (Run check now, the
// genesis Sell card, the refusal callout's controls) must be at least 44px tall. Status, quote, prepare and the
// admin health contract are stubbed, so nothing is sent or spent; search and the token page use seeded coins.
import { randomBytes, randomInt } from "node:crypto";
import type { PauseReason, Status } from "@bondr/core/api";
import type { AdminContract } from "@bondr/core/api-admin";
import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { openConsole, skipRefused } from "./admin.ts";
import { stubConsole } from "./admin-stubs.ts";
import { field, receipt, row, solText, toStep2 } from "./coin.ts";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { stub, toSign } from "./launch-stubs.ts";
import { adminAccount, adminSignIn, injectPhantom, newTestAccount, preConsent, rootEnv } from "./phantom.ts";
import { gate, PHASE7_SHOTS } from "./shoot.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

// Runs in the admin-responsive project (playwright.config.ts RESPONSIVE): the admin health limit is per wallet.
test.describe.configure({ timeout: 90_000 }); // a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" });
// Every admin and owner test signs in, and the session route allows 10 calls per IP in 10 minutes.
test.beforeEach(({ context }) =>
  context.setExtraHTTPHeaders({ "x-real-ip": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}` }),
);
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const WIDTHS = [390, 768, 1440];
const MIN = "250000000";
const TREASURY = "TreasuryBondr111111111111111111111111111111";
const status = (paused: PauseReason | null, over: Partial<Status> = {}): Status => ({
  ...{
    net: "devnet",
    paused,
    quoteMint: paused === "genesis" ? null : "BondrQuote1111111111111111111111111111bndr",
  },
  ...{ fees: { protocolBps: 93, creatorBps: 30 }, minLamports: MIN, createCostEstimate: "8829040" },
  ...{ networkFeeEstimate: "10600", senderTipEstimate: null },
  ...(paused === "genesis" && { genesisTreasury: TREASURY }),
  ...over,
});
const stubStatus = (page: Page, s: Status) => page.route("**/api/status", (r) => r.fulfill({ json: s }));

/** gate at every width; `check` runs at each width first (the 44px rule below 768). */
async function matrix(
  page: Page,
  state: string,
  check?: (width: number) => Promise<void>,
  el?: () => Locator,
) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await check?.(width);
    await gate(page, `golive-${state}`, width, PHASE7_SHOTS, el?.());
  }
}
const tall = (target: () => Locator) => async (width: number) => {
  if (width >= 768) return;
  // Polled: right after a resize the md: rules can still apply for a frame (seen once at 24px).
  for (const box of await target().all())
    await expect
      .poll(async () => (await box.boundingBox())?.height ?? 0, {
        message: `${await box.textContent()} at ${width}px`,
      })
      .toBeGreaterThanOrEqual(44);
};

test("launch: public genesis banner", async ({ page }) => {
  await stubStatus(page, status("genesis"));
  await page.goto("/launch");
  await expect(page.getByRole("status").filter({ hasText: "Launches are not open yet." })).toBeVisible();
  await matrix(page, "launch-genesis-public");
});

test("launch: contract_check banner", async ({ page }) => {
  await stubStatus(page, status("contract_check"));
  await page.goto("/launch");
  await expect(page.getByRole("status").filter({ hasText: "Trading is not affected." })).toBeVisible();
  await matrix(page, "launch-contract-paused");
});

// The admin cookie comes from the real sign-in through page.request, which the browser context shares.
async function asOwner(page: Page) {
  let admin: ReturnType<typeof adminAccount>;
  try {
    admin = adminAccount();
  } catch {
    test.skip(true, "needs MASTER_SEED_FILE in the root .env");
    return;
  }
  const res = await adminSignIn(page.request, admin);
  const error = res.ok() ? null : (await res.json().catch(() => null))?.error;
  skipRefused(error);
  expect(res.status()).toBe(200);
  await stubStatus(page, status("genesis"));
  await page.route("**/api/quote", (r) =>
    r.fulfill({ json: { tokensOut: "8000000000000", solBackEstimate: "0" } }),
  );
  await injectPhantom(page, admin);
  await preConsent(page, admin.address);
  await page.goto("/launch");
}

test("launch: owner genesis variant, steps 2 and 3 and the summary", async ({ page }) => {
  await asOwner(page);
  await expect(page.getByRole("status").filter({ hasText: "Genesis launch." })).toBeVisible();
  await toStep2(page, "BONDR", "BONDR");
  await expect(page.getByRole("radio", { name: /Insta burn/ })).toBeChecked();
  const sellCard = () =>
    page.locator("label").filter({ has: page.getByRole("radio", { name: /Insta sell/ }) });
  await matrix(page, "launch-genesis-owner-buy", tall(sellCard));
  await page.setViewportSize({ width: 1280, height: 720 });
  await field(page, "Dev buy").fill(solText(MIN));
  await page.getByRole("button", { name: "Review launch" }).click();
  await expect(row(page.getByRole("region", { name: /Step 3 of 5/ }), "Pair")).toHaveText("SOL");
  await matrix(page, "launch-genesis-owner-review");
  await expect(row(receipt(page), "BONDR treasury, claimed on pump.fun")).toHaveText("100%");
  await matrix(page, "launch-genesis-owner-summary", undefined, () => receipt(page));
});

test("launch: Sender tip row on mainnet", async ({ page }) => {
  await stubStatus(page, status(null, { net: "mainnet", senderTipEstimate: "1000000" }));
  await page.goto("/launch");
  await expect(row(receipt(page), "Sender tip")).toHaveText("about 0.001 SOL");
  await matrix(page, "launch-tip-summary");
});

test("launch: ticker refusal at step 4, then the step 1 field", async ({ page }) => {
  await stub(page, {
    prepare: { status: 409, json: { error: "ticker_locked", retryAfter: 75600, lock: "landed" } },
  });
  await toSign(page, newTestAccount(), { symbol: "pepe" });
  const callout = page.getByRole("main").getByRole("alert");
  await expect(callout).toContainText("$PEPE launched on BONDR 3h ago. Try again in 21h");
  await matrix(
    page,
    "launch-ticker-locked-step4",
    tall(() => callout.locator("a, button")),
  );
  await page.getByRole("button", { name: "Back to review" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#coin-symbol-error")).toHaveText(
    "$PEPE launched on BONDR 3h ago. Try again in 21h.",
  );
  await matrix(page, "launch-ticker-field");
});

test("launch: reserved ticker field error", async ({ page }) => {
  await page.goto("/launch");
  await field(page, "Symbol").fill("sol");
  await expect(page.locator("#coin-symbol-error")).toHaveText(
    "$SOL is reserved on BONDR. Choose another ticker.",
  );
  await matrix(page, "launch-reserved-field");
});

test.describe("seeded", () => {
  test.skip(!sql, "needs DATABASE_URL in the root .env");
  const seeded: Seeded[] = [];
  const db = () => sql as postgres.Sql;
  test.afterAll(async () => {
    for (const c of seeded) await dropCoin(db(), c.mint);
  });
  const seed = async (coin: Record<string, string | number | null | Date>, trades = 0) => {
    const c = await seedCoin(db(), { trades, coin });
    seeded.push(c);
    return c;
  };

  test("search with the First marker", async ({ page }) => {
    const key = `F${randomBytes(4).toString("hex").toUpperCase()}`;
    for (const [symbol, day] of [
      [key, 1],
      [key, 2],
      [`${key}X`, 3],
    ] as const) {
      const c = await seed({ launched_at: new Date(`2099-06-0${day}T00:00:00Z`) });
      await db()`update launches set symbol = ${symbol} where mint = ${c.mint}`;
    }
    await page.goto(`/?q=${key.toLowerCase()}`);
    await expect(page.getByRole("list", { name: "Coins" }).getByRole("link")).toHaveCount(3);
    await expect(page.getByRole("link", { name: /first launched with this ticker/i })).toHaveCount(1);
    await matrix(page, "search-first");
  });

  test("token page Sniped line", async ({ page }) => {
    const c = await seed({ create_slot: "1000", sniped_bps: 320 }, 3);
    await page.goto(`/coin/${c.mint}`);
    await expect(page.getByText(/^Sniped 3\.2% of supply\./)).toBeVisible();
    await matrix(page, "coin-sniped");
  });
});

const AT = new Date(Date.now() - 60_000).toISOString();
const FACTS = [
  "creator fee not configurable, assumed 150 bps per coin",
  "Global account is 1096 bytes, expected 1088",
];
const contract = (over: Partial<AdminContract>): AdminContract => ({
  ...{ kind: "passed", at: AT, facts: [], programs: [], lastPass: AT },
  ...over,
});
const admin: [string, AdminContract, boolean, string][] = [
  ["admin-contract-passed", contract({}), false, "Passed"],
  [
    "admin-contract-redeployed",
    contract({ kind: "redeployed", programs: ["pump"] }),
    false,
    "Passed, pump redeployed",
  ],
  ["admin-contract-mismatch", contract({ kind: "mismatch", facts: FACTS }), false, "Mismatch, jobs paused"],
  ["admin-contract-failed", contract({ kind: "failed" }), false, "Could not run"],
  ["admin-genesis-callout", contract({}), true, "Passed"],
];

for (const [state, c, genesis, value] of admin) {
  test(`admin: ${state}`, async ({ page }) => {
    await stubConsole(page, { health: { contract: c, genesis } });
    await openConsole(page);
    const cell = page
      .getByRole("region", { name: "Health", exact: true })
      .locator("dl > div")
      .filter({ has: page.locator('dt:text-is("Pump contract check")') });
    await expect(cell.locator("dd").first()).toContainText(value);
    const switches = page.getByRole("region", { name: /^Kill switches/ });
    if (c.kind === "mismatch")
      await expect(switches.getByRole("alert")).toContainText("The pump contract check failed.");
    if (genesis) await expect(switches).toContainText("Genesis mode.");
    await matrix(
      page,
      state,
      tall(() => cell.getByRole("button", { name: "Run check now" })),
    );
  });
}

test("terms: contact section", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.locator("#t08").getByRole("link", { name: "hello@trybondr.fun" })).toHaveAttribute(
    "href",
    "mailto:hello@trybondr.fun",
  );
  await matrix(page, "terms-contact");
});
