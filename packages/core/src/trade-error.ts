// The one map from a simulation, preflight or on-chain failure to a contract code, for launch and trade
// (RESEARCH Error Mapping, D-17). Pure, so every probe shape is unit tested.
import type { ApiError } from "./api.ts";
import { customCode, fromLogs } from "./send.ts";

const SLIPPAGE = 6004; // pump-amm ExceededSlippage, multi_hop_swap.rs
// pump 6107: a child create on a complete, unmigrated BONDR (01-05); pump 6005: the curve is complete.
const AWAITING = new Set([6107, 6005]);

// Token program custom 1 is its InsufficientFunds; System custom 1 logs "insufficient lamports".
export function tradeError(err: unknown, logs: readonly string[] | null): ApiError {
  const code = customCode(err) ?? fromLogs(logs).code;
  if (code === SLIPPAGE) return { error: "slippage" };
  if (code !== undefined && AWAITING.has(code)) return { error: "paused", paused: "awaiting_migration" };
  const text = `${JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  if (/insufficient (lamports|funds)|InsufficientFunds|AccountNotFound/i.test(text) || code === 1)
    return { error: "insufficient_balance" };
  if (/Blockhash not found|BlockhashNotFound/i.test(text)) return { error: "expired" };
  if (text.includes("No tradable curve or canonical pool"))
    return { error: "paused", paused: "awaiting_migration" };
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
