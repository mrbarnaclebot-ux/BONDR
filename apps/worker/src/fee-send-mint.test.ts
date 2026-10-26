// One transaction with rows for several mints (EVACUATE, the leftover sweep): each row keeps its own SOL value
// and each coin's rows are published to that coin only (RESEARCH Pitfalls 4, 5). No RPC, no database.
import { toSol } from "@bondr/core/price";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { beforeEach, expect, test } from "vitest";
import type { Entry } from "./fee-ledger.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { type FeeDeps, type Job, land, noteOps, withSol } from "./fee-send.ts";

const ops = Keypair.generate();
const meta = {
  ...{ err: null, fee: 5000, preBalances: [LAMPORTS_PER_SOL], postBalances: [LAMPORTS_PER_SOL] },
  ...{ preTokenBalances: [], postTokenBalances: [], logMessages: [], computeUnitsConsumed: 1000 },
};

const conn = {
  getLatestBlockhash: async () => ({ blockhash: PublicKey.unique().toBase58(), lastValidBlockHeight: 100 }),
  sendRawTransaction: async () => "sig",
  getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
  getBlockHeight: async () => 200,
  getTransaction: async () => ({ slot: 77, meta }),
};

function deps() {
  const published: [string | null, Entry[]][] = [];
  const d = {
    ...{ net: "fork", mode: "on", conn, Q: PublicKey.unique(), ops, ledger: memoryLedger() },
    bondrSol: () => 2,
    publish: (m: string | null, rows: Entry[]) => published.push([m, rows]),
  } as unknown as FeeDeps;
  return { d, published };
}

const job = (rows: Job["rows"], over: Partial<Job> = {}): Job => ({
  rows,
  ixs: [SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: PublicKey.unique(), lamports: 1 })],
  signers: [],
  ...over,
});

const evacuate = [
  { kind: "evacuate", mint: "A", amount: 100n, sol: 10n },
  { kind: "evacuate", mint: "B", amount: 200n, sol: 20n },
] as const;

beforeEach(() => noteOps(LAMPORTS_PER_SOL));

test("withSol leaves a row that carries its own sol alone; a collect still gets its sol from the facts", () => {
  expect(withSol({ rows: [...evacuate] }, {}, 2)).toEqual({});
  const facts = withSol({ rows: [{ kind: "collect", mint: "A" }] }, { collect: { amount: 1000n } }, 2);
  expect(facts.collect).toEqual({ amount: 1000n, sol: toSol(1000n, 2) });
});

test("a landed two-mint job keeps each row's sol and publishes each mint's rows once", async () => {
  const { d, published } = deps();
  const r = await land(d, job([...evacuate]));
  expect(r.state).toBe("landed");
  expect(r.rows?.map((e) => [e.mint, e.sol])).toEqual([
    ["A", 10n],
    ["B", 20n],
  ]);
  expect(published.map(([m, rows]) => [m, rows.map((e) => e.mint)])).toEqual([
    ["A", ["A"]],
    ["B", ["B"]],
  ]);
});

test("a one-mint job still publishes once with all its rows", async () => {
  const { d, published } = deps();
  const rows = [
    { kind: "sweep_buyback", mint: "A", amount: 9n, windowIndex: 1 },
    { kind: "sweep_treasury", mint: "A", amount: 1n, windowIndex: 1 },
  ] as const;
  await land(d, job([...rows]));
  expect(published.map(([m, list]) => [m, list.length])).toEqual([["A", 2]]);
});
