import { expect, test } from "vitest";
import {
  ACTION_COPY,
  type ActionKey,
  actResultCopy,
  DEFAULT_HINT,
  fill,
  stuckErrorCopy,
} from "./admin-copy-actions";

const KEYS: ActionKey[] = [
  ...["sweep_now", "retry_forced_bond", "burn_w_tokens", "run_migrate", "finalize_split"],
  ...["retry_sweep", "distribute_now", "sweep_leftovers", "burn_buyback", "evacuate"],
  ...["hold", "release_hold", "recheck_launch"],
] as ActionKey[];

test("every action has a label, and a reason unless it always applies", () => {
  expect(Object.keys(ACTION_COPY).sort()).toEqual([...KEYS].sort());
  for (const k of KEYS) {
    expect(ACTION_COPY[k].label).not.toBe("");
    if (k === "hold" || k === "release_hold") expect(ACTION_COPY[k].reason).toBe("");
    else expect(ACTION_COPY[k].reason).not.toBe("");
    expect(ACTION_COPY[k].tx).toBe(!["hold", "release_hold", "recheck_launch"].includes(k));
  }
});

test("reasons match the UI-SPEC Not applicable table", () => {
  const reason = (k: ActionKey) => fill(ACTION_COPY[k].reason, "SWMP");
  expect(reason("sweep_now")).toBe("Sweep now applies only to a coin still on its curve.");
  expect(reason("retry_forced_bond")).toBe(
    "Retry forced bond applies only to a curve coin whose budget is at 105% of the cost or more.",
  );
  expect(reason("burn_w_tokens")).toBe("Burn W token balance applies only when this coin's W holds SWMP tokens.");
  expect(reason("run_migrate")).toBe("Run migrate applies only to a complete curve that has not migrated.");
  expect(reason("finalize_split")).toBe(
    "Finalize split applies only to a bonded coin whose fee shares are not set yet.",
  );
  expect(reason("retry_sweep")).toBe("Retry sweep applies only when this coin has a failed or expired sweep.");
  expect(reason("distribute_now")).toBe("Distribute now applies only after finalize.");
  expect(reason("recheck_launch")).toBe(
    "Re-check launch applies only to a launch that is still signed, sent or unknown.",
  );
  expect(reason("sweep_leftovers")).toBe("Sweep leftovers applies only after finalize.");
  expect(reason("burn_buyback")).toBe("The buyback wallet holds no BONDR to burn.");
  expect(DEFAULT_HINT).toMatch(/^Greyed actions do not apply to this coin now\. Every action simulates first;/);
});

test("permanent callouts exist only for finalize and the burns", () => {
  expect(fill(ACTION_COPY.finalize_split.permanent ?? "", "SWMP")).toMatch(
    /^This is the single allowed update_fee_shares_v2 for SWMP\. /,
  );
  for (const k of ["burn_w_tokens", "burn_buyback", "sweep_leftovers"] as const)
    expect(ACTION_COPY[k].permanent).toBe("Burned tokens cannot be recovered.");
  const others = KEYS.filter(
    (k) => !["finalize_split", "burn_w_tokens", "burn_buyback", "sweep_leftovers"].includes(k),
  );
  for (const k of others) expect(ACTION_COPY[k].permanent).toBeNull();
});

test("non-transaction result lines", () => {
  expect(actResultCopy("held", "SWMP")).toBe("Held SWMP for review.");
  expect(actResultCopy("released", "SWMP")).toBe("Released SWMP.");
  expect(actResultCopy("landed", "SWMP")).toBe("Launch landed. SWMP is armed.");
  expect(actResultCopy("not_on_chain", "SWMP")).toBe("The launch is not on chain yet. Nothing changed.");
  expect(actResultCopy("worker_unavailable", "SWMP")).toMatch(/Nothing changed/);
});

test("stuck errors are contract words, never raw text", () => {
  expect(stuckErrorCopy("blockhash_expired")).toBe("blockhash expired");
  expect(stuckErrorCopy("program_6003")).toBe("program error 6003");
  expect(stuckErrorCopy("job_error")).toBe("an unexpected error");
  expect(stuckErrorCopy("Transaction failed: <script>")).toBe("an unexpected error");
  expect(stuckErrorCopy("program_6003 leaked rpc text")).toBe("an unexpected error");
  expect(stuckErrorCopy("toString")).toBe("an unexpected error");
});
