import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import { applyBps } from "./math.ts";
import { BN, type Global, pumpPoolAuthorityPda } from "./pump.ts";
import { type CurveState, curveHop, curveRates, type HopInput, routeQuote } from "./quote.ts";

// The devnet route fixtures (multihop-buy.json, multihop-sell.json): BONDR's curve and a child curve quoted in
// it, both at the devnet flat rates 95 protocol / 30 creator. Pre-trade state is each TradeEvent's post-trade
// reserves with the trade taken back out (a buy's quoteAmount is net, a sell's is gross).
const BONDR = new PublicKey("4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA");
const COIN = new PublicKey("F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr");
const RATES = { protocolBps: 95n, creatorBps: 30n };
const BUY = {
  bondr: { vQ: 325_900_436n - 9_905_894n, vT: 987_725_024_500_036n + 30_963_504_445_971n },
  coin: { vQ: 303_420_531_510_717n - 30_870_891_770_659n, vT: 936_561_950_662_678n + 106_081_602_760_505n },
};
const SELL = {
  coin: { vQ: 272_549_639_740_060n + 30_870_891_770_657n, vT: 1_042_643_553_423_183n - 106_081_602_760_505n },
  bondr: { vQ: 316_052_010n + 9_848_426n, vT: 1_018_503_303_595_381n - 30_778_279_095_345n },
};
const curve = (s: { vQ: bigint; vT: bigint }, realTokens = 700_000_000_000_000n): CurveState => ({
  ...s,
  realTokens,
  ...RATES,
});
const programs = { base: T22, quote: T22 };
const curveIn = (s: CurveState): HopInput => ({ kind: "curve", state: s, tokenPrograms: programs });

// Flat AMM rates (no FeeConfig), so a pool hop charges lp 20, protocol 5, creator 10 before the masks.
const ammGlobalConfig = {
  lpFeeBasisPoints: new BN(20),
  protocolFeeBasisPoints: new BN(5),
  coinCreatorFeeBasisPoints: new BN(10),
  creatorFeeConfigurable: false,
} as unknown as Parameters<typeof routeQuote>[0]["ammGlobalConfig"];

function poolIn(base: PublicKey, quote: PublicKey, baseAmount: bigint, quoteAmount: bigint): HopInput {
  const pool = {
    creator: pumpPoolAuthorityPda(base),
    baseMint: base,
    quoteMint: quote,
    coinCreator: Keypair.generate().publicKey,
    isMayhemMode: false,
    isCashbackCoin: false,
    virtualQuoteReserves: new BN(0),
    creatorFeeBps: new BN(0),
    protocolFees: new BN(0),
    creatorFees: new BN(0),
  } as unknown as Extract<HopInput, { kind: "pool" }>["pool"];
  return {
    kind: "pool",
    pool,
    poolKey: Keypair.generate().publicKey,
    poolBaseAmount: new BN(baseAmount.toString()),
    poolQuoteAmount: new BN(quoteAmount.toString()),
    baseMintSupply: new BN("1000000000000000"),
    tokenPrograms: programs,
  };
}

type Side = "buy" | "sell";
const quote = (side: Side, bondr: HopInput, coin: HopInput, amountIn: bigint, slippageBps = 100) =>
  routeQuote({
    side,
    bondrMint: BONDR,
    coinMint: COIN,
    bondr,
    coin,
    amountIn,
    slippageBps,
    ammGlobalConfig,
    ammFeeConfig: null,
  });

describe("curveHop on the devnet fixtures", () => {
  test("buy fixture: both hops to the base unit", () => {
    const bondrOut = curveHop(curve(BUY.bondr), 10_000_000n, true, { protocol: true, creator: false });
    expect(bondrOut).toBe(30_963_504_445_971n);
    expect(curveHop(curve(BUY.coin), bondrOut, true, { protocol: false, creator: true })).toBe(
      106_081_602_760_505n,
    );
    expect(quote("buy", curveIn(curve(BUY.bondr)), curveIn(curve(BUY.coin)), 10_000_000n).amountOut).toBe(
      "106081602760505",
    );
  });

  test("sell fixture: both hops to the base unit", () => {
    // gross 30,870,891,770,657 BONDR less 92,612,675,312 creator; then 9,848,426 lamports less 93,561 protocol
    const bondrOut = curveHop(curve(SELL.coin), 106_081_602_760_505n, false, {
      protocol: false,
      creator: true,
    });
    expect(bondrOut).toBe(30_778_279_095_345n);
    expect(curveHop(curve(SELL.bondr), bondrOut, false, { protocol: true, creator: false })).toBe(9_754_865n);
    expect(
      quote("sell", curveIn(curve(SELL.bondr)), curveIn(curve(SELL.coin)), 106_081_602_760_505n).amountOut,
    ).toBe("9754865");
  });
});

describe("fee masks", () => {
  const venues = {
    bondr: {
      curve: curveIn(curve(BUY.bondr)),
      pool: poolIn(BONDR, NATIVE_MINT, 200_000_000_000_000n, 85_000_000_000n),
    },
    coin: {
      curve: curveIn(curve(BUY.coin)),
      pool: poolIn(COIN, BONDR, 200_000_000_000_000n, 60_000_000_000_000n),
    },
  };
  const amounts: Record<Side, bigint> = { buy: 10_000_000n, sell: 1_000_000_000_000n };
  for (const side of ["buy", "sell"] as const) {
    for (const b of ["curve", "pool"] as const) {
      for (const c of ["curve", "pool"] as const) {
        test(`${side} ${b}/${c}: protocol only on the BONDR hop, creator and LP only on the coin hop`, () => {
          const q = quote(side, venues.bondr[b], venues.coin[c], amounts[side]);
          const { bondrHop, coinHop } = q.fees;
          expect(q.route).toEqual({ bondr: b, coin: c });
          expect([bondrHop.venue, coinHop.venue]).toEqual([b, c]);
          expect(bondrHop.protocolBps).toBeGreaterThan(0);
          expect([bondrHop.creatorBps, bondrHop.lpBps, coinHop.protocolBps]).toEqual([0, 0, 0]);
          expect(coinHop.creatorBps).toBeGreaterThan(0);
          expect(coinHop.lpBps > 0).toBe(c === "pool");
          expect(BigInt(bondrHop.sol)).toBeGreaterThan(0n);
          expect(BigInt(coinHop.sol)).toBeGreaterThan(0n);
          expect(q.fees.totalSol).toBe(String(BigInt(bondrHop.sol) + BigInt(coinHop.sol)));
          expect(q.fees.platformFee).toBe("0");
          expect(BigInt(q.amountOut)).toBeGreaterThan(0n);
        });
      }
    }
  }
});

describe("impact, floor and supply cap", () => {
  const route = (amountIn: bigint, slippageBps = 100) =>
    quote("buy", curveIn(curve(BUY.bondr)), curveIn(curve(BUY.coin)), amountIn, slippageBps);

  test("impact is near 0 for 1 lamport and grows with size", () => {
    const [one, ten, hundred] = [1n, 10n, 100n].map((a) => route(a).impact);
    expect(one).toBeGreaterThanOrEqual(0);
    expect(one).toBeLessThan(1e-6);
    expect(ten).toBeGreaterThan(one);
    expect(hundred).toBeGreaterThan(ten);
    expect(route(100_000_000n).impact).toBeGreaterThan(route(10_000_000n).impact);
  });

  test("the floor is applyBps(out, 10000 - slippage)", () => {
    for (const bps of [50, 100, 300]) {
      const q = route(10_000_000n, bps);
      expect(q.minAmountOut).toBe(String(applyBps(BigInt(q.amountOut), 10_000 - bps)));
    }
  });

  test("a buy past the coin's remaining supply caps at its real tokens", () => {
    const q = quote("buy", curveIn(curve(BUY.bondr)), curveIn(curve(BUY.coin, 1_000_000n)), 10_000_000n);
    expect(q.amountOut).toBe("1000000");
    expect(q.impact).toBeGreaterThan(0.99);
  });
});

describe("curveRates", () => {
  const global = {
    feeBasisPoints: new BN(95),
    creatorFeeBasisPoints: new BN(30),
    creatorFeeConfigurable: false,
  };
  const bc = (creator: PublicKey) =>
    ({
      virtualQuoteReserves: new BN(BUY.coin.vQ.toString()),
      virtualTokenReserves: new BN(BUY.coin.vT.toString()),
      quoteMint: BONDR,
      creator,
      creatorFeeBps: new BN(0),
    }) as unknown as Parameters<typeof curveRates>[2];

  test("schedule rates, and no creator fee on a curve without a creator", () => {
    const g = global as unknown as Global;
    expect(curveRates(g, null, bc(Keypair.generate().publicKey))).toEqual({
      protocolBps: 95n,
      creatorBps: 30n,
    });
    expect(curveRates(g, null, bc(PublicKey.default))).toEqual({ protocolBps: 95n, creatorBps: 0n });
  });
});
