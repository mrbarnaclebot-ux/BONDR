// UI-SPEC Simulation dialog copy (ADMIN-04, D-12, D-14): worker contract codes to their copy, the result line
// and the OQ1 estimated note. Pure, so the unit test pins every line. T-06-18-05: an unknown code or raw RPC
// text never renders; it falls back to the worker_unavailable line or "an unexpected error".
import type { AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";
import { ACTION_COPY, sweptCopy } from "./admin-copy-actions";
import { clock } from "./admin-copy-health";
import { sol, thousands } from "./format";

const UNAVAILABLE = "The worker did not answer. Nothing was sent. Try again in a moment.";

const FIXED: Record<string, string> = {
  intent_expired: "This simulation expired. Simulate again; nothing was sent.",
  intent_used: "This simulation was already used. Simulate again.",
  bad_intent_signature: "That signature is not from the admin wallet. Nothing was sent.",
  worker_unavailable: UNAVAILABLE,
  rate_limited: "Too many requests. Wait a minute and try again.",
  // Dialog-side states, not worker codes.
  phantom_rejected: "Phantom rejected the request. Nothing was sent.",
  phantom_failed: "Phantom could not sign the message. Nothing was sent.",
  nothing_to_send: "There is nothing to send for this action now. Nothing was sent.",
};

// The worker's simulate and send codes (tradeError and admin-money outcome) as words.
const WORDS: Record<string, string> = {
  insufficient_balance: "insufficient funds",
  slippage: "the price moved",
  paused: "the program is paused",
  expired: "blockhash expired",
  build_failed: "the transaction could not be built",
  send_failed: "a transaction failed",
  ops_low: "the ops wallet is below its floor",
  nothing_sent: "there was nothing to send",
  destination_refused: "a destination was refused",
};

function words(code: string | undefined): string {
  const program = /^code (\d{1,10})$/.exec(code ?? "");
  if (program) return `program error ${program[1]}`;
  return code && Object.hasOwn(WORDS, code) ? WORDS[code] : "an unexpected error";
}

/** The refusal line, also the destination check's refused callout. */
export const refusedCopy = (account: string, symbol: string): string =>
  `Destination refused: ${account} is not burn, treasury, buyback or ${symbol}'s deployer. Nothing can be sent.`;

/** `detail` is the refused account, the worker's simulation_failed code or the not_applicable reason. */
export function adminErrorCopy(code: string, action: AdminTxAction, symbol: string, detail?: string): string {
  if (code === "destination_refused") return refusedCopy(detail ?? "a destination", symbol);
  if (code === "not_applicable" && detail === "window_swept") return `${sweptCopy()} Nothing was sent.`;
  if (code === "not_applicable")
    return `${ACTION_COPY[action].label} no longer applies to ${symbol}. Refresh to see its current state.`;
  if (code === "simulation_failed") return `Simulation failed: ${words(detail)}. Nothing was sent.`;
  return Object.hasOwn(FIXED, code) ? FIXED[code] : UNAVAILABLE;
}

/** "Failed after send": the intent's code as words and the landed count. */
export const sentFailedCopy = (code: string | undefined, landed: number, total: number): string =>
  `Sending stopped: ${words(code)}. ${landed} of ${total} transactions landed.`;

export type Part = { pre: string; value: string; post?: string; tone?: "ok" | "danger" };

/** "Result", "Compute", "Fee", "{n} transactions" past one step, "Expires" (a static local time). */
export function simResultLine(s: AdminSimResult): Part[] {
  const parts: Part[] = [
    { pre: "Result ", value: s.ok ? "success" : "failed", tone: s.ok ? "ok" : "danger" },
    { pre: "Compute ", value: thousands(s.cu), post: " CU" },
    { pre: "Fee ", value: sol(s.feeLamports), post: " SOL, ops pays" },
  ];
  if (s.steps.length > 1) parts.push({ pre: "", value: String(s.steps.length), post: " transactions" });
  if (s.intent) parts.push({ pre: "Expires ", value: clock(s.intent.expiresAt) });
  return parts;
}

// OQ1 (Claude's discretion, the owner may override): later steps are estimated from the first one's result.
export const estimatedNote = (s: AdminSimResult): string | null =>
  s.steps.some((step) => step.estimated)
    ? "Later transactions are simulated again by the RPC before they are sent."
    : null;
