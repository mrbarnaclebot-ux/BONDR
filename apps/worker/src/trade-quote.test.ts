import { AwaitingMigration } from "@bondr/core/launch";
import {
  BN,
  type BondingCurve,
  type FeeConfig,
  type Global,
  getBuyV3QuoteAmountFromTokenAmount,
} from "@bondr/core/pump";
import { routeQuote } from "@bondr/core/quote";
import type * as QuoteRead from "@bondr/core/quote-read";
import { hopInputs } from "@bondr/core/quote-read";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { knownCoins } from "./ingest.ts";
import { MAX_SOL_IN } from "./status.ts";
import { maxSolIn, parseTrade, quoteTrade, tradeBalance } from "./trade-quote.ts";
import { configs, mintState } from "./trade-state.ts";

vi.mock("./trade-state.ts", () => ({ configs: vi.fn(), mintState: vi.fn() }));
vi.mock("@bondr/core/quote", async (orig) => ({ ...(await orig<object>()), routeQuote: vi.fn() }));
vi.mock("@bondr/core/quote-read", async (orig) => {
  const real = await orig<typeof QuoteRead>();
  return { ...real, hopInputs: vi.fn(real.hopInputs) };
});

const Q = PublicKey.unique();
const COIN = PublicKey.unique();
knownCoins.set(COIN.toBase58(), {
  mint: COIN.toBase58(),
  bondingCurve: "",
  pool: "",
  initialRealTokenReserves: "0",
});
const ok = { side: "buy", mint: COIN.toBase58(), amount: "10000000", slippageBps: 100 };

describe("parseTrade (T1)", () => {
  test("accepts a valid buy and sell", () => {
    expect(parseTrade(ok, Q)).toEqual({ side: "buy", mint: COIN, amount: 10_000_000n, slippageBps: 100 });
    const max = String(2n ** 64n - 1n);
    expect(parseTrade({ ...ok, side: "sell", amount: max }, Q).amount).toBe(2n ** 64n - 1n);
    expect(parseTrade({ ...ok, amount: String(MAX_SOL_IN) }, Q).amount).toBe(MAX_SOL_IN);
  });

  test("refuses bad side, amount and slippage with invalid_input", () => {
    const bad = [
      undefined,
      { ...ok, side: "swap" },
      { ...ok, amount: 10_000_000 },
      { ...ok, amount: "1e7" },
      { ...ok, amount: "-1" },
      { ...ok, amount: "1".repeat(21) },
      { ...ok, amount: "0" },
      { ...ok, amount: String(MAX_SOL_IN + 1n) },
      { ...ok, side: "sell", amount: "0" },
      { ...ok, side: "sell", amount: String(2n ** 64n) },
      { ...ok, slippageBps: 9 },
      { ...ok, slippageBps: 5_001 },
      { ...ok, slippageBps: 100.5 },
      { ...ok, slippageBps: "100" },
      { ...ok, mint: 7 },
      { ...ok, mint: Q.toBase58() }, // BONDR itself
    ];
    for (const b of bad) expect(() => parseTrade(b, Q), JSON.stringify(b)).toThrow("invalid_input");
  });

  test("an unregistered mint is not_found", () => {
    expect(() => parseTrade({ ...ok, mint: PublicKey.unique().toBase58() }, Q)).toThrow("not_found");
  });
});

// Decoded-shape literals at the devnet flat rates (95 protocol, 30 creator).
const fees = { lpFeeBps: new BN(0), protocolFeeBps: new BN(95), creatorFeeBps: new BN(30) };
const feeConfig = {
  flatFees: fees,
  feeTiers: [{ marketCapLamportsThreshold: new BN(0), fees }],
  stableFeeTiers: [],
  exoticFlatFees: { lpFeeBps: new BN(0), protocolFeeBps: new BN(0), creatorFeeBps: new BN(0) },
} as unknown as FeeConfig;
const global = {
  feeBasisPoints: new BN(95),
  creatorFeeBasisPoints: new BN(30),
  creatorFeeConfigurable: false,
  tokenTotalSupply: new BN(1_000_000_000_000_000),
  initialVirtualQuoteReserves: new BN(30_000_000_000),
  initialVirtualTokenReserves: new BN(1_073_000_000_000_000),
  initialRealTokenReserves: new BN(793_100_000_000_000),
} as unknown as Global;
const cfg = { global, feeConfig, ammGlobalConfig: {}, ammFeeConfig: null } as unknown as QuoteRead.Configs;
const curve = {
  virtualQuoteReserves: new BN(31_000_000_000),
  virtualTokenReserves: new BN(1_040_000_000_000_000),
  realTokenReserves: new BN(760_100_000_000_000),
  realQuoteReserves: new BN(1_000_000_000),
  tokenTotalSupply: new BN(1_000_000_000_000_000),
  complete: false,
  creator: PublicKey.unique(),
  quoteMint: NATIVE_MINT,
  creatorFeeBps: new BN(0),
  isMayhemMode: false,
  isCashbackCoin: false,
} as unknown as BondingCurve;
const programs = { base: T22, quote: T22 };
const curveState = (mint: PublicKey): QuoteRead.MintState => ({
  mint,
  supply: new BN(1_000_000_000_000_000),
  tokenPrograms: programs,
  venue: "curve",
  curve,
  curveTokenBalance: new BN(760_100_000_000_000),
});
const poolState = (mint: PublicKey) =>
  ({ ...curveState(mint), venue: "pool" }) as unknown as QuoteRead.MintState;

describe("maxSolIn (Pitfall 4)", () => {
  test("devnet on the curve: BONDR's cost to complete less 10%", () => {
    const full = getBuyV3QuoteAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: curve.tokenTotalSupply,
      bondingCurve: curve,
      amount: curve.realTokenReserves,
      curveBaseTokenBalance: curve.realTokenReserves,
    });
    expect(full.gtn(0)).toBe(true);
    expect(maxSolIn("devnet", curveState(Q), poolState(COIN), cfg)).toBe(full.muln(9).divn(10).toString());
  });

  test("devnet: a nearly complete coin curve caps lower than BONDR's, at its cost to complete less 10% (S-WR-04)", () => {
    const bondrCap = BigInt(maxSolIn("devnet", curveState(Q), poolState(COIN), cfg) ?? 0);
    const left = new BN(1_000_000_000_000); // 1M coin tokens left on the coin's curve
    const nearly = {
      ...curveState(COIN),
      curve: { ...curve, realTokenReserves: left },
    } as QuoteRead.MintState;
    const cost = (s: QuoteRead.MintState, amount: BN) =>
      s.venue === "curve"
        ? getBuyV3QuoteAmountFromTokenAmount({
            global,
            feeConfig,
            mintSupply: s.curve.tokenTotalSupply,
            bondingCurve: s.curve,
            amount,
            curveBaseTokenBalance: s.curveTokenBalance,
          })
        : new BN(0);
    const want = cost(curveState(Q), cost(nearly, left)).muln(9).divn(10);
    const cap = maxSolIn("devnet", curveState(Q), nearly, cfg);
    expect(cap).toBe(want.toString());
    expect(BigInt(cap ?? 0)).toBeLessThan(bondrCap);
  });

  test("none on mainnet or once BONDR is on its pool", () => {
    expect(maxSolIn("mainnet", curveState(Q), curveState(COIN), cfg)).toBeUndefined();
    expect(maxSolIn("devnet", poolState(Q), curveState(COIN), cfg)).toBeUndefined();
  });
});

describe("quoteTrade", () => {
  const ctx = { conn: {} as Connection, Q, net: "devnet" as const };
  const route = { side: "buy", amountOut: "1", fees: { totalSol: "3" } };
  beforeEach(() => {
    vi.mocked(configs).mockResolvedValue(cfg);
    vi.mocked(routeQuote).mockReturnValue(route as unknown as ReturnType<typeof routeQuote>);
    vi.mocked(hopInputs).mockClear();
  });

  test("builds both hops with hopInputs and adds networkMax and maxSolIn", async () => {
    vi.mocked(mintState).mockImplementation(async (_c, mint) => curveState(mint));
    const q = await quoteTrade(ctx, ok);
    expect(mintState).toHaveBeenCalledWith(ctx, Q, NATIVE_MINT);
    expect(mintState).toHaveBeenCalledWith(ctx, COIN, Q);
    expect(hopInputs).toHaveBeenCalledTimes(2);
    const args = vi.mocked(routeQuote).mock.calls[0][0];
    expect(args).toMatchObject({
      side: "buy",
      bondrMint: Q,
      coinMint: COIN,
      amountIn: 10_000_000n,
      slippageBps: 100,
    });
    expect(args.bondr).toEqual(vi.mocked(hopInputs).mock.results[0].value);
    expect(q.fees.networkMax).toBe("505000");
    expect(q.maxSolIn).toBe(maxSolIn("devnet", curveState(Q), curveState(COIN), cfg));
    expect(q.fees.totalSol).toBe("3");
  });

  test("either hop awaiting migration answers 409 paused", async () => {
    for (const awaiting of [Q, COIN]) {
      vi.mocked(mintState).mockImplementation(async (_c, mint) =>
        mint.equals(awaiting) ? { ...curveState(mint), venue: "awaiting" } : curveState(mint),
      );
      const e = await quoteTrade(ctx, ok).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 409, body: { error: "paused", paused: "awaiting_migration" } });
      expect(e).not.toBeInstanceOf(AwaitingMigration);
    }
  });
});

describe("tradeBalance", () => {
  const wallet = PublicKey.unique();
  const ata = getAssociatedTokenAddressSync(COIN, wallet, true, T22);
  const tokenInfo = (amount: bigint): AccountInfo<Buffer> => {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint: COIN,
        owner: wallet,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    return { owner: T22, data, lamports: 2_039_280, executable: false };
  };
  const conn = (ataInfo: AccountInfo<Buffer> | null) => ({
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => {
      expect(keys).toEqual([wallet, ata]);
      return [{ owner: PublicKey.default, data: Buffer.alloc(0), lamports: 42, executable: false }, ataInfo];
    }),
  });
  const body = { wallet: wallet.toBase58(), mint: COIN.toBase58() };

  test("SOL and coin balance from one read", async () => {
    const c = conn(tokenInfo(123n));
    expect(await tradeBalance({ conn: c as unknown as Connection }, body)).toEqual({
      sol: "42",
      tokens: "123",
    });
    expect(c.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  });

  test("a missing ATA is 0", async () => {
    const c = conn(null) as unknown as Connection;
    expect(await tradeBalance({ conn: c }, body)).toEqual({ sol: "42", tokens: "0" });
  });

  test("refuses a bad wallet and an unknown mint", async () => {
    const c = conn(null) as unknown as Connection;
    await expect(tradeBalance({ conn: c }, { ...body, wallet: "nope" })).rejects.toThrow("invalid_input");
    await expect(tradeBalance({ conn: c }, { ...body, mint: PublicKey.unique().toBase58() })).rejects.toThrow(
      "not_found",
    );
  });
});
