// The simulate-then-sign money path (ADMIN-01, ADMIN-04, ADMIN-10, D-12, D-14, D-33): a send needs a passing
// simulation, an allowed destination set and a fresh owner signature, and its audit row is written first. The
// action registry is faked with one transfer job, so every refusal can be shown to send nothing.
import { createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { beforeEach, expect, test, vi } from "vitest";
import type { ActionDef } from "./admin-actions.ts";
import { memoryAudit } from "./admin-audit.ts";
import { allowFor } from "./admin-dest.ts";
import { executeAction, intentView, type MoneyCtx, simulateAction } from "./admin-money.ts";
import { gatedDeps } from "./admin-send.ts";
import type { Engine } from "./fee-engine.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { settled } from "./fee-prebond.ts";
import type { FeeDeps, Landed } from "./fee-send.ts";
import { Fail } from "./http.ts";

const m = vi.hoisted(() => ({ def: null as unknown, mint: null as string | null }));
vi.mock("./switches.ts", () => ({ pauseAll: vi.fn(async () => {}) }));
vi.mock("@bondr/core/send", async (orig) => ({ ...((await orig()) as object), pace: async () => {} }));
vi.mock("./admin-actions.ts", async (orig) => ({
  ...((await orig()) as object),
  ACTIONS: new Proxy({}, { get: () => m.def }),
  actionView: async (_d: unknown, mint: string | null) => ({
    ...{ coin: mint ? { mint } : null, mint, wChild: 0n, buybackBondr: 0n, costNow: null },
    ...{ failedSweep: null, pendingSweeps: [] },
  }),
}));

function account() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const x = createPublicKey(privateKey).export({ format: "jwk" }).x as string;
  return { wallet: bs58.encode(Buffer.from(x, "base64url")), key: privateKey };
}
const admin = account();
const stranger = account();
const signText = (text: string, key: KeyObject = admin.key) =>
  new Uint8Array(sign(null, Buffer.from(text), key));

const Q = PublicKey.unique();
const OPS = Keypair.generate();
const W = Keypair.generate();
const TREASURY = PublicKey.unique();
const STRANGER = PublicKey.unique();
const MINT = PublicKey.unique().toBase58();

let reasons: (string | null)[];
let sends: PublicKey[];
let outcomes: Landed[];
let simErr: unknown;
let order: string[];
let base: FeeDeps;
let audit: ReturnType<typeof memoryAudit>;
let clock: number;
let ctx: MoneyCtx;

const transfer = (to: PublicKey) =>
  SystemProgram.transfer({ fromPubkey: OPS.publicKey, toPubkey: to, lamports: 1 });
m.def = {
  applies: () => reasons.shift() ?? null,
  allow: () => allowFor({ treasury: TREASURY, internal: [W.publicKey], mints: [Q], closeTo: TREASURY }),
  watch: (_v, d) => [{ address: d.ops.publicKey, name: "Ops wallet", kind: "sol", unit: "SOL" }],
  run: async (d) => {
    const out: Landed[] = [];
    for (const to of sends) {
      const r = await d.land({ rows: [], ixs: [transfer(to)], signers: [] });
      out.push(r);
      if (!settled(r)) break;
    }
    return out;
  },
} satisfies ActionDef;

let n = 0;
beforeEach(() => {
  [reasons, sends, outcomes, simErr, order] = [[], [TREASURY], [], null, []];
  clock = Date.now();
  audit = memoryAudit();
  const insert = audit.insertPending;
  audit.insertPending = (r) => {
    order.push("audit");
    return insert(r);
  };
  const conn = {
    getMultipleAccountsInfo: async (keys: PublicKey[]) =>
      keys.map(() => ({ lamports: 1_000_000_000, data: Buffer.alloc(0), owner: SystemProgram.programId })),
    simulateTransaction: async () => ({ value: { err: simErr, unitsConsumed: 5_000, accounts: null } }),
  };
  base = {
    ...{ net: "devnet", mode: "on", Q, ops: OPS, treasury: TREASURY, buyback: Keypair.generate() },
    ...{ ledger: memoryLedger(), windowMs: 1000, bondrSol: () => 1, allowed: () => false, conn },
    publish: vi.fn(),
    land: vi.fn(async () => {
      order.push("land");
      return outcomes.shift() ?? { state: "landed", sig: `sig${++n}` };
    }),
  } as unknown as FeeDeps;
  ctx = {
    deps: base,
    engine: null,
    audit,
    admin: admin.wallet,
    site: "https://trybondr.fun",
    now: () => clock,
  };
});

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof Fail) return `${e.body.error} ${e.status}${e.body.reason ? ` ${e.body.reason}` : ""}`;
    throw e;
  }
}

const simulate = (mint: string | null = MINT) =>
  simulateAction(ctx, { actor: admin.wallet, action: mint ? "sweep_now" : "burn_buyback", mint });

async function ready(mint: string | null = MINT) {
  const r = await simulate(mint);
  if (!r.intent) throw new Error("expected an intent");
  return { id: r.intent.id, signature: signText(r.intent.message) };
}

async function finished(id: string) {
  await vi.waitFor(() => expect(intentView(id).state).not.toBe("sending"));
  return intentView(id);
}

test("a coin the action does not apply to answers not_applicable with the reason and sends nothing", async () => {
  reasons = ["not_curve"];
  expect(await refusal(simulate())).toBe("not_applicable 409 not_curve");
  expect(base.land).not.toHaveBeenCalled();
});

test("a passing simulation returns the intent message and never sends, audits or publishes", async () => {
  const r = await simulate();
  expect(r).toMatchObject({ ok: true, nothing: false, steps: [{ ok: true, cu: 5_000, estimated: false }] });
  expect(r.destinations).toEqual({ ok: true, passed: ["treasury matches config"] });
  expect(r.balances.map((b) => b.name)).toEqual(["Ops wallet"]);
  const msg = r.intent?.message ?? "";
  for (const part of ["BONDR admin action", "sweep_now", MINT, r.intent?.id ?? "?", TREASURY.toBase58()])
    expect(msg).toContain(part);
  expect(msg).not.toContain(W.publicKey.toBase58());
  expect(base.land).not.toHaveBeenCalled();
  expect(base.publish).not.toHaveBeenCalled();
  expect(audit.rows).toEqual([]);
});

test("an outflow outside the allowlist refuses the destinations and gives no intent", async () => {
  sends = [TREASURY, STRANGER];
  const r = await simulate();
  expect(r.destinations).toEqual({ ok: false, refused: STRANGER.toBase58() });
  expect(r.intent).toBeUndefined();
});

test("a failed first step maps to a contract code; a job with nothing to send gives no intent", async () => {
  simErr = { InstructionError: [0, { Custom: 1 }] };
  const failed = await simulate();
  expect(failed).toMatchObject({ ok: false, error: "insufficient_balance" });
  expect(failed.intent).toBeUndefined();
  simErr = null;
  sends = [];
  const none = await simulate();
  expect(none).toMatchObject({ nothing: true });
  expect(none.intent).toBeUndefined();
});

test("execute refuses another key's signature, an expired intent and a second use, with no audit row", async () => {
  const a = await ready();
  const wrong = { actor: admin.wallet, id: a.id, signature: signText("x", stranger.key) };
  expect(await refusal(executeAction(ctx, wrong))).toBe("bad_intent_signature 403");
  expect(audit.rows).toEqual([]);
  expect(await executeAction(ctx, { actor: admin.wallet, ...a })).toEqual({ id: a.id });
  expect(await refusal(executeAction(ctx, { actor: admin.wallet, ...a }))).toBe("intent_used 409");
  await finished(a.id);
  expect(audit.rows).toHaveLength(1);
  const b = await ready();
  clock += 120_000;
  expect(await refusal(executeAction(ctx, { actor: admin.wallet, ...b }))).toBe("intent_expired 410");
  expect(audit.rows).toHaveLength(1);
});

test("execute writes the pending audit row before the first send, lands, then settles it once", async () => {
  sends = [TREASURY, W.publicKey];
  const a = await ready();
  await executeAction(ctx, { actor: admin.wallet, ...a });
  const v = await finished(a.id);
  expect(v).toMatchObject({ state: "landed", landed: 2, total: 2 });
  expect(order).toEqual(["audit", "land", "land"]);
  const [row] = audit.rows;
  expect(row).toMatchObject({ actor: admin.wallet, action: "sweep_now", mint: MINT, result: "landed" });
  expect(row?.params).toEqual({ intent: a.id });
  expect(row?.sigs).toEqual(v.sigs);
  expect(row?.intentSig).toBe(Buffer.from(a.signature).toString("base64"));
  expect(Object.keys(row?.simulation ?? {}).sort()).toEqual([
    "balances",
    "cu",
    "destinations",
    "feeLamports",
    "ok",
  ]);
});

test("a state change since simulate settles the audit refused and sends nothing", async () => {
  reasons = [null, "not_curve"];
  const a = await ready();
  expect(await refusal(executeAction(ctx, { actor: admin.wallet, ...a }))).toBe(
    "not_applicable 409 not_curve",
  );
  expect(audit.rows[0]).toMatchObject({ result: "refused", error: "not_applicable" });
  expect(intentView(a.id).state).toBe("refused");
  expect(base.land).not.toHaveBeenCalled();
});

test("the gated land never sends to a stranger: the audit and the intent read refused", async () => {
  const a = await ready();
  sends = [STRANGER];
  await executeAction(ctx, { actor: admin.wallet, ...a });
  expect(await finished(a.id)).toMatchObject({ state: "refused", code: "destination_refused" });
  expect(audit.rows[0]).toMatchObject({ result: "refused", error: "destination_refused" });
  expect(base.land).not.toHaveBeenCalled();

  const refused: string[] = [];
  const allowed = allowFor({ treasury: TREASURY, internal: [], mints: [Q], closeTo: TREASURY });
  const d = gatedDeps(base, allowed, (to) => refused.push(to));
  expect(await d.land({ rows: [], ixs: [transfer(STRANGER)], signers: [] })).toEqual({ state: "skipped" });
  expect(refused).toEqual([STRANGER.toBase58()]);
  expect(d.allowed?.("sweeps", null)).toBe(true);
  expect(base.land).not.toHaveBeenCalled();
});

test("an unknown outcome settles failed unconfirmed, reads unknown and is never resent", async () => {
  sends = [TREASURY, W.publicKey];
  outcomes = [{ state: "unknown", sig: "u1" }];
  const a = await ready();
  await executeAction(ctx, { actor: admin.wallet, ...a });
  expect(await finished(a.id)).toMatchObject({ state: "unknown", sigs: ["u1"] });
  expect(audit.rows[0]).toMatchObject({ result: "failed", error: "unconfirmed", sigs: ["u1"] });
  expect(base.land).toHaveBeenCalledTimes(1);
});

test("with an engine the run goes through its queue for the mint, or platform for burn_buyback", async () => {
  const exclusive = vi.fn((_mint: string, fn: () => Promise<unknown>) => fn());
  ctx.engine = { exclusive } as unknown as Engine;
  const coin = await ready();
  await executeAction(ctx, { actor: admin.wallet, ...coin });
  await finished(coin.id);
  const platform = await ready(null);
  await executeAction(ctx, { actor: admin.wallet, ...platform });
  await finished(platform.id);
  expect(exclusive.mock.calls.map(([mint]) => mint)).toEqual([MINT, "platform"]);
});

// Evacuate (06-22) dispatches with mint null; its two W hold only SOL here, so one batch of system transfers.
const evacuate = () => simulateAction(ctx, { actor: admin.wallet, action: "evacuate", mint: null });
function evacuateCtx(evacuate: "simulate" | "on") {
  const coins = [Keypair.generate(), Keypair.generate()].map((w) => ({ mint: PublicKey.unique(), w }));
  const sol = { lamports: 7_000, data: Buffer.alloc(0), owner: SystemProgram.programId };
  const read = async (keys: PublicKey[]) => keys.map((_, i) => (i % 3 ? null : sol));
  base = { ...base, conn: { ...(base.conn as object), getMultipleAccountsInfo: read } } as unknown as FeeDeps;
  ctx = { ...ctx, deps: base, evacuate, coins: async () => coins };
}
async function evacuateIntent() {
  const r = await evacuate();
  if (!r.intent) throw new Error("expected an intent");
  return { actor: admin.wallet, id: r.intent.id, signature: signText(r.intent.message) };
}

test("evacuate in simulate mode returns totals and no intent, so nothing can execute", async () => {
  evacuateCtx("simulate");
  const r = await evacuate();
  expect(r).toMatchObject({ action: "evacuate", mint: null, ok: true, totals: { wallets: 2, sol: "14000" } });
  expect(r.intent).toBeUndefined();
  expect(base.land).not.toHaveBeenCalled();
});

test("evacuate on devnet: the signed intent audits first with params wallets, then pauses and lands", async () => {
  evacuateCtx("on");
  const req = await evacuateIntent();
  expect(await executeAction(ctx, req)).toEqual({ id: req.id });
  expect(await finished(req.id)).toMatchObject({ state: "landed", moved: 2, failed: 0 });
  expect(order).toEqual(["audit", "land"]);
  const row = { action: "evacuate", mint: null, params: { wallets: 2 }, result: "landed" };
  expect(audit.rows[0]).toMatchObject(row);
  expect(audit.rows[0]?.simulation).toHaveProperty("totals.wallets", 2);
});

test("an evacuate intent refuses at execute once the mode is back to simulate, with no audit row", async () => {
  evacuateCtx("on");
  const req = await evacuateIntent();
  ctx.evacuate = "simulate";
  expect(await refusal(executeAction(ctx, req))).toBe("not_applicable 409 simulate_only");
  expect(audit.rows).toEqual([]);
  expect(intentView(req.id).state).toBe("refused");
});
