// The bare token page /coin/[mint]. The found group reads the newest landed devnet launch; the links and
// unlanded cases use a throwaway launch row on a fake mint (used_at set, so the pool never hands it out).
import { randomBytes, randomInt } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeMint = () => Array.from({ length: 44 }, () => B58[randomInt(58)]).join("");
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fixtures: string[] = [];

type Landed = {
  mint: string;
  name: string;
  symbol: string;
  exit: string;
  signature: string;
  wallet: string;
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
  await sql?.end({ timeout: 5 });
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
  await db()`insert into launches (id, wallet, mint, w, state, name, symbol, links, uri, sol_in, exit, signature, facts)
    values (${randomBytes(16).toString("hex")}, ${wallet}, ${mint}, 'e2e', ${state}, 'BONDR e2e links', 'BLINK',
      ${db().json(links)}, 'https://ipfs.io/ipfs/x', 2500000, 'burn',
      ${state === "landed" ? randomBytes(48).toString("hex") : null}, ${db().json({ tokens: "31120363129478" })})`;
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
    await expect(
      page.getByText(
        `Chart, trading and the public fee ledger for ${c.symbol} arrive in a later BONDR update.`,
      ),
    ).toBeVisible();
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
