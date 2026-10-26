// The order of prepare's steps, with the DB, the pool and the chain stubbed: what runs before a mint is
// reserved and before ops pays for a table.
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { type PrepareCtx, prepare } from "./prepare.ts";

const m = vi.hoisted(() => ({
  reserve: vi.fn(),
  createTable: vi.fn(),
  union: vi.fn(),
  insertFailed: vi.fn(),
  markUsed: vi.fn(),
  onChain: vi.fn(),
}));
vi.mock("@bondr/core/db", async (orig) => ({ ...(await orig()), db: () => ({}) }));
vi.mock("@bondr/core/alt", async (orig) => ({ ...(await orig()), createTable: m.createTable }));
vi.mock("./build.ts", async (orig) => ({ ...(await orig()), unionTableKeys: m.union }));
vi.mock("./grind.ts", () => ({ startRefill: async () => undefined }));
vi.mock("./status.ts", async (orig) => ({
  ...(await orig()),
  liveStatus: async () => ({ paused: null, minLamports: "2500000", createCostEstimate: "0" }),
}));
vi.mock("./launches.ts", async (orig) => ({
  ...(await orig()),
  consented: async () => true,
  newTablesLastHour: async () => 0,
  newTablesToday: async () => 0,
  tableFor: async () => null,
  insertFailed: m.insertFailed,
}));
vi.mock("./admin-moderate.ts", async (orig) => ({ ...(await orig()), blocked: async () => false }));
vi.mock("./ticker.ts", async (orig) => ({
  ...(await orig()),
  tickerLock: async () => ({ held: 0, until: null, lastLanded: null }),
}));
vi.mock("./vanity.ts", async (orig) => ({ ...(await orig()), reserve: m.reserve, markUsed: m.markUsed }));

const body = {
  wallet: Keypair.generate().publicKey.toBase58(),
  name: "Bondr Test",
  symbol: "bndt",
  links: {},
  uri: `https://ipfs.io/ipfs/${"b".repeat(59)}`,
  imageCid: "b".repeat(59),
  solIn: "2500000",
  exit: "burn",
};

function ctxWith(balance: number): PrepareCtx {
  const conn = { getBalance: async () => balance, getAccountInfo: m.onChain };
  const online = { fetchGlobal: async () => ({ creatorFeeConfigurable: false }) };
  const env = { seed: Buffer.alloc(32, 1), net: "devnet", lane: "local" };
  return { conn, online, Q: Keypair.generate().publicKey, priorityFee: 0, env } as unknown as PrepareCtx;
}

const TABLE = PublicKey.unique();
const MINT = PublicKey.unique().toBase58();

beforeEach(() => {
  vi.clearAllMocks();
  m.reserve.mockResolvedValue({ idx: 1n, pubkey: MINT });
  m.union.mockResolvedValue({ keys: [PublicKey.unique()], builds: {} });
  m.insertFailed.mockResolvedValue(undefined);
  m.onChain.mockResolvedValue(null);
});

const recorded = () =>
  expect(m.insertFailed).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ mint: MINT, lookupTable: TABLE.toBase58(), newTable: true }),
    "build_failed",
  );

test("a wallet that cannot pay is refused before any mint is reserved (WR-01)", async () => {
  await expect(prepare(ctxWith(0), body)).rejects.toMatchObject({ body: { error: "insufficient_balance" } });
  expect(m.reserve).not.toHaveBeenCalled();
});

test("a paid table that never warmed up is recorded before the refusal (WR-02)", async () => {
  m.createTable.mockResolvedValue({ address: TABLE, ok: false, err: "not warm", bytes: 0, txs: 1 });
  await expect(prepare(ctxWith(1e10), body)).rejects.toMatchObject({ body: { error: "build_failed" } });
  recorded();
});

test("a paid table is recorded when the re-price after it throws (WR-02)", async () => {
  m.createTable.mockResolvedValue({ address: TABLE, table: { key: TABLE }, ok: true, bytes: 0, txs: 1 });
  m.union
    .mockResolvedValueOnce({ keys: [PublicKey.unique()], builds: {} })
    .mockRejectedValueOnce(new Error("429"));
  await expect(prepare(ctxWith(1e10), body)).rejects.toThrow("429");
  recorded();
});

test("a reserved mint that already exists on chain is retired before any table is paid (WR-04)", async () => {
  m.onChain.mockResolvedValue({ lamports: 1 });
  await expect(prepare(ctxWith(1e10), body)).rejects.toMatchObject({ body: { error: "build_failed" } });
  expect(m.markUsed).toHaveBeenCalledWith(expect.anything(), MINT);
  expect(m.createTable).not.toHaveBeenCalled();
});
