// The trade routes' guards against the real local web and worker, no stubs (T2, T6, CSRF). Nothing is signed or
// sent: the only worker build is for a 0 SOL session wallet, which stops at the balance.
import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { newTestAccount, rootEnv, signIn, simDevAccount } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const db = () => sql as postgres.Sql;
const used: string[] = [];
const ID = "a".repeat(32);
const origin = () => new URL(test.info().project.use.baseURL as string).origin;
const evil = { origin: "https://evil.example" };

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");
test.afterAll(async () => {
  if (sql && used.length) await sql`delete from wallets where address in ${sql(used)}`;
});

test("cross-origin is refused", async ({ request }) => {
  for (const path of ["quote", "prepare", "submit"])
    expect((await request.post(`/api/trade/${path}`, { headers: evil, data: {} })).status()).toBe(403);
  expect((await request.get(`/api/trade/${ID}`, { headers: evil })).status()).toBe(403);
});

test("no session is consent_required", async ({ request }) => {
  const headers = { origin: origin() };
  const replies = [
    await request.post("/api/trade/prepare", { headers, data: { side: "buy" } }),
    await request.post("/api/trade/submit", { headers, data: { tradeId: ID, signed: "x" } }),
    await request.get(`/api/trade/${ID}`, { headers }),
  ];
  for (const r of replies) {
    expect(r.status()).toBe(403);
    expect(await r.json()).toEqual({ error: "consent_required" });
  }
});

test("body wallet is ignored", async ({ request }) => {
  const [c] = await db()<{ mint: string }[]>`select c.mint from coins c join launches l on l.mint = c.mint
    where l.state = 'landed' and c.venue = 'curve' and l.name not like 'E2E %'
    order by l.created_at desc limit 1`;
  test.skip(!c, "no indexed curve coin on the dev branch");
  const account = newTestAccount(); // 0 SOL on devnet
  used.push(account.address);
  expect((await signIn(request, account)).status()).toBe(204);
  const data = {
    side: "buy",
    mint: c.mint,
    amount: "10000000",
    slippageBps: 100,
    wallet: simDevAccount().address,
  };
  const res = await request.post("/api/trade/prepare", { headers: { origin: origin() }, data });
  // The funded wallet in the body would have built a tx; the session's empty one cannot pay.
  expect(res.status()).toBe(402);
  expect(await res.json()).toEqual({ error: "insufficient_balance" });
});

test("rate limit", async ({ request }) => {
  const headers = { origin: origin(), "x-real-ip": `10.9.${randomInt(256)}.${randomInt(256)}` };
  const data = { tradeId: ID, signed: "x" };
  for (let i = 0; i < 30; i++) {
    const r = await request.post("/api/trade/submit", { headers, data });
    expect(await r.json()).toEqual({ error: "consent_required" });
  }
  const over = await request.post("/api/trade/submit", { headers, data });
  expect(over.status()).toBe(429);
  expect(await over.json()).toEqual({ error: "rate_limited" });
});
