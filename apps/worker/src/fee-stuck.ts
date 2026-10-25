// The engine's stuck-step bookkeeping (D-20, D-26), split from fee-engine.ts for the 300-line rule: which step a
// job label names, whether a job's result failed or landed, and a short code for a thrown error.
import type { AdminCoinMemory } from "@bondr/core/api-admin";
import type { Landed } from "./fee-send.ts";

export const STUCK_AT = 3; // D-20: failures of one step on one coin before it shows as stuck
export type Failure = NonNullable<AdminCoinMemory["stuck"]>;
export type Verdict = { fail: string } | "clear" | null;

// T-06-06-03: a short code the console maps to copy, never the raw RPC text.
const CODES: [RegExp, string][] = [
  [/simulat/i, "simulation_failed"],
  [/blockhash|expired/i, "blockhash_expired"],
  [/429|rate.?limit|too many/i, "rate_limited"],
  [/timeout|timed out/i, "timeout"],
  [/insufficient/i, "insufficient_funds"],
];
export const codeOf = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return CODES.find(([re]) => re.test(m))?.[1] ?? "job_error";
};

// A job's Landed or Landed[]: a failed send fails the step, a landing with no failure clears the coin.
export function verdict(r: unknown): Verdict {
  const out = (Array.isArray(r) ? r : [r]).filter(
    (l): l is Landed => typeof (l as Landed | null)?.state === "string",
  );
  const bad = out.find((l) => l.state === "failed");
  if (bad) return { fail: bad.code === undefined ? "send_failed" : `program_${bad.code}` };
  return out.some((l) => l.state === "landed") ? "clear" : null;
}

// The job label names the step: "fee finalize <mint>" is finalize, "fee window <mint> 4" is sweep.
export function stepOf(what: string, mint: string): string {
  const at = what.indexOf(mint);
  const head = (at < 0 ? what : what.slice(0, at)).replace(/^fee /, "").trim();
  return head === "window" ? "sweep" : head || "job";
}
