// UI-SPEC Audit log and Kill switches copy (D-18, D-33). Pure, so the unit test pins every action's line.
import type { AdminAuditAction, AdminAuditRow, AdminJob, AuditResult } from "@bondr/core/api-admin";
import type { Tone } from "./admin-copy-health";
import { clock } from "./admin-copy-health";
import { plural, short, thousands } from "./format";

export const JOB_LABEL: Record<AdminJob, string> = {
  launches: "Launches",
  forcedBond: "Forced bond",
  sweeps: "Sweeps",
  finalize: "Finalize",
  buybackBurn: "Buyback burn",
};

// "{Action}: {SYMBOL}" actions; the labels match the timeline's recovery buttons (UI-SPEC Recovery actions).
const COIN_ACTION: Partial<Record<AdminAuditAction, string>> = {
  sweep_now: "Sweep now",
  retry_forced_bond: "Retry forced bond",
  burn_w_tokens: "Burn W token balance",
  run_migrate: "Run migrate",
  finalize_split: "Retry finalize split",
  retry_sweep: "Retry sweep",
  distribute_now: "Distribute now",
  sweep_leftovers: "Sweep leftovers, close accounts",
  recheck_launch: "Re-check launch",
  hold: "Hold for review",
  release_hold: "Release hold",
  hide: "Hide coin",
  unhide: "Unhide coin",
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The Action cell, from the row's action and its allowlisted params. */
export function auditActionCopy(r: AdminAuditRow): string {
  const coin = COIN_ACTION[r.action];
  if (coin) return `${coin}: ${r.symbol ?? (r.mint ? short(r.mint) : "unknown coin")}`;
  const p = r.params;
  switch (r.action) {
    case "switch": {
      const job = JOB_LABEL[p.job as AdminJob]?.toLowerCase() ?? str(p.job);
      return `${p.enabled === true ? "Resume" : "Pause"} ${job}`;
    }
    case "block":
    case "unblock":
      return `${r.action === "block" ? "Block" : "Unblock"} deployer: ${short(str(p.wallet))}`;
    case "evacuate":
      return `EVACUATE: ${typeof p.wallets === "number" ? plural(p.wallets, "wallet", "wallets") : "all wallets"}`;
    default:
      return "Burn buyback now";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** Local "HH:MM:SS" today, "Yesterday HH:MM", else "Mon D HH:MM". */
export function auditTime(iso: string, now: number): string {
  const d = new Date(iso);
  const today = dayStart(now);
  const t = d.getTime();
  if (t >= today) return clock(t);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (t >= new Date(today).setDate(new Date(today).getDate() - 1)) return `Yesterday ${hm}`;
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()} ${hm}`;
}

export type Word = { text: string; tone: Tone };

/** The Simulation cell: only money actions are simulated, the rest read "–". */
export function auditSim(s: AdminAuditRow["simulation"]): Word {
  if (!s) return { text: "–", tone: "muted" };
  return s.ok
    ? { text: `passed, ${thousands(s.cu)} CU`, tone: "ok" }
    : { text: "failed, not sent", tone: "danger" };
}

const RESULT: Record<AuditResult, Word> = {
  pending: { text: "Pending", tone: "muted" },
  landed: { text: "Landed", tone: "ok" },
  failed: { text: "Failed", tone: "danger" },
  refused: { text: "Refused", tone: "danger" },
};

export const auditResult = (r: AuditResult): Word => RESULT[r];
