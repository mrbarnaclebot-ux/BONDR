// The owner's session-only actions (D-13): a switch flip, hold for review, release hold and re-check launch. No
// fresh signature, but each writes one audit row (D-34) after validation: pending before the change, settled after.
import type { AdminSwitches } from "@bondr/core/api-admin";
import { coins, launches } from "@bondr/core/db";
import type { Connection } from "@solana/web3.js";
import { and, eq, inArray } from "drizzle-orm";
import { type AuditStore, audited } from "./admin-audit.ts";
import type { Engine } from "./fee-engine.ts";
import { key } from "./fee-routes.ts";
import { fail } from "./http.ts";
import type { Exec } from "./launches.ts";
import type { landed, observe } from "./settle.ts";
import type { Gate } from "./switch-gate.ts";
import { isJob, type setJob } from "./switches.ts";

export type ActDeps = {
  audit: AuditStore;
  engine: () => Pick<Engine, "setHold"> | null;
  conn: Connection;
  exec: Exec;
  observe: typeof observe;
  landed: typeof landed;
  setJob: typeof setJob;
  gate: Gate; // WR-W-02: genesis and D-30 refusals, before any audit row
};
export type ActOutcome = "held" | "released" | "landed" | "not_on_chain";

type Body = {
  actor?: unknown;
  job?: unknown;
  enabled?: unknown;
  action?: unknown;
  mint?: unknown;
  reason?: unknown;
};
const bodyOf = (b: unknown) => (b ?? {}) as Body;

export async function switchRoute(d: ActDeps, body: unknown): Promise<AdminSwitches> {
  const { actor, job, enabled } = bodyOf(body);
  if (!isJob(job) || typeof enabled !== "boolean") throw fail({ error: "invalid_input" });
  await d.gate(job, enabled);
  const r = { actor: String(actor), action: "switch" as const, mint: null, params: { job, enabled } };
  return audited(d.audit, r, () => d.setJob(job, enabled));
}

// The DB CHECK allows 1 to 120 characters.
function reasonOf(v: unknown): string {
  const r = typeof v === "string" ? v.trim() : "";
  if (!r || r.length > 120) throw fail({ error: "invalid_input" });
  return r;
}

async function finalizeOf(d: ActDeps, mint: string): Promise<string> {
  const [c] = await d.exec.select({ finalize: coins.finalize }).from(coins).where(eq(coins.mint, mint));
  if (!c) throw fail({ error: "not_found" });
  return c.finalize;
}

async function hold(d: ActDeps, actor: string, mint: string, reason: string): Promise<ActOutcome> {
  await finalizeOf(d, mint);
  return audited(d.audit, { actor, action: "hold", mint, params: { reason } }, async () => {
    await d.exec.update(coins).set({ heldAt: new Date(), heldReason: reason }).where(eq(coins.mint, mint));
    d.engine()?.setHold(mint, reason);
    return "held" as const;
  });
}

// OQ3, A5: on a finalize-held coin release also sets finalize none, so the next batch re-runs the full finalize
// pre-flight. Finalize split with launches.wallet stays the primary release (D-05, D-15).
async function release(d: ActDeps, actor: string, mint: string): Promise<ActOutcome> {
  const resetFinalize = (await finalizeOf(d, mint)) === "held";
  const set = { heldAt: null, heldReason: null, ...(resetFinalize && { finalize: "none" }) };
  return audited(d.audit, { actor, action: "release_hold", mint, params: { resetFinalize } }, async () => {
    await d.exec.update(coins).set(set).where(eq(coins.mint, mint));
    d.engine()?.setHold(mint, null, resetFinalize);
    return "released" as const;
  });
}

// A8: one status read, never the settleLaunch loop, which can run for minutes and time out the web route. The
// boot resume and settle's unknown retries own everything else.
async function recheck(d: ActDeps, actor: string, mint: string): Promise<ActOutcome> {
  const inFlight = and(eq(launches.mint, mint), inArray(launches.state, ["signed", "sent", "unknown"]));
  const [row] = await d.exec.select().from(launches).where(inFlight).limit(1);
  const audit = (outcome: string) =>
    d.audit.insertLanded({ actor, action: "recheck_launch", mint, params: { outcome } });
  if (!row) {
    await audit("not_applicable");
    throw fail({ error: "not_applicable" });
  }
  // A known height skips the block height read.
  const o = row.signature ? await d.observe(d.conn, row.signature, true, 0) : null;
  const ok = o?.seen?.confirmed === true && o.seen.err === null;
  await audit(ok ? "landed" : "not_on_chain");
  if (!ok) return "not_on_chain";
  await d.landed(d.conn, row);
  return "landed";
}

export async function act(d: ActDeps, body: unknown): Promise<{ outcome: ActOutcome }> {
  const b = bodyOf(body);
  const actor = String(b.actor);
  if (b.action === "hold") {
    const reason = reasonOf(b.reason);
    return { outcome: await hold(d, actor, key(b.mint).toBase58(), reason) };
  }
  if (b.action === "release_hold") return { outcome: await release(d, actor, key(b.mint).toBase58()) };
  if (b.action === "recheck_launch") return { outcome: await recheck(d, actor, key(b.mint).toBase58()) };
  throw fail({ error: "invalid_input" });
}
