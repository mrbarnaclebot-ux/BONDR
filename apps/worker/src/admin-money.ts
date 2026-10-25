// The simulate-then-sign money path (ADMIN-01, ADMIN-04, ADMIN-10, D-12, D-14, D-33). simulate runs the action's
// real job through capture deps, checks every outflow against the action's allowlist and only then stores an
// intent. execute needs the owner's fresh signature over that intent (verified here, so a leaked WORKER_TOKEN
// alone moves nothing), writes the pending audit row before anything is sent, and runs the job once more through
// deps whose land re-checks each tx's destinations. Nothing is resent: an unknown result stays unknown.
import type { AdminIntentView, AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";
import { OnlinePumpSdk } from "@bondr/core/pump";
import type { Connection } from "@solana/web3.js";
import { ACTIONS, type ActionDef, type ActionView, actionView, runOn } from "./admin-actions.ts";
import type { AuditStore } from "./admin-audit.ts";
import { type Allowed, passedLines, refusedDestination } from "./admin-dest.ts";
import type { EvacCoin } from "./admin-evacuate.ts";
import { type Intent, putIntent, take, updateIntent, viewIntent } from "./admin-intent.ts";
import { codeOf, gatedDeps, logged, outcome, progress } from "./admin-send.ts";
import { captureDeps, type Step, simSummary } from "./admin-sim.ts";
import type { WorkerEnv } from "./env.ts";
import { feeDeps } from "./fee-boot.ts";
import type { Engine } from "./fee-engine.ts";
import type { FeeDeps, Landed } from "./fee-send.ts";
import { Fail, fail } from "./http.ts";

export type MoneyCtx = {
  deps: FeeDeps;
  engine: Engine | null;
  audit: AuditStore;
  admin: string | null; // injectable, so the fork stage signs with its test key
  now?: () => number;
  evacuate?: "simulate" | "on"; // ADMIN_EVACUATE; absent means simulate only (A2)
  coins?: () => Promise<EvacCoin[]>; // EVACUATE's coin list; absent reads every coin of this seed
};
type SimReq = { actor: string; action: AdminTxAction; mint: string | null };
type ExecReq = { actor: string; id: string; signature: Uint8Array };
type IntentData = { allowed: Allowed; summary: AdminSimResult };
type Run = { def: ActionDef; view: ActionView; allowed: Allowed; auditId: string };

const clock = (c: MoneyCtx) => (c.now ?? Date.now)();

// A1 (Claude's discretion, owner may override): admin actions send in every engine mode with the Postgres
// ledger; the engine flag governs automation only, so a recovery still works with automation off.
export function adminBase(env: WorkerEnv, conn: Connection): FeeDeps {
  const online = new OnlinePumpSdk(conn);
  return feeDeps({ conn, online, Q: env.quoteMint, priorityFee: env.priorityFee }, env, "on");
}

// Evacuate has no registry entry (06-22), so an intent for it can never reach a job.
function defOf(action: AdminTxAction): ActionDef {
  const def = (ACTIONS as Partial<Record<AdminTxAction, ActionDef>>)[action];
  if (!def) throw fail({ error: "not_applicable", reason: "unknown_action" });
  return def;
}

async function viewOf(ctx: MoneyCtx, mint: string | null): Promise<ActionView> {
  const view = await actionView(ctx.deps, mint, ctx.engine);
  if (mint && !view.coin) throw fail({ error: "not_found" });
  return view;
}

// What the owner signs: each named destination with its full address; the coin's own W is an internal move.
const named = (a: Allowed) =>
  [...a.owners].filter(([, n]) => !n.startsWith("W ")).map(([k, n]) => `${n.split(" ")[0]} ${k}`);

export async function simulateAction(ctx: MoneyCtx, req: SimReq): Promise<AdminSimResult> {
  const def = defOf(req.action);
  const view = await viewOf(ctx, req.mint);
  const reason = def.applies(view);
  if (reason) throw fail({ error: "not_applicable", reason });
  const [allowed, watch] = [def.allow(view, ctx.deps), def.watch(view, ctx.deps)];
  const steps: Step[] = [];
  // A shallow coin copy: jobs mutate open, finalize and notReady even in dry mode.
  await def.run(captureDeps(ctx.deps, steps, watch), { ...view, coin: view.coin && { ...view.coin } });
  const refused = steps.map((s) => refusedDestination(s.ixs, allowed)).find((r) => r !== null);
  const dest: AdminSimResult["destinations"] = refused
    ? { ok: false, refused }
    : { ok: true, passed: passedLines(allowed) };
  const sum = simSummary(req.action, req.mint, steps, dest, watch);
  if (sum.error) sum.error = codeOf(sum.error);
  if (!sum.ok || sum.nothing || !dest.ok) return sum;
  const data: IntentData = { allowed, summary: sum };
  const e = putIntent({ action: req.action, mint: req.mint, to: named(allowed), data }, clock(ctx));
  return { ...sum, intent: { id: e.id, message: e.message, expiresAt: e.expiresAt } };
}

// The audit keeps the verdict the owner saw, not the intent or its message.
function trimmed(s: AdminSimResult): Record<string, unknown> {
  const { ok, cu, feeLamports, balances, destinations } = s;
  return { ok, cu, feeLamports, balances, destinations };
}

// D-33: the pending row goes in before anything is sent; a failed write throws and the action stops. The
// coin's state is read again, and a change since simulate refuses with nothing sent (T-06-13-05).
async function begin(ctx: MoneyCtx, e: Intent, req: ExecReq): Promise<Run> {
  const def = defOf(e.action);
  const view = await viewOf(ctx, e.mint);
  const { allowed, summary } = e.data as IntentData;
  const auditId = await ctx.audit.insertPending({
    ...{ actor: req.actor, action: e.action, mint: e.mint, params: { intent: e.id } },
    ...{ simulation: trimmed(summary), intentSig: Buffer.from(req.signature).toString("base64") },
  });
  const reason = def.applies(view);
  if (reason) {
    await ctx.audit.settle(auditId, "refused", { error: "not_applicable" });
    throw fail({ error: "not_applicable", reason });
  }
  return { def, view, allowed, auditId };
}

// Answers once the signature, the re-check and the audit row are in; the send continues in the background and
// the browser polls intentView.
export async function executeAction(ctx: MoneyCtx, req: ExecReq): Promise<{ id: string }> {
  if (!ctx.admin) throw fail({ error: "forbidden" });
  const e = take(req.id, req.signature, ctx.admin, clock(ctx));
  let run: Run;
  try {
    run = await begin(ctx, e, req);
  } catch (err) {
    const code = err instanceof Fail ? err.body.error : "build_failed";
    updateIntent(e.id, { state: code === "not_applicable" ? "refused" : "failed", code }, clock(ctx));
    throw err;
  }
  void send(ctx, e, run).catch(logged(e.action));
  return { id: e.id };
}

// Pitfall 9: on the coin's queue when the engine runs, so it never overlaps the coin's automatic jobs.
async function send(ctx: MoneyCtx, e: Intent, r: Run): Promise<void> {
  const seen: Landed[] = [];
  let refused: string | null = null;
  const recorded: FeeDeps = {
    ...ctx.deps,
    land: async (job) => {
      const l = await ctx.deps.land(job);
      seen.push(l);
      updateIntent(e.id, progress(seen), clock(ctx));
      return l;
    },
  };
  const d = gatedDeps(recorded, r.allowed, (to) => {
    refused ??= to;
  });
  let threw = false;
  try {
    await runOn(ctx.engine, e.mint, () => r.def.run(d, r.view));
  } catch (err) {
    threw = true;
    logged(e.action)(err);
  }
  const out = outcome(seen, refused, threw);
  const p = progress(seen);
  updateIntent(e.id, { ...p, state: out.state, ...(out.error && { code: out.error }) }, clock(ctx));
  await ctx.audit.settle(r.auditId, out.result, { sigs: p.sigs, ...(out.error && { error: out.error }) });
}

export function intentView(id: string): AdminIntentView {
  const v = viewIntent(id);
  if (!v) throw fail({ error: "not_found" });
  return v;
}
