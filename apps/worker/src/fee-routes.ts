// Owner routes of the fee engine, behind the worker's bearer check (http.ts). Phase 6 puts a UI on them.
import { redact } from "@bondr/core/net";
import { PublicKey } from "@solana/web3.js";
import { batchNow } from "./fee-batch.ts";
import type { Engine } from "./fee-engine.ts";
import { fail, type Routes } from "./http.ts";

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function key(v: unknown): PublicKey {
  if (typeof v !== "string" || !BASE58_KEY.test(v)) throw fail({ error: "invalid_input" });
  try {
    return new PublicKey(v);
  } catch {
    throw fail({ error: "invalid_input" });
  }
}

// D-18, Open Question 5: the owner names the deployer of a held coin after a manual check. The engine then
// runs one finalize with it, re-checking only that it is distinct from treasury and W and on curve.
async function release(engine: Pick<Engine, "release"> | null, body: unknown): Promise<{ ok: true }> {
  const b = (body ?? {}) as { mint?: unknown; deployer?: unknown };
  const [mint, deployer] = [key(b.mint), key(b.deployer)];
  if (!PublicKey.isOnCurve(deployer.toBytes())) throw fail({ error: "invalid_input" });
  if (!engine?.release(mint.toBase58(), deployer)) throw fail({ error: "invalid_input" });
  console.log(redact(`fee release ${mint.toBase58()}`));
  return { ok: true };
}

// The engine starts after the server listens, so routes read it when called.
export const feeRoutes = (engine: () => Pick<Engine, "release"> | null): Routes => ({
  "POST /fee/release": (body) => release(engine(), body),
  // Runs the daily batch now (the e2e and the owner); a run already going is shared, not doubled.
  "POST /fee/batch": () => batchNow() ?? Promise.reject(fail({ error: "paused" })),
});
