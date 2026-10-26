// The admin money path as the console drives it, for the fork stage (D-12, D-14, D-33): simulate, the owner
// signs the stored intent message, execute, then poll the intent until it leaves "sending". The worker's own
// admin-money.ts runs every step, with the fork deps, an in-memory audit and the fork's admin key.
import { createPrivateKey, sign } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { AdminBalanceRow, AdminIntentView, AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";
import { COIN_DECIMALS } from "@bondr/core/launch";
import { type Keypair, PublicKey } from "@solana/web3.js";
import { memoryAudit } from "../../../apps/worker/src/admin-audit.ts";
import {
  executeAction,
  intentView,
  type MoneyCtx,
  simulateAction,
} from "../../../apps/worker/src/admin-money.ts";
import type { Engine } from "../../../apps/worker/src/fee-engine.ts";
import type { Entry } from "../../../apps/worker/src/fee-ledger.ts";
import type { FeeCoin } from "../../../apps/worker/src/fee-send.ts";
import type { Row } from "../results.ts";
import { createChild, type Run } from "./bond.ts";
import { feeDeps } from "./engine-bond.ts";
import type { F } from "./engine-final.ts";

type Facts = NonNullable<Row["facts"]>;
export type A = F & {
  money: MoneyCtx & { audit: ReturnType<typeof memoryAudit> };
  admin: Keypair;
  settled: Entry[]; // every ledger row as it settled, so a row's sig and burned come from the ledger
};
export type Act = { sim: AdminSimResult; view: AdminIntentView; audit: string };

const POLL_MS = 500;
const POLL_CAP_MS = 60_000;
const DECIMALS: Record<AdminBalanceRow["unit"], number> = { SOL: 9, BONDR: 6, tokens: COIN_DECIMALS, bps: 0 };

// The fork runs no engine: this one holds the coin, so actionView never reads Postgres, and runs admin work
// inline as an idle queue would.
const engineOf = (coin: FeeCoin) =>
  ({
    coin: (mint: string) => (mint === coin.mint.toBase58() ? coin : undefined),
    exclusive: <T>(_mint: string, fn: () => Promise<T>) => fn(),
  }) as unknown as Engine;

// A fresh child AD, launched by the sim dev (its recorded deployer, D-15), held by the stage as the indexer would.
export async function adminRun(run: Run): Promise<A> {
  const { mint, W } = await createChild(run, "aux.admin.create", "AD");
  const s = run.ctx.file.state;
  s["AD.dev"] = run.ctx.key("sim", "dev").publicKey.toBase58();
  const coin: FeeCoin = {
    ...{ mint, w: W, launchedAt: Date.now(), venue: "curve", feesUnclaimed: 0n, feeBudget: 0n, cost: null },
    ...{ launchSig: run.ctx.file.rows.find((r) => r.id === "aux.admin.create")?.sig ?? "" },
    ...{ wallet: new PublicKey(s["AD.dev"]), finalize: "none" },
  };
  const d = feeDeps(run);
  const settled: Entry[] = [];
  const base = d.ledger;
  d.ledger = {
    ...base,
    settle: async (...a) => {
      const out = await base.settle(...a);
      settled.push(...out);
      return out;
    },
  };
  const admin = run.ctx.key("sim", "admin");
  const money = {
    ...{ deps: d, engine: engineOf(coin), audit: memoryAudit(), admin: admin.publicKey.toBase58() },
    site: "https://fork.bondr.test", // any origin: the stage signs the intent text as given
  };
  return { ...run, d, coin, money, admin, settled };
}

// The same ed25519 that admin-intent.ts verifies with (node:crypto), as a wallet's signMessage would sign.
function signWith(k: Keypair, message: string): Uint8Array {
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
  const jwk = { kty: "OKP", crv: "Ed25519", d: b64(k.secretKey.slice(0, 32)), x: b64(k.publicKey.toBytes()) };
  return sign(null, Buffer.from(message, "utf8"), createPrivateKey({ key: jwk, format: "jwk" }));
}

async function finished(id: string): Promise<AdminIntentView> {
  for (const end = Date.now() + POLL_CAP_MS; Date.now() < end; await sleep(POLL_MS)) {
    const v = intentView(id);
    if (v.state !== "sending") return v;
  }
  throw new Error(`intent ${id} still sending after ${POLL_CAP_MS / 1000} s`);
}

// audit is "landed" only when the action's audit row settled landed with exactly the intent's signatures.
export async function act(a: A, action: AdminTxAction): Promise<Act> {
  const actor = a.admin.publicKey.toBase58();
  const sim = await simulateAction(a.money, { actor, action, mint: a.coin.mint.toBase58() });
  if (!sim.intent || !sim.destinations.ok)
    throw new Error(`${action} simulate: ${sim.error ?? (sim.nothing ? "nothing" : "destinations refused")}`);
  const signature = signWith(a.admin, sim.intent.message);
  const { id } = await executeAction(a.money, { actor, id: sim.intent.id, signature });
  const view = await finished(id);
  const row = a.money.audit.rows.at(-1);
  const same = !!row && view.sigs.length > 0 && row.sigs.join() === view.sigs.join();
  return { sim, view, audit: same ? row.result : `${row?.result ?? "missing"}, sigs differ` };
}

// The preview's change column back to base units, by admin-sim's own decimals: "−1.5" BONDR -> -1500000n.
export function simChange(sim: AdminSimResult, prefix: string, unit: AdminBalanceRow["unit"]): bigint {
  const row = sim.balances.find((b) => b.name.startsWith(prefix) && b.unit === unit);
  if (!row) throw new Error(`no ${prefix} ${unit} row in the simulation`);
  const [int = "0", frac = ""] = row.change.replace(/^[+−]/, "").split(".");
  const v = BigInt(int + frac.padEnd(DECIMALS[unit], "0"));
  return row.change.startsWith("−") ? -v : v;
}

export const entryOf = (a: A, kind: Entry["kind"]) => a.settled.find((e) => e.kind === kind);

// One row per action. A step whose intent or audit did not land records, then stops the stage.
export function recordAct(a: A, id: string, step: string, r: Act, sig: string | null | undefined, f: Facts) {
  const ok = r.view.state === "landed" && r.audit === "landed";
  a.ctx.record({
    ...{ id, step, ok, sig: sig ?? r.view.sigs.at(-1) },
    facts: { ...f, intent: r.view.state, audit: r.audit, txs: r.view.sigs.length, cu: r.sim.cu },
    ...(r.view.code ? { err: r.view.code } : {}),
  });
  if (!ok) throw new Error(`${id}: intent ${r.view.state} ${r.view.code ?? ""}, audit ${r.audit}`);
}
