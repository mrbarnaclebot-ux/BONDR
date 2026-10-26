import type { AdminAuditAction, AdminAuditRow } from "@bondr/core/api-admin";
import { expect, test } from "vitest";
import { auditActionCopy, auditResult, auditSim, auditTime, JOB_LABEL } from "./admin-copy-audit";

const MINT = "SwmpMint1111111111111111111111111111111111";
const WALLET = "Dep1oyer111111111111111111111111111111111XyZ";

const row = (action: AdminAuditAction, over: Partial<AdminAuditRow> = {}): AdminAuditRow => ({
  id: "1",
  at: new Date(2026, 9, 25, 14, 2, 11).toISOString(),
  actor: WALLET,
  action,
  mint: MINT,
  symbol: "SWMP",
  params: {},
  simulation: null,
  result: "landed",
  sigs: [],
  ...over,
});

// Mirrors the admin_audit_action CHECK (schema-admin.ts): a new action without copy fails here.
const ALL: AdminAuditAction[] = [
  "sweep_now",
  "retry_forced_bond",
  "burn_w_tokens",
  "run_migrate",
  "finalize_split",
  "retry_sweep",
  "distribute_now",
  "sweep_leftovers",
  "burn_buyback",
  "evacuate",
  "hold",
  "release_hold",
  "recheck_launch",
  "switch",
  "hide",
  "unhide",
  "block",
  "unblock",
];

test("every one of the 18 audit actions has copy", () => {
  expect(ALL).toHaveLength(18);
  for (const a of ALL)
    expect(auditActionCopy(row(a, { params: { job: "sweeps", enabled: true } }))).not.toBe("");
});

test("coin actions read {Action}: {SYMBOL}", () => {
  expect(auditActionCopy(row("finalize_split"))).toBe("Retry finalize split: SWMP");
  expect(auditActionCopy(row("sweep_now"))).toBe("Sweep now: SWMP");
  expect(auditActionCopy(row("hold"))).toBe("Hold for review: SWMP");
  expect(auditActionCopy(row("release_hold"))).toBe("Release hold: SWMP");
  expect(auditActionCopy(row("hide"))).toBe("Hide coin: SWMP");
  expect(auditActionCopy(row("unhide"))).toBe("Unhide coin: SWMP");
  expect(auditActionCopy(row("sweep_now", { symbol: null }))).toBe("Sweep now: Swmp…1111");
});

test("platform, switch, deployer and evacuate copy", () => {
  expect(auditActionCopy(row("burn_buyback", { mint: null, symbol: null }))).toBe("Burn buyback now");
  const sw = (job: string, enabled: boolean) => row("switch", { mint: null, params: { job, enabled } });
  expect(auditActionCopy(sw("sweeps", false))).toBe("Pause sweeps");
  expect(auditActionCopy(sw("sweeps", true))).toBe("Resume sweeps");
  expect(auditActionCopy(sw("buybackBurn", false))).toBe("Pause buyback burn");
  expect(auditActionCopy(row("block", { mint: null, params: { wallet: WALLET } }))).toBe(
    "Block deployer: Dep1…1XyZ",
  );
  expect(auditActionCopy(row("unblock", { mint: null, params: { wallet: WALLET } }))).toBe(
    "Unblock deployer: Dep1…1XyZ",
  );
  expect(auditActionCopy(row("evacuate", { mint: null, params: { wallets: 42 } }))).toBe(
    "EVACUATE: 42 wallets",
  );
  expect(auditActionCopy(row("evacuate", { mint: null, params: { wallets: 1 } }))).toBe("EVACUATE: 1 wallet");
});

test("JOB_LABEL names the five switches", () => {
  expect(Object.values(JOB_LABEL)).toEqual(["Launches", "Forced bond", "Sweeps", "Finalize", "Buyback burn"]);
});

test("auditTime: seconds today, Yesterday, then month and day", () => {
  const now = new Date(2026, 9, 25, 18, 0, 0).getTime();
  expect(auditTime(new Date(2026, 9, 25, 9, 5, 7).toISOString(), now)).toBe("09:05:07");
  expect(auditTime(new Date(2026, 9, 24, 23, 59, 30).toISOString(), now)).toBe("Yesterday 23:59");
  expect(auditTime(new Date(2026, 9, 3, 7, 4, 0).toISOString(), now)).toBe("Oct 3 07:04");
  expect(auditTime(new Date(2025, 11, 31, 0, 0, 0).toISOString(), now)).toBe("Dec 31 00:00");
});

test("simulation and result cells", () => {
  expect(auditSim({ ok: true, cu: 41_210 })).toEqual({ text: "passed, 41,210 CU", tone: "ok" });
  expect(auditSim({ ok: false, cu: 0 })).toEqual({ text: "failed, not sent", tone: "danger" });
  expect(auditSim(null)).toEqual({ text: "–", tone: "muted" });
  expect(auditResult("pending")).toEqual({ text: "Pending", tone: "muted" });
  expect(auditResult("landed")).toEqual({ text: "Landed", tone: "ok" });
  expect(auditResult("failed")).toEqual({ text: "Failed", tone: "danger" });
  expect(auditResult("refused")).toEqual({ text: "Refused", tone: "danger" });
});
