// UI-SPEC Timeline and recovery actions copy (ADMIN-03, D-13, D-16, D-20): every action's label, its reason when it
// does not apply, whether it sends a transaction and its permanent-action callout; the non-transaction result
// lines; and the stuck box's error words. Pure, so the unit test pins every line. {SYMBOL} is filled by `fill`.
import type { AdminActAction, AdminTxAction } from "@bondr/core/api-admin";

export type ActionKey = AdminTxAction | AdminActAction;
type Copy = { label: string; reason: string; tx: boolean; permanent: string | null };

const BURNED = "Burned tokens cannot be recovered.";
const tx = (label: string, reason: string, permanent: string | null = null): Copy => ({
  ...{ label, reason, tx: true, permanent },
});

export const ACTION_COPY: Record<ActionKey, Copy> = {
  sweep_now: tx("Sweep now", "Sweep now applies only to a coin still on its curve."),
  retry_forced_bond: tx(
    "Retry forced bond",
    "Retry forced bond applies only to a curve coin whose budget is at 105% of the cost or more.",
  ),
  burn_w_tokens: tx(
    "Burn W token balance",
    "Burn W token balance applies only when this coin's W holds {SYMBOL} tokens.",
    BURNED,
  ),
  run_migrate: tx("Run migrate", "Run migrate applies only to a complete curve that has not migrated."),
  finalize_split: tx(
    "Finalize split",
    "Finalize split applies only to a bonded coin whose fee shares are not set yet.",
    "This is the single allowed update_fee_shares_v2 for {SYMBOL}. Once confirmed it is permanent; only pump admin can reset it.",
  ),
  retry_sweep: tx("Retry sweep", "Retry sweep applies only when this coin has a failed or expired sweep."),
  distribute_now: tx("Distribute now", "Distribute now applies only after finalize."),
  sweep_leftovers: tx(
    "Sweep leftovers, close accounts",
    "Sweep leftovers applies only after finalize.",
    BURNED,
  ),
  burn_buyback: tx("Burn buyback now", "The buyback wallet holds no BONDR to burn.", BURNED),
  // EVACUATE has its own panel (06-22); this entry only keeps the map total.
  evacuate: tx("EVACUATE", "EVACUATE runs from its own panel."),
  hold: { label: "Hold for review", reason: "", tx: false, permanent: null },
  release_hold: { label: "Release hold", reason: "", tx: false, permanent: null },
  recheck_launch: {
    label: "Re-check launch",
    reason: "Re-check launch applies only to a launch that is still signed, sent or unknown.",
    tx: false,
    permanent: null,
  },
};

export const DEFAULT_HINT =
  "Greyed actions do not apply to this coin now. Every action simulates first; destinations are limited to burn, treasury, buyback or this coin's deployer.";

export const fill = (s: string, symbol: string): string => s.replaceAll("{SYMBOL}", symbol);

const RESULT: Record<string, string> = {
  held: "Held {SYMBOL} for review.",
  released: "Released {SYMBOL}.",
  landed: "Launch landed. {SYMBOL} is armed.",
  not_on_chain: "The launch is not on chain yet. Nothing changed.",
};

/** The hint line after a non-transaction action: its outcome, or the failure when the worker refused. */
export function actResultCopy(outcome: string, symbol: string): string {
  const line = RESULT[outcome];
  if (line) return fill(line, symbol);
  if (outcome === "not_applicable")
    return "Re-check launch no longer applies. Refresh to see its current state.";
  return "The worker did not answer. Nothing changed. Try again in a moment.";
}

// fee-stuck.ts codes. T-06-17-02: only these words or a program error number render, never raw RPC text.
const STUCK: Record<string, string> = {
  simulation_failed: "simulation failed",
  blockhash_expired: "blockhash expired",
  rate_limited: "RPC rate limited",
  timeout: "RPC timeout",
  insufficient_funds: "insufficient funds",
  send_failed: "transaction failed",
};

/** The stuck box's {error}: contract words per engine code, a program error by number, else a generic phrase. */
export function stuckErrorCopy(code: string): string {
  const program = /^program_(\d{1,10})$/.exec(code);
  if (program) return `program error ${program[1]}`;
  return Object.hasOwn(STUCK, code) ? STUCK[code] : "an unexpected error";
}
