import type { AdminSimResult } from "@bondr/core/api-admin";
import { expect, test } from "vitest";
import { clock } from "./admin-copy-health";
import { adminErrorCopy, estimatedNote, type Part, sentFailedCopy, simResultLine } from "./admin-copy-sim";

const SIM: AdminSimResult = {
  ...{ action: "finalize_split", mint: "Mint1111", ok: true, cu: 48_210, feeLamports: "15000" },
  steps: [
    { ok: true, cu: 30_000, estimated: false },
    { ok: true, cu: 18_210, estimated: true },
  ],
  ...{ balances: [], destinations: { ok: true, passed: ["burn only"] }, nothing: false },
  intent: { id: "a".repeat(32), message: "m", expiresAt: Date.UTC(2026, 9, 25, 18, 30, 5) },
};
const text = (parts: Part[]) => parts.map((p) => `${p.pre}${p.value}${p.post ?? ""}`);

test("every contract code maps to the UI-SPEC copy verbatim", () => {
  const c = (code: string, detail?: string) => adminErrorCopy(code, "finalize_split", "SWMP", detail);
  expect(c("intent_expired")).toBe("This simulation expired. Simulate again; nothing was sent.");
  expect(c("intent_used")).toBe("This simulation was already used. Simulate again.");
  expect(c("bad_intent_signature")).toBe("That signature is not from the admin wallet. Nothing was sent.");
  expect(c("destination_refused", "Evil1111")).toBe(
    "Destination refused: Evil1111 is not burn, treasury, buyback or SWMP's deployer. Nothing can be sent.",
  );
  expect(c("not_applicable")).toBe(
    "Finalize split no longer applies to SWMP. Refresh to see its current state.",
  );
  expect(adminErrorCopy("not_applicable", "sweep_now", "SWMP", "window_swept")).toBe(
    "Already swept this window; the next sweep runs when the window closes. Nothing was sent.",
  );
  expect(adminErrorCopy("not_applicable", "burn_buyback", "BONDR")).toBe(
    "Burn buyback now no longer applies to BONDR. Refresh to see its current state.",
  );
  expect(c("simulation_failed", "insufficient_balance")).toBe(
    "Simulation failed: insufficient funds. Nothing was sent.",
  );
  expect(c("simulation_failed", "code 6001")).toBe(
    "Simulation failed: program error 6001. Nothing was sent.",
  );
  expect(c("simulation_failed")).toBe("Simulation failed: an unexpected error. Nothing was sent.");
  expect(c("worker_unavailable")).toBe("The worker did not answer. Nothing was sent. Try again in a moment.");
  expect(c("rate_limited")).toBe("Too many requests. Wait a minute and try again.");
  expect(c("phantom_rejected")).toBe("Phantom rejected the request. Nothing was sent.");
  expect(c("phantom_failed")).toBe("Phantom could not sign the message. Nothing was sent.");
  expect(c("nothing_to_send")).toBe("There is nothing to send for this action now. Nothing was sent.");
  expect(c("something_new")).toBe(c("worker_unavailable"));
});

test("a failure after send names the reason and how many landed, never raw text", () => {
  expect(sentFailedCopy("ops_low", 1, 2)).toBe(
    "Sending stopped: the ops wallet is below its floor. 1 of 2 transactions landed.",
  );
  expect(sentFailedCopy("code 6023", 0, 1)).toBe(
    "Sending stopped: program error 6023. 0 of 1 transactions landed.",
  );
  expect(sentFailedCopy("<raw rpc text>", 0, 0)).toBe(
    "Sending stopped: an unexpected error. 0 of 0 transactions landed.",
  );
});

test("the result line shows transactions only past one step and a static expiry", () => {
  const exp = clock(SIM.intent?.expiresAt ?? 0);
  expect(text(simResultLine(SIM))).toEqual([
    "Result success",
    "Compute 48,210 CU",
    "Fee 0.000015 SOL, ops pays",
    "2 transactions",
    `Expires ${exp}`,
  ]);
  expect(simResultLine(SIM)[0].tone).toBe("ok");
  const one = { ...SIM, ok: false, steps: [SIM.steps[0]], intent: undefined };
  expect(text(simResultLine(one))).toEqual([
    "Result failed",
    "Compute 48,210 CU",
    "Fee 0.000015 SOL, ops pays",
  ]);
  expect(simResultLine(one)[0].tone).toBe("danger");
});

test("the estimated note shows only when a later step is estimated (OQ1)", () => {
  expect(estimatedNote(SIM)).toBe("Later transactions are simulated again by the RPC before they are sent.");
  expect(estimatedNote({ ...SIM, steps: [SIM.steps[0]] })).toBeNull();
});
