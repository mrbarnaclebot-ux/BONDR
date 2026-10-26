// The Phase 6 UI-SPEC accessibility matrix at 390, 768 and 1440 (D-38), each through shoot.ts gate (no
// horizontal page scroll, 0 axe violations, a screenshot in PHASE6_SHOTS) named admin-{state}-{width}. States:
// sign-in connect, wrong wallet and session ended; console healthy (also the audit log with its dev DB rows);
// ops low with a stuck coin selected; the simulation dialog ready, failed and landed (390 and 1440); the
// inspector with output; moderation with a field error; EVACUATE disarmed and simulated; and the token page of a
// seeded coin with a leftover_burn and an evacuate row. Below 768px every visible console control must also be
// at least 44px tall. Stubbed: overview rows and memory, the coin op, simulate, execute, intent, inspect,
// moderate and the EVACUATE health flag, so nothing is sent, spent or moderated. The not-configured card needs a
// server without ADMIN_WALLET; 06-26 gates it on staging.
import { randomInt } from "node:crypto";
import type { AdminCoinMemory } from "@bondr/core/api-admin";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import type { WRow } from "../lib/admin-data.ts";
import type { CoinTimeline } from "../lib/admin-timeline.ts";
import { openConsole } from "./admin.ts";
import { evacFixture, INSPECT, simFixture, stubConsole, stubSim } from "./admin-stubs.ts";
import { dropCoin, seedCoin, seedLedger } from "./fixtures.ts";
import { adminAccount, injectPhantom, newTestAccount, preConsent, rootEnv } from "./phantom.ts";
import { gate, PHASE6_SHOTS } from "./shoot.ts";

const STAGING = process.env.E2E_BASE_URL;
const url = STAGING ? undefined : rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

test.describe.configure({ timeout: 90_000 }); // a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" });
// The admin session route allows 10 calls per IP in 10 minutes and every test signs in, so each test presents
// its own client IP (the config's per-process one would run out halfway through this file).
test.beforeEach(({ context }) =>
  context.setExtraHTTPHeaders({ "x-real-ip": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}` }),
);
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const WIDTHS = [390, 768, 1440];
const H = 3_600_000;
const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const W = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const PHRASE = "EVACUATE ALL W TO TREASURY";

const coin = (mint: string, symbol: string, over: Partial<WRow> = {}): WRow => ({
  ...{ mint, symbol, name: `${symbol} coin`, image: null, w: W, venue: "curve", finalize: "none" },
  ...{ feeBudget: "100", feesUnclaimed: "0", cost: "1000", bondrSol: 0.001, launchedAt: iso(5 * H) },
  ...{ lastCollectAt: iso(H), heldAt: null, heldReason: null, bondSent: false, bondedAt: null },
  launch: "landed",
  ...over,
});
const HEALTHY = [
  coin("Trig11111", "TRIG", { feeBudget: "2000" }),
  coin("Coll11111", "COLL"),
  coin("Bond11111", "BOND", { venue: "pool", bondedAt: iso(2 * H) }),
  coin("Fin111111", "FINL", { venue: "pool", finalize: "done", bondedAt: iso(3 * H) }),
];
// Per call, as admin-stubs' evacFixture: the module can load long before this file runs (WR-E-06).
const stuck = (): AdminCoinMemory => ({
  mint: "Stuck1111",
  stuck: { step: "finalize", attempts: 3, code: "blockhash_expired", at: Date.now() - H },
  hold: null,
  busy: false,
});
const balances = (opsSol: string) => ({
  ...{ treasurySol: "2500000000", treasuryBondr: "0", buybackSol: "0", buybackBondr: "5000000", opsSol },
  ...{ opsFloor: "100000000", bondrSol: null, nextBurnAt: Date.now() + H },
});
const TIMELINE: CoinTimeline = {
  launch: {
    ...{ state: "landed", exit: "burn", solIn: "500000000", signature: "StuckLaunchSig", wallet: W },
    ...{ tokens: null, landedAt: null, createdAt: iso(5 * H) },
  },
  rows: [],
};

/** The real overview with fixture rows, memory and balances, plus health overrides; then the console. */
async function console_(page: Page, o: { stuck?: boolean; health?: Record<string, unknown> } = {}) {
  const rows = o.stuck
    ? [coin("Stuck1111", "STUK", { venue: "pool", bondedAt: iso(4 * H) }), ...HEALTHY]
    : HEALTHY;
  await page.route("**/api/admin/overview", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.rows = rows;
    body.worker = {
      balances: balances(o.stuck ? "40000000" : "1000000000"),
      coins: o.stuck ? [stuck()] : [],
    };
    await route.fulfill({ response: res, json: body });
  });
  await page.route("**/api/admin/coin", (route) =>
    route.fulfill({ json: { timeline: TIMELINE, live: null } }),
  );
  // Before openConsole: the first health poll lands while the console opens.
  await page.route("**/api/admin/health", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), ...o.health } });
  });
  await openConsole(page);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "COLL, open timeline" })).toBeVisible({ timeout: 30_000 });
}

/** Below 768px every visible button and input in main must be at least 44px tall (UI-SPEC tap targets). */
async function targets(page: Page, width: number) {
  if (width >= 768) return;
  const small = await page.locator("main").evaluate((m) =>
    [...m.querySelectorAll("button, input, [role=switch]")]
      .map((e) => [e, e.getBoundingClientRect()] as const)
      .filter(([, r]) => r.width > 0 && r.height > 0 && r.height < 44)
      .map(([e, r]) => `${e.textContent?.trim() || e.getAttribute("aria-label") || e.tagName} ${r.height}px`),
  );
  expect(small, "sub-44px targets").toEqual([]);
}

const shot = (page: Page, state: string, width: number) => gate(page, `admin-${state}`, width, PHASE6_SHOTS);

function phantomAdmin() {
  try {
    return adminAccount();
  } catch {
    test.skip(true, "needs MASTER_SEED_FILE in the root .env");
    throw new Error("unreachable");
  }
}

for (const width of WIDTHS)
  test.describe(`at ${width}`, () => {
    test.beforeEach(({ page }) => page.setViewportSize({ width, height: 900 }));

    test("sign-in connect", async ({ page }) => {
      await page.goto("/admin");
      const main = page.getByRole("main");
      test.skip(await page.getByText("Admin is not configured").isVisible(), "server without ADMIN_WALLET");
      await expect(main.getByRole("button", { name: "Connect Phantom" })).toBeVisible();
      await targets(page, width);
      await shot(page, "signin-connect", width);
    });

    test("sign-in wrong wallet", async ({ page }) => {
      const other = newTestAccount();
      await injectPhantom(page, other);
      await preConsent(page, other.address);
      await page.goto("/admin");
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Connect Phantom" }).click();
      await main.getByRole("button", { name: /^Sign in as / }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "This wallet is not the admin wallet." }),
      ).toBeVisible();
      await shot(page, "signin-wrong", width);
    });

    test("sign-in session ended", async ({ page }) => {
      await openConsole(page);
      await page.route("**/api/admin/health", (r) =>
        r.fulfill({ status: 401, json: { error: "unauthorized" } }),
      );
      const ended = page.getByText("Your admin session ended after 30 minutes. Sign in again.");
      await expect(ended).toBeVisible({ timeout: 20_000 }); // the next 10 s poll
      await shot(page, "signin-ended", width);
    });

    test("console healthy, audit log with rows", async ({ page }) => {
      await console_(page);
      await expect(page.getByRole("heading", { level: 2, name: "Timeline", exact: true })).toBeVisible();
      const audit = page.getByRole("region", { name: "Audit log", exact: true });
      expect(await audit.locator("tbody tr").count()).toBeGreaterThan(0);
      await targets(page, width);
      await shot(page, "console-healthy", width);
    });

    test("ops low with a stuck coin selected", async ({ page }) => {
      await console_(page, { stuck: true, health: { opsLow: true } });
      await expect(page.getByRole("heading", { level: 2, name: "Timeline, STUK" })).toBeVisible();
      await expect(page.getByText(/^Below the 0\.1 SOL alert/)).toBeVisible();
      await targets(page, width);
      await shot(page, "ops-low", width);
    });

    test("inspector with output", async ({ page }) => {
      await page.route("**/api/admin/inspect", (route) => route.fulfill({ json: INSPECT }));
      await openConsole(page);
      const panel = page.getByRole("region", { name: "Transaction inspector", exact: true });
      await panel.getByLabel("Paste a transaction signature").fill("5".repeat(88));
      await panel.getByRole("button", { name: "Decode" }).click();
      await expect(panel.locator("pre")).toContainText("pump: buy");
      await targets(page, width);
      await shot(page, "inspect", width);
    });

    test("moderation with a field error", async ({ page }) => {
      await page.route("**/api/admin/moderate", (r) =>
        r.fulfill({ json: { ok: false, reason: "no_match" } }),
      );
      await openConsole(page);
      const panel = page.getByRole("region", { name: "Moderation", exact: true });
      await panel.getByLabel("Hide a coin from lists").fill("zzzzzz");
      await panel.getByLabel("Reason, shown only here").first().fill("e2e check");
      await panel.getByRole("button", { name: "Hide coin" }).click();
      await expect(panel.getByText("No BONDR coin matches zzzzzz.")).toBeVisible();
      await targets(page, width);
      await shot(page, "moderation-error", width);
    });

    test("EVACUATE disarmed and simulated", async ({ page }) => {
      const admin = phantomAdmin();
      await injectPhantom(page, admin);
      await preConsent(page, admin.address);
      await stubSim(page, { simulate: { json: evacFixture() } });
      await console_(page, { health: { evacuate: "on" } });
      const box = page.getByRole("region", { name: "EVACUATE" });
      await expect(box.getByText("Disarmed. The phrase must match exactly.")).toBeVisible();
      await targets(page, width);
      await shot(page, "evacuate-disarmed", width);
      await box.getByLabel(`Type ${PHRASE} to arm`).fill(PHRASE);
      await expect(box.getByText("Armed. Phantom will ask for your signature next.")).toBeVisible();
      await box.getByRole("button", { name: "Connect Phantom" }).click();
      await expect(box.getByRole("button", { name: "Sign and evacuate 12 wallets" })).toBeEnabled();
      await targets(page, width);
      await shot(page, "evacuate-simulated", width);
    });

    test("simulation dialog ready, failed and landed", async ({ page }) => {
      test.skip(width === 768, "the UI-SPEC lists the dialog at 390 and 1440");
      const admin = phantomAdmin();
      await injectPhantom(page, admin);
      await preConsent(page, admin.address);
      let failed = false;
      await stubConsole(page);
      await stubSim(page);
      // Registered after stubSim, so it answers simulate first while `failed` is set (last route wins).
      await page.route("**/api/admin/simulate", (route) =>
        failed
          ? route.fulfill({ json: simFixture({ ok: false, error: "code 6001", intent: undefined }) })
          : route.fallback(),
      );
      await openConsole(page);
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByRole("button", { name: "HELD, open timeline" }).click({ timeout: 30_000 });
      const finalize = page
        .getByRole("region", { name: "Timeline, HELD" })
        .getByRole("button", { name: "Finalize split" })
        .last();
      const d = page.getByRole("dialog");
      const open = async () => {
        await finalize.click();
        await expect(d.getByRole("heading", { level: 2, name: "Finalize split, HELD" })).toBeVisible();
      };
      failed = true;
      await open();
      await expect(d.getByRole("alert").filter({ hasText: "Simulation failed: " })).toBeVisible();
      await shot(page, "sim-failed", width);
      await d.getByRole("button", { name: "Cancel" }).click();
      failed = false;
      await open();
      await d.getByRole("button", { name: "Connect Phantom" }).click();
      await expect(d.getByRole("button", { name: "Sign with owner wallet and send" })).toBeVisible();
      await targets(page, width);
      await shot(page, "sim-ready", width);
      await d.getByRole("button", { name: "Sign with owner wallet and send" }).click();
      await expect(
        d.getByRole("status").filter({ hasText: "Sent. 2 of 2 transactions landed." }),
      ).toBeVisible();
      await expect(d.getByText("Simulated, then sent")).toBeVisible();
      await shot(page, "sim-landed", width);
    });
  });

test.describe("token page ledger kinds", () => {
  test.skip(!!STAGING || !sql, "seeded runs only, needs DATABASE_URL in the root .env");
  let mint = "";
  test.beforeAll(async () => {
    const db = sql as postgres.Sql;
    const c = await seedCoin(db, {
      trades: 2,
      coin: { fee_budget: "0", cost_to_complete: "1000", bondr_sol: 1e6 },
    });
    mint = c.mint;
    await seedLedger(db, mint, [
      { kind: "leftover_burn", amount: "31120363129", burned: "31120363129" },
      { kind: "evacuate", amount: "5000000000", sol: "5000000000" },
    ]);
  });
  test.afterAll(async () => {
    if (sql && mint) await dropCoin(sql, mint);
  });
  for (const width of WIDTHS)
    test(`coin ledger at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/coin/${mint}`);
      const ledger = page.getByRole("region", { name: "Fee ledger" });
      await expect(ledger.getByText("Leftover burn", { exact: true })).toBeVisible();
      await expect(ledger.getByText("Emergency", { exact: true })).toBeVisible();
      // The 1100px padding must beat md:p-8 (Tailwind v4 sorts a px breakpoint before md; deferred from 06-12).
      const pad = width >= 1100 ? "24px" : width >= 768 ? "32px" : "16px";
      for (const name of ["Fee ledger", "Bond and burn"])
        await expect(page.getByRole("region", { name })).toHaveCSS("padding-top", pad);
      await shot(page, "coin-ledger", width);
    });
});
