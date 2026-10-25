// Boot recovery (D-08) over memoryLedger and a scripted connection: settle from chain status only, never send.
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import { type Entry, memoryLedger } from "./fee-ledger.ts";
import { recover, recoverAction } from "./fee-recover.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";

const at = { height: 100, lastValid: 150, rechecks: 0 };
const past = { ...at, height: 151 };

test("recoverAction maps settle's nextState to ledger actions", () => {
  expect(recoverAction({ ...at, seen: { confirmed: true, err: null } })).toEqual({ to: "landed" });
  const err = { InstructionError: [0, { Custom: 1 }] };
  expect(recoverAction({ ...past, seen: { confirmed: true, err } })).toEqual({
    to: "failed",
    error: `onchain ${JSON.stringify(err)}`,
  });
  expect(recoverAction({ ...at, seen: null })).toEqual({ to: "poll" });
  expect(recoverAction({ ...past, seen: null })).toEqual({ to: "recheck" });
  expect(recoverAction({ ...past, rechecks: 3, seen: null })).toEqual({ to: "expired", error: "expired" });
  expect(recoverAction({ ...past, seen: null, rpcError: true })).toEqual({ to: "pending" });
  expect(recoverAction({ ...at, seen: null, rpcError: true })).toEqual({ to: "pending" });
});

const Q = PublicKey.unique();
const W = Keypair.generate();
const MINT = PublicKey.unique();
const coin: FeeCoin = {
  ...{ mint: MINT, w: W, launchedAt: 0, venue: "curve", feesUnclaimed: 5n, feeBudget: 0n },
  ...{ cost: null, launchSig: "launch", wallet: PublicKey.unique(), finalize: "none" },
};
const coinOf = (m: string) => (m === MINT.toBase58() ? coin : undefined);
const meta = (wDelta: bigint) => ({
  err: null,
  preTokenBalances: [],
  postTokenBalances: [
    { mint: Q.toBase58(), owner: W.publicKey.toBase58(), uiTokenAmount: { amount: String(wDelta) } },
  ],
  postBalances: [1e9],
});

type Status = { confirmationStatus: string; err: unknown } | null;
function deps(statuses: (sigs: string[]) => Status[], height = 100) {
  const ledger = memoryLedger();
  const jobs: Job[] = [];
  const published: Entry[][] = [];
  const conn = {
    getSignatureStatuses: vi.fn(async (sigs: string[], _o: unknown) => ({ value: statuses(sigs) })),
    getBlockHeight: vi.fn(async () => height),
    getTransaction: vi.fn(async () => ({ slot: 9, meta: meta(1000n) })),
  };
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), ledger, conn, bondrSol: () => null },
    treasury: PublicKey.unique(),
    publish: (_m: string | null, rows: Entry[]) => published.push(rows),
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      return { state: "landed" };
    },
  };
  return { d: d as unknown as FeeDeps, ledger, conn, jobs, published };
}

const mint = MINT.toBase58();
const ok = { confirmationStatus: "confirmed", err: null };

test("recover settles three signatures from one status call, then splits the landed collect", async () => {
  const byS: Record<string, Status> = {
    a: ok,
    b: { confirmationStatus: "confirmed", err: { InstructionError: [0, "x"] } },
    c: ok,
  };
  const t = deps((sigs) => sigs.map((s) => byS[s] ?? null));
  await t.ledger.insertPending([{ kind: "collect", mint }], "a", 150n);
  await t.ledger.insertPending([{ kind: "sweep_buyback", mint, amount: 9n, windowIndex: 1 }], "b", 150n);
  await t.ledger.insertPending([{ kind: "sweep_treasury", mint, amount: 1n, windowIndex: 2 }], "c", 150n);
  await recover(t.d, coinOf, async () => {});
  expect(t.conn.getSignatureStatuses).toHaveBeenCalledTimes(1);
  expect(t.conn.getSignatureStatuses.mock.calls[0]).toEqual([
    ["a", "b", "c"],
    { searchTransactionHistory: true },
  ]);
  expect(await t.ledger.pending()).toEqual([]);
  const open = await t.ledger.openCollects();
  expect(open.map((e) => [e.kind, e.amount])).toEqual([["collect", 1000n]]);
  expect(t.jobs.map((j) => j.rows[0]?.kind)).toEqual(["split_treasury"]);
  expect(t.jobs[0]?.rows[0]).toMatchObject({ amount: 100n, ref: open[0]?.id });
  expect(t.published.flat().map((e) => e.kind)).toEqual(["collect", "sweep_treasury"]);
  expect("sendRawTransaction" in t.conn).toBe(false);
});

test("an unseen signature past its blockhash is rechecked three times, then expired, never resent", async () => {
  const t = deps(() => [null], 151);
  await t.ledger.insertPending([{ kind: "sweep_buyback", mint, amount: 9n, windowIndex: 1 }], "x", 150n);
  const waits: number[] = [];
  await recover(t.d, coinOf, async (ms) => void waits.push(ms));
  expect(t.conn.getSignatureStatuses).toHaveBeenCalledTimes(4);
  expect(waits).toEqual([10_000, 10_000, 10_000]);
  const all = await t.ledger.settle("x", "landed");
  expect(all).toEqual([]); // no longer pending
  expect(t.jobs).toEqual([]);
});

test("an RPC error leaves every row pending", async () => {
  const t = deps(() => {
    throw new Error("rpc down");
  });
  await t.ledger.insertPending([{ kind: "collect", mint }], "a", 150n);
  await recover(t.d, coinOf, async () => {});
  expect((await t.ledger.pending()).map((e) => e.signature)).toEqual(["a"]);
});

test("an unseen signature within its blockhash is polled until it lands", async () => {
  let n = 0;
  const t = deps(() => [n++ < 2 ? null : ok]);
  await t.ledger.insertPending([{ kind: "sweep_buyback", mint, amount: 9n, windowIndex: 1 }], "p", 150n);
  const waits: number[] = [];
  await recover(t.d, coinOf, async (ms) => void waits.push(ms));
  expect(waits).toEqual([400, 400]);
  expect(await t.ledger.pending()).toEqual([]);
});
