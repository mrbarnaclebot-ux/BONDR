// The pin route's refusals. None of these cases reaches Pinata; the live pin is a manual check (02-10).
import { randomInt } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import postgres from "postgres";
import { newTestAccount, rootEnv } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
// fullyParallel runs these hooks once per worker group, so each group opens its own client and consents
// its own address; a shared one would be deleted under a test still running in another worker.
let sql: postgres.Sql | undefined;
let consented = "";

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!url, "needs DATABASE_URL in the root .env");
test.beforeAll(async () => {
  sql = postgres(url as string, { max: 1, onnotice: () => {} });
  consented = newTestAccount().address;
  await sql`insert into wallets (address, consented_at, terms_version) values (${consented}, now(), 'e2e')`;
});
test.afterAll(async () => {
  if (sql) await sql`delete from wallets where address = ${consented}`;
  await sql?.end({ timeout: 5 });
});

// Each test gets its own client IP, so the per-IP limit never carries over between tests or runs.
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;

function pin(
  request: APIRequestContext,
  o: { wallet: string; symbol?: string; image?: Buffer; ip: string; origin?: string },
) {
  const meta = { wallet: o.wallet, name: "Pin test", symbol: o.symbol ?? "PIN", description: "", links: {} };
  return request.post("/api/launch/pin", {
    headers: { origin: o.origin ?? "http://127.0.0.1:3000", "x-real-ip": o.ip },
    multipart: {
      image: { name: "a.png", mimeType: "image/png", buffer: o.image ?? PNG },
      meta: JSON.stringify(meta),
    },
  });
}

test("a cross-site pin gets 403", async ({ request }) => {
  const res = await pin(request, { wallet: consented, ip: ip(), origin: "https://evil.example" });
  expect(res.status()).toBe(403);
});

test("a wallet with no consent row gets 403 consent_required", async ({ request }) => {
  const res = await pin(request, { wallet: newTestAccount().address, ip: ip() });
  expect(res.status()).toBe(403);
  expect(await res.json()).toEqual({ error: "consent_required" });
});

test("an SVG or an invalid symbol gets 400 invalid_input", async ({ request }) => {
  const svg = await pin(request, { wallet: consented, image: SVG, ip: ip() });
  expect(svg.status()).toBe(400);
  expect(await svg.json()).toEqual({ error: "invalid_input" });
  const symbol = await pin(request, { wallet: consented, symbol: "ab-c", ip: ip() });
  expect(symbol.status()).toBe(400);
});

test("a body over 4 MB plus 64 KB gets 413 before it is read", async ({ request }) => {
  const res = await pin(request, { wallet: consented, image: Buffer.alloc(4.2 * 1024 * 1024), ip: ip() });
  expect(res.status()).toBe(413);
});

test("the sixth pin in ten minutes from one IP gets 429 rate_limited", async ({ request }) => {
  const from = ip();
  const wallet = () => newTestAccount().address; // unconsented: each attempt stops at 403, nothing is pinned
  for (let i = 0; i < 5; i++) expect((await pin(request, { wallet: wallet(), ip: from })).status()).toBe(403);
  const res = await pin(request, { wallet: wallet(), ip: from });
  expect(res.status()).toBe(429);
  expect(Number(res.headers()["retry-after"])).toBeGreaterThan(0);
  expect(await res.json()).toEqual({ error: "rate_limited" });
});
