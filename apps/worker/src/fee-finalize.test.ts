// Finalize (FEE-05, D-18): the deployer pre-flight, the held state, the resumable two-tx finalize, the 6009
// rule, the closing sweep and the owner release route. No RPC: the chain reads and builders are stubbed and
// land records each job against a memoryLedger.
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { finalizeJob, preflight } from "./fee-finalize.ts";
import { memoryLedger } from "./fee-ledger.ts";
import { feeRoutes } from "./fee-routes.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";

const core = vi.hoisted(() => ({
  state: { complete: true, pool: {} as unknown, sharing: "none" as "none" | "configured" | "revoked" },
  sharing: { shares: [8000, 2000], holders: [] as string[], adminRevoked: true },
  events: [] as { name: string; data: Record<string, unknown> }[],
  sweepCurve: [] as (boolean | undefined)[],
  fetchTx: vi.fn(async (_c: unknown, _s: string): Promise<object | undefined> => ({})),
}));
vi.mock("@bondr/core/sharing", async (orig) => ({
  ...((await orig()) as object),
  finalizeConfigIxs: async () => [],
  finalizeUpdateIxs: async () => [],
  finalizeState: async () => core.state,
  readSharing: async () => core.sharing,
}));
vi.mock("@bondr/core/collect", async (orig) => ({
  ...((await orig()) as object),
  collectIxs: async (o: { sweepCurve?: boolean }) => {
    core.sweepCurve.push(o.sweepCurve);
    return [];
  },
}));
vi.mock("@bondr/core/send", async (orig) => ({ ...((await orig()) as object), fetchTx: core.fetchTx }));
vi.mock("@bondr/core/events", () => ({ innerEvents: () => core.events }));

const Q = PublicKey.unique();
const W = Keypair.generate();
const MINT = PublicKey.unique();
const DEV = Keypair.generate().publicKey;
const TREASURY = Keypair.generate().publicKey;
const OFF_CURVE = PublicKey.findProgramAddressSync([Buffer.from("x")], SystemProgram.programId)[0];
const coinOf = (o: Partial<FeeCoin> = {}): FeeCoin => ({
  ...{ mint: MINT, w: W, launchedAt: 0, venue: "pool", feesUnclaimed: 0n, feeBudget: 0n, cost: null },
  ...{ launchSig: "launch", wallet: DEV, finalize: "none" },
  ...o,
});
const qMeta = (wDelta: bigint) => {
  const at = (amount: bigint) => [
    { mint: Q.toBase58(), owner: W.publicKey.toBase58(), uiTokenAmount: { amount: String(amount) } },
  ];
  return { err: null, preTokenBalances: at(10_000n), postTokenBalances: at(10_000n + wDelta) };
};

let jobs: Job[];
type Opts = { balances?: string[]; failCode?: number };
function deps(o: Opts = {}) {
  const ledger = memoryLedger();
  const balances = [...(o.balances ?? [])];
  let n = 0;
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), ledger, windowMs: 60_000 },
    ...{ treasury: TREASURY, buyback: Keypair.generate(), publish: () => {}, bondrSol: () => 1 },
    conn: {
      getTokenAccountBalance: async () => ({ value: { amount: balances.shift() ?? "0" } }),
      getMinimumBalanceForRentExemption: async () => 1000,
      getBalance: async () => 0,
    },
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      const sig = `s${n++}`;
      if (!(await ledger.insertPending(job.rows, sig, 1n))) return { state: "done" };
      if (o.failCode && job.rows[0]?.kind === "finalize_update") {
        const rows = await ledger.settle(sig, "failed", {
          error: `code ${o.failCode}: SharingConfigAdminRevoked`,
        });
        return { state: "failed", sig, rows, code: o.failCode };
      }
      const rows = await ledger.settle(sig, "landed", { facts: job.facts?.(qMeta(50n) as never) });
      return { state: "landed", sig, rows };
    },
  };
  return d as unknown as FeeDeps;
}

const kinds = () => jobs.map((j) => j.rows.map((r) => r.kind).join("+"));
const SWEEP = "sweep_buyback+sweep_treasury";
const CLOSING = ["collect", "split_treasury", SWEEP]; // W's own vaults, then a window's split and sweep
const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return vi.spyOn(console, "error").mockImplementation(() => {});
};

beforeEach(() => {
  vi.restoreAllMocks();
  jobs = [];
  core.state = { complete: true, pool: PublicKey.unique(), sharing: "none" };
  core.sharing = { shares: [8000, 2000], holders: [DEV.toBase58(), TREASURY.toBase58()], adminRevoked: true };
  core.events = [{ name: "CreateEvent", data: { mint: MINT.toBase58(), user: DEV.toBase58() } }];
  core.fetchTx.mockReset().mockResolvedValue({});
  core.sweepCurve = [];
});

test("preflight returns the deployer when the CreateEvent user is the launch wallet, distinct and on curve", async () => {
  expect((await preflight(deps(), coinOf()))?.toBase58()).toBe(DEV.toBase58());
  expect(core.fetchTx.mock.calls[0]?.[1]).toBe("launch");
});

test("a CreateEvent user other than the launch wallet holds once and finalize sends nothing", async () => {
  const err = quiet();
  core.events = [
    { name: "CreateEvent", data: { mint: MINT.toBase58(), user: Keypair.generate().publicKey.toBase58() } },
  ];
  const [d, coin] = [deps(), coinOf()];
  const hold = vi.spyOn(d.ledger, "hold");
  expect(await finalizeJob(d, coin)).toEqual([{ state: "done" }]);
  expect(hold).toHaveBeenCalledWith(MINT.toBase58(), "deployer is not the launch wallet");
  expect(coin.finalize).toBe("held");
  expect(err.mock.calls.filter(([m]) => String(m).includes("finalize held"))).toHaveLength(1);
  expect(jobs).toEqual([]);
});

test("an RPC failure fetching the launch tx throws and writes no held row", async () => {
  core.fetchTx.mockRejectedValue(new Error("fetch failed"));
  const d = deps();
  await expect(preflight(d, coinOf())).rejects.toThrow("fetch failed");
  expect(await d.ledger.has(MINT.toBase58(), ["held"])).toBe(false);
});

test("sharing none lands config, update, then the closing sweep, and W ends empty", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const out = await finalizeJob(deps({ balances: ["1000", "0", "0"] }), coinOf());
  expect(kinds()).toEqual(["finalize_config", "finalize_update", ...CLOSING]);
  expect(core.sweepCurve).toEqual([false]); // the curve names the sharing config now
  expect(jobs.slice(0, 2).every((j) => j.signers[0] === W && !j.urgent && !j.sender)).toBe(true);
  expect(jobs[1]?.rows[0]?.detail).toEqual({
    ...{ dBps: 8000, tBps: 2000 },
    ...{ deployer: DEV.toBase58(), treasury: TREASURY.toBase58() },
  });
  expect(out[0]?.rows?.[0]?.amount).toBe(50n); // W's BONDR delta from the meta
  expect(jobs[3]?.rows[0]?.amount).toBe(5n); // a tenth of the closing collect's 50
  expect(jobs[4]?.rows.map((r) => r.amount)).toEqual([900n, 100n]);
  expect(log).toHaveBeenCalledWith(`finalize ${MINT.toBase58()}: W child 0, BONDR 0`);
});

test("sharing configured lands only the update and the sweep", async () => {
  quiet();
  core.state.sharing = "configured";
  await finalizeJob(deps({ balances: ["10"] }), coinOf());
  expect(kinds()).toEqual(["finalize_update", ...CLOSING]);
});

test("sharing revoked with [8000, 2000] marks the coin done and sweeps", async () => {
  quiet();
  core.state.sharing = "revoked";
  const [d, coin] = [deps({ balances: ["10"] }), coinOf()];
  const mark = vi.spyOn(d.ledger, "markFinal");
  await finalizeJob(d, coin);
  expect(kinds()).toEqual(CLOSING);
  expect(mark).toHaveBeenCalledWith(MINT.toBase58(), 8000);
  expect(coin.finalize).toBe("done");
});

test("a 6009 on the update is final: failed with 6009, never resent, done only if the shares are 80/20", async () => {
  quiet();
  core.state.sharing = "configured";
  const [d, coin] = [deps({ failCode: 6009, balances: ["10"] }), coinOf()];
  const out = await finalizeJob(d, coin);
  expect(kinds()).toEqual(["finalize_update", ...CLOSING]);
  expect(out[0]?.rows?.[0]).toMatchObject({ state: "failed", error: expect.stringContaining("6009") });
  expect(coin.finalize).toBe("done");

  jobs = [];
  core.sharing = { ...core.sharing, shares: [5000, 5000] };
  const [d2, coin2] = [deps({ failCode: 6009 }), coinOf()];
  await finalizeJob(d2, coin2);
  expect(kinds()).toEqual(["finalize_update"]);
  expect(coin2.finalize).toBe("held");
});

test("a held coin is skipped without an override; with one only the distinct and on-curve checks run", async () => {
  quiet();
  const d = deps({ balances: ["0"] });
  expect(await finalizeJob(d, coinOf({ finalize: "held" }))).toEqual([{ state: "done" }]);
  expect(jobs).toEqual([]);
  const release = vi.spyOn(d.ledger, "release");
  const owner = Keypair.generate().publicKey;
  await finalizeJob(d, coinOf({ finalize: "held" }), owner);
  expect(core.fetchTx).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledWith(MINT.toBase58());
  expect(jobs[1]?.rows[0]?.detail).toMatchObject({ deployer: owner.toBase58() });

  jobs = [];
  const again = coinOf({ finalize: "held" });
  await finalizeJob(deps(), again, TREASURY);
  expect([jobs, again.finalize]).toEqual([[], "held"]);
});

test("POST /fee/release refuses bad input and a coin that is not held, and enqueues the override", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const release = vi.fn((mint: string, _d: PublicKey) => mint === MINT.toBase58());
  const route = feeRoutes(() => ({ release }))["POST /fee/release"];
  if (!route) throw new Error("no route");
  const refused = (body: unknown) =>
    expect(route(body)).rejects.toMatchObject({ body: { error: "invalid_input" } });
  await refused({ mint: "not base58!", deployer: DEV.toBase58() });
  await refused({ mint: MINT.toBase58(), deployer: OFF_CURVE.toBase58() });
  await refused({ mint: PublicKey.unique().toBase58(), deployer: DEV.toBase58() });
  expect(await route({ mint: MINT.toBase58(), deployer: DEV.toBase58() })).toEqual({ ok: true });
  expect(release.mock.calls.at(-1)?.[1].toBase58()).toBe(DEV.toBase58());
});
