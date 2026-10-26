// Moderation (ADMIN-07): hide, unhide, block and unblock, each one landed audit row (D-34). The unit cases use the
// memory stores; the DB case runs pgMod and pgAudit on the Neon dev branch inside a transaction that is always
// rolled back (the audit trigger refuses DELETE), and skips without DATABASE_URL.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blockedDeployers, close, coins, db, launches, vanityMints, wallets } from "@bondr/core/db";
import { Keypair } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { memoryAudit, pgAudit } from "./admin-audit.ts";
import { blocked, type ModInput, memoryMod, moderate, modReq, pgMod } from "./admin-moderate.ts";
import { Fail } from "./http.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const actor = Keypair.generate().publicKey.toBase58();
const key = () => Keypair.generate().publicKey.toBase58();
const [A, B, C] = [key(), key(), key()];

function setup() {
  const store = memoryMod([
    { mint: A, symbol: "FOO", hiddenAt: null },
    { mint: B, symbol: "DUP", hiddenAt: null },
    { mint: C, symbol: "DUP", hiddenAt: null },
  ]);
  const audit = memoryAudit();
  const run = (i: Omit<ModInput, "actor">) => moderate(store, audit, { actor, ...i });
  return { store, audit, run };
}

test("hide by symbol (any case) or exact mint hides one coin and writes one landed row", async () => {
  const { store, audit, run } = setup();
  expect(await run({ op: "hide", query: "foo", reason: "spam" })).toEqual({ ok: true });
  expect(store.coins[0]).toMatchObject({ hiddenReason: "spam" });
  expect(store.coins[0]?.hiddenAt).toBeInstanceOf(Date);
  expect(await run({ op: "hide", mint: B, reason: "scam" })).toEqual({ ok: true });
  expect(store.coins.map((c) => c.hiddenReason)).toEqual(["spam", "scam", null]);
  expect(audit.rows.map((r) => [r.actor, r.action, r.mint, r.result, r.params])).toEqual([
    [actor, "hide", A, "landed", { mint: A, reason: "spam" }],
    [actor, "hide", B, "landed", { mint: B, reason: "scam" }],
  ]);
});

test("ambiguous, unknown, already hidden and reasonless hides each refuse and change nothing", async () => {
  const { store, audit, run } = setup();
  expect(await run({ op: "hide", query: "dup", reason: "x" })).toEqual({
    ok: false,
    reason: "ambiguous",
    count: 2,
  });
  expect(await run({ op: "hide", query: "NOPE", reason: "x" })).toEqual({ ok: false, reason: "no_match" });
  expect(await run({ op: "hide", query: "FOO", reason: "  " })).toEqual({ ok: false, reason: "no_reason" });
  expect(await run({ op: "hide", query: "FOO" })).toEqual({ ok: false, reason: "no_reason" });
  expect(await run({ op: "hide", query: "FOO", reason: "x".repeat(121) })).toEqual({
    ok: false,
    reason: "no_reason",
  });
  expect(store.coins.every((c) => c.hiddenAt === null)).toBe(true);
  expect(audit.rows).toHaveLength(0);
  await run({ op: "hide", query: "FOO", reason: "spam" });
  expect(await run({ op: "hide", query: "FOO", reason: "again" })).toEqual({
    ok: false,
    reason: "already_hidden",
  });
  expect(store.coins[0]?.hiddenReason).toBe("spam");
  expect(audit.rows).toHaveLength(1);
});

test("unhide clears a hidden coin and audits unhide; a visible coin is no_match", async () => {
  const { store, audit, run } = setup();
  expect(await run({ op: "unhide", query: "FOO" })).toEqual({ ok: false, reason: "no_match" });
  await run({ op: "hide", query: "FOO", reason: "spam" });
  expect(await run({ op: "unhide", mint: A })).toEqual({ ok: true });
  expect(store.coins[0]).toMatchObject({ hiddenAt: null, hiddenReason: null });
  expect(audit.rows.map((r) => [r.action, r.mint, r.params])).toEqual([
    ["hide", A, { mint: A, reason: "spam" }],
    ["unhide", A, { mint: A }],
  ]);
});

test("block refuses a bad wallet, a missing reason and a second block; unblock removes and audits", async () => {
  const { store, audit, run } = setup();
  const w = key();
  expect(await run({ op: "block", wallet: "not a wallet", reason: "x" })).toEqual({
    ok: false,
    reason: "invalid_wallet",
  });
  expect(await run({ op: "block", wallet: w })).toEqual({ ok: false, reason: "no_reason" });
  expect(await run({ op: "unblock", wallet: w })).toEqual({ ok: false, reason: "no_match" });
  expect(audit.rows).toHaveLength(0);
  expect(await run({ op: "block", wallet: w, reason: "spam launches" })).toEqual({ ok: true });
  expect(await store.isBlocked(w)).toBe(true);
  expect(await run({ op: "block", wallet: w, reason: "again" })).toEqual({
    ok: false,
    reason: "already_blocked",
  });
  expect(await run({ op: "unblock", wallet: w })).toEqual({ ok: true });
  expect(await store.isBlocked(w)).toBe(false);
  expect(audit.rows.map((r) => [r.action, r.mint, r.params])).toEqual([
    ["block", null, { wallet: w, reason: "spam launches" }],
    ["unblock", null, { wallet: w }],
  ]);
});

test("modReq refuses a bad op or a non-string or over-length field with 400", () => {
  const bad = [
    { op: "delete" },
    { op: "__proto__" },
    { op: "hide", query: 7 },
    { op: "hide", query: "x".repeat(201) },
    { op: "block", wallet: A, reason: "x".repeat(201) },
  ];
  for (const b of bad) {
    try {
      modReq({ actor, ...b });
      throw new Error("accepted");
    } catch (e) {
      expect(e).toBeInstanceOf(Fail);
      expect((e as Fail).status).toBe(400);
    }
  }
  expect(modReq({ actor, op: "hide", query: "FOO", reason: "r", mint: null })).toEqual({
    ...{ actor, op: "hide", query: "FOO", reason: "r" },
  });
});

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

async function seedCoin(tx: Tx, symbol: string): Promise<string> {
  const mint = `test-${randomBytes(8).toString("hex")}`;
  const id = randomBytes(16).toString("hex");
  await tx.insert(wallets).values({ address: mint, consentedAt: new Date(), termsVersion: "test" });
  await tx.insert(vanityMints).values({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey: mint });
  await tx.insert(launches).values({
    ...{ id, wallet: mint, mint, w: mint, state: "failed", name: "Test", symbol },
    ...{ uri: "ipfs://test", solIn: 1n, exit: "burn" },
  });
  await tx.insert(coins).values({
    ...{ mint, launchId: id, launchedAt: new Date(), bondingCurve: "curve", pool: "pool" },
    ...{ initialRealTokenReserves: "1", realTokenReserves: "1", realQuoteReserves: "0" },
    ...{ virtualTokenReserves: "1", virtualQuoteReserves: "1", mcapSol: 1, launchMcapSol: 1 },
  });
  return mint;
}

describe.skipIf(!process.env.DATABASE_URL)("moderation on the database", { timeout: 30_000 }, () => {
  afterAll(() => close());

  test("pgMod hides and unhides by symbol, blocks once and unblocks, with pgAudit rows", async () => {
    await rolledBack(async (tx) => {
      const symbol = `T${randomBytes(4).toString("hex")}`;
      const mint = await seedCoin(tx, symbol.toUpperCase());
      const [store, audit] = [pgMod(tx), pgAudit(tx)];
      const run = (i: Omit<ModInput, "actor">) => moderate(store, audit, { actor, ...i });
      const hidden = async () => (await tx.select().from(coins).where(eq(coins.mint, mint)))[0];
      expect(await run({ op: "hide", query: symbol.toLowerCase(), reason: "spam" })).toEqual({ ok: true });
      expect((await hidden())?.hiddenReason).toBe("spam");
      expect(await run({ op: "hide", mint, reason: "x" })).toEqual({ ok: false, reason: "already_hidden" });
      expect(await run({ op: "unhide", mint })).toEqual({ ok: true });
      expect(await hidden()).toMatchObject({ hiddenAt: null, hiddenReason: null });
      const w = key();
      expect(await run({ op: "block", wallet: w, reason: "spam" })).toEqual({ ok: true });
      expect(await blocked(tx, w)).toBe(true);
      expect(await store.block(w, "again")).toBe(false);
      expect(await run({ op: "unblock", wallet: w })).toEqual({ ok: true });
      expect(await blocked(tx, w)).toBe(false);
      expect(await tx.$count(blockedDeployers, eq(blockedDeployers.wallet, w))).toBe(0);
    });
  });
});
