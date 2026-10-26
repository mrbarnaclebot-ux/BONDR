// genesisOne's refusal order and the row it builds, with every DB, pool and chain step injected (D-28, D-29):
// owner only, once, burn only. genesisQuote over a stubbed Global.
import type { PrepareResult } from "@bondr/core/api";
import { BN, type FeeConfig, type Global } from "@bondr/core/pump";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import { type GenesisCtx, type GenesisDeps, genesisOne, genesisQuote } from "./genesis.ts";
import { rowOf } from "./prepare.ts";
import type { Req } from "./prepare-rules.ts";

vi.mock("./status.ts", async (orig) => ({
  ...(await orig()),
  liveStatus: async () => ({ paused: "genesis", minLamports: "2500000", createCostEstimate: "0" }),
}));

const ADMIN = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const TREASURY = Keypair.generate().publicKey;
const MINT = PublicKey.unique();
const TABLE = PublicKey.unique();
const RESULT = { launchId: "x" } as unknown as PrepareResult;

const body = (over: Record<string, unknown> = {}) => ({
  ...{ wallet: ADMIN, actor: ADMIN, name: "BONDR", symbol: "BONDR", links: {} },
  ...{ uri: `https://ipfs.io/ipfs/${"b".repeat(59)}`, imageCid: "b".repeat(59), solIn: "2500000" },
  exit: "burn",
  ...over,
});

function ctx(adminWallet: string | null = ADMIN, online: unknown = {}): GenesisCtx {
  const conn = { getBalance: async () => 1e10 };
  const env = {
    seed: Buffer.alloc(32, 1),
    net: "mainnet",
    lane: "production",
    adminWallet,
    treasury: TREASURY,
  };
  const base = { conn, online, Q: null, treasury: TREASURY, priorityFee: 0, net: "mainnet", env };
  return base as unknown as GenesisCtx;
}

function deps(over: Partial<GenesisDeps> = {}) {
  return {
    consented: vi.fn(async () => true),
    genesisLanded: vi.fn(async () => false),
    reserve: vi.fn(async () => ({ idx: 1n, pubkey: MINT.toBase58() })),
    build: vi.fn(async () => ({ ixs: [], amount: new BN(5) })),
    table: vi.fn(async () => ({ table: { key: TABLE }, address: TABLE.toBase58(), created: true })),
    finish: vi.fn(async () => RESULT),
    ...over,
  } as GenesisDeps & Record<keyof GenesisDeps, ReturnType<typeof vi.fn>>;
}

const refused = (error: string) => ({ body: { error } });

test("a prepare without an admin actor is a child prepare: not_ready, before any read", async () => {
  const d = deps();
  await expect(genesisOne(ctx(), body({ actor: undefined }), d)).rejects.toMatchObject(refused("not_ready"));
  expect(d.consented).not.toHaveBeenCalled();
});

test("an actor or wallet other than ADMIN_WALLET is forbidden, and so is a worker without ADMIN_WALLET", async () => {
  for (const [c, b] of [
    [ctx(), body({ actor: OTHER, wallet: OTHER })],
    [ctx(), body({ wallet: OTHER })],
    [ctx(null), body()],
  ] as const) {
    await expect(genesisOne(c, b, deps())).rejects.toMatchObject(refused("forbidden"));
  }
});

test("the owner wallet without consent records is refused before any build", async () => {
  const d = deps({ consented: vi.fn(async () => false) });
  await expect(genesisOne(ctx(), body(), d)).rejects.toMatchObject(refused("consent_required"));
  expect(d.reserve).not.toHaveBeenCalled();
});

test("the genesis ticker is pinned to BONDR: any other symbol is invalid_input before a mint is reserved", async () => {
  const d = deps();
  await expect(genesisOne(ctx(), body({ symbol: "BONDE" }), d)).rejects.toMatchObject(
    refused("invalid_input"),
  );
  expect(d.reserve).not.toHaveBeenCalled();
});

test("genesis is burn only: a sell exit is invalid_input", async () => {
  await expect(genesisOne(ctx(), body({ exit: "sell" }), deps())).rejects.toMatchObject(
    refused("invalid_input"),
  );
});

test("a second genesis after one landed answers genesis_landed and reserves no mint", async () => {
  const d = deps({ genesisLanded: vi.fn(async () => true) });
  await expect(genesisOne(ctx(), body(), d)).rejects.toMatchObject(refused("genesis_landed"));
  expect(d.reserve).not.toHaveBeenCalled();
});

test("the owner's genesis builds with the treasury as creator and stores w = the treasury, exit burn", async () => {
  const d = deps();
  await expect(genesisOne(ctx(), body(), d)).resolves.toBe(RESULT);
  expect(d.reserve).toHaveBeenCalledWith(expect.anything(), ADMIN);
  const opts = d.build.mock.calls[0]?.[0];
  expect(opts.treasury.equals(TREASURY)).toBe(true);
  expect(opts.dev.toBase58()).toBe(ADMIN);
  expect(opts.mint.equals(MINT)).toBe(true);
  const [, req, sized, created] = d.finish.mock.calls[0] ?? [];
  expect(created).toBe(true);
  const row = rowOf(req as Req, sized.o, TABLE.toBase58(), true);
  expect(row).toMatchObject({ w: TREASURY.toBase58(), exit: "burn", wallet: ADMIN, symbol: "BONDR" });
});

const bps = (lp: number, protocol: number, creator: number) => ({
  lpFeeBps: new BN(lp),
  protocolFeeBps: new BN(protocol),
  creatorFeeBps: new BN(creator),
});
const feeConfig = {
  flatFees: bps(0, 95, 30),
  exoticFlatFees: bps(0, 0, 0),
  feeTiers: [{ marketCapLamportsThreshold: new BN(0), fees: bps(0, 95, 30) }],
} as unknown as FeeConfig;
const global = {
  initialVirtualQuoteReserves: new BN(30_000_000_000),
  initialVirtualSolReserves: new BN(30_000_000_000),
  initialVirtualTokenReserves: new BN(1_073_000_000_000_000),
  initialRealTokenReserves: new BN(793_100_000_000_000),
  tokenTotalSupply: new BN(1_000_000_000_000_000),
  whitelistedQuoteMints: [],
} as unknown as Global;

test("the genesis quote prices a fresh SOL curve and gives nothing back (burn only)", async () => {
  const online = { fetchGlobal: async () => global, fetchFeeConfig: async () => feeConfig };
  const q = await genesisQuote(ctx(ADMIN, online), { solIn: "1000000000" });
  expect(BigInt(q.tokensOut)).toBeGreaterThan(0n);
  expect(q.solBackEstimate).toBe("0");
});
