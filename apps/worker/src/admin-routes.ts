// The owner console's worker routes. Each sits behind the bearer check (http.ts) and, here, the allowlist:
// web forwards the session wallet as body.actor and the worker re-checks it against ADMIN_WALLET (D-08, D-11).
import type { Connection } from "@solana/web3.js";
import type { WorkerEnv } from "./env.ts";
import type { Engine } from "./fee-engine.ts";
import { bootAt, instance } from "./health.ts";
import { fail, type Handler, type Routes } from "./http.ts";

// Fail closed: no ADMIN_WALLET, or any other actor, is forbidden. The handler gets the whole body, actor included,
// so it can name the actor in the audit.
export function gated(admin: string | null, h: Handler): Handler {
  return async (body) => {
    const actor = (body as { actor?: unknown } | null | undefined)?.actor;
    if (!admin || actor !== admin) throw fail({ error: "forbidden" });
    return h(body);
  };
}

export type AdminOpts = { env: WorkerEnv; engine: () => Engine | null; conn: Connection };

// Every route is wrapped here in one place, so no admin route can skip the gate.
export function adminRoutes(o: AdminOpts): Routes {
  const routes: Routes = {
    "POST /admin/health": async () => ({ bootAt, instance }),
  };
  return Object.fromEntries(Object.entries(routes).map(([k, h]) => [k, gated(o.env.adminWallet, h)]));
}
