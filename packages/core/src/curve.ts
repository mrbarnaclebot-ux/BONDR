// Bonding curve reads. The completion cost comes from the SDK v3 quote, never a hand-rolled curve, because
// it includes per-leg fees and the synthetic-migration pool-to-be (RESEARCH Don't Hand-Roll).
import { TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { BN, getBuyV3QuoteAmountFromTokenAmount, type OnlinePumpSdk } from "./pump.ts";

type Online = InstanceType<typeof OnlinePumpSdk>;

export async function readCurve(online: Online, mint: PublicKey) {
  const c = await online.fetchBondingCurve(mint);
  return {
    complete: c.complete,
    creator: c.creator.toBase58(),
    quoteMint: c.quoteMint.toBase58(),
    realTokenReserves: c.realTokenReserves,
  };
}

// The quote (fees included) that buys every token left on the curve, i.e. what completes it. Phase 5 uses
// it for the 105% forced-bond trigger. Zero once complete. Every BONDR curve is a Token-2022 mint.
export async function costToComplete(online: Online, mint: PublicKey): Promise<BN> {
  const [global, feeConfig, s] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchBuyState(mint, PublicKey.default, T22),
  ]);
  if (s.bondingCurve.complete) return new BN(0);
  return getBuyV3QuoteAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: s.bondingCurve.tokenTotalSupply,
    bondingCurve: s.bondingCurve,
    amount: s.bondingCurve.realTokenReserves,
    curveBaseTokenBalance: s.curveBaseTokenBalance,
  });
}
