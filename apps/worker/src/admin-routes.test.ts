// The worker's admin door (D-08, D-11): closed unless ADMIN_WALLET is set and the forwarded actor matches it.
// The money routes validate their bodies at the boundary and drive simulate, execute and the intent poll.
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { expect, test, vi } from "vitest";
import type { ActionDef } from "./admin-actions.ts";
import { memoryAudit } from "./admin-audit.ts";
import { allowFor } from "./admin-dest.ts";
import { memoryMod } from "./admin-moderate.ts";
import { adminRoutes, gated } from "./admin-routes.ts";
import type { WorkerEnv } from "./env.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import type { FeeDeps } from "./fee-send.ts";
import { Fail, Reply } from "./http.ts";

const m = vi.hoisted(() => ({ def: null as unknown }));
vi.mock("./admin-actions.ts", async (orig) => ({
  ...((await orig()) as object),
  ACTIONS: new Proxy({}, { get: () => m.def }),
  actionView: async (_d: unknown, mint: string | null) => ({
    ...{ coin: { mint }, mint, wChild: 0n, buybackBondr: 0n, costNow: null },
    ...{ failedSweep: null, pendingSweeps: [], windowSwept: false },
  }),
}));

const { privateKey } = generateKeyPairSync("ed25519");
const A = bs58.encode(
  Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x as string, "base64url"),
);
const B = Keypair.generate().publicKey.toBase58();
const MINT = PublicKey.unique().toBase58();
const OPS = Keypair.generate();
const TREASURY = PublicKey.unique();
const ok = async (body: unknown) => ({ got: body });

m.def = {
  applies: () => null,
  allow: () => allowFor({ treasury: TREASURY, internal: [], mints: [], closeTo: TREASURY }),
  watch: () => [],
  run: async (d) => [
    await d.land({
      rows: [],
      signers: [],
      ixs: [SystemProgram.transfer({ fromPubkey: OPS.publicKey, toPubkey: TREASURY, lamports: 1 })],
    }),
  ],
} satisfies ActionDef;

const deps = {
  ...{ net: "devnet", mode: "on", ops: OPS, treasury: TREASURY, ledger: memoryLedger(), publish: () => {} },
  ...{ Q: PublicKey.unique(), bondrSol: () => null },
  conn: {
    getMultipleAccountsInfo: async () => [],
    simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 1, accounts: null } }),
  },
  land: vi.fn(async () => ({ state: "landed", sig: "s1" })),
} as unknown as FeeDeps;

const envOf = (adminWallet: string | null) =>
  ({
    adminWallet,
    ...{ seed: Buffer.alloc(32, 7), net: "devnet", lane: "local" },
    feeEngine: "off",
    adminEvacuate: "simulate",
    sentryReadToken: null,
  }) as unknown as WorkerEnv;
const mod = { store: memoryMod([{ mint: MINT, symbol: "FOO", hiddenAt: null }]), audit: memoryAudit() };
const routesFor = (adminWallet: string | null) =>
  adminRoutes({
    env: envOf(adminWallet),
    engine: () => null,
    conn: {} as never,
    money: () => ({
      deps,
      engine: null,
      audit: memoryAudit(),
      admin: adminWallet,
      site: "https://trybondr.fun",
    }),
    mod: () => mod,
  });

async function status(p: Promise<unknown>, code = "forbidden"): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof Fail && e.body.error === code) return e.status;
    throw e;
  }
}

test("no admin wallet answers 403 for any body", async () => {
  expect(await status(gated(null, ok)({ actor: A }))).toBe(403);
  expect(await status(gated(null, ok)(undefined))).toBe(403);
});

test("another or a missing actor answers 403; the admin actor reaches the handler with the full body", async () => {
  expect(await status(gated(A, ok)({ actor: B }))).toBe(403);
  expect(await status(gated(A, ok)({}))).toBe(403);
  expect(await gated(A, ok)({ actor: A, x: 1 })).toEqual({ got: { actor: A, x: 1 } });
});

test("without SITE_URL, simulate and execute answer 403 before any deps are built (WR-B-03)", async () => {
  const r = adminRoutes({ env: envOf(A), engine: () => null, conn: {} as never, mod: () => mod });
  const body = { actor: A, action: "sweep_now", mint: MINT };
  expect(await status(r["POST /admin/simulate"](body))).toBe(403);
  const exec = { actor: A, id: "a".repeat(32), signature: Buffer.alloc(64).toString("base64") };
  expect(await status(r["POST /admin/execute"](exec))).toBe(403);
});

test("every admin route is a POST behind the gate", async () => {
  const routes = routesFor(A);
  const names = [
    ...["health", "switch", "act", "overview", "coin-live", "simulate", "execute", "intent", "inspect"],
    "moderate",
  ];
  expect(Object.keys(routes)).toEqual(names.map((r) => `POST /admin/${r}`));
  for (const [key, h] of Object.entries(routes)) {
    expect(key).toMatch(/^POST \/admin\//);
    expect(await status(h({ actor: B }))).toBe(403);
    expect(await status(h(undefined))).toBe(403);
  }
  for (const h of Object.values(routesFor(null))) expect(await status(h({ actor: A }))).toBe(403);
});

test("malformed money bodies answer 400 before anything runs", async () => {
  const r = routesFor(A);
  const id = "ab".repeat(16);
  const sig = Buffer.alloc(64, 1).toString("base64");
  const bad: [string, Record<string, unknown>][] = [
    ["simulate", { action: "evacuate", mint: MINT }],
    ["simulate", { action: "sweep_now" }],
    ["simulate", { action: "sweep_now", mint: "not a key" }],
    ["simulate", { action: "burn_buyback", mint: MINT }],
    ["execute", { id: "x", signature: sig }],
    ["execute", { id, signature: Buffer.alloc(63).toString("base64") }],
    ["execute", { id }],
    ["intent", { id: 7 }],
  ];
  for (const [route, body] of bad)
    expect(await status(r[`POST /admin/${route}`]({ actor: A, ...body }), "invalid_input")).toBe(400);
  expect(deps.land).not.toHaveBeenCalled();
});

test("simulate accepts evacuate only with mint null and reaches the money path", async () => {
  const r = routesFor(A);
  const sim = await r["POST /admin/simulate"]({ actor: A, action: "evacuate", mint: null });
  expect(sim).toMatchObject({ action: "evacuate", mint: null, nothing: true });
  expect(
    await status(r["POST /admin/simulate"]({ actor: A, action: "evacuate", mint: MINT }), "invalid_input"),
  ).toBe(400);
});

test("simulate then execute through the route map answers 202 and the intent reads landed", async () => {
  const r = routesFor(A);
  const sim = (await r["POST /admin/simulate"]({ actor: A, action: "sweep_now", mint: MINT })) as {
    intent: { id: string; message: string };
  };
  const signature = sign(null, Buffer.from(sim.intent.message), privateKey).toString("base64");
  const res = await r["POST /admin/execute"]({ actor: A, id: sim.intent.id, signature });
  expect(res).toBeInstanceOf(Reply);
  expect(res).toMatchObject({ status: 202, body: { id: sim.intent.id } });
  const view = () => r["POST /admin/intent"]({ actor: A, id: sim.intent.id });
  await vi.waitFor(async () => expect(await view()).toMatchObject({ state: "landed", landed: 1, total: 1 }));
  expect(await status(r["POST /admin/intent"]({ actor: A, id: "cd".repeat(16) }), "not_found")).toBe(404);
});

test("moderate refuses a bad op or an over-length field with 400 and touches nothing; a good body hides", async () => {
  const r = routesFor(A)["POST /admin/moderate"];
  const bad = [
    { op: "drop" },
    { op: "hide", query: "FOO", reason: "x".repeat(201) },
    { op: "block", wallet: 1 },
  ];
  for (const body of bad) expect(await status(r({ actor: A, ...body }), "invalid_input")).toBe(400);
  expect(mod.audit.rows).toHaveLength(0);
  expect(mod.store.coins[0]?.hiddenAt).toBeNull();
  expect(await r({ actor: A, op: "hide", query: "foo", reason: "spam" })).toEqual({ ok: true });
  expect(mod.audit.rows.map((x) => [x.actor, x.action, x.mint])).toEqual([[A, "hide", MINT]]);
});

test("inspect answers 400 for a non-signature before any RPC call, found false when missing, 503 when the RPC fails", async () => {
  const sig = bs58.encode(Buffer.alloc(64, 1));
  const at = (getTransaction: () => Promise<unknown>) =>
    adminRoutes({ env: envOf(A), engine: () => null, conn: { getTransaction } as never })[
      "POST /admin/inspect"
    ];
  const missing = vi.fn(async () => null);
  const bad = [undefined, 5, "abc", bs58.encode(Buffer.alloc(32, 1)), `${sig}0`, "z".repeat(88)];
  for (const signature of bad)
    expect(await status(at(missing)({ actor: A, signature }), "invalid_input")).toBe(400);
  expect(missing).not.toHaveBeenCalled();
  expect(await at(missing)({ actor: A, signature: sig })).toEqual({ found: false });
  const down = at(async () => {
    throw new Error("socket hang up");
  });
  expect(await status(down({ actor: A, signature: sig }), "rpc_failed")).toBe(503);
});
