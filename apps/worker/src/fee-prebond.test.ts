// Collect, split and the window sweep (FEE-01, FEE-04, D-11, D-12, D-14) through a recording land backed by
// memoryLedger and scripted metas. No RPC: collectIxs is stubbed, the sweep ixs are the real builder's.
import {
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { windowJob } from "./fee-guard.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { collectJob, splitJob, sweepJob } from "./fee-prebond.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";

vi.mock("@bondr/core/collect", async (orig) => ({
  ...((await orig()) as object),
  collectIxs: async () => [],
}));

const Q = PublicKey.unique();
const W = Keypair.generate();
const coin: FeeCoin = {
  ...{ mint: PublicKey.unique(), w: W, launchedAt: 0, venue: "curve", feesUnclaimed: 0n, feeBudget: 0n },
  ...{ cost: null, launchSig: "launch", wallet: PublicKey.unique(), finalize: "none" },
};
const qMeta = (wDelta: bigint) => ({
  err: null,
  preTokenBalances: [],
  postTokenBalances: [
    { mint: Q.toBase58(), owner: W.publicKey.toBase58(), uiTokenAmount: { amount: String(wDelta) } },
  ],
});

type Status = { confirmationStatus: string; err: unknown } | null;
type Opts = { balance?: bigint; metas?: object[]; bondrSol?: number | null; statuses?: () => Status[] };

let jobs: Job[];
function deps(o: Opts = {}): FeeDeps {
  const ledger = memoryLedger();
  const metas = [...(o.metas ?? [])];
  let n = 0;
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), online: {}, amm: {}, ledger },
    ...{ treasury: PublicKey.unique(), buyback: Keypair.generate(), publish: () => {} },
    bondrSol: () => (o.bondrSol === undefined ? 1 : o.bondrSol),
    conn: {
      getTokenAccountBalance: vi.fn(async () => {
        if (o.balance === undefined) throw new Error("Invalid param: could not find account");
        return { value: { amount: String(o.balance) } };
      }),
      // An earlier row's chain status: an RPC error unless the test scripts one.
      getSignatureStatuses: async () => {
        if (!o.statuses) throw new Error("rpc down");
        return { value: o.statuses() };
      },
      getBlockHeight: async () => 100,
      getTransaction: async () => ({ slot: 9, meta: qMeta(2000n) }),
    },
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      const sig = `s${n++}`;
      if (!(await ledger.insertPending(job.rows, sig, 1n))) return { state: "done" };
      const meta = (metas.shift() ?? qMeta(0n)) as never;
      return { state: "landed", sig, rows: await ledger.settle(sig, "landed", { facts: job.facts?.(meta) }) };
    },
  };
  return d as unknown as FeeDeps;
}

const transfers = (job: Job | undefined) =>
  (job?.ixs ?? [])
    .filter((ix) => ix.programId.equals(T22) && ix.data.length === 10)
    .map((ix) => decodeTransferCheckedInstruction(ix, T22));
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(Q, owner, true, T22);

beforeEach(() => {
  jobs = [];
});

test("a window collects, splits a tenth of the collect's own delta, then sweeps 90/10", async () => {
  const d = deps({ metas: [qMeta(1000n)], balance: 5_000n }); // W holds more than the collect: never sizes the split
  const out = await windowJob(d, { ...coin, feesUnclaimed: 20_000n }, 3);
  expect(out.map((r) => r.state)).toEqual(["landed", "landed", "landed"]);
  const [c, s, w] = jobs;
  expect(c?.rows).toEqual([{ kind: "collect", mint: coin.mint.toBase58() }]);
  const collectId = out[0]?.rows?.[0]?.id;
  expect(s?.rows).toEqual([
    { kind: "split_treasury", mint: coin.mint.toBase58(), ref: collectId, amount: 100n },
  ]);
  expect(s?.signers).toEqual([W]);
  expect(transfers(s).map((t) => t.data.amount)).toEqual([100n]);
  expect(w?.rows.map((r) => [r.kind, r.amount, r.windowIndex])).toEqual([
    ["sweep_buyback", 4500n, 3],
    ["sweep_treasury", 500n, 3],
  ]);
});

test("fees below the minimum skip collect and split but still sweep W's balance", async () => {
  const d = deps({ balance: 1001n });
  const out = await windowJob(d, { ...coin, feesUnclaimed: 9_999n }, 0); // 9,999 lamports at 1 lamport each
  expect(out.map((r) => r.state)).toEqual(["landed"]);
  expect(jobs.map((j) => j.rows.map((r) => r.kind))).toEqual([["sweep_buyback", "sweep_treasury"]]);
});

test("an unknown BONDR price still collects any unclaimed fees", async () => {
  const d = deps({ bondrSol: null, metas: [qMeta(50n)] });
  await windowJob(d, { ...coin, feesUnclaimed: 1n }, 0);
  expect(jobs[0]?.rows[0]?.kind).toBe("collect");
});

test("a sweep of 1001 sends 901 to the buyback and 100 to the treasury in one W-signed tx", async () => {
  const d = deps({ balance: 1001n });
  expect((await sweepJob(d, coin, 2)).state).toBe("landed");
  expect(jobs).toHaveLength(1);
  const [j] = jobs;
  expect(j?.signers).toEqual([W]);
  expect(j?.urgent).toBeFalsy();
  expect(j?.rows.map((r) => [r.kind, r.amount, r.windowIndex])).toEqual([
    ["sweep_buyback", 901n, 2],
    ["sweep_treasury", 100n, 2],
  ]);
  const t = transfers(j);
  expect(t.map((x) => x.data.amount)).toEqual([901n, 100n]);
  expect(t.map((x) => x.keys.destination.pubkey.toBase58())).toEqual([
    ata(d.buyback.publicKey).toBase58(),
    ata(d.treasury).toBase58(),
  ]);
  expect(t.every((x) => x.keys.source.pubkey.equals(ata(W.publicKey)))).toBe(true);
});

test("a zero or missing W balance sweeps nothing and writes no row (D-12)", async () => {
  for (const balance of [0n, undefined]) {
    const d = deps({ balance });
    expect((await sweepJob(d, coin, 1)).state).toBe("done");
    expect(await d.ledger.pending()).toEqual([]);
  }
  expect(jobs).toEqual([]);
});

test("a split of a collect under 10 base units sends nothing", async () => {
  const d = deps();
  expect((await splitJob(d, coin, { id: 1, kind: "collect", mint: "m", amount: 9n } as never)).state).toBe(
    "done",
  );
  expect(jobs).toEqual([]);
});

test("collectJob takes its amount from W's BONDR delta in the meta", async () => {
  const d = deps({ metas: [qMeta(777n)] });
  const r = await collectJob(d, coin);
  expect(r.rows?.[0]).toMatchObject({ kind: "collect", amount: 777n, state: "landed" });
  expect(jobs[0]?.signers).toEqual([]);
});

// CR-01: W's balance still holds the treasury tenth of a collect that is pending, or whose split is.
test("a pending collect from an earlier window defers the sweep while its status is unknown", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const d = deps({ metas: [qMeta(1000n)], balance: 5_000n });
  await d.ledger.insertPending([{ kind: "collect", mint: coin.mint.toBase58() }], "old", 50n);
  const out = await windowJob(d, { ...coin, feesUnclaimed: 20_000n, open: true }, 4);
  expect(jobs.map((j) => j.rows[0]?.kind)).toEqual(["collect", "split_treasury"]); // no sweep
  expect(out.at(-1)?.state).toBe("unknown");
  expect(err.mock.calls.flat().join(" ")).toContain("balance-sized send deferred");
  err.mockRestore();
});

test("a pending collect that landed on chain is settled from its meta, split, then swept", async () => {
  const ok = { confirmationStatus: "confirmed", err: null };
  const d = deps({ balance: 5_000n, statuses: () => [ok] });
  await d.ledger.insertPending([{ kind: "collect", mint: coin.mint.toBase58() }], "old", 50n);
  const out = await windowJob(d, { ...coin, open: true }, 4);
  expect(out.map((r) => r.state)).toEqual(["landed", "landed"]);
  expect(jobs.map((j) => [j.rows[0]?.kind, j.rows[0]?.amount])).toEqual([
    ["split_treasury", 200n], // a tenth of the 2000 the old collect's own meta shows
    ["sweep_buyback", 4500n],
  ]);
});

test("a landed collect whose split is pending defers the sweep", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const d = deps({ balance: 5_000n });
  const mint = coin.mint.toBase58();
  const [c] = (await d.ledger.insertPending([{ kind: "collect", mint }], "c", 50n)) ?? [];
  await d.ledger.settle("c", "landed", { facts: { collect: { amount: 1000n } } });
  await d.ledger.insertPending([{ kind: "split_treasury", mint, ref: c?.id, amount: 100n }], "s", 50n);
  expect((await windowJob(d, { ...coin, open: true }, 4)).map((r) => r.state)).toEqual(["unknown"]);
  expect(jobs).toEqual([]);
  vi.restoreAllMocks();
});

// WR-05: N idle coins must not mean N Neon wake-ups a day.
test("an idle coin's window reads no ledger; a collect opens it and a clean guard closes it again", async () => {
  const d = deps({ metas: [qMeta(1000n)], balance: 0n });
  const reads = [vi.spyOn(d.ledger, "pendingFor"), vi.spyOn(d.ledger, "openCollects")];
  const idle = { ...coin, open: undefined }; // never collected nor flagged at boot
  await windowJob(d, idle, 1);
  expect(reads.map((r) => r.mock.calls.length)).toEqual([0, 0]);
  const busy = { ...coin, feesUnclaimed: 20_000n, open: undefined };
  await windowJob(d, busy, 1);
  expect(jobs.map((j) => j.rows[0]?.kind)).toEqual(["collect", "split_treasury"]);
  expect(reads.map((r) => r.mock.calls.length)).toEqual([1, 1]);
  expect(busy.open).toBe(false);
});
