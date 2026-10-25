// The Phase 5 UI-SPEC accessibility matrix at 390, 768 and 1440, each with no horizontal scroll, 0 axe violations
// and a full-page screenshot for the Designer. Home: `/` with the Next to bond rail hidden and shown. Shown: two
// seeded curve coins with burn budgets lead the rail, the top one at 104.9%, and the hero's second CTA is Watch a
// coin bond to it. Hidden runs first and only when no curve coin has a budget (the shared dev branch may hold real
// ones). Token page: the six /coin/[mint] states of the accessibility contract on seeded coins. Against staging
// (E2E_BASE_URL) nothing is seeded: the live home and the first curve coin are gated as they are.

import type { CoinRow } from "@bondr/core/api";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeSig, type LedgerSeed, type Seeded, seedCoin, seedLedger } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import { gate, PHASE5_SHOTS } from "./shoot.ts";

const STAGING = process.env.E2E_BASE_URL;
const url = STAGING ? undefined : rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as in coin.e2e.ts (a worker may come back to this module).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

// Serial: the hidden state must render before this file seeds the coins that show the rail.
test.describe.configure({ mode: "serial", timeout: 90_000 }); // a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" }); // settled frames: the bars draw at their value, the hero video is a still
test.skip(!STAGING && !sql, "needs DATABASE_URL in the root .env");

const WIDTHS = [390, 768, 1440];
const COST = "1000000000000";
const rail = (page: Page) => page.getByRole("region", { name: "Next to bond" });

/** Whether any curve coin on any page of /api/coins has a burn budget (then the rail cannot be hidden). */
async function anyBudget(api: APIRequestContext): Promise<boolean> {
  for (let page = 0; ; page++) {
    const res = await api.get(`/api/coins?sort=top&page=${page}`);
    const { coins, more } = (await res.json()) as { coins: CoinRow[]; more: boolean };
    if (coins.some((c) => c.venue === "curve" && BigInt(c.fees?.budget ?? 0) > 0n)) return true;
    if (!more) return false;
  }
}

test.describe("staging", () => {
  test.skip(!STAGING, "staging only");
  for (const width of WIDTHS)
    test(`home at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Built/ })).toBeVisible();
      await gate(page, (await rail(page).count()) ? "home-rail" : "home-norail", width, PHASE5_SHOTS);
    });
  for (const width of WIDTHS)
    test(`coin-curve at ${width}`, async ({ page, request }) => {
      const { coins } = (await (await request.get("/api/coins?sort=top")).json()) as { coins: CoinRow[] };
      const coin = coins.find((c) => c.venue === "curve");
      expect(coin, "a curve coin on staging").toBeTruthy();
      await page.setViewportSize({ width, height: 900 });
      await coinPage(page, (coin as CoinRow).mint);
      await gate(page, "coin-curve", width, PHASE5_SHOTS);
    });
});

test.describe("rail hidden", () => {
  test.skip(!!STAGING, "seeded runs only");
  for (const width of WIDTHS)
    test(`home-norail at ${width}`, async ({ page, request }) => {
      test.skip(
        await anyBudget(request),
        "a curve coin on the dev branch has a burn budget, so the rail shows",
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("link", { name: "See all coins" })).toBeVisible();
      await expect(rail(page)).toHaveCount(0);
      await gate(page, "home-norail", width, PHASE5_SHOTS);
    });
});

test.describe("rail shown", () => {
  test.skip(!!STAGING, "seeded runs only");
  let top: Seeded;
  let next: Seeded;
  test.beforeAll(async () => {
    const db = sql as postgres.Sql;
    const fees = (budget: string) => ({ fee_budget: budget, cost_to_complete: COST });
    top = await seedCoin(db, { trades: 0, coin: fees("1049000000000") });
    next = await seedCoin(db, { trades: 0, coin: fees("700000000000") });
  });
  test.afterAll(async () => {
    if (sql) for (const c of [top, next]) if (c) await dropCoin(sql, c.mint);
  });

  for (const width of WIDTHS)
    test(`home-rail at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // The rail read is kept 10 s per process, so a page rendered just before the seed can miss the coins.
      await expect(async () => {
        await page.goto("/");
        await expect(rail(page).getByRole("link").first()).toHaveAccessibleName(new RegExp(top.symbol), {
          timeout: 2000,
        });
      }).toPass({ timeout: 30_000 });
      await expect(rail(page).getByText("104.9% ready", { exact: true })).toBeVisible();
      await expect(
        rail(page).getByRole("link", { name: new RegExp(`${next.symbol}, .*70\\.0% ready`) }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Watch a coin bond" })).toHaveAttribute(
        "href",
        `/coin/${top.mint}`,
      );
      await gate(page, "home-rail", width, PHASE5_SHOTS);
    });
});

// The token page states. bondr_sol 1e6 lamports per base unit, so 504 of 1000 reads 50.4%; the bonded columns
// and rows are fee-bonded.e2e.ts's.
const BURN = { amount: "5000000000", burned: "96100000000000", sol: "5000000000" };
const bonded = (extra: Record<string, string | number | null>) => ({
  venue: "pool",
  progress: 1,
  bond_sig: fakeSig(),
  bonded_at: new Date(Date.now() - 2 * 3_600_000),
  bondr_sol: 1e6,
  ...extra,
});
const spent = { bond_spent: BURN.amount, bond_spent_sol: BURN.sol, bond_burned: BURN.burned };
const collects = Array.from({ length: 25 }, (_, i) => ({
  kind: "collect",
  amount: String(1_000_000 + i),
  sol: "3000",
  window_index: 0,
  landed_at: new Date(Date.now() - 5 * 60_000 - i * 60_000),
}));
const STATES: { name: string; coin: Record<string, string | number | Date | null>; rows?: LedgerSeed[] }[] = [
  { name: "curve-nofees", coin: { fee_budget: "0", cost_to_complete: "1000", bondr_sol: 1e6 } },
  { name: "curve-budget", coin: { fee_budget: "504", cost_to_complete: "1000", bondr_sol: 1e6 } },
  {
    name: "forced",
    coin: bonded({ ...spent, finalize: "done", deployer_bps: 8000, deployer_earned: "2000000000" }),
    rows: [
      { kind: "forced_bond", ...BURN },
      { kind: "finalize_update", detail: { dBps: 8000, tBps: 2000 } },
    ],
  },
  { name: "traders", coin: bonded({ ...spent, finalize: "none" }), rows: [{ kind: "pool_burn", ...BURN }] },
  {
    name: "held",
    coin: bonded({ finalize: "held" }),
    rows: [{ kind: "held", state: null, signature: null, detail: { reason: "deployer is off curve" } }],
  },
  {
    name: "ledger-more",
    coin: { fee_budget: "0", cost_to_complete: "1000", bondr_sol: 1e6 },
    rows: collects,
  },
];

/** Opens a token page and waits for both Phase 5 panels. */
async function coinPage(page: Page, mint: string) {
  await page.goto(`/coin/${mint}`);
  await expect(page.getByRole("region", { name: "Bond and burn" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Fee ledger" })).toBeVisible();
}

test.describe("token page states", () => {
  test.skip(!!STAGING, "seeded runs only");
  const mints = new Map<string, string>();
  test.beforeAll(async () => {
    const db = sql as postgres.Sql;
    for (const s of STATES) {
      const c = await seedCoin(db, { trades: 2, coin: s.coin });
      mints.set(s.name, c.mint);
      if (s.rows) await seedLedger(db, c.mint, s.rows);
    }
  });
  test.afterAll(async () => {
    if (sql) for (const mint of mints.values()) await dropCoin(sql, mint);
  });

  for (const { name } of STATES)
    for (const width of WIDTHS)
      test(`coin-${name} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await coinPage(page, mints.get(name) as string);
        if (name === "ledger-more")
          await expect(page.getByRole("button", { name: "Load 20 older entries" })).toBeVisible();
        await gate(page, `coin-${name}`, width, PHASE5_SHOTS);
      });
});
