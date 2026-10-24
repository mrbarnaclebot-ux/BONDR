import { AwaitingMigration } from "@bondr/core/launch";
import {
  BN,
  type BondingCurve,
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  type FeeConfig,
  type Global,
  type Pool,
  PUMP_AMM_PROGRAM_ID,
  PUMP_AMM_SDK,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
} from "@bondr/core/pump";
import { curveRates } from "@bondr/core/quote";
import type * as QuoteRead from "@bondr/core/quote-read";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  MintLayout,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@bondr/core/quote-read", async (orig) => ({
  ...(await orig<typeof QuoteRead>()),
  readConfigs: vi.fn(),
  readMintState: vi.fn(),
}));
const { readConfigs, readMintState } = await import("@bondr/core/quote-read");
const real = await vi.importActual<typeof QuoteRead>("@bondr/core/quote-read");
const { hopInputs } = real;
const { configs, mintState } = await import("./trade-state.ts");

const ctx = { conn: {} as Connection };
const flush = () => new Promise((r) => setImmediate(r));

describe("single-flight caches", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(readMintState).mockReset();
    vi.mocked(readConfigs).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  test("one read per mint per 2 s window", async () => {
    vi.mocked(readMintState).mockResolvedValue({ venue: "awaiting" } as QuoteRead.MintState);
    const mint = PublicKey.unique();
    const [a, b] = await Promise.all([mintState(ctx, mint, NATIVE_MINT), mintState(ctx, mint, NATIVE_MINT)]);
    expect(a).toBe(b);
    expect(readMintState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_999);
    await mintState(ctx, mint, NATIVE_MINT);
    expect(readMintState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await mintState(ctx, mint, NATIVE_MINT);
    expect(readMintState).toHaveBeenCalledTimes(2);
    await mintState(ctx, PublicKey.unique(), NATIVE_MINT); // another mint has its own entry
    expect(readMintState).toHaveBeenCalledTimes(3);
  });

  test("a failed read is not cached", async () => {
    vi.mocked(readMintState).mockRejectedValueOnce(new Error("rpc down"));
    vi.mocked(readMintState).mockResolvedValue({ venue: "awaiting" } as QuoteRead.MintState);
    const mint = PublicKey.unique();
    await expect(mintState(ctx, mint, NATIVE_MINT)).rejects.toThrow("rpc down");
    await flush();
    await expect(mintState(ctx, mint, NATIVE_MINT)).resolves.toEqual({ venue: "awaiting" });
    expect(readMintState).toHaveBeenCalledTimes(2);
  });

  test("configs are read once a minute", async () => {
    vi.mocked(readConfigs).mockResolvedValue({} as QuoteRead.Configs);
    await Promise.all([configs(ctx), configs(ctx)]);
    vi.advanceTimersByTime(59_999);
    await configs(ctx);
    expect(readConfigs).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await configs(ctx);
    expect(readConfigs).toHaveBeenCalledTimes(2);
  });
});

// Decoded-shape literals: the fields the readers and hopInputs touch.
const global = {
  feeBasisPoints: new BN(95),
  creatorFeeBasisPoints: new BN(30),
  creatorFeeConfigurable: false,
} as unknown as Global;
const cfg = {
  global,
  feeConfig: null as unknown as FeeConfig,
  ammGlobalConfig: {},
  ammFeeConfig: null,
} as unknown as QuoteRead.Configs;
const curveOf = (p: Partial<BondingCurve> = {}) =>
  ({
    virtualQuoteReserves: new BN(30_000_000_000),
    virtualTokenReserves: new BN(1_073_000_000_000_000),
    realTokenReserves: new BN(793_100_000_000_000),
    tokenTotalSupply: new BN(1_000_000_000_000_000),
    complete: false,
    creator: PublicKey.unique(),
    quoteMint: NATIVE_MINT,
    creatorFeeBps: new BN(0),
    isMayhemMode: false,
    ...p,
  }) as BondingCurve;

describe("readMintState venue (RESEARCH Pattern 3)", () => {
  const mint = PublicKey.unique();
  const curvePda = bondingCurvePda(mint);
  const poolKey = canonicalPumpPoolPdaWithQuote(mint, NATIVE_MINT);
  const poolBase = getAssociatedTokenAddressSync(mint, poolKey, true, T22);
  const poolQuote = getAssociatedTokenAddressSync(NATIVE_MINT, poolKey, true, TOKEN_PROGRAM_ID);
  const curveAta = getAssociatedTokenAddressSync(mint, curvePda, true, T22);

  const info = (owner: PublicKey, data = Buffer.alloc(8)): AccountInfo<Buffer> => ({
    owner,
    data,
    lamports: 1,
    executable: false,
  });
  const mintInfo = () => {
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: 1_000_000_000_000_000n,
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    return info(T22, data);
  };
  const tokenInfo = (m: PublicKey, owner: PublicKey, amount: bigint, program: PublicKey) => {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint: m,
        owner,
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
    return info(program, data);
  };
  const conn = (accounts: Map<string, AccountInfo<Buffer>>) => {
    const getMultipleAccountsInfo = vi.fn(async (keys: PublicKey[]) =>
      keys.map((k) => accounts.get(k.toBase58()) ?? null),
    );
    return { getMultipleAccountsInfo } as unknown as Connection & {
      getMultipleAccountsInfo: typeof getMultipleAccountsInfo;
    };
  };
  const pool = { poolBaseTokenAccount: poolBase, poolQuoteTokenAccount: poolQuote } as unknown as Pool;

  function chain(curve: BondingCurve | null, withPool: boolean) {
    vi.spyOn(PUMP_SDK, "decodeBondingCurve").mockReturnValue(curve as BondingCurve);
    vi.spyOn(PUMP_AMM_SDK, "decodePool").mockReturnValue(pool);
    const m = new Map<string, AccountInfo<Buffer>>([[mint.toBase58(), mintInfo()]]);
    if (curve) m.set(curvePda.toBase58(), info(PUMP_PROGRAM_ID));
    m.set(curveAta.toBase58(), tokenInfo(mint, curvePda, 5n, T22));
    if (withPool) {
      m.set(poolKey.toBase58(), info(PUMP_AMM_PROGRAM_ID));
      m.set(poolBase.toBase58(), tokenInfo(mint, poolKey, 7n, T22));
      m.set(poolQuote.toBase58(), tokenInfo(NATIVE_MINT, poolKey, 9n, TOKEN_PROGRAM_ID));
    }
    return conn(m);
  }
  afterEach(() => vi.restoreAllMocks());

  test("curve while it trades, in one read", async () => {
    const c = chain(curveOf(), true);
    const s = await real.readMintState(c, mint, NATIVE_MINT);
    expect(s.venue).toBe("curve");
    expect(s.venue === "curve" && s.curveTokenBalance.toString()).toBe("5");
    expect(s.supply.toString()).toBe("1000000000000000");
    expect(s.tokenPrograms).toEqual({ base: T22, quote: TOKEN_PROGRAM_ID });
    expect(c.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  });

  test("pool once the curve is complete or quoted in another mint", async () => {
    for (const curve of [curveOf({ complete: true }), curveOf({ quoteMint: PublicKey.unique() }), null]) {
      const s = await real.readMintState(chain(curve, true), mint, NATIVE_MINT);
      expect(s.venue).toBe("pool");
      if (s.venue !== "pool") continue;
      expect([s.poolBaseAmount.toString(), s.poolQuoteAmount.toString()]).toEqual(["7", "9"]);
      expect(s.poolKey).toEqual(poolKey);
    }
  });

  test("awaiting when complete with no pool yet", async () => {
    const s = await real.readMintState(chain(curveOf({ complete: true }), false), mint, NATIVE_MINT);
    expect(s.venue).toBe("awaiting");
  });
});

describe("hopInputs, the one HopInput builder", () => {
  const base = {
    mint: PublicKey.unique(),
    supply: new BN("1000000000000000"),
    tokenPrograms: { base: T22, quote: T22 },
  };

  test("a curve state gives its reserves and live rates", () => {
    const curve = curveOf();
    const h = hopInputs({ ...base, venue: "curve", curve, curveTokenBalance: new BN(5) }, cfg);
    expect(h).toEqual({
      kind: "curve",
      state: {
        vQ: 30_000_000_000n,
        vT: 1_073_000_000_000_000n,
        realTokens: 793_100_000_000_000n,
        ...curveRates(global, cfg.feeConfig, curve),
      },
      tokenPrograms: base.tokenPrograms,
    });
    expect(h.kind === "curve" && h.state.protocolBps).toBe(95n);
  });

  test("a pool state gives its vaults, supply and programs", () => {
    const poolKey = PublicKey.unique();
    const pool = {} as Pool;
    const s = {
      ...base,
      venue: "pool" as const,
      pool,
      poolKey,
      poolBaseAmount: new BN(7),
      poolQuoteAmount: new BN(9),
    };
    expect(hopInputs(s, cfg)).toEqual({
      kind: "pool",
      pool,
      poolKey,
      poolBaseAmount: new BN(7),
      poolQuoteAmount: new BN(9),
      baseMintSupply: base.supply,
      tokenPrograms: base.tokenPrograms,
    });
  });

  test("an awaiting state throws AwaitingMigration", () => {
    expect(() => hopInputs({ ...base, venue: "awaiting" }, cfg)).toThrow(AwaitingMigration);
  });
});
