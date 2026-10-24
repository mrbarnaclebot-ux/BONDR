// TOKEN-06 share cards: a landed coin's page points og:image at its 1200x630 card, served immutable; an
// unknown mint gets the site card with a short cache. The coin is a throwaway landed row on a fake mint, or on
// staging (E2E_BASE_URL, nothing seeded) the first card on its home page, whose card must point at SITE_URL.
import { randomBytes, randomInt } from "node:crypto";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { rootEnv } from "./phantom.ts";

const STAGING = process.env.E2E_BASE_URL;
const url = STAGING ? undefined : rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll (see coin.e2e.ts).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeMint = () => Array.from({ length: 44 }, () => B58[randomInt(58)]).join("");
const fixtures: string[] = [];
type Card = { mint: string; name: string; symbol: string };

test.describe.configure({ timeout: 90_000 }); // a Neon cold start plus a first card compile in dev
test.skip(!STAGING && !sql, "needs DATABASE_URL in the root .env");
test.afterAll(async () => {
  if (sql && fixtures.length) {
    await sql`delete from launches where mint in ${sql(fixtures)}`;
    await sql`delete from vanity_mints where pubkey in ${sql(fixtures)}`;
  }
});

/** A landed insta-burn launch on a fresh fake mint with no image (the letter fallback), removed in afterAll. */
async function landed(): Promise<string> {
  const mint = fakeMint();
  fixtures.push(mint);
  // Not a seeded "E2E" coin's wallet: dropCoin deletes that wallet, and this row would block it.
  const [{ wallet }] = await db()<{ wallet: string }[]>`select wallet from launches
    where name not like 'E2E %' limit 1`;
  const idx = -(2n ** 61n) - BigInt(randomInt(1_000_000));
  await db()`insert into vanity_mints (idx, pubkey, used_at) values (${idx.toString()}, ${mint}, now())`;
  await db()`insert into launches (id, wallet, mint, w, state, name, symbol, links, uri, sol_in, exit, signature)
    values (${randomBytes(16).toString("hex")}, ${wallet}, ${mint}, 'e2e', 'landed', 'BONDR e2e card', 'BCARD',
      ${db().json({})}, 'https://ipfs.io/ipfs/x', 2500000, 'burn', ${randomBytes(48).toString("hex")})`;
  return mint;
}

const path = (href: string | null) => {
  const u = new URL(href as string);
  return u.pathname + u.search;
};
const meta = (page: Page, key: string) =>
  page
    .locator(`meta[property="${key}"], meta[name="${key}"]`)
    .first()
    .getAttribute("content", { timeout: 5_000 }); // server HTML: present at load or never

/** GETs a card and checks it is a 1200x630 PNG (IHDR width and height at bytes 16 and 20). */
async function png(request: APIRequestContext, href: string) {
  const res = await request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const body = await res.body();
  expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]);
  return res.headers()["cache-control"] ?? "";
}

test("a landed coin's page carries its card, served as an immutable 1200x630 PNG", async ({
  page,
  request,
}) => {
  const { mint, name, symbol } = STAGING
    ? ((await (await request.get("/api/coins?sort=top")).json()) as { coins: Card[] }).coins[0]
    : { mint: await landed(), name: "BONDR e2e card", symbol: "BCARD" };
  expect((await page.goto(`/coin/${mint}`))?.status()).toBe(200);
  const image = await meta(page, "og:image");
  const origin = STAGING ? STAGING.replace(/\/$/, "") : "https?://[^/]+";
  expect(image).toMatch(new RegExp(`^${origin}/coin/${mint}/opengraph-image/card(\\?.*)?$`));
  expect(await meta(page, "twitter:image")).toBe(image);
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
  expect(await meta(page, "og:image:alt")).toBe(`${name} (${symbol}) on BONDR. Dev holds 0 launch supply.`);
  const cache = await png(request, path(image));
  expect(cache).toContain("immutable");
});

test("an unknown mint's card is the site card with a 5 minute cache", async ({ request }) => {
  const cache = await png(request, `/coin/${fakeMint()}/opengraph-image/card`);
  expect(cache).toContain("max-age=300");
  expect(cache).not.toContain("immutable");
});

test("a non-token page carries the site card", async ({ page, request }) => {
  await page.goto("/terms");
  const image = await meta(page, "og:image");
  expect(image).toMatch(/^https?:\/\/[^/]+\/opengraph-image/);
  await png(request, path(image));
});
