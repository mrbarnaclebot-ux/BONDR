// The probe shapes from the 2026-10-24 devnet simulations (RESEARCH Error Mapping), as literals.
import { expect, test } from "vitest";
import { launchError, textError, tradeError } from "./trade-error.ts";

const custom = (i: number, n: number) => ({ InstructionError: [i, { Custom: n }] });
const paused = { error: "paused", paused: "awaiting_migration" };
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
// The raiser's failed line first, then the top-level multi_hop_swap's, as the runtime unwinds the CPI.
const raised = (program: string, n: number) => [
  `Program ${program} failed: custom program error: 0x${n.toString(16)}`,
  `Program ${AMM} failed: custom program error: 0x${n.toString(16)}`,
];

test("slippage is keyed by the program that raised it", () => {
  for (const [p, n] of [
    [AMM, 6004],
    [AMM, 6040],
    [PUMP, 6002],
    [PUMP, 6003],
  ] as const)
    expect(tradeError(custom(2, n), raised(p, n))).toEqual({ error: "slippage" });
});

test("the same code from the other program is not slippage or paused", () => {
  expect(tradeError(custom(2, 6004), raised(PUMP, 6004))).toEqual({ error: "build_failed" }); // MintDoesNotMatch
  expect(tradeError(custom(2, 6005), raised(AMM, 6005))).toEqual({ error: "build_failed" }); // InvalidAdmin
  expect(tradeError(custom(2, 6004), [])).toEqual({ error: "build_failed" }); // no raiser in the logs
});

test("low funds are insufficient_balance", () => {
  const lamports = ["Program log: Transfer: insufficient lamports 5, need 9"];
  expect(tradeError(custom(1, 1), lamports)).toEqual({ error: "insufficient_balance" });
  expect(tradeError("AccountNotFound", null)).toEqual({ error: "insufficient_balance" });
  expect(tradeError("InsufficientFundsForFee", [])).toEqual({ error: "insufficient_balance" });
});

test("6107, 6005 and no tradable venue are paused awaiting_migration", () => {
  expect(tradeError(custom(3, 6107), raised(PUMP, 6107))).toEqual(paused);
  expect(tradeError(custom(2, 6005), raised(PUMP, 6005))).toEqual(paused);
  expect(tradeError(null, ["No tradable curve or canonical pool for A / B"])).toEqual(paused);
});

test("a dead blockhash is expired", () => {
  expect(tradeError("BlockhashNotFound", [])).toEqual({ error: "expired" });
  expect(tradeError(null, ["Transaction simulation failed: Blockhash not found"])).toEqual({
    error: "expired",
  });
});

test("an unknown custom code is build_failed", () => {
  expect(tradeError(custom(2, 6003), raised(AMM, 6003))).toEqual({ error: "build_failed" });
});

test("a launch keeps its own codes: pump 6107 paused, low funds, the rest build_failed", () => {
  expect(launchError(custom(3, 6107), raised(PUMP, 6107))).toEqual(paused);
  expect(launchError(custom(1, 1), [])).toEqual({ error: "insufficient_balance" });
  for (const [p, n] of [
    [PUMP, 6002],
    [PUMP, 6004],
    [PUMP, 6005],
    [AMM, 6004],
  ] as const)
    expect(launchError(custom(2, n), raised(p, n))).toEqual({ error: "build_failed" });
});

test("textError maps the SDK's simulateMultiHopSwap text the same way", () => {
  const sim = (err: unknown, ...logs: string[]) =>
    `multi_hop_swap simulation failed: ${JSON.stringify(err)}\n${logs.join("\n")}`;
  expect(textError(sim(custom(2, 6004), ...raised(AMM, 6004)))).toEqual({ error: "slippage" });
  expect(textError(sim(custom(2, 6004), ...raised(PUMP, 6004)))).toEqual({ error: "build_failed" });
  expect(textError(sim(custom(1, 1), "Transfer: insufficient lamports 5, need 9"))).toEqual({
    error: "insufficient_balance",
  });
  expect(textError(sim("AccountNotFound"))).toEqual({ error: "insufficient_balance" });
  expect(textError(sim(custom(2, 6005), ...raised(PUMP, 6005)))).toEqual(paused);
  expect(textError("No tradable curve or canonical pool for A / B")).toEqual(paused);
  expect(textError(sim(custom(2, 6003), ...raised(AMM, 6003)))).toEqual({ error: "build_failed" });
  // A code only the logs carry still maps.
  expect(textError(`failed\nProgram ${AMM} failed: custom program error: 0x1774`)).toEqual({
    error: "slippage",
  });
});
