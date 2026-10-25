// A curve coin's patch from one TradeEvent: reserves, market cap, progress, what bonding would take and the
// creator fee bucket the D-10 trigger reads. Pure; split from trades.ts for size.
import { bondrAtBond, curvePrice, mcapSol, progress, toSol } from "./price.ts";
import type { CoinPatch } from "./trades.ts";

export const big = (v: unknown): bigint => BigInt(String(v));
export const sol = (lamports: bigint): number => Number(lamports) / 1e9;

export function curveState(
  mint: string,
  d: Record<string, unknown>,
  b: number | null,
  init: bigint,
): CoinPatch {
  const [vQ, vT] = [big(d.virtualQuoteReserves), big(d.virtualTokenReserves)];
  const [realT, realQ] = [big(d.realTokenReserves), big(d.realQuoteReserves)];
  const atBond = bondrAtBond(vQ, vT, realT, realQ);
  return {
    mint,
    realTokenReserves: String(realT),
    realQuoteReserves: String(realQ),
    virtualTokenReserves: String(vT),
    virtualQuoteReserves: String(vQ),
    ...(b !== null && {
      mcapSol: mcapSol(curvePrice(vQ, vT), b),
      bondSol: sol(toSol(atBond, b)),
      bondrSol: b,
    }),
    progress: progress(realT, init),
    bondrAtBond: String(atBond),
    feesUnclaimed: String(big(d.creatorFeeUnclaimed)),
  };
}
