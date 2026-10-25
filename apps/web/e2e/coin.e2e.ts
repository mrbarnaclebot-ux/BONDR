// The bare token page /coin/[mint]. The found group reads the newest landed devnet launch; the links and
// unlanded cases use a throwaway launch row on a fake mint (used_at set, so the pool never hands it out).
import { randomBytes, randomInt } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { dropCoin, fakeMint, fakeSig, type Seeded, seedCoin } from "./fixtures.ts";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll: a fullyParallel worker runs afterAll when it leaves this file
// and reuses the module if it comes back, and an ended client refuses every query (CONNECTION_ENDED).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fixtures: string[] = [];

type Landed = Record<"mint" | "name" | "symbol" | "exit" | "signature" | "wallet", string> & {
  links: Record<string, string> | null;
};

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");
test.beforeAll(async () => {
  if (sql) await sql`select 1`;
});
test.afterAll(async () => {
  if (sql && fixtures.length) {
    await sql`delete from launches where mint in ${sql(fixtures)}`;
    await sql`delete from vanity_mints where pubkey in ${sql(fixtures)}`;
  }
});

const newest = async (): Promise<Landed> => {
  const [row] = await db()<Landed[]>`select mint, name, symbol, exit, signature, wallet, links
    from launches where state = 'landed' order by created_at desc limit 1`;
  return row;
};

/** A launch row in `state` on a fresh fake mint, removed in afterAll. */
async function fixture(state: string, links: Record<string, string> = {}): Promise<string> {
  const mint = fakeMint();
  fixtures.push(mint);
  const { wallet } = await newest();
  const idx = -(2n ** 61n) - BigInt(randomInt(1_000_000));
  await db()`insert into vanity_mints (idx, pubkey, used_at) values (${idx.toString()}, ${mint}, now())`;
  // A year back, like seedCoin, so a parallel spec's newest() never picks this row and loses it mid-test.
  await db()`insert into launches (id, wallet, mint, w, state, name, symbol, links, uri, sol_in, exit, signature, facts,
      created_at)
    values (${randomBytes(16).toString("hex")}, ${wallet}, ${mint}, 'e2e', ${state}, 'BONDR e2e links', 'BLINK',
      ${db().json(links)}, 'https://ipfs.io/ipfs/x', 2500000, 'burn',
      ${state === "landed" ? randomBytes(48).toString("hex") : null}, ${db().json({ tokens: "31120363129478" })},
      now() - interval '1 year')`;
  return mint;
}

async function expectNotFound(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No BONDR coin here" })).toBeVisible();
  await expect(page.getByText("There is no coin launched through BONDR at this address.")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Launch a coin" })).toHaveAttribute(
    "href",
    "/launch",
  );
}

test.describe("404", () => {
  test("an unknown mint is a 404 with Launch a coin", ({ page }) =>
    expectNotFound(page, `/coin/${fakeMint()}`));
  test("a malformed mint is a 404", ({ page }) => expectNotFound(page, "/coin/not-a-mint"));
  test("a mint with only a failed row is a 404", async ({ page }) => {
    await expectNotFound(page, `/coin/${await fixture("failed")}`);
  });
  test("a mint with only a prepared row is a 404", async ({ page }) => {
    await expectNotFound(page, `/coin/${await fixture("prepared")}`);
  });
});

test.describe("found", () => {
  test("the newest landed launch shows its identity, proof and contract address", async ({ page }) => {
    const c = await newest();
    const res = await page.goto(`/coin/${c.mint}`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(`${c.name} (${c.symbol}) on BONDR`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      new RegExp(`${c.name}\\s*${c.symbol}`, "i"),
    );
    const proof = page.getByRole("complementary", { name: "Launch supply proof" });
    await expect(proof).toContainText("Proof, checked on-chain");
    await expect(proof).toContainText("Dev holds 0 launch supply");
    await expect(proof.locator("p")).toHaveText(
      new RegExp(`^Deployer ${short(c.wallet)} chose insta ${c.exit}: `),
    );
    const tx = proof.getByRole("link");
    await expect(tx).toHaveAttribute("href", new RegExp(`/tx/${c.signature}\\?cluster=devnet$`));
    await expect(page.getByText(c.mint, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy contract address" })).toBeVisible();
    await expect(page.getByText("On curve")).toBeVisible();
    // The Phase 4 note promising a later ledger gave way to the Fee ledger panel (TOKEN-04).
    await expect(page.getByRole("region", { name: "Fee ledger" })).toBeVisible();
    await expect(page.getByText(/public fee ledger for/)).toHaveCount(0);
    for (const name of [`${c.symbol} on X`, "Telegram"]) {
      const link = page.getByRole("link", { name, exact: true });
      if (c.links?.[name === "Telegram" ? "telegram" : "x"])
        await expect(link).toHaveAttribute("rel", /noopener/);
      else await expect(link).toHaveCount(0);
    }
  });

  test("the copy chip copies the full mint", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { mint } = await newest();
    await page.goto(`/coin/${mint}`);
    await page.getByRole("button", { name: "Copy contract address" }).click();
    await expect(page.getByText("Contract address copied")).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mint);
  });

  test("X, Telegram and website links render when present, with rel noopener", async ({ page }) => {
    const links = {
      x: "https://x.com/bondr",
      telegram: "https://t.me/bondr",
      website: "https://grubworm.fun/",
    };
    await page.goto(`/coin/${await fixture("landed", links)}`);
    const expected: [string, string][] = [
      ["BLINK on X", links.x],
      ["Telegram", links.telegram],
      ["grubworm.fun", links.website],
    ];
    for (const [name, href] of expected) {
      const link = page.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
    // No coins row yet: the panel shows the curve at 0 and the stats wait.
    await expect(page.getByRole("img", { name: "Curve 0.0 percent filled" })).toBeVisible();
    await expect(page.locator('dt:text-is("Holders") + dd')).toHaveText("–not counted yet");
  });

  for (const width of [390, 768, 1440]) {
    test(`no horizontal scroll at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/coin/${(await newest()).mint}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const chip = await page.getByRole("button", { name: "Copy contract address" }).boundingBox();
      expect(chip?.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
    });
  }
});

test.describe("trades", () => {
  let coin: Seeded;
  test.beforeAll(async () => {
    coin = await seedCoin(db(), { trades: 60 });
  });
  test.afterAll(async () => {
    if (coin) await dropCoin(db(), coin.mint);
  });

  test("the feed shows 50 newest trades and loads older ones back to the launch", async ({ page }) => {
    await page.goto(`/coin/${coin.mint}`);
    await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: `Trades for ${coin.symbol}, newest first` });
    for (const name of ["Time", "Side", "SOL", coin.symbol, "Trader", "Tx"])
      await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(table.getByText("Buy", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("Sell", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("Launch", { exact: true })).toHaveCount(0);
    const newest = coin.sigs.at(-1) as string;
    await expect(table.getByRole("link").first()).toHaveAccessibleName(
      `Transaction ${short(newest)} (opens Solscan)`,
    );
    const hrefs = await table
      .getByRole("link")
      .evaluateAll((a) => a.map((x) => (x as HTMLAnchorElement).href));
    expect(hrefs[0]).toContain(newest);
    for (const href of hrefs) expect(href).toContain("cluster=devnet");

    await page.getByRole("button", { name: "Load 50 older trades" }).click();
    // 20 s: a dev server compiles the route on its first request, and Neon may be waking.
    await expect(page.getByText("That is every trade since launch.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Load 50 older trades" })).toHaveCount(0);
    await expect(table.getByText("Launch", { exact: true })).toHaveCount(2);
    await expect(table).toContainText(
      `Launch transaction: ${Number(coin.solIn) / 1e9} SOL dev buy, then insta burn.`,
    );
    await expect(table.getByText("burned", { exact: true })).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(61); // 60 trades and the launch caption row
  });

  test("the older-trades route checks the mint and the cursor", async ({ request }) => {
    expect((await request.get("/api/coin/not-a-mint/trades")).status()).toBe(404);
    expect((await request.get(`/api/coin/${coin.mint}/trades?before=garbage`)).status()).toBe(400);
    const res = await request.get(`/api/coin/${coin.mint}/trades`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = (await res.json()) as { trades: { signature: string }[]; more: boolean };
    expect(body.trades).toHaveLength(50);
    expect(body.more).toBe(true);
  });

  test("the Trader column is hidden at 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/coin/${coin.mint}`);
    await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Trader" })).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "Tx" })).toBeVisible();
  });
});

const stat = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`);
const bondPanel = (page: Page) => page.getByRole("region", { name: "Bond and burn" });

test.describe("stats and bond", () => {
  const coins: Seeded[] = [];
  const seed = async (coin: Record<string, string | number | Date | null>) => {
    const c = await seedCoin(db(), { trades: 3, coin });
    coins.push(c);
    return c;
  };
  test.afterAll(async () => {
    for (const c of coins) await dropCoin(db(), c.mint);
  });

  test("a curve coin shows its four stats, the On curve tag and curve progress only", async ({ page }) => {
    const c = await seed({
      mcap_sol: 61.4,
      progress: 0.642,
      real_quote_reserves: "2940180000000",
      bondr_at_bond: "4580000000000",
      bond_sol: 84.3,
    });
    await page.goto(`/coin/${c.mint}`);
    await expect(page.getByText("On curve", { exact: true })).toBeVisible();
    await expect(stat(page, "Mcap")).toHaveText("61.40 SOL");
    await expect(stat(page, "1h")).toHaveText(/^[+−]\d+\.\d%$/);
    await expect(stat(page, "1h volume")).toHaveText(/^[\d,.]+ SOL$/);
    await expect(stat(page, "Holders")).toHaveText("–not counted yet");
    const panel = bondPanel(page);
    await expect(panel).toContainText("Read from the pump curve on-chain.");
    await expect(panel).toContainText("Curve filled");
    await expect(panel).toContainText("64.2%");
    await expect(panel.getByRole("img", { name: "Curve 64.2 percent filled" })).toBeVisible();
    await expect(panel).toContainText("2,940,180 of 4,580,000 BONDR in the curve. Bonds at about 84.30 SOL.");
    await expect(panel).not.toContainText(/budget|window|ledger/i); // D-10
  });

  test("a bonded coin shows Bonded, PumpSwap, 100% and the bond tx", async ({ page }) => {
    const sig = fakeSig();
    const c = await seed({
      venue: "pool",
      progress: 1,
      holders: 1284,
      bond_sig: sig,
      bonded_at: new Date(Date.now() - 2 * 3_600_000),
    });
    await page.goto(`/coin/${c.mint}`);
    await expect(page.getByText("Bonded, PumpSwap", { exact: true })).toBeVisible();
    await expect(stat(page, "Holders")).toHaveText("1,284");
    const panel = bondPanel(page);
    await expect(panel).toContainText("100%");
    await expect(panel.getByText("Bonded", { exact: true })).toBeVisible();
    await expect(panel.getByRole("img", { name: "Bonded" })).toBeVisible();
    await expect(panel).toContainText(
      new RegExp(`Bonded 2h \\d+m ago\\. ${c.symbol} now trades on PumpSwap\\.`),
    );
    await expect(panel.getByRole("link", { name: new RegExp(`^Bond tx ${short(sig)}`) })).toHaveAttribute(
      "href",
      new RegExp(`/tx/${sig}\\?cluster=devnet$`),
    );
    await expect(panel).not.toContainText(/budget|window|ledger/i);
  });

  test("a complete curve waits for PumpSwap", async ({ page }) => {
    const c = await seed({ venue: "complete", progress: 1, bonded_at: new Date() });
    await page.goto(`/coin/${c.mint}`);
    await expect(page.getByText("Curve complete", { exact: true })).toBeVisible();
    const panel = bondPanel(page);
    await expect(panel).toContainText("100%");
    await expect(panel).toContainText(
      `The curve is complete. ${c.symbol} moves to PumpSwap automatically, usually within a minute.`,
    );
    await expect(panel.getByRole("link")).toHaveCount(0);
  });
});

test("the image optimizer refuses IPFS URLs instead of proxying them (web WR-07)", async ({ request }) => {
  const res = await request.get(
    `/_next/image?url=${encodeURIComponent("https://ipfs.io/ipfs/bafkrei")}&w=64&q=75`,
  );
  expect(res.status()).toBe(400);
});
