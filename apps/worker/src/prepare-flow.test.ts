// The order of prepare's steps, with the DB, the pool and the chain stubbed: what runs before a mint is
// reserved and before ops pays for a table.
import { Keypair } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { type PrepareCtx, prepare } from "./prepare.ts";

const m = vi.hoisted(() => ({ reserve: vi.fn() }));
vi.mock("@bondr/core/db", async (orig) => ({ ...(await orig()), db: () => ({}) }));
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
}));
vi.mock("./vanity.ts", async (orig) => ({ ...(await orig()), reserve: m.reserve }));

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
  const conn = { getBalance: async () => balance };
  const online = { fetchGlobal: async () => ({ creatorFeeConfigurable: false }) };
  const env = { seed: Buffer.alloc(32, 1), net: "devnet", lane: "local" };
  return { conn, online, Q: Keypair.generate().publicKey, priorityFee: 0, env } as unknown as PrepareCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.reserve.mockResolvedValue(null);
});

test("a wallet that cannot pay is refused before any mint is reserved (WR-01)", async () => {
  await expect(prepare(ctxWith(0), body)).rejects.toMatchObject({ body: { error: "insufficient_balance" } });
  expect(m.reserve).not.toHaveBeenCalled();
});
