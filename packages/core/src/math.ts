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
