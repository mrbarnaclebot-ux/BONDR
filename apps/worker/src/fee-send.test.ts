// The land pipeline over a fake connection: intent before broadcast, the ops floor, the mainnet-only Sender
// path (D-08, D-16, D-20). No RPC, no database.
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  SystemInstruction,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OPS_FLOOR_LAMPORTS, SENDER_TIPS } from "./fee-config.ts";
import type { LedgerStore } from "./fee-ledger.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import {
  type FeeDeps,
  type Job,
  land,
  noteOps,
  opsLow,
  refreshOps,
  tipIxs,
  urgentBroadcast,
} from "./fee-send.ts";

const calls = vi.hoisted(() => [] as string[]);
const metaMisses = vi.hoisted(() => ({ n: 0 })); // fetchTx tries that find no meta yet
vi.mock("@bondr/core/send", async (orig) => {
  const m = (await orig()) as typeof import("@bondr/core/send");
  return {
    ...m,
    fetchTx: async (...a: Parameters<typeof m.fetchTx>) => (metaMisses.n-- > 0 ? undefined : m.fetchTx(...a)),
    signTx: (o: Parameters<typeof m.signTx>[0]) => {
      calls.push("sign");
      return m.signTx(o);
    },
  };
});

const ops = Keypair.generate();
const W = Keypair.generate();
const meta = (over: Record<string, unknown> = {}) => ({
  ...{ err: null, fee: 5000, preBalances: [LAMPORTS_PER_SOL], postBalances: [LAMPORTS_PER_SOL] },
  ...{ preTokenBalances: [], postTokenBalances: [], logMessages: [], computeUnitsConsumed: 1000 },
  ...over,
});

function fakeConn(o: { meta?: object; seen?: boolean; send?: () => Promise<string> } = {}) {
  return {
    getLatestBlockhash: async () => ({ blockhash: PublicKey.unique().toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: vi.fn(
      o.send ??
        (async () => {
          calls.push("broadcast");
          return "sig";
        }),
    ),
    getSignatureStatuses: async () => ({
      value: [o.seen === false ? null : { confirmationStatus: "confirmed", err: null }],
    }),
    getBlockHeight: async () => 200,
    getTransaction: async () => ({ slot: 77, meta: o.meta ?? meta() }),
    simulateTransaction: vi.fn(async () => ({ value: { err: null, unitsConsumed: 1234, logs: [] } })),
  };
}

function deps(over: Omit<Partial<FeeDeps>, "conn"> & { conn?: ReturnType<typeof fakeConn> } = {}) {
  const ledger = memoryLedger();
  const recorded: LedgerStore = {
    ...ledger,
    insertPending: (...a) => {
      calls.push("insertPending");
      return ledger.insertPending(...a);
    },
  };
  const d = {
    ...{ net: "fork", mode: "on", conn: fakeConn(), online: {}, amm: {}, Q: PublicKey.unique() },
    ...{ ops, treasury: PublicKey.unique(), buyback: Keypair.generate(), ledger: recorded },
    bondrSol: () => 2,
    publish: vi.fn(),
    ...over,
  } as unknown as FeeDeps;
  d.land = (job) => land(d, job);
  return d;
}

const ix = () => SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: W.publicKey, lamports: 1 });
const job = (over: Partial<Job> = {}): Job => ({
  rows: [{ kind: "collect", mint: "M" }],
  ixs: [ix()],
  signers: [],
  facts: () => ({ collect: { amount: 1000n } }),
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  metaMisses.n = 0;
  noteOps(LAMPORTS_PER_SOL);
});
afterEach(() => vi.restoreAllMocks());

describe("tipIxs and urgentBroadcast (D-16)", () => {
  test("devnet gets no tip; mainnet gets one transfer to a Sender tip account", () => {
    expect(tipIxs("devnet", ops.publicKey, 1_000_000)).toEqual([]);
    const [t, ...rest] = tipIxs("mainnet", ops.publicKey, 1_000_000);
    expect(rest).toEqual([]);
    const d = SystemInstruction.decodeTransfer(t as never);
    expect(d.fromPubkey.equals(ops.publicKey)).toBe(true);
    expect(SENDER_TIPS).toContain(d.toPubkey.toBase58());
    expect(d.lamports).toBeGreaterThanOrEqual(1_000_000n);
  });

  const o = { sig: "s", bytes: 1, blockhash: "b", lastValidBlockHeight: 1, paceMs: 0 };

  test("devnet never calls Sender", async () => {
    const post = vi.fn();
    const conn = fakeConn();
    expect(await urgentBroadcast("devnet", conn as never, new Uint8Array([1]), o, post)).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(conn.sendRawTransaction).toHaveBeenCalledOnce();
  });

  test("mainnet posts once to Sender with skipPreflight and no retries", async () => {
    const post = vi.fn(async () => new Response(JSON.stringify({ result: "s" })));
    expect(await urgentBroadcast("mainnet", fakeConn() as never, new Uint8Array([1]), o, post)).toBeNull();
    expect(post).toHaveBeenCalledOnce();
    const body = JSON.parse(String((post.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.method).toBe("sendTransaction");
    expect(body.params[1]).toEqual({ encoding: "base64", skipPreflight: true, maxRetries: 0 });
  });
});

describe("land (D-08)", () => {
  test("signs, records the intent, then broadcasts; landing applies facts and publishes once", async () => {
    const d = deps();
    const r = await land(d, job());
    expect(calls).toEqual(["sign", "insertPending", "broadcast"]);
    expect(r.state).toBe("landed");
    expect(r.rows?.[0]).toMatchObject({ kind: "collect", state: "landed", amount: 1000n, sol: 2000n });
    expect(d.publish).toHaveBeenCalledOnce();
    expect(await d.ledger.pending()).toEqual([]);
  });

  test("a confirmed tx whose meta lags is fetched again, not left pending (CR-01)", async () => {
    metaMisses.n = 2;
    const d = deps();
    expect((await land(d, job())).state).toBe("landed");
    expect(await d.ledger.pending()).toEqual([]);
  });

  test("a refused once-only intent is done and never broadcast", async () => {
    const d = deps();
    await d.ledger.insertPending([{ kind: "forced_bond", mint: "M" }], "earlier", 1n);
    const r = await land(d, job({ rows: [{ kind: "forced_bond", mint: "M" }] }));
    expect(r.state).toBe("done");
    expect(calls).not.toContain("broadcast");
  });

  test("ops below the floor pauses non-urgent sends; urgent still go; a later meta clears it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const low = deps({ conn: fakeConn({ meta: meta({ postBalances: [OPS_FLOOR_LAMPORTS - 1] }) }) });
    expect((await land(low, job())).state).toBe("landed");
    expect(err.mock.calls.flat().join(" ")).toContain("ops below floor");
    expect(opsLow()).toBe(true);
    calls.length = 0;
    expect((await land(deps(), job())).state).toBe("skipped");
    expect(calls).toEqual([]);
    expect((await land(deps(), job({ urgent: true }))).state).toBe("landed");
    expect(opsLow()).toBe(false);
  });

  test("while paused, ops is re-read at most once a minute and a top-up clears the pause (WR-04)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    noteOps(0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3_600_000);
    const conn = { getBalance: vi.fn(async () => LAMPORTS_PER_SOL) };
    expect(await refreshOps({ conn, ops } as never)).toBe(false);
    noteOps(0);
    expect(await refreshOps({ conn, ops } as never)).toBe(true); // read a moment ago
    expect(conn.getBalance).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  test("sender on mainnet adds the tip and posts to Sender; urgent alone gets neither", async () => {
    const post = vi.fn(async (_u: string, _i: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", post);
    const d = deps({ net: "mainnet" });
    expect((await land(d, job({ urgent: true, sender: true }))).state).toBe("landed");
    expect(post).toHaveBeenCalledOnce();
    expect(d.conn.sendRawTransaction).not.toHaveBeenCalled();
    const wire = Buffer.from(JSON.parse(String(post.mock.calls[0]?.[1].body)).params[0], "base64");
    const keys = VersionedTransaction.deserialize(wire).message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys.some((k) => SENDER_TIPS.includes(k))).toBe(true);

    const plain = deps({ net: "mainnet" });
    expect((await land(plain, job({ urgent: true, rows: [{ kind: "pool_burn", mint: "N" }] }))).state).toBe(
      "landed",
    );
    expect(post).toHaveBeenCalledOnce();
    expect(plain.conn.sendRawTransaction).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  test("dry mode simulates, logs and writes nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps({ mode: "dry" });
    expect((await land(d, job())).state).toBe("dry");
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^fee dry/);
    expect(d.conn.simulateTransaction).toHaveBeenCalledOnce();
    expect(d.conn.sendRawTransaction).not.toHaveBeenCalled();
    expect(await d.ledger.pending()).toEqual([]);
  });

  test("a rejected broadcast or an on-chain error fails the rows; unknown leaves them pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = new SendTransactionError({
      action: "send",
      signature: "",
      transactionMessage: "Simulation failed",
      logs: ["Program log: no"],
    });
    const a = deps({ conn: fakeConn({ send: async () => Promise.reject(rejected) }) });
    const ra = await land(a, job());
    expect(ra.state).toBe("failed");
    expect(ra.rows?.[0]?.state).toBe("failed");
    expect(ra.rows?.[0]?.error).toContain("Simulation failed");

    const b = deps({ conn: fakeConn({ meta: meta({ err: { InstructionError: [0, { Custom: 1 }] } }) }) });
    expect((await land(b, job())).rows?.[0]?.state).toBe("failed");

    const c = deps({ conn: fakeConn({ seen: false }) });
    expect((await land(c, job())).state).toBe("unknown");
    expect((await c.ledger.pending()).map((e) => e.state)).toEqual(["pending"]);
  });
});
