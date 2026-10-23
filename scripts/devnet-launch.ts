// Devnet driver for the launch flow. In-process, no HTTP: it calls the worker's own modules with the sim dev
// (derive(seed, "sim", net, "dev")) as the wallet. Every run refuses below the ops floor, prints the ops and
// sim dev balances before and after, and exits 1 when the run's ops spend exceeds its budget.
//   --size-only     both exits with max-length fields against an in-memory table; sends nothing, no table
//   --fund          tops the sim dev up from ops; the devnet e2e groups run this in beforeAll
//   --prepare-only  prepare insta burn, then insta sell for the same wallet; asserts the same mint and table
//   (no flag)       insta burn, then insta sell: prepare, sign slot 0 as the dev (Phantom's role), submit, settle
//   --tamper        prepare, sign, flip one message byte, submit: asserts cosign_refused and nothing sent
// Run: VANITY_THREADS=0 node --env-file=.env scripts/devnet-launch.ts --prepare-only
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { memoryTable } from "@bondr/core/alt";
import { signatureOf } from "@bondr/core/cosign";
import { close, db, wallets } from "@bondr/core/db";
import { derive } from "@bondr/core/keys";
import type { LaunchOpts } from "@bondr/core/launch";
import { connect, redact } from "@bondr/core/net";
import { BN, OnlinePumpSdk } from "@bondr/core/pump";
import { fetchTx, messageSize, sendTx } from "@bondr/core/send";
import {
  type Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { TERMS_VERSION } from "../apps/web/lib/terms.ts";
import { compileLaunch, unionTableKeys } from "../apps/worker/src/build.ts";
import { loadEnv, ops } from "../apps/worker/src/env.ts";
import { Fail } from "../apps/worker/src/http.ts";
import { getLaunch, type LaunchRow } from "../apps/worker/src/launches.ts";
import { type PrepareCtx, prepare } from "../apps/worker/src/prepare.ts";
import { LAUNCH_CU_LIMIT, liveStatus } from "../apps/worker/src/status.ts";
import { submit } from "../apps/worker/src/submit.ts";
import { assertLanded } from "./devnet-checks.ts";

// Derived, not flat. Ops held 2.917 SOL at phase start. The phase plans about 0.28 SOL of ops spend: 7
// per-coin tables at about 0.006 each (1 for the 02-11 prepare, 3 for the 02-12 two launches plus tamper,
// 1 for the 02-13 devnet e2e, 1 for the 02-17 staging launch, 1 for the 02-18 owner launch: about 0.042)
// plus up to 4 sim dev top-ups of 0.06, and 0.22 SOL of margin for reruns. Under 2.40 the phase overspent:
// ask the owner before any more devnet spend.
export const OPS_FLOOR_SOL = 2.4;
// Ops spend per run, not counting the sim dev top-up (recorded separately as "funded").
export const RUN_BUDGET_SOL = {
  "size-only": 0,
  fund: 0.06,
  "prepare-only": 0.01,
  launch: 0.03,
  tamper: 0.01,
};
type Mode = keyof typeof RUN_BUDGET_SOL;
// A sim dev launch costs about 0.03 SOL of its own balance (create rent, the minimum dev buy, fees).
const SIM_LOW = 0.03 * LAMPORTS_PER_SOL;
const SIM_TARGET = 0.06 * LAMPORTS_PER_SOL;
const MAX_FIELDS = {
  name: "N".repeat(32),
  symbol: "S".repeat(13),
  uri: `https://ipfs.io/ipfs/${"b".repeat(59)}`,
};
// Placeholder metadata: prepare only builds and simulates, so nothing is pinned for it.
const CID = `bafkrei${"a".repeat(52)}`;

const sol = (lamports: number): string => (lamports / LAMPORTS_PER_SOL).toFixed(6);
const simDev = (seed: Buffer): Keypair => derive(seed, "sim", "devnet", "dev");

// Tops the sim dev up to 0.06 SOL when it holds under 0.03, in one transfer. Returns the lamports sent.
export async function fundSimDev(conn: Connection, seed: Buffer): Promise<number> {
  const [payer, dev] = [ops(seed, "devnet"), simDev(seed).publicKey];
  const have = await conn.getBalance(dev);
  if (have >= SIM_LOW) return 0;
  const need = SIM_TARGET - have;
  if ((await conn.getBalance(payer.publicKey)) - need < OPS_FLOOR_SOL * LAMPORTS_PER_SOL)
    throw new Error("funding the sim dev would take ops under the floor");
  const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: dev, lamports: need });
  const r = await sendTx({ conn, payer, ixs: [ix], paceMs: 1100 });
  if (!r.ok) throw new Error(`sim dev top-up ${r.status}: ${r.err ?? ""}`);
  return need;
}

async function sizeOnly(ctx: PrepareCtx): Promise<void> {
  const status = await liveStatus(ctx);
  const mint = Keypair.generate().publicKey;
  const o: LaunchOpts = {
    ...{ ...MAX_FIELDS, online: ctx.online, Q: ctx.Q, mint, exit: "burn", cuLimit: LAUNCH_CU_LIMIT },
    W: derive(ctx.env.seed, "w", "devnet", mint.toBase58()).publicKey,
    dev: simDev(ctx.env.seed).publicKey,
    solIn: new BN(status.minLamports ?? "2500000"),
    priorityFee: ctx.priorityFee,
  };
  const { keys, builds } = await unionTableKeys(o);
  const table = memoryTable(keys);
  for (const exit of ["burn", "sell"] as const) {
    const msg = compileLaunch({ ...o, exit }, builds[exit].ixs, table, PublicKey.default.toBase58());
    console.log(`size insta ${exit}: ${messageSize(msg)} bytes (max fields, ${keys.length} table keys)`);
  }
}

// The sim dev's consent row and a request at the live minimum dev buy.
async function baseRequest(ctx: PrepareCtx, name: string, symbol: string) {
  const wallet = simDev(ctx.env.seed).publicKey.toBase58();
  const consentedAt = new Date();
  await db()
    .insert(wallets)
    .values({ address: wallet, consentedAt, termsVersion: TERMS_VERSION })
    .onConflictDoUpdate({ target: wallets.address, set: { consentedAt, termsVersion: TERMS_VERSION } });
  const solIn = (await liveStatus(ctx)).minLamports ?? "2500000";
  return { wallet, name, symbol, links: {}, solIn, uri: `https://ipfs.io/ipfs/${CID}`, imageCid: CID };
}

async function prepareOnly(ctx: PrepareCtx): Promise<void> {
  const base = await baseRequest(ctx, "BONDR devnet prepare", "BPREP");
  const runs = [];
  for (const exit of ["burn", "sell"] as const) {
    const t0 = Date.now();
    const r = await prepare(ctx, { ...base, exit });
    const ms = Date.now() - t0;
    const table = (await getLaunch(db(), r.launchId))?.lookupTable;
    console.log(
      `prepare insta ${exit}: ${JSON.stringify({ ...r, tx: `${r.tx.length} b64 chars`, table, ms })}`,
    );
    runs.push({ mint: r.mint, table });
  }
  const [a, b] = runs;
  if (!a?.mint.endsWith("bndr")) throw new Error(`mint ${a?.mint} does not end in bndr`);
  if (a.mint !== b?.mint || a.table !== b.table)
    throw new Error("second prepare did not reuse mint and table");
  console.log(`reuse ok: mint ${a.mint}, table ${a.table}`);
}

// Phantom's role: sign slot 0 of the prepared wire with the dev key, nothing else.
function signAsDev(tx: string, dev: Keypair): Uint8Array {
  const vtx = VersionedTransaction.deserialize(Buffer.from(tx, "base64"));
  vtx.sign([dev]);
  return vtx.serialize();
}

const b64 = (wire: Uint8Array): string => Buffer.from(wire).toString("base64");

// Settle runs in the background of this process; wait for landed with facts, or failed (60 s cap).
async function settled(id: string): Promise<LaunchRow> {
  for (let i = 0; i < 60; i++) {
    const row = await getLaunch(db(), id);
    if (row && ((row.state === "landed" && row.facts) || row.state === "failed")) return row;
    await delay(1000);
  }
  throw new Error(`launch ${id} did not settle in 60 s`);
}

async function launchBoth(ctx: PrepareCtx): Promise<void> {
  const stamp = Date.now().toString(36);
  for (const exit of ["burn", "sell"] as const) {
    const base = await baseRequest(ctx, `BONDR ${exit} ${stamp}`, exit === "burn" ? "BBURN" : "BSELL");
    const r = await prepare(ctx, { ...base, exit });
    console.log(
      `prepared ${exit}: ${r.launchId} mint ${r.mint}, ${r.bytes} bytes, preview ${JSON.stringify(r.preview)}`,
    );
    const signed = signAsDev(r.tx, simDev(ctx.env.seed));
    const s = await submit(ctx, { launchId: r.launchId, signed: b64(signed) });
    console.log(`submitted ${exit}: ${JSON.stringify(s)}`);
    const row = await settled(r.launchId);
    const tx = row.signature ? await fetchTx(ctx.conn, row.signature) : undefined;
    console.log(
      `settled ${exit}: ${row.state} ${row.error ?? ""} facts ${JSON.stringify(row.facts)} cu ${tx?.meta.computeUnitsConsumed}`,
    );
    await assertLanded(ctx, row);
  }
}

async function tamper(ctx: PrepareCtx): Promise<void> {
  const base = await baseRequest(ctx, `BONDR tamper ${Date.now().toString(36)}`, "BTAMP");
  const r = await prepare(ctx, { ...base, exit: "burn" });
  const wire = signAsDev(r.tx, simDev(ctx.env.seed));
  wire[wire.length - 10] ^= 1; // inside the message section, after the dev signed it
  const sig = signatureOf(wire);
  const e = await submit(ctx, { launchId: r.launchId, signed: b64(wire) }).then(
    () => null,
    (x: unknown) => x,
  );
  const row = await getLaunch(db(), r.launchId);
  console.log(
    `tamper ${r.launchId}: ${e instanceof Fail ? `${e.status} ${e.body.error}` : "accepted"}, row ${row?.state} ${row?.error}`,
  );
  if (!(e instanceof Fail) || e.body.error !== "cosign_refused")
    throw new Error("tampered wire was not refused");
  if (row?.state !== "failed" || row.error !== "cosign_refused")
    throw new Error("row not failed cosign_refused");
  await delay(5000);
  const st = await ctx.conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
  if (st.value[0]) throw new Error(`signature ${sig} was seen on chain`);
  console.log(`not sent: ${sig} has no status after 5 s`);
}

function modeOf(): Mode {
  const flag = { type: "boolean" } as const;
  const options = { "size-only": flag, fund: flag, "prepare-only": flag, tamper: flag };
  const set = Object.entries(parseArgs({ options }).values).flatMap(([k, v]) => (v ? [k] : []));
  if (set.length > 1) throw new Error("pass at most one of --size-only, --fund, --prepare-only, --tamper");
  return (set[0] ?? "launch") as Mode;
}

async function balances(conn: Connection, seed: Buffer) {
  const [o, d] = [ops(seed, "devnet").publicKey, simDev(seed).publicKey];
  const [opsL, devL] = await Promise.all([conn.getBalance(o), conn.getBalance(d)]);
  return { ops: opsL, dev: devL };
}

async function main(): Promise<void> {
  const mode = modeOf();
  const env = loadEnv();
  if (env.net !== "devnet") throw new Error("devnet only");
  const conn = await connect(env.net);
  const ctx: PrepareCtx = {
    conn,
    online: new OnlinePumpSdk(conn),
    Q: env.quoteMint,
    priorityFee: env.priorityFee,
    env,
  };
  const before = await balances(conn, env.seed);
  console.log(`before: ops ${sol(before.ops)} SOL, sim dev ${sol(before.dev)} SOL`);
  if (before.ops < OPS_FLOOR_SOL * LAMPORTS_PER_SOL)
    throw new Error(`ops under the ${OPS_FLOOR_SOL} SOL floor: ask the owner before more devnet spend`);
  const funded = mode === "size-only" ? 0 : await fundSimDev(conn, env.seed);
  if (mode === "size-only") await sizeOnly(ctx);
  if (mode === "prepare-only") await prepareOnly(ctx);
  if (mode === "launch") await launchBoth(ctx);
  if (mode === "tamper") await tamper(ctx);
  const after = await balances(conn, env.seed);
  const spend = before.ops - after.ops - funded;
  console.log(`after: ops ${sol(after.ops)} SOL, sim dev ${sol(after.dev)} SOL`);
  console.log(
    `funded ${sol(funded)} SOL; run spend ${sol(spend)} SOL of a ${RUN_BUDGET_SOL[mode]} SOL budget`,
  );
  if (spend > RUN_BUDGET_SOL[mode] * LAMPORTS_PER_SOL) throw new Error("run spend over budget");
}

if (import.meta.main)
  main()
    .catch((e: unknown) => {
      console.error(`devnet-launch failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exitCode = 1;
    })
    .finally(() => close());
