// The probe shapes from the 2026-10-24 devnet simulations (RESEARCH Error Mapping), as literals.
import { expect, test } from "vitest";
import { textError, tradeError } from "./trade-error.ts";

const custom = (i: number, n: number) => ({ InstructionError: [i, { Custom: n }] });
const paused = { error: "paused", paused: "awaiting_migration" };

test("6004 is slippage", () => {
  expect(tradeError(custom(2, 6004), ["Program log: Error Code: ExceededSlippage"])).toEqual({
    error: "slippage",
  });
});

test("low funds are insufficient_balance", () => {
  const lamports = ["Program log: Transfer: insufficient lamports 5, need 9"];
  expect(tradeError(custom(1, 1), lamports)).toEqual({ error: "insufficient_balance" });
  expect(tradeError("AccountNotFound", null)).toEqual({ error: "insufficient_balance" });
  expect(tradeError("InsufficientFundsForFee", [])).toEqual({ error: "insufficient_balance" });
});

test("6107, 6005 and no tradable venue are paused awaiting_migration", () => {
  expect(tradeError(custom(3, 6107), [])).toEqual(paused);
  expect(tradeError(custom(2, 6005), [])).toEqual(paused);
  expect(tradeError(null, ["No tradable curve or canonical pool for A / B"])).toEqual(paused);
});

test("a dead blockhash is expired", () => {
  expect(tradeError("BlockhashNotFound", [])).toEqual({ error: "expired" });
  expect(tradeError(null, ["Transaction simulation failed: Blockhash not found"])).toEqual({
    error: "expired",
  });
});

test("an unknown custom code is build_failed", () => {
  expect(tradeError(custom(2, 6003), ["slippage"])).toEqual({ error: "build_failed" });
});

test("textError maps the SDK's simulateMultiHopSwap text the same way", () => {
  const sim = (err: unknown, ...logs: string[]) =>
    `multi_hop_swap simulation failed: ${JSON.stringify(err)}\n${logs.join("\n")}`;
  expect(textError(sim(custom(2, 6004)))).toEqual({ error: "slippage" });
  expect(textError(sim(custom(1, 1), "Transfer: insufficient lamports 5, need 9"))).toEqual({
    error: "insufficient_balance",
  });
  expect(textError(sim("AccountNotFound"))).toEqual({ error: "insufficient_balance" });
  expect(textError(sim(custom(2, 6005)))).toEqual(paused);
  expect(textError("No tradable curve or canonical pool for A / B")).toEqual(paused);
  expect(textError(sim(custom(2, 6003)))).toEqual({ error: "build_failed" });
  // A code only the logs carry still maps.
  expect(textError("failed\nProgram x failed: custom program error: 0x1774")).toEqual({ error: "slippage" });
});
