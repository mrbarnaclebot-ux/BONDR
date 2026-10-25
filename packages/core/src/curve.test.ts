import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import { costFromReserves, costToComplete } from "./curve.ts";
import { BN, type FeeConfig, type Global } from "./pump.ts";
import { type KnownCoin, parseTx, type TradeTx } from "./trades.ts";

const fixture = (name: string): TradeTx =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")).response;
const coin = (mint: string): ReadonlyMap<string, KnownCoin> =>
  new Map([
    [mint, { mint, bondingCurve: "unused", pool: "unused", initialRealTokenReserves: "793100000000000" }],
  ]);
const patchOf = (name: string, mint: string) => {
  const p = parseTx(fixture(name), coin(mint), { mint: "unused", pool: "unused", sol: 3e-7 }).patches[0];
  if (!p?.realTokenReserves) throw new Error(`${name}: no curve patch`);
  return p as Required<
    Pick<
      typeof p,
      "virtualTokenReserves" | "virtualQuoteReserves" | "realTokenReserves" | "realQuoteReserves"
    >
  >;
};

// Devnet flat rates for an exotic quote (BONDR): protocol 95, creator 30 (RESEARCH, read live in 05-RESEARCH).
const bps = (lp: number, protocol: number, creator: number) => ({
  lpFeeBps: new BN(lp),
  protocolFeeBps: new BN(protocol),
  creatorFeeBps: new BN(creator),
});
const feeConfig = {
  flatFees: bps(0, 95, 30),
  exoticFlatFees: bps(0, 0, 0),
  feeTiers: [],
} as unknown as FeeConfig;
const global = (configurable: boolean) => ({ creatorFeeConfigurable: configurable }) as unknown as Global;

const DEV = "F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr";
const ids = (creatorFeeBps: number) => ({
  creator: new PublicKey("Ccn3FhHqbuXGTHYe5uDxdZqi8oTiDdDgmtTf5TvkyjVF"),
  quoteMint: new PublicKey("4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA"),
  creatorFeeBps,
});

// The RPC path over the same state: a stub online SDK returning the curve the reserves describe.
async function viaRpc(r: ReturnType<typeof patchOf>, g: Global, creatorFeeBps: number): Promise<bigint> {
  const bondingCurve = {
    virtualTokenReserves: new BN(r.virtualTokenReserves),
    virtualQuoteReserves: new BN(r.virtualQuoteReserves),
    realTokenReserves: new BN(r.realTokenReserves),
    realQuoteReserves: new BN(r.realQuoteReserves),
    tokenTotalSupply: new BN("1000000000000000"),
    complete: false,
    isMayhemMode: false,
    isCashbackCoin: false,
    ...ids(0),
    creatorFeeBps: new BN(creatorFeeBps),
  };
  const online = {
    fetchGlobal: async () => g,
    fetchFeeConfig: async () => feeConfig,
    fetchBuyState: async () => ({ bondingCurve, curveBaseTokenBalance: bondingCurve.realTokenReserves }),
  } as unknown as Parameters<typeof costToComplete>[0];
  return BigInt((await costToComplete(online, new PublicKey(DEV))).toString());
}

describe("costFromReserves", () => {
  const r = patchOf("curve-buy", DEV);

  test("equals the RPC costToComplete on the curve-buy patch (devnet, creatorFeeBps 0)", async () => {
    const cost = costFromReserves(r, { global: global(false), feeConfig }, ids(0));
    expect(cost).toBeGreaterThan(0n);
    expect(cost).toBe(await viaRpc(r, global(false), 0));
  });

  test("a configured 150 bps creator rate (fork, mainnet) costs more and still matches", async () => {
    const cost = costFromReserves(r, { global: global(true), feeConfig }, ids(150));
    expect(cost).toBe(await viaRpc(r, global(true), 150));
    expect(cost).toBeGreaterThan(costFromReserves(r, { global: global(true), feeConfig }, ids(0)));
  });

  test("is 0 once no tokens are left (the forced-bond patch)", () => {
    const done = patchOf("forced-bond", "3BoxFpTp3SXWZADr3gQtAnnr7AozxH3Bc3M2qkjwU3jN");
    expect(done.realTokenReserves).toBe("0");
    expect(costFromReserves(done, { global: global(true), feeConfig }, ids(150))).toBe(0n);
  });
});
