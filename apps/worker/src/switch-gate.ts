// What may turn a switch on (WR-W-02). In genesis nothing does: a switch written on now would carry into
// production at the BONDR_QUOTE_MINT redeploy (D-29). On mainnet the launches switch also needs D-30 in code: a
// passing contract check and at least 100 free vanity mints (D-11). Turning a switch off is never refused.
import type { AdminJob } from "@bondr/core/api-admin";
import { db } from "@bondr/core/db";
import type { PublicKey } from "@solana/web3.js";
import { contractFailed } from "./contract-check.ts";
import type { WorkerEnv } from "./env.ts";
import { Fail } from "./http.ts";
import { poolSize } from "./vanity.ts";

export const MIN_FREE_MINTS = 100;
export type GateEnv = Pick<WorkerEnv, "net"> & { quoteMint: PublicKey | null };
export type Gate = (job: AdminJob, on: boolean) => Promise<void>;

// 409: the request is valid, the deploy is not ready for it yet. reason is what the console names.
const notReady = (reason: "genesis" | "contract_check" | "vanity_pool") =>
  new Fail(409, { error: "not_ready", reason });

export async function switchGate(
  env: GateEnv,
  job: AdminJob,
  on: boolean,
  free = () => poolSize(db()),
): Promise<void> {
  if (!on) return;
  if (env.quoteMint === null) throw notReady("genesis");
  if (job !== "launches" || env.net !== "mainnet") return;
  if (contractFailed()) throw notReady("contract_check");
  if ((await free()) < MIN_FREE_MINTS) throw notReady("vanity_pool");
}

export const gateFor =
  (env: GateEnv): Gate =>
  (job, on) =>
    switchGate(env, job, on);
