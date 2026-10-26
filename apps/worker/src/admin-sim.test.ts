// Simulate-first (D-04, D-12, Pattern 2): the capture deps simulate each job tx instead of sending it. The base
// deps throw on land, publish and every ledger write, so a passing test proves nothing was sent or written.
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import {
  type AccountInfo,
  Keypair,
  PublicKey,
  SystemProgram,
  type VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, expect, test } from "vitest";
import { balanceRows, captureDeps, type Step, simSummary, simulateJob, type Watched } from "./admin-sim.ts";
import { windowJob } from "./fee-guard.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { type FeeCoin, type FeeDeps, type Job, noteOps } from "./fee-send.ts";

const Q = PublicKey.unique();
const OPS = Keypair.generate();
const W = Keypair.generate();
const BUYBACK = Keypair.generate();
const TREASURY = PublicKey.unique();
const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);
const W_ATA = ataOf(Q, W.publicKey);
const BUYBACK_ATA = ataOf(Q, BUYBACK.publicKey);

function tokenAccount(amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      ...{ mint: Q, owner: PublicKey.default, amount, delegateOption: 0, delegate: PublicKey.default },
      ...{ state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0 },
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner: T22, lamports: 2_039_280, executable: false };
}
const solAccount = (lamports: number): AccountInfo<Buffer> => ({
  ...{ data: Buffer.alloc(0), owner: SystemProgram.programId, lamports, executable: false },
});
const simAccount = (a: AccountInfo<Buffer> | null) =>
  a && { ...a, owner: a.owner.toBase58(), data: [a.data.toString("base64"), "base64"] };

const WATCH: Watched = [
  { address: OPS.publicKey, name: "Ops wallet", kind: "sol", unit: "SOL" },
  { address: BUYBACK_ATA, name: "Buyback", kind: "token", unit: "BONDR" },
  { address: W_ATA, name: "W", kind: "token", unit: "BONDR" },
];

let pre: Map<string, AccountInfo<Buffer>>;
let post: (AccountInfo<Buffer> | null)[];
let simErr: unknown;
let sims: { tx: VersionedTransaction; opts: Record<string, unknown> }[];
const boom = (what: string) => () => {
  throw new Error(`${what} must never run in a simulation`);
};

function setup(): FeeDeps {
  const ledger = memoryLedger();
  for (const k of ["insertPending", "settle", "hold", "release", "markFinal", "diff"] as const)
    (ledger as Record<string, unknown>)[k] = boom(`ledger.${k}`);
  const conn = {
    getLatestBlockhash: async () => ({ blockhash: PublicKey.unique().toBase58(), lastValidBlockHeight: 9 }),
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => pre.get(k.toBase58()) ?? null),
    getTokenAccountBalance: async () => ({ value: { amount: "1000000" } }),
    simulateTransaction: async (tx: VersionedTransaction, opts: Record<string, unknown>) => {
      sims.push({ tx, opts });
      return { value: { err: simErr, unitsConsumed: 12_345, logs: [], accounts: post.map(simAccount) } };
    },
  };
  return {
    ...{
      net: "devnet",
      mode: "on",
      Q,
      ops: OPS,
      treasury: TREASURY,
      buyback: BUYBACK,
      ledger,
      windowMs: 1000,
    },
    ...{ conn: conn as never, bondrSol: () => 1, allowed: () => false },
    publish: boom("publish"),
    land: boom("land"),
  } as unknown as FeeDeps;
}

const transferJob = (cu?: number): Job => ({
  rows: [{ kind: "collect", mint: "m" }],
  ixs: [SystemProgram.transfer({ fromPubkey: W.publicKey, toPubkey: TREASURY, lamports: 1 })],
  signers: [W],
  cu,
});

beforeEach(() => {
  pre = new Map([
    [OPS.publicKey.toBase58(), solAccount(1_000_000_000)],
    [BUYBACK_ATA.toBase58(), tokenAccount(0n)],
    [W_ATA.toBase58(), tokenAccount(1_000_000n)],
  ]);
  post = [solAccount(999_990_000), tokenAccount(900_000n), null];
  simErr = null;
  sims = [];
});

test("land simulates once with the watched accounts, records a step and never sends or writes", async () => {
  const sink: Step[] = [];
  const d = captureDeps(setup(), sink, WATCH);
  expect(d.mode).toBe("dry");
  expect(d.allowed?.("sweeps", null)).toBe(true);
  await expect(d.land(transferJob())).resolves.toEqual({ state: "dry" });
  expect(sims).toHaveLength(1);
  expect(sims[0]?.opts).toMatchObject({
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: WATCH.map((w) => w.address.toBase58()) },
  });
  expect(sink).toHaveLength(1);
  expect(sink[0]?.ixs).toHaveLength(1);
  d.publish("m", []);
  expect(() => d.ledger.settle("s", "landed")).toThrow(/write the fee ledger \(settle\)/);
  await expect(d.ledger.pending()).resolves.toEqual([]);
});

test("below the ops floor a non-urgent step previews as ops_low and stops, like base land (CR-W-01)", async () => {
  noteOps(0);
  try {
    const sink: Step[] = [];
    const d = captureDeps(setup(), sink, WATCH);
    await expect(d.land(transferJob())).resolves.toEqual({ state: "skipped" });
    expect(sink[0]).toMatchObject({ ok: false, err: "ops_low", post: sink[0]?.pre });
    await expect(d.land({ ...transferJob(), urgent: true })).resolves.toEqual({ state: "dry" });
    expect(sink[1]?.ok).toBe(true);
  } finally {
    noteOps(1_000_000_000);
  }
});

test("windowJob through the capture deps leaves the engine's coin untouched", async () => {
  const live: FeeCoin = {
    ...{ mint: PublicKey.unique(), w: W, launchedAt: 0, venue: "curve", feesUnclaimed: 0n, feeBudget: 0n },
    ...{ cost: null, launchSig: "l", wallet: PublicKey.unique(), finalize: "none", open: true },
  };
  const sink: Step[] = [];
  const out = await windowJob(captureDeps(setup(), sink, WATCH), { ...live }, 3);
  expect(out.map((l) => l.state)).toEqual(["dry"]); // the switch is off on the base deps: admin bypasses it
  expect(sink).toHaveLength(1);
  expect(live).toMatchObject({ open: true, finalize: "none" });
  expect(live.notReady).toBeUndefined();
});

test("simulateJob reads SOL by lamports, tokens by amount and a closed account as 0", async () => {
  const s = await simulateJob(setup(), transferJob(), WATCH);
  expect(s).toMatchObject({ ok: true, cu: 12_345, err: null });
  expect(s.pre).toEqual([1_000_000_000n, 0n, 1_000_000n]);
  expect(s.post).toEqual([999_990_000n, 900_000n, 0n]);
});

test("a failed simulation keeps the pre balances and reports the error", async () => {
  simErr = { InstructionError: [2, { Custom: 6009 }] };
  const s = await simulateJob(setup(), transferJob(), WATCH);
  expect(s.ok).toBe(false);
  expect(s.err).toContain("6009");
  expect(s.post).toEqual(s.pre);
});

test("the fee is 5000 per required signature plus the priority price of the CU limit", async () => {
  expect((await simulateJob(setup(), transferJob(200_000), WATCH)).feeLamports).toBe(10_200n);
  expect((await simulateJob(setup(), transferJob(), WATCH)).feeLamports).toBe(10_400n);
});

const step = (o: Partial<Step>): Step => ({
  ...{ ok: true, cu: 1000, err: null, feeLamports: 5000n, pre: [], post: [], ixs: [] },
  ...o,
});

test("balanceRows sums each account's change across steps and signs it", () => {
  const steps = [
    step({ pre: [1_000_000_000n, 0n, 1_000_000n], post: [999_990_000n, 900_000n, 1_000_000n] }),
    step({ pre: [1_000_000_000n, 0n, 1_000_000n], post: [999_995_000n, 0n, 1_000_000n] }),
  ];
  expect(balanceRows(steps, WATCH)).toEqual([
    { name: "Ops wallet", unit: "SOL", before: "1", after: "0.999985", change: "−0.000015" },
    { name: "Buyback", unit: "BONDR", before: "0", after: "0.9", change: "+0.9" },
    { name: "W", unit: "BONDR", before: "1", after: "1", change: "0" },
  ]);
  expect(balanceRows([], WATCH)).toEqual([]);
});

const passed = { ok: true as const, passed: ["burn only"] };

test("simSummary: the first step is authoritative and later steps are estimated", () => {
  const two = [step({ cu: 100 }), step({ ok: false, cu: null, err: "no config" })];
  const r = simSummary("finalize_split", "m", two, passed, WATCH);
  expect(r).toMatchObject({ action: "finalize_split", mint: "m", ok: true, nothing: false, cu: 100 });
  expect(r.feeLamports).toBe("10000");
  expect(r.steps).toEqual([
    { ok: true, cu: 100, estimated: false },
    { ok: false, cu: null, estimated: true },
  ]);
  expect(r.error).toBeUndefined();
  const failed = simSummary("sweep_now", "m", [step({ ok: false, err: "x" }), step({})], passed, WATCH);
  expect(failed).toMatchObject({ ok: false, error: "x" });
});

test("simSummary with zero steps sends nothing and claims nothing", () => {
  const r = simSummary("burn_buyback", null, [], passed, WATCH);
  expect(r).toMatchObject({ ok: false, nothing: true, steps: [], cu: 0, feeLamports: "0", balances: [] });
});
