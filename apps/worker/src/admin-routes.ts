// The owner console's worker routes. Each sits behind the bearer check (http.ts) and, here, the allowlist:
// web forwards the session wallet as body.actor and the worker re-checks it against ADMIN_WALLET (D-08, D-11).
import { db } from "@bondr/core/db";
import type { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { type ActDeps, act, switchRoute } from "./admin-act.ts";
import { type AuditStore, pgAudit } from "./admin-audit.ts";
import { inspect, knownKeys } from "./admin-inspect.ts";
import { type ModStore, moderate, modReq, pgMod } from "./admin-moderate.ts";
import { adminBase, executeAction, intentView, type MoneyCtx, simulateAction } from "./admin-money.ts";
import { coinLive, overview } from "./admin-overview.ts";
import type { WorkerEnv } from "./env.ts";
import type { Engine } from "./fee-engine.ts";
import { key } from "./fee-routes.ts";
import type { FeeDeps } from "./fee-send.ts";
import { healthSnapshot } from "./health.ts";
import { fail, type Handler, Reply, type Routes } from "./http.ts";
import { landed, observe } from "./settle.ts";
import { setJob } from "./switches.ts";

// Fail closed: no ADMIN_WALLET, or any other actor, is forbidden. The handler gets the whole body, actor included,
// so it can name the actor in the audit.
export function gated(admin: string | null, h: Handler): Handler {
  return async (body) => {
    const actor = (body as { actor?: unknown } | null | undefined)?.actor;
    if (!admin || actor !== admin) throw fail({ error: "forbidden" });
    return h(body);
  };
}

// money and mod: test seams; the worker builds them from env, the engine getter, conn, pgAudit and pgMod.
export type AdminOpts = {
  env: WorkerEnv;
  engine: () => Engine | null;
  conn: Connection;
  money?: () => MoneyCtx;
  mod?: () => { store: ModStore; audit: AuditStore };
};

const TX = [
  ...["sweep_now", "retry_forced_bond", "burn_w_tokens", "run_migrate", "finalize_split"],
  ...["retry_sweep", "distribute_now", "sweep_leftovers", "burn_buyback", "evacuate"],
] as const;
const ID = /^[0-9a-f]{32}$/; // admin-intent ids: 16 random bytes in hex
const SIG = /^[A-Za-z0-9+/]{86}==$/; // exactly 64 bytes of base64
type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b ?? {}) as Body;
const invalid = () => fail({ error: "invalid_input" });

// The mint is a base58 key, and absent only for the platform actions, burn_buyback and evacuate.
function simReq(b: Body) {
  const action = TX.find((a) => a === b.action);
  if (!action) throw invalid();
  const platform = action === "burn_buyback" || action === "evacuate";
  if (platform !== (b.mint === undefined || b.mint === null)) throw invalid();
  return { actor: String(b.actor), action, mint: platform ? null : key(b.mint).toBase58() };
}
// A transaction signature: 64 bytes of base58 (87 or 88 characters, fewer only for leading zero bytes).
function sigOf(b: Body): string {
  const s = b.signature;
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s)) throw invalid();
  if (bs58.decode(s).length !== 64) throw invalid();
  return s;
}
function idOf(b: Body): string {
  if (typeof b.id !== "string" || !ID.test(b.id)) throw invalid();
  return b.id;
}
function execReq(b: Body) {
  if (typeof b.signature !== "string" || !SIG.test(b.signature)) throw invalid();
  return {
    actor: String(b.actor),
    id: idOf(b),
    signature: new Uint8Array(Buffer.from(b.signature, "base64")),
  };
}

// Built on first use (db() needs DATABASE_URL); the engine is read per call, since it starts after listen.
function moneyOf(o: AdminOpts): () => MoneyCtx {
  let base: FeeDeps | undefined;
  let audit: AuditStore | undefined;
  return () => {
    base ??= adminBase(o.env, o.conn);
    audit ??= pgAudit();
    return { deps: base, engine: o.engine(), audit, admin: o.env.adminWallet, evacuate: o.env.adminEvacuate };
  };
}

// Every route is wrapped here in one place, so no admin route can skip the gate.
export function adminRoutes(o: AdminOpts): Routes {
  // Built per call: db() needs DATABASE_URL, which a route table built in a test does not have.
  const deps = (): ActDeps => ({
    audit: pgAudit(),
    engine: o.engine,
    conn: o.conn,
    exec: db(),
    observe,
    landed,
    setJob,
  });
  const money = o.money ?? moneyOf(o);
  const mod = o.mod ?? (() => ({ store: pgMod(), audit: pgAudit() }));
  const routes: Routes = {
    "POST /admin/health": () => healthSnapshot(o),
    "POST /admin/switch": (b) => switchRoute(deps(), b),
    "POST /admin/act": (b) => act(deps(), b),
    "POST /admin/overview": () => overview(o),
    "POST /admin/coin-live": (b) => coinLive(o, b),
    "POST /admin/simulate": (b) => simulateAction(money(), simReq(bodyOf(b))),
    "POST /admin/execute": async (b) => new Reply(202, await executeAction(money(), execReq(bodyOf(b)))),
    "POST /admin/intent": async (b) => intentView(idOf(bodyOf(b))),
    "POST /admin/inspect": async (b) => {
      const sig = sigOf(bodyOf(b)); // before any RPC call
      return inspect(o.conn, sig, knownKeys(o.env, o.engine())).catch(() => {
        throw fail({ error: "rpc_failed" });
      });
    },
    "POST /admin/moderate": (b) => {
      const req = modReq(b); // before mod(): a bad body never builds a store
      const m = mod();
      return moderate(m.store, m.audit, req);
    },
  };
  return Object.fromEntries(Object.entries(routes).map(([k, h]) => [k, gated(o.env.adminWallet, h)]));
}
