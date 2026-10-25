// The bonded half of Bond and burn and the bonded totals (TOKEN-03, TOKEN-05, FEE-05) on seeded PumpSwap coins:
// the forced and trader bond moments, the bond burn states, the fee shares states (a held finalize stays plain
// and never shows its reason) and the trade panel's creator fee row per state. /api/trade/quote is stubbed.
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeSig, type LedgerSeed, type Seeded, seedCoin, seedLedger } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";
import { panel, QUOTE_BUY, QUOTE_POOL, stubTrade } from "./trade-stubs.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as coin.e2e.ts explains.
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const HELD_REASON = "deployer is off curve";

test.describe.configure({ timeout: 90_000 }); // a Neon cold start and a first route compile
test.skip(!sql, "needs DATABASE_URL in the root .env");
test.use({ reducedMotion: "reduce" });

const bond = (page: Page) => page.getByRole("region", { name: "Bond and burn" });
const ledger = (page: Page) => page.getByRole("region", { name: "Fee ledger" });
const total = (page: Page, label: string) => ledger(page).locator(`dt:text-is("${label}") + dd`).first();

// bondr_sol 1e6 lamports per base unit: 5,000 BONDR spent reads 5 SOL.
const pool = () => ({
  venue: "pool",
  progress: 1,
  bond_sig: fakeSig(),
  bonded_at: new Date(Date.now() - 2 * 3_600_000),
  bondr_sol: 1e6,
});
const BURN = { amount: "5000000000", burned: "96100000000000", sol: "5000000000" };

const seeded: Seeded[] = [];
async function seed(coin: Record<string, string | number | Date | null>, rows: LedgerSeed[] = []) {
  const c = await seedCoin(db(), { trades: 2, coin: { ...pool(), ...coin } });
  seeded.push(c);
  const sigs = rows.length ? await seedLedger(db(), c.mint, rows) : [];
  return { ...c, ledgerSigs: sigs.map((s) => s.signature) };
}
test.afterAll(async () => {
  for (const c of seeded) await dropCoin(db(), c.mint);
});

/** The trade panel's coin hop creator row for a stubbed quote. */
async function creatorRow(page: Page, symbol: string, hop: string) {
  const trade = panel(page, symbol);
  await trade.getByRole("textbox", { name: "You pay" }).fill("0.5");
  await trade.getByText("Fees 0.0062 SOL").click();
  return trade.locator("details dl > div", { hasText: hop });
}

test("a forced bond, finalized: moment, burn, permanent shares, deployer earned, creator split", async ({
  page,
}) => {
  const c = await seed(
    {
      bond_spent: BURN.amount,
      bond_spent_sol: BURN.sol,
      bond_burned: BURN.burned,
      finalize: "done",
      deployer_bps: 8000,
      deployer_earned: "2000000000",
      deployer_earned_sol: "2000000000",
    },
    [
      { kind: "forced_bond", ...BURN },
      { kind: "finalize_update", detail: { dBps: 8000, tBps: 2000 } },
    ],
  );
  const [burnSig, finalizeSig] = c.ledgerSigs as string[];
  await stubTrade(page, { quote: { json: QUOTE_POOL } });
  await page.goto(`/coin/${c.mint}`);
  const p = bond(page);
  await expect(p.getByRole("heading", { name: "Forced by its own fees.", level: 3 })).toBeVisible();
  await expect(p).toContainText(`${c.symbol}'s burn budget bought the last of its curve and burned it.`);
  await expect(p.getByRole("heading", { name: "Forced-bond buy", level: 3 })).toBeVisible();
  await expect(p.getByText("Bought and burned", { exact: true })).toBeVisible();
  await expect(p).toContainText(`96.1M ${c.symbol}`);
  await expect(p.getByRole("link", { name: /^Burn tx / })).toHaveAttribute(
    "href",
    new RegExp(`^https://solscan.io/tx/${burnSig}`),
  );
  await expect(p.getByRole("heading", { name: "Fee shares, permanent", level: 3 })).toBeVisible();
  await expect(p).toContainText("80 deployer / 20 treasury");
  await expect(p.getByRole("link", { name: /^Finalize tx / })).toHaveAttribute(
    "href",
    new RegExp(finalizeSig),
  );
  await expect(p).toContainText(/Bonded \d{4}-\d\d-\d\d \d\d:\d\d UTC, forced by its own fees\./);

  await expect(total(page, "Forced-bond buy")).toHaveText("5 SOL");
  await expect(ledger(page)).toContainText("5,000 BONDR spent on the curve");
  await expect(total(page, "Deployer earned")).toHaveText("2 SOL");
  await expect(ledger(page)).toContainText("80% of post-bond fees");
  await expect(ledger(page)).toContainText("BONDR: 10% before bond, 20% after");

  const hop = await creatorRow(page, c.symbol, `Fees on ${c.symbol} PumpSwap`);
  await expect(hop).toContainText("Creator 0.05%, split 80 deployer / 20 treasury");
});

test("bonded by traders before finalize: fallback buy and pending shares", async ({ page }) => {
  const c = await seed(
    { bond_spent: BURN.amount, bond_spent_sol: BURN.sol, bond_burned: BURN.burned, finalize: "none" },
    [{ kind: "pool_burn", ...BURN }],
  );
  await page.goto(`/coin/${c.mint}`);
  const p = bond(page);
  await expect(p.getByRole("heading", { name: "Bonded by its traders.", level: 3 })).toBeVisible();
  await expect(p).toContainText(`Its burn budget then bought ${c.symbol} on PumpSwap and burned it.`);
  await expect(p.getByRole("heading", { name: "Fallback buy", level: 3 })).toBeVisible();
  await expect(p.getByRole("heading", { name: "Fee shares", exact: true, level: 3 })).toBeVisible();
  await expect(p.getByText("Pending", { exact: true })).toBeVisible();
  await expect(total(page, "Fallback buy")).toHaveText("5 SOL");
  await expect(total(page, "Deployer share")).toHaveText("Pending");
});

test("a held finalize reads Pending review, plain, with no reason on the page", async ({ page }) => {
  const c = await seed({ finalize: "held" }, [
    { kind: "held", state: null, signature: null, detail: { reason: HELD_REASON } },
  ]);
  await page.goto(`/coin/${c.mint}`);
  const tag = bond(page).getByText("Pending review", { exact: true });
  await expect(tag).toBeVisible();
  await expect(tag).not.toHaveClass(/warn|destructive/);
  await expect(bond(page)).toContainText("this coin is waiting for a manual check");
  await expect(total(page, "Deployer share")).toHaveText("Pending review");
  await expect(total(page, "Bond burn buy")).toHaveText("0 SOL");
  expect(await page.content()).not.toContain(HELD_REASON);
});

test("no burn row and a landed finalize: bond burn None", async ({ page }) => {
  const c = await seed({ finalize: "done", deployer_bps: 8000 }, [
    { kind: "finalize_update", detail: { dBps: 8000, tBps: 2000 } },
  ]);
  await page.goto(`/coin/${c.mint}`);
  const p = bond(page);
  await expect(p.getByRole("heading", { name: "Bond burn", level: 3 })).toBeVisible();
  await expect(p.getByText("None", { exact: true })).toBeVisible();
  await expect(p).toContainText(
    `The burn budget was empty when ${c.symbol} bonded, so there was nothing to burn.`,
  );
  await expect(p).toContainText(`Traders completed ${c.symbol}'s curve. It now trades on PumpSwap.`);
});

test("on curve the creator fee goes to the coin's burn budget", async ({ page }) => {
  const c = await seed({ venue: "curve", progress: 0.2, bond_sig: null, bonded_at: null });
  await stubTrade(page, { quote: { json: QUOTE_BUY } });
  await page.goto(`/coin/${c.mint}`);
  const hop = await creatorRow(page, c.symbol, `Fees on the ${c.symbol} curve`);
  await expect(hop).toContainText(`Creator 0.3%, to the ${c.symbol} burn budget`);
});
