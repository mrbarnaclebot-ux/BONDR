// Pure bigint amount math. No SDK import, so every fee and slippage rule here is unit-testable offline.

// floor(x * bps / 10000). Floor, so a slippage floor or exact-out amount never exceeds what was quoted.
export function applyBps(x: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`bps out of range: ${bps}`);
  if (x < 0n) throw new Error("negative amount");
  return (x * BigInt(bps)) / 10_000n;
}

// PROJECT.md item 4: the treasury takes 10% of each collect off-chain; the other 90% stays in W as the
// burn budget. Treasury floors, so rounding dust always lands in the burn budget.
const TREASURY_BPS = 1000;

export function split90_10(x: bigint): { treasury: bigint; burn: bigint } {
  const treasury = applyBps(x, TREASURY_BPS);
  return { treasury, burn: x - treasury };
}

// PROJECT.md default 2: the forced bond fires once W's burn budget is at least 105% of the cost to complete
// the curve, so price moves between quote and landing still complete it.
const TRIGGER_PCT = 105n;

export const trigger105 = (budget: bigint, cost: bigint): boolean => budget * 100n >= cost * TRIGGER_PCT;

// D-17: the dev-buy minimum is 0.25 SOL scaled by live initial virtual reserves over mainnet's 30 SOL,
// i.e. reserves / 120. Exactly 0.25 SOL on mainnet, 0.0025 SOL on devnet. The only place the minimum lives.
export const minLamports = (initialVirtualSolReserves: bigint): bigint => initialVirtualSolReserves / 120n;

// Fee-only insta-sell estimate (RESEARCH Open Question 3): each leg keeps (10000 - bps) / 10000, floored.
// It ignores price impact, so the UI labels it "about" until prepare simulates the real value.
export const estimateSolBack = (solIn: bigint, legBps: number[]): bigint =>
  legBps.reduce((x, bps) => applyBps(x, 10_000 - bps), applyBps(solIn, 10_000));
