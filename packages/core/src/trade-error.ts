// The one map from a simulation, preflight or on-chain failure to a contract code, for launch and trade
// (RESEARCH Error Mapping, D-17). Pure, so every probe shape is unit tested.
import type { ApiError } from "./api.ts";
import { customCode, fromLogs } from "./send.ts";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
// Keyed by program, never the code alone: pump 6004 is MintDoesNotMatchBondingCurve, AMM 6004 ExceededSlippage.
// AMM 6040 BuySlippageBelowMinBaseAmountOut; pump 6002 TooMuchSolRequired, 6003 TooLittleSolReceived.
const SLIPPAGE = new Set([`${AMM}:6004`, `${AMM}:6040`, `${PUMP}:6002`, `${PUMP}:6003`]);
// pump 6107: a child create on a complete, unmigrated BONDR (01-05); pump 6005: the curve is complete.
const AWAITING = new Set([`${PUMP}:6107`, `${PUMP}:6005`]);
const PAUSED: ApiError = { error: "paused", paused: "awaiting_migration" };

// The runtime logs "Program <id> failed" for the program that raised the error first, then once per caller up
// the CPI stack, so the first such line names the raiser even under the top-level multi_hop_swap.
const RAISED = /Program (\w+) failed: custom program error/;
const raisedBy = (logs: readonly string[] | null): string | undefined =>
  (logs ?? []).map((l) => l.match(RAISED)?.[1]).find(Boolean);

function parts(err: unknown, logs: readonly string[] | null) {
  const code = customCode(err) ?? fromLogs(logs).code;
  const text = `${JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  return { code, key: `${raisedBy(logs)}:${code}`, text };
}

// Token program custom 1 is its InsufficientFunds; System custom 1 logs "insufficient lamports".
const lowFunds = (p: ReturnType<typeof parts>): boolean =>
  /insufficient (lamports|funds)|InsufficientFunds|AccountNotFound/i.test(p.text) || p.code === 1;

export function tradeError(err: unknown, logs: readonly string[] | null): ApiError {
  const p = parts(err, logs);
  if (SLIPPAGE.has(p.key)) return { error: "slippage" };
  if (AWAITING.has(p.key)) return PAUSED;
  if (lowFunds(p)) return { error: "insufficient_balance" };
  if (/Blockhash not found|BlockhashNotFound/i.test(p.text)) return { error: "expired" };
  if (p.text.includes("No tradable curve or canonical pool")) return PAUSED;
  return { error: "build_failed" };
}

// A launch keeps its pre-trade codes: its UI has no copy for slippage, and a moved exact-out dev buy (pump
// 6002) or a complete curve stays build_failed there.
export function launchError(err: unknown, logs: readonly string[] | null): ApiError {
  const p = parts(err, logs);
  if (p.key === `${PUMP}:6107`) return PAUSED;
  if (lowFunds(p)) return { error: "insufficient_balance" };
  return { error: "build_failed" };
}

// The SDK's simulateMultiHopSwap throws "...simulation failed: <JSON err>\n<logs>"; other throws are plain text.
export function textError(message: string): ApiError {
  const lines = message.split("\n");
  const json = lines[0]?.match(/simulation failed: (.+)$/)?.[1];
  let err: unknown = null;
  try {
    if (json) err = JSON.parse(json);
  } catch {
    err = null;
  }
  return tradeError(err, lines);
}
