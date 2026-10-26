// The daily batch (FEE-06, FEE-07, FEE-09, D-13, D-19, D-20, D-21): the buyback burn, the distribution crank,
// finalize retries, the ops-floor pause, the batch hour, the single-flight route and the reconciliation. No RPC: chain reads are stubbed and land
// records each job against a memoryLedger.
import { BN, PUMP_AMM_SDK, PUMP_SDK } from "@bondr/core/pump";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { type AccountInfo, Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buybackBurnJob, distributeJob, nextBatchAt, runBatch, scheduleBatch } from "./fee-batch.ts";
import type { NewEntry } from "./fee-ledger.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { impliedOf, reconcile } from "./fee-reconcile.ts";
import { feeRoutes } from "./fee-routes.ts";
import { type FeeCoin, type FeeDeps, type Job, type Landed, noteOps } from "./fee-send.ts";

const burns = vi.hoisted(() => ({ bonded: [] as string[] }));
vi.mock("./fee-burns.ts", () => ({
  bondedJob: async (_d: unknown, coin: { mint: { toBase58(): string } }) => {
    burns.bonded.push(coin.mint.toBase58());
    return [{ state: "landed" }];
  },
}));
vi.mock("@bondr/core/sharing", async (orig) => ({
  ...((await orig()) as object),
  distributeIxs: async () => [],
}));

const Q = PublicKey.unique();
const DEV = Keypair.generate().publicKey;
const TREASURY = Keypair.generate().publicKey;

// A Token-2022 account body for getMultipleAccountsInfo stubs.
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
  return { data, owner: T22, lamports: 1, executable: false };
}
const raw = (): AccountInfo<Buffer> => ({
  data: Buffer.alloc(8),
  owner: T22,
  lamports: 1,
  executable: false,
});

const coinOf = (o: Partial<FeeCoin> = {}): FeeCoin => ({
  ...{ mint: PublicKey.unique(), w: Keypair.generate(), launchedAt: 0, venue: "pool", feesUnclaimed: 0n },
  ...{ feeBudget: 0n, cost: null, launchSig: "l", wallet: DEV, finalize: "done" },
  ...o,
});

const tokenMeta = (deltas: [PublicKey, bigint][]) => {
  const at = (post: boolean) =>
    deltas.map(([owner, x]) => ({
      ...{ mint: Q.toBase58(), owner: owner.toBase58() },
      uiTokenAmount: { amount: String(post ? 1000n + x : 1000n) },
    }));
  return { err: null, preTokenBalances: at(false), postTokenBalances: at(true) };
};

let jobs: Job[];
type Opts = { buyback?: string | null; accounts?: (AccountInfo<Buffer> | null)[]; meta?: object };
function deps(o: Opts = {}, conn: object = {}) {
  const ledger = memoryLedger();
  const reads = o.accounts ? [o.accounts] : []; // the first multi-account read only (distribute's)
  let n = 0;
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), ledger, windowMs: 60_000 },
    ...{ treasury: TREASURY, buyback: Keypair.generate(), publish: () => {}, bondrSol: () => 1 },
    conn: {
      getTokenAccountBalance: async () => {
        if (o.buyback === null) throw new Error("could not find account");
        return { value: { amount: o.buyback ?? "0" } };
      },
      getMultipleAccountsInfo: async (keys: PublicKey[]) => reads.shift() ?? keys.map(() => null),
      ...conn,
    },
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      const sig = `s${n++}`;
      if (!(await ledger.insertPending(job.rows, sig, 1n))) return { state: "done" };
      const rows = await ledger.settle(sig, "landed", { facts: job.facts?.((o.meta ?? {}) as never) });
      return { state: "landed", sig, rows };
    },
  };
  return d as unknown as FeeDeps;
}

const kinds = () => jobs.map((j) => j.rows.map((r) => r.kind).join("+"));

beforeEach(() => {
  jobs = [];
  burns.bonded = [];
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => noteOps(10 ** 9, "devnet"));

test("buybackBurnJob: nothing at 0 or a missing ATA; the whole balance burns in one buyback_burn row", async () => {
  expect((await buybackBurnJob(deps({ buyback: "0" }))).state).toBe("done");
  expect((await buybackBurnJob(deps({ buyback: null }))).state).toBe("done");
  expect(jobs).toHaveLength(0);
  const d = deps({ buyback: "5000000" });
  const out = await buybackBurnJob(d);
  expect(out.state).toBe("landed");
  expect(kinds()).toEqual(["buyback_burn"]);
  const [job] = jobs;
  expect(job?.rows[0]).toMatchObject({
    kind: "buyback_burn",
    mint: null,
    amount: 5_000_000n,
    burned: 5_000_000n,
  });
  expect(job?.signers).toEqual([d.buyback]);
  expect(job?.urgent).toBeFalsy();
  expect(job?.ixs).toHaveLength(1);
  expect(job?.ixs[0]?.programId.equals(T22)).toBe(true);
});

function sharing(pending: bigint) {
  vi.spyOn(PUMP_AMM_SDK, "decodePool").mockReturnValue({ creatorFees: new BN(String(pending)) } as never);
  vi.spyOn(PUMP_SDK, "decodeSharingConfig").mockReturnValue({
    ...{ version: 1, mint: PublicKey.default, admin: PublicKey.default, adminRevoked: true },
    shareholders: [
      { address: DEV, shareBps: 8000 },
      { address: TREASURY, shareBps: 2000 },
    ],
  });
}

test("distributeJob: pending is the pool bucket plus both vault ATAs; below the minimum it sends nothing", async () => {
  sharing(100_000n);
  const calls: number[] = [];
  const accounts = [raw(), tokenAccount(20_000n), tokenAccount(30_000n), raw()];
  const conn = {
    getMultipleAccountsInfo: async (keys: PublicKey[]) => calls.push(keys.length) && accounts,
  };
  expect((await distributeJob(deps({}, conn), coinOf())).state).toBe("done");
  expect(calls).toEqual([4]); // one read: pool, AMM vault ATA, pump vault ATA, sharing config
  expect(jobs).toHaveLength(0);
});

test("distributeJob: above the minimum, one distribute row with the meta deltas and the shares", async () => {
  sharing(1_000_000n);
  const meta = tokenMeta([
    [DEV, 800_000n],
    [TREASURY, 200_000n],
  ]);
  const d = deps({ accounts: [raw(), null, null, raw()], meta });
  const out = await distributeJob(d, coinOf());
  expect(out.state).toBe("landed");
  expect(kinds()).toEqual(["distribute"]);
  expect(jobs[0]?.signers).toEqual([]);
  expect(out.rows?.[0]?.detail).toEqual({
    ...{ deployerAmount: "800000", treasuryAmount: "200000", dBps: 8000, tBps: 2000 },
    ...{ deployer: DEV.toBase58(), treasury: TREASURY.toBase58() },
  });
});

test("distributeJob: no sharing config yet sends nothing", async () => {
  expect((await distributeJob(deps({ accounts: [raw(), null, null, null] }), coinOf())).state).toBe("done");
  expect(jobs).toEqual([]);
});

const engineOf = (coins: FeeCoin[]) => {
  const keys: string[] = [];
  return {
    keys,
    coins: new Map(coins.map((c) => [c.mint.toBase58(), c])),
    busy: () => false,
    enqueue: async (mint: string, job: () => Promise<unknown>) => {
      keys.push(mint);
      await job();
    },
  };
};

test("runBatch: burn, distributions, finalize retries, then one reconcile read, each on its coin's queue", async () => {
  sharing(1_000_000n);
  const [done, retry, curve, held] = [
    coinOf(),
    coinOf({ finalize: "none" }),
    coinOf({ venue: "curve", finalize: "none" }),
    coinOf({ finalize: "held" }),
  ];
  const d = deps({ buyback: "7", accounts: [raw(), null, null, raw()] });
  const implied = vi.spyOn(d.ledger, "implied");
  const e = engineOf([done, retry, curve, held]);
  const s = await runBatch(d, e);
  expect(kinds()).toEqual(["buyback_burn", "distribute"]);
  expect(burns.bonded).toEqual([retry.mint.toBase58()]);
  expect(e.keys).toEqual(["platform", done.mint.toBase58(), retry.mint.toBase58()]);
  expect(implied).toHaveBeenCalledTimes(1);
  expect(s).toMatchObject({ opsLow: false, burn: "landed", distribute: 1, finalize: 1 });
});

test("runBatch: below the ops floor it skips every send but still reconciles", async () => {
  noteOps(0, "devnet");
  const d = deps({ buyback: "7" });
  const implied = vi.spyOn(d.ledger, "implied");
  const s = await runBatch(d, engineOf([coinOf(), coinOf({ finalize: "none" })]));
  expect(jobs).toHaveLength(0);
  expect(burns.bonded).toEqual([]);
  expect(implied).toHaveBeenCalledTimes(1);
  expect(s).toMatchObject({ opsLow: true, burn: "skipped", distribute: 0, finalize: 0 });
});

test("nextBatchAt: today at the hour when before it, else tomorrow", () => {
  const at = (iso: string) => Date.parse(iso);
  expect(nextBatchAt(at("2026-10-25T03:59:00Z"), 4)).toBe(at("2026-10-25T04:00:00Z"));
  expect(nextBatchAt(at("2026-10-25T04:00:00Z"), 4)).toBe(at("2026-10-26T04:00:00Z"));
  expect(nextBatchAt(at("2026-10-25T23:00:00Z"), 4)).toBe(at("2026-10-26T04:00:00Z"));
});

test("POST /fee/batch: refused before the engine starts; then one run, shared while in flight", async () => {
  const routes = feeRoutes(() => null);
  await expect(routes["POST /fee/batch"]?.(null)).rejects.toMatchObject({ status: 409 });
  const d = deps({ buyback: "0" });
  scheduleBatch(d, engineOf([]), 4);
  const implied = vi.spyOn(d.ledger, "implied");
  const [a, b] = [routes["POST /fee/batch"]?.(null), routes["POST /fee/batch"]?.(null)];
  expect(a).toBe(b);
  expect(await a).toMatchObject({ opsLow: false, burn: "done" });
  expect(implied).toHaveBeenCalledTimes(1);
});

const ataOf = (owner: PublicKey) => getAssociatedTokenAddressSync(Q, owner, true, T22).toBase58();

// Chain balances by ATA address; every multi-account read's size is kept.
function chain(amounts: Record<string, bigint>, calls: number[]) {
  return {
    getMultipleAccountsInfo: async (keys: PublicKey[]) => {
      calls.push(keys.length);
      return keys.map((k) => (k.toBase58() in amounts ? tokenAccount(amounts[k.toBase58()] ?? 0n) : null));
    },
  };
}

async function landRows(d: FeeDeps, rows: NewEntry[]): Promise<void> {
  for (const [i, r] of rows.entries()) {
    await d.ledger.insertPending([r], `r${i}${r.kind}${r.mint}`, 1n);
    await d.ledger.settle(`r${i}${r.kind}${r.mint}`, "landed");
  }
}

const row = (kind: NewEntry["kind"], mint: string, amount: bigint, o: Partial<NewEntry> = {}) => ({
  ...{ kind, mint, amount, ...o },
  state: "landed",
});
const window = (m: string) => [
  ...[row("collect", m, 1000n), row("split_treasury", m, 100n, { ref: 1 })],
  ...[row("sweep_buyback", m, 810n, { windowIndex: 0 }), row("sweep_treasury", m, 90n, { windowIndex: 0 })],
];

test("impliedOf: a full window nets W to 0; the buyback keeps its sweeps minus its burns", () => {
  const burn = { kind: "buyback_burn", mint: null, burned: 800n, state: "landed" } as const;
  const i = impliedOf([...window("M"), { ...row("collect", "M", 7n), state: "failed" }, burn]);
  expect(i.byMint.get("M")).toBe(0n);
  expect(i.buyback).toBe(10n);
});

test("reconcile: an exact match writes nothing; a W off by 5 writes one reconcile_diff and an error", async () => {
  const coin = coinOf();
  const mint = coin.mint.toBase58();
  for (const w of [0n, 5n]) {
    const d = deps();
    Object.assign(d.conn, chain({ [ataOf(coin.w.publicKey)]: w, [ataOf(d.buyback.publicKey)]: 810n }, []));
    await landRows(d, window(mint));
    const diff = vi.spyOn(d.ledger, "diff");
    expect(await reconcile(d, new Map([[mint, coin]]))).toEqual({ accounts: 2, diffs: Number(w) / 5 });
    if (w === 0n) expect(diff).not.toHaveBeenCalled();
    else expect(diff).toHaveBeenCalledWith(mint, { implied: "0", chain: "5", diff: "5" });
  }
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("reconcile diff"));
});

test("reconcile: chain reads go 100 accounts per call and nothing is ever sent", async () => {
  const coins = Array.from({ length: 150 }, () => coinOf());
  const calls: number[] = [];
  const d = deps({}, chain({}, calls));
  await landRows(
    d,
    coins.map((c) => row("collect", c.mint.toBase58(), 1n)),
  );
  const s = await reconcile(d, new Map(coins.map((c) => [c.mint.toBase58(), c])));
  expect(calls).toEqual([100, 51]);
  expect(s).toEqual({ accounts: 151, diffs: 150 });
  expect(jobs).toHaveLength(0);
});
