// UI-SPEC EVACUATE copy (ADMIN-11, D-35 to D-37): the arm phrase, the simulated totals line and the done and
// progress lines. Pure, so the unit test pins every line.
import type { AdminIntentView, EvacuateTotals } from "@bondr/core/api-admin";
import type { Part } from "./admin-copy-sim";
import { feeSol, thousands, whole } from "./format";

export const EVAC_PHRASE = "EVACUATE ALL W TO TREASURY";

/** Exact match only (T-06-23-01): no trimming or case folding, so autocorrect or a stray key never arms it. */
export const phraseMatches = (typed: string): boolean => typed === EVAC_PHRASE;

export const EVAC_HINT = {
  disarmed: "Disarmed. The phrase must match exactly.",
  simulating: "Armed. Simulating every W balance…",
  ready: "Armed. Phantom will ask for your signature next.",
  signing: "Waiting for Phantom…",
  evacuating:
    "Evacuating. Every job is paused. Transfers are being sent; this can take a few minutes. Keep this tab open.",
  lost: "Lost contact with the worker. Transfers continue on the worker. Refresh to see the audit log.",
  simOnly: "This deploy runs EVACUATE as a simulation only.",
  nothing: "Every W is empty. Nothing to evacuate.",
} as const;

/** "Simulated now: {n} W balances, {bondr} BONDR ({sol} SOL) and {sol} SOL to the treasury, ..." */
export function evacSummary(t: EvacuateTotals): Part[] {
  return [
    {
      pre: "Simulated now: ",
      value: thousands(t.wallets),
      post: t.wallets === 1 ? " W balance, " : " W balances, ",
    },
    { pre: "", value: whole(t.bondr), post: " BONDR (" },
    { pre: "", value: feeSol(t.bondrSol), post: " SOL) and " },
    { pre: "", value: feeSol(t.sol), post: " SOL to the treasury, child tokens burned in " },
    { pre: "", value: thousands(t.burnedIn), post: t.burnedIn === 1 ? " wallet, " : " wallets, " },
    { pre: "", value: thousands(t.failures), post: " failures." },
  ];
}

/** The intent view's moved and failed are W counts (06-22), so together they are every W the run touched. */
export function evacDone(v: Pick<AdminIntentView, "moved" | "failed">): string {
  const moved = v.moved ?? 0;
  const failed = v.failed ?? 0;
  return `Evacuated. ${moved} of ${moved + failed} wallets moved to the treasury, ${failed} failed. Every job is paused.`;
}

/** W counts from the intent poll against the simulated wallet count; null until the first batch settles. */
export function evacProgress(v: Pick<AdminIntentView, "moved" | "failed">, wallets: number): string | null {
  const moved = v.moved ?? 0;
  const failed = v.failed ?? 0;
  return moved + failed ? `Moved ${moved} of ${wallets} wallets so far, ${failed} failed.` : null;
}
