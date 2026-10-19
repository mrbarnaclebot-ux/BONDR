// Pure bigint amount math. No SDK import, so every fee and slippage rule here is unit-testable offline.

// floor(x * bps / 10000). Floor, so a slippage floor or exact-out amount never exceeds what was quoted.
export function applyBps(x: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`bps out of range: ${bps}`);
  if (x < 0n) throw new Error("negative amount");
  return (x * BigInt(bps)) / 10_000n;
}
