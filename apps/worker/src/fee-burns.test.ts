// The forced bond and the fallback burn (FEE-02, FEE-03, D-15 to D-17) through a recording land backed by
// memoryLedger and scripted metas. No RPC: the core builders, the curve read and the float are stubbed.
import { BN } from "@bondr/core/pump";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { bondedJob, forcedJob, poolBurnJob } from "./fee-burns.ts";
import { memoryLedger } from "./fee-ledger.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";

const core = vi.hoisted(() => ({
  cost: 1000n,
  exactFails: false,
  forced: vi.fn(async (_o: { budget: unknown }) => ({ ixs: [], burnAmount: new BN(777) })),
  exact: vi.fn(async (_o: object) => ({ ixs: [], burnAmount: new BN(555) })),
  buyV2: vi.fn(async (_o: object) => []),
  finalize: vi.fn(async () => [{ state: "done" }]),
}));
vi.mock("./fee-finalize.ts", () => ({ finalizeJob: core.finalize }));
vi.mock("@bondr/core/collect", async (orig) => ({
  ...((await orig()) as object),
  collectIxs: async () => [],
}));
vi.mock("@bondr/core/curve", () => ({ costToComplete: async () => new BN(core.cost.toString()) }));
vi.mock("@bondr/core/float", () => ({ wFloat: async () => 0 }));
vi.mock("@bondr/core/bond", () => ({
  forcedBondIxs: core.forced,
  poolExactInBurnIxs: async (o: object) => {
    if (core.exactFails) throw new Error("request to https://rpc.example/?api-key=SECRET-KEY failed");
    return core.exact(o);
  },
  poolBaseOut: async () => new BN(333),
  poolBuyBurnIxs: core.buyV2,
}));

const Q = PublicKey.unique();
const W = Keypair.generate();
const MINT = PublicKey.unique();
const coin: FeeCoin = {
  ...{ mint: MINT, w: W, launchedAt: 0, venue: "curve", feesUnclaimed: 10n, feeBudget: 0n },
  ...{ cost: null, launchSig: "launch", wallet: PublicKey.unique(), finalize: "none" },
};
const qMeta = (wDelta: bigint) => ({
  err: null,
  preTokenBalances: [
    { mint: Q.toBase58(), owner: W.publicKey.toBase58(), uiTokenAmount: { amount: String(10_000n) } },
  ],
  postTokenBalances: [
    {
      mint: Q.toBase58(),
      owner: W.publicKey.toBase58(),
      uiTokenAmount: { amount: String(10_000n + wDelta) },
    },
  ],
});

let jobs: Job[];
type Status = { confirmationStatus: string; err: unknown } | null;
function deps(o: { balance?: bigint; metas?: object[]; statuses?: () => Status[] } = {}): FeeDeps {
  const ledger = memoryLedger();
  const metas = [...(o.metas ?? [])];
  let n = 0;
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), amm: {}, ledger },
    ...{ treasury: PublicKey.unique(), buyback: Keypair.generate(), publish: () => {}, bondrSol: () => 1 },
    online: { fetchGlobal: async () => ({}) },
    conn: {
      getTokenAccountBalance: async () => {
        if (o.balance === undefined) throw new Error("Invalid param: could not find account");
        return { value: { amount: String(o.balance) } };
      },
      // An earlier row's chain status: an RPC error unless the test scripts one.
      getSignatureStatuses: async () => {
        if (!o.statuses) throw new Error("rpc down");
        return { value: o.statuses() };
      },
      getBlockHeight: async () => 100,
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

const kinds = () => jobs.map((j) => j.rows.map((r) => r.kind).join("+"));
const bondJob = () => jobs.find((j) => j.rows[0]?.kind === "forced_bond" || j.rows[0]?.kind === "pool_burn");

beforeEach(() => {
  jobs = [];
  Object.assign(core, { cost: 1000n, exactFails: false });
  for (const f of [core.forced, core.exact, core.buyV2, core.finalize]) f.mockClear();
});

test("forcedJob below 105% of the fresh cost logs not ready and sends no bond", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const out = await forcedJob(deps({ balance: 1049n }), coin);
  expect(kinds()).toEqual(["collect"]);
  expect(out.at(-1)?.state).toBe("done");
  expect(log).toHaveBeenCalledWith(expect.stringContaining("forced bond not ready"));
  expect(core.forced).not.toHaveBeenCalled();
  log.mockRestore();
});

test("forcedJob at 105% collects, splits, then lands one urgent sender forced_bond of W's whole balance", async () => {
  const d = deps({ balance: 1050n, metas: [qMeta(1000n), qMeta(-100n), qMeta(-1040n)] });
  const out = await forcedJob(d, coin);
  expect(kinds()).toEqual(["collect", "split_treasury", "forced_bond"]);
  expect(core.forced.mock.calls[0]?.[0].budget?.toString()).toBe("1050");
  expect(bondJob()).toMatchObject({ urgent: true, sender: true, signers: [W], cu: 600_000 });
  expect(jobs.slice(0, 2).every((j) => j.urgent)).toBe(true);
  expect(bondJob()?.rows).toEqual([
    { kind: "forced_bond", mint: MINT.toBase58(), amount: 1050n, burned: 777n },
  ]);
  expect(out.at(-1)?.rows?.[0]).toMatchObject({ amount: 1040n, burned: 777n }); // spent, from the meta
});

test("forcedJob does nothing once a bond burn is live for the mint", async () => {
  const d = deps({ balance: 5000n });
  await d.ledger.insertPending([{ kind: "pool_burn", mint: MINT.toBase58() }], "x", 1n);
  expect(await forcedJob(d, coin)).toEqual([{ state: "done" }]);
  expect(jobs).toEqual([]);
});

test("forcedJob sends no bond while the curve is already complete (cost 0)", async () => {
  core.cost = 0n;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await forcedJob(deps({ balance: 5000n }), coin);
  expect(kinds()).toEqual(["collect"]);
  log.mockRestore();
});

test("bondedJob collects, splits, then burns W's whole budget on the pool", async () => {
  const pooled = { ...coin, venue: "pool" as const };
  await bondedJob(deps({ balance: 900n, metas: [qMeta(1000n), qMeta(-100n), qMeta(-900n)] }), pooled);
  expect(kinds()).toEqual(["collect", "split_treasury", "pool_burn"]);
  expect(bondJob()).toMatchObject({ urgent: true, sender: true, signers: [W] });
  expect(bondJob()?.rows[0]).toMatchObject({ kind: "pool_burn", amount: 900n, burned: 555n });
  expect(bondJob()?.rows[0]?.detail).toEqual({ path: "exact_quote_in" });
  expect(core.finalize).toHaveBeenCalledOnce(); // after the burn landed
});

test("bondedJob with an empty budget or after a forced bond lands no pool_burn", async () => {
  await bondedJob(deps(), { ...coin, venue: "pool" });
  expect(kinds()).toEqual(["collect"]);
  jobs = [];
  const d = deps({ balance: 900n });
  await d.ledger.insertPending([{ kind: "forced_bond", mint: MINT.toBase58() }], "x", 1n);
  await d.ledger.settle("x", "landed");
  await bondedJob(d, { ...coin, venue: "pool" });
  expect(kinds()).toEqual([]); // finalize's closing collect takes what came after the forced bond
  expect(core.finalize).toHaveBeenCalledTimes(2); // a forced bond's coin finalizes too
});

test("poolBurnJob falls back to buy_v2 of what 95% buys when exact-quote-in fails, and records the path", async () => {
  core.exactFails = true;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await poolBurnJob(deps({ balance: 1000n }), { ...coin, venue: "pool" });
  expect(core.buyV2.mock.calls[0]?.[0]).toMatchObject({ baseOut: new BN(333), maxQuoteIn: new BN(1000) });
  expect(bondJob()?.rows[0]).toMatchObject({ amount: 1000n, burned: 333n, detail: { path: "buy_v2" } });
  expect(String(warn.mock.calls[0]?.[0])).not.toContain("SECRET-KEY"); // WR-07: RPC text can carry the key
  warn.mockRestore();
});

// WR-02: a dropped pool burn must be sent again, never closing-swept 90/10 by finalize.
test("bondedJob with a pending pool_burn leaves finalize for later while its status is unknown", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const d = deps({ balance: 900n });
  await d.ledger.insertPending([{ kind: "pool_burn", mint: MINT.toBase58() }], "x", 50n);
  expect((await bondedJob(d, { ...coin, venue: "pool" })).map((l) => l.state)).toEqual(["unknown"]);
  expect(core.finalize).not.toHaveBeenCalled();
  expect(jobs).toEqual([]);
  vi.restoreAllMocks();
});

test("bondedJob sends the pool burn again once the pending one failed on chain, then finalizes", async () => {
  const failed = { confirmationStatus: "confirmed", err: { InstructionError: [0, { Custom: 1 }] } };
  const d = deps({ balance: 900n, statuses: () => [failed] });
  await d.ledger.insertPending([{ kind: "pool_burn", mint: MINT.toBase58() }], "x", 50n);
  await bondedJob(d, { ...coin, venue: "pool" });
  expect(kinds()).toEqual(["collect", "pool_burn"]);
  expect(core.finalize).toHaveBeenCalledOnce();
});
