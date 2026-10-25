// Live fee events on the token page (D-22) over a stubbed /api/live, released after the server render: a landed
// collect and split pair lands on top of the ledger, the totals and Supply burned stat follow the event's coin,
// the polite region reads the burst once, and a resync refetches the ledger's first page exactly once.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeSig, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;

test.describe.configure({ timeout: 60_000 });
test.skip(!sql, "needs DATABASE_URL in the root .env");

const sse = (events: [string, unknown][]) =>
  `retry: 60000\n\n${events.map(([e, d], i) => `id: e2e-${i}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("")}`;

/** Answers /api/live with `events` once `gate` resolves, so the test reads the server render first. */
async function stubLive(page: Page, events: [string, unknown][], gate?: Promise<void>) {
  await page.route(
    (u) => u.pathname === "/api/live",
    async (r) => {
      await gate;
      await r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) });
    },
  );
}

const ledger = (page: Page) => page.getByRole("region", { name: "Fee ledger" });
const entries = (page: Page) =>
  ledger(page).getByRole("list", { name: "Fee movements, newest first" }).getByRole("listitem");

let coin: Seeded;
test.beforeAll(async () => {
  coin = await seedCoin(db(), { trades: 2 });
});
test.afterAll(async () => {
  if (coin) await dropCoin(db(), coin.mint);
});

// The coin's fee fields after the pair: 1 BONDR to treasury (0.003 SOL) and 50M tokens burned (5.00%).
const fees = {
  w: null,
  budget: "9000000",
  budgetSol: "27000000",
  cost: null,
  costSol: null,
  toBuyback: "0",
  toBuybackSol: "0",
  toTreasury: "1000000",
  toTreasurySol: "3000000",
  bondSpent: "0",
  bondSpentSol: "0",
  bondBurned: "0",
  burnedSupply: "50000000000000",
  bondKind: null,
  bondBurnSig: null,
  deployerEarned: "0",
  deployerEarnedSol: "0",
  finalize: "none",
  deployerBps: null,
  finalizeSig: null,
};

function feeEvent(mint: string) {
  const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const row = { burned: null, windowIndex: 0, detail: null };
  const rows = [
    {
      ...row,
      id: "900000001",
      kind: "collect",
      amount: "10000000",
      sol: "30000000",
      signature: fakeSig(),
      landedAt: at(2),
    },
    {
      ...row,
      id: "900000002",
      kind: "split_treasury",
      amount: "1000000",
      sol: "3000000",
      signature: fakeSig(),
      landedAt: at(1),
    },
  ];
  const live = {
    mint,
    venue: "curve",
    mcapSol: 30,
    progress: 0.01,
    vol1h: 0,
    vol24h: 0,
    change1h: null,
    lastTradeAt: null,
    bondSol: null,
    bondrAtBond: null,
    realQuoteReserves: "0",
    holders: 1,
    fees,
  };
  return { mint, rows, coin: live };
}

test("a fee event lands on top, updates the totals and stat, and is announced once", async ({ page }) => {
  let open = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const event = feeEvent(coin.mint);
  await stubLive(page, [["fee", event]], gate);
  await page.goto(`/coin/${coin.mint}`);
  await expect(entries(page)).toHaveCount(1); // the launch row, server rendered
  open();

  await expect(entries(page)).toHaveCount(3);
  await expect(entries(page).nth(0)).toContainText("Split 90/10");
  await expect(entries(page).nth(1)).toContainText("Collect");
  await expect(entries(page).nth(0).getByRole("link")).toHaveAttribute(
    "href",
    new RegExp(event.rows[1].signature),
  );
  await expect(entries(page).nth(2)).toContainText("Launch burn");
  await expect(ledger(page).locator('dt:text-is("To treasury") + dd')).toHaveText("0.003 SOL");
  await expect(page.locator('dt:text-is("Supply burned") + dd').first()).toHaveText("5.00%");
  await expect(ledger(page).locator('[aria-live="polite"]')).toHaveText(
    "Fee ledger: Collect, 0.03 SOL. Fee ledger: Split 90/10, 0.003 SOL.",
  );
});

test("a resync refetches the ledger's first page exactly once", async ({ page }) => {
  let n = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/api/coin/${coin.mint}/ledger`) n++;
  });
  await stubLive(page, [["resync", {}]]);
  await page.goto(`/coin/${coin.mint}`);
  await expect.poll(() => n, { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(n).toBe(1);
  await expect(entries(page)).toHaveCount(1); // no duplicate launch or fee rows
});
