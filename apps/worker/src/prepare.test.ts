import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blockedDeployers, close, db, vanityMints, wallets } from "@bondr/core/db";
import { Keypair } from "@solana/web3.js";
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, describe, expect, test, vi } from "vitest";
import { ensureTable, previewCosts, simError } from "./build.ts";
import {
  advance,
  type Exec,
  getLaunch,
  insertPrepared,
  newTablesLastHour,
  newTablesToday,
  tableFor,
} from "./launches.ts";
import {
  type GuardInput,
  type PrepareCtx,
  parseRequest,
  prepare,
  prepareGuard,
  sellFloor,
  signBy,
  TABLE_CAP,
  WALLET_TABLE_CAP,
} from "./prepare.ts";

// An open, priced launch, so only the blocked check can refuse before prepareGuard.
vi.mock("./status.ts", async (orig) => ({
  ...((await orig()) as object),
  liveStatus: async () => ({ paused: null, minLamports: "2500000", createCostEstimate: "0" }),
}));

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const MIN = 2_500_000n;
const body = {
  wallet: Keypair.generate().publicKey.toBase58(),
  name: "Bondr Test",
  symbol: "bndt",
  description: "",
  links: { x: "x.com/bondr" },
  uri: `https://ipfs.io/ipfs/${"b".repeat(59)}`,
  imageCid: "b".repeat(59),
  solIn: String(MIN),
  exit: "burn",
};
const ok: GuardInput = {
  paused: null,
  min: MIN,
  consented: true,
  body,
  tablesLastHour: 0,
  walletTablesToday: 0,
  reusable: false,
};
const guard = (over: Partial<GuardInput>, b: Record<string, unknown> = {}) =>
  prepareGuard({ ...ok, ...over, body: { ...body, ...b } });

test("prepareGuard refuses paused, unconsented, invalid fields, below-minimum buys and both table caps", () => {
  expect(guard({ paused: "kill_switch" })).toEqual({ error: "paused", paused: "kill_switch" });
  expect(guard({ consented: false })).toEqual({ error: "consent_required" });
  expect(guard({}, { name: "N".repeat(33) })).toEqual({ error: "invalid_input" });
  expect(guard({}, { uri: "https://evil.example/ipfs/abc" })).toEqual({ error: "invalid_input" });
  expect(guard({}, { exit: "lock" })).toEqual({ error: "invalid_input" });
  expect(guard({}, { solIn: String(MIN - 1n) })).toEqual({ error: "invalid_input" });
  expect(guard({}, { wallet: "not-a-wallet" })).toEqual({ error: "invalid_input" });
  expect(guard({ min: null })).toEqual({ error: "build_failed" });
  expect(guard({ tablesLastHour: TABLE_CAP })).toEqual({ error: "rate_limited" });
  expect(guard({ tablesLastHour: TABLE_CAP, reusable: true })).toBe(null);
  expect(guard({ walletTablesToday: WALLET_TABLE_CAP })).toEqual({ error: "rate_limited" });
  expect(guard({ walletTablesToday: WALLET_TABLE_CAP, reusable: true })).toBe(null);
  expect(guard({})).toBe(null);
});

test("parseRequest normalizes the fields the worker stores", () => {
  const r = parseRequest(body, MIN);
  expect(r?.symbol).toBe("BNDT");
  expect(r?.links).toEqual({ x: "https://x.com/bondr" });
  expect(r?.solIn).toBe(MIN);
  expect(r && "description" in r).toBe(false);
});

test("signBy is 0.4 s per block left, capped at 60 and never negative", () => {
  const h = 1_000_000;
  expect(signBy(h + 300, h)).toBe(60);
  expect(signBy(h + 50, h)).toBe(20);
  expect(signBy(h - 5, h)).toBe(0);
});

test("sellFloor takes 300 bps off and never returns 0", () => {
  expect(sellFloor(2_000_000n)).toBe(1_940_000n);
  expect(sellFloor(1n)).toBe(1n);
  expect(sellFloor(0n)).toBe(1n);
});

test("simError maps 6107 to paused, low funds to insufficient_balance, the rest to build_failed", () => {
  const custom = (n: number) => ({ InstructionError: [3, { Custom: n }] });
  const pump = (n: number) => [
    `Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P failed: custom program error: 0x${n.toString(16)}`,
  ];
  expect(simError(custom(6107), pump(6107))).toEqual({ error: "paused", paused: "awaiting_migration" });
  // Trade codes stay build_failed for a launch (S-WR-01): its UI has no slippage copy.
  for (const n of [6002, 6004, 6005]) expect(simError(custom(n), pump(n))).toEqual({ error: "build_failed" });
  expect(simError(custom(1), [])).toEqual({ error: "insufficient_balance" });
  expect(simError(custom(0), ["Transfer: insufficient lamports 5, need 9"])).toEqual({
    error: "insufficient_balance",
  });
  expect(simError("AccountNotFound", null)).toEqual({ error: "insufficient_balance" });
  expect(simError(custom(6003), ["slippage"])).toEqual({ error: "build_failed" });
});

test("ensureTable refuses a new table when ops is under the floor, before sending anything", async () => {
  const conn = { getBalance: async () => 0.049 * 1e9 } as unknown as Parameters<typeof ensureTable>[0];
  const ops = Keypair.generate();
  await expect(ensureTable(conn, ops, [], null, "devnet")).rejects.toMatchObject({
    body: { error: "build_failed" },
  });
});

test("previewCosts: rent from the burn spend, solBack from burn minus sell", () => {
  expect(previewCosts(100n, 10n, 1000n)).toEqual({ createCost: 890n, solBack: null });
  expect(previewCosts(100n, 10n, 1000n, 920n)).toEqual({ createCost: 890n, solBack: 80n });
  expect(previewCosts(100n, 10n, 50n, 60n)).toEqual({ createCost: 0n, solBack: 0n });
});

type Tx = Exec;
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  try {
    await db().transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }
}

describe.skipIf(!process.env.DATABASE_URL)("launch rows", { timeout: 30_000 }, () => {
  afterAll(() => close(), 30_000);

  test("advance is guarded by the from state; tableFor follows the live reservation", async () => {
    await rolledBack(async (tx) => {
      const wallet = `test-w-${randomBytes(4).toString("hex")}`;
      const mint = `test-${randomBytes(8).toString("hex")}`;
      await tx.insert(wallets).values({ address: wallet, consentedAt: new Date(), termsVersion: "test" });
      const reservedUntil = sql`now() + interval '10 minutes'`;
      await tx
        .insert(vanityMints)
        .values({ idx: -(2n ** 62n) + 1000n, pubkey: mint, reservedBy: wallet, reservedUntil });
      const before = await newTablesLastHour(tx);
      const row = { wallet, mint, w: wallet, name: "T", symbol: "T", uri: "u", solIn: 1n, exit: "burn" };
      await insertPrepared(tx, "test-launch", { ...row, lookupTable: "TABLE1", newTable: true });
      expect(await newTablesLastHour(tx)).toBe(before + 1);
      expect(await newTablesToday(tx, wallet)).toBe(1);
      expect(await newTablesToday(tx, "test-other-wallet")).toBe(0);
      expect(await tableFor(tx, wallet)).toEqual({ mint, table: "TABLE1" });

      expect((await advance(tx, "test-launch", "prepared", "signed"))?.state).toBe("signed");
      expect(await advance(tx, "test-launch", "prepared", "signed")).toBe(null);
      expect((await getLaunch(tx, "test-launch"))?.state).toBe("signed");

      const expired = { reservedUntil: sql`now() - interval '1 minute'` };
      await tx.update(vanityMints).set(expired).where(eq(vanityMints.pubkey, mint));
      expect(await tableFor(tx, wallet)).toBe(null);
      expect(await tableFor(tx, wallet, mint)).toEqual({ mint, table: "TABLE1" });
      expect(await tableFor(tx, "test-other-wallet", mint)).toBe(null);
    });
  });

  // prepare's own db() reads the row, so it is committed and always deleted.
  test("a blocked wallet is refused with 403 blocked before the guard and any chain call", async () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const chain = new Proxy({}, { get: () => () => Promise.reject(new Error("chain call")) });
    const ctx = { conn: chain, online: {}, Q: Keypair.generate().publicKey, priorityFee: 0 };
    await db().insert(blockedDeployers).values({ wallet, reason: "test block" });
    try {
      const run = prepare(ctx as unknown as PrepareCtx, { ...body, wallet });
      await expect(run).rejects.toMatchObject({ status: 403, body: { error: "blocked" } });
    } finally {
      await db().delete(blockedDeployers).where(eq(blockedDeployers.wallet, wallet));
    }
  });
});
