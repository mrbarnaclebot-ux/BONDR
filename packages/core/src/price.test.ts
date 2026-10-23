import { expect, test } from "vitest";
import { bondrAtBond, curvePrice, mcapSol, poolPrice, progress, SUPPLY, toSol } from "./price.ts";

// Post-trade reserves from fixtures/launch-burn.json: ix 1 is the BONDR buy, ix 2 the child dev buy.
const bondr = { vQ: 315890677n, vT: 1019023468424286n }; // lamports, BONDR base units
const child = { vQ: 272549639740058n, vT: 1042643553423183n }; // BONDR base units, child base units

test("SUPPLY is the fixed 1B at 6 decimals (D-22)", () => {
  expect(SUPPLY).toBe(10n ** 15n);
});

test("curvePrice is virtual quote over virtual token, in quote base units per token base unit", () => {
  expect(curvePrice(bondr.vQ, bondr.vT)).toBe(315890677 / 1019023468424286);
  expect(curvePrice(child.vQ, child.vT)).toBe(272549639740058 / 1042643553423183);
});

test("mcapSol prices the fixed supply in SOL through the same-tx BONDR price", () => {
  const bondrSol = 315890677 / 1019023468424286;
  const byHand = ((272549639740058 / 1042643553423183) * 1e15 * bondrSol) / 1e9;
  expect(mcapSol(curvePrice(child.vQ, child.vT), bondrSol)).toBeCloseTo(byHand, 9);
  expect(byHand).toBeGreaterThan(0.08); // about 0.081 SOL on devnet
});

test("poolPrice is quote (caller adds the pool's virtual quote) over base", () => {
  // fixtures/pool-buy.json postTokenBalances (pool 3rTxmK...) plus the BuyEvent virtualQuoteReserves
  const q = 112308024204437n + 24739279326487n;
  expect(poolPrice(q, 181113419818657n)).toBe(137047303530924 / 181113419818657);
});

test("toSol rounds to the nearest lamport", () => {
  expect(toSol(1000n, 0.0004)).toBe(0n);
  expect(toSol(1000n, 0.0005)).toBe(1n);
  expect(toSol(987654320987n, 315890677 / 1019023468424286)).toBe(306166n);
});

test("progress runs 0 to 1 and is capped", () => {
  const init = 793_100_000_000_000n;
  expect(progress(init, init)).toBe(0);
  expect(progress(0n, init)).toBe(1);
  expect(progress(init / 2n, init)).toBe(0.5);
  expect(progress(-1n, init)).toBe(1);
  expect(() => progress(1n, 0n)).toThrow();
});

test("bondrAtBond on the forced-bond pre-completion reserves matches realQuoteReserves at completion", () => {
  // fixtures/forced-bond.json: one buy took all 793.1e12; post-trade vQ 162176648221100, vT 279.9e12.
  const [vQPost, vTPost, quote, tokens] = [
    162176648221100n,
    279_900_000_000_000n,
    119871667944226n,
    793_100_000_000_000n,
  ];
  const atBond = bondrAtBond(vQPost - quote, vTPost + tokens, tokens, 0n);
  expect(atBond - quote <= 1n && quote - atBond <= 1n).toBe(true);
  expect(vTPost + tokens - tokens).toBe(279_900_000_000_000n);
  expect(bondrAtBond(vQPost, vTPost, 0n, quote)).toBe(quote); // already complete
});
