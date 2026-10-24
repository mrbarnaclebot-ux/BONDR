// Pure price, market cap and bond math for the indexer. No SDK import. Worker-side: web reads the stored
// values. Child and BONDR both have 6 decimals, SOL has 9.

// D-22: market cap is price x a fixed 1,000,000,000 tokens (6 decimals), the pump.fun convention. Never the
// live supply, so burns do not lower it.
export const SUPPLY = 1_000_000_000_000_000n;

// Quote base units per token base unit from post-trade virtual reserves. For BONDR on its curve that is
// lamports per BONDR base unit; for a child, BONDR base units per child base unit.
export const curvePrice = (vQuote: bigint, vToken: bigint): number => Number(vQuote) / Number(vToken);

// Quote base units per base unit of a PumpSwap pool. The caller adds the pool's virtual quote reserves.
export const poolPrice = (quoteReserve: bigint, baseReserve: bigint): number =>
  Number(quoteReserve) / Number(baseReserve);

// BONDR base units to lamports at bondrSol (lamports per BONDR base unit), rounded to the nearest lamport.
export const toSol = (quoteAmount: bigint, bondrSol: number): bigint =>
  BigInt(Math.round(Number(quoteAmount) * bondrSol));

// Market cap in SOL: price (BONDR base units per child base unit) x SUPPLY x bondrSol, lamports to SOL.
export const mcapSol = (pricePerToken: number, bondrSol: number): number =>
  (pricePerToken * Number(SUPPLY) * bondrSol) / 1e9;

// Bond progress in [0, 1]: the share of the curve's initial real tokens (child base units) sold.
export function progress(realTokenReserves: bigint, initialRealTokenReserves: bigint): number {
  if (initialRealTokenReserves <= 0n) throw new Error("initial real token reserves must be positive");
  return Math.min(1, Math.max(0, 1 - Number(realTokenReserves) / Number(initialRealTokenReserves)));
}

// BONDR base units the curve holds once its last real token sells: constant product on virtual reserves,
// k = vQ x vT, so the quote still to come is k / (vT - realTokenReserves) - vQ.
export function bondrAtBond(
  vQ: bigint,
  vT: bigint,
  realTokenReserves: bigint,
  realQuoteReserves: bigint,
): bigint {
  const vTEnd = vT - realTokenReserves;
  if (vTEnd <= 0n) throw new Error("virtual token reserves must exceed real token reserves");
  return realQuoteReserves + (vQ * vT) / vTEnd - vQ;
}
