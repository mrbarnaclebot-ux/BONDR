// The engine paths the admin actions lean on (D-16, D-17): finalize burns W's leftover child tokens itself, and
// Distribute now pays one coin below the batch minimum. No RPC: chain reads and builders are stubbed and land
// records each job against a memoryLedger.
import { BN, PUMP_AMM_SDK, PUMP_SDK } from "@bondr/core/pump";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { type AccountInfo, Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { distributeJob } from "./fee-batch.ts";
import { finalizeJob } from "./fee-finalize.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";

const DEV = Keypair.generate().publicKey;
const TREASURY = Keypair.generate().publicKey;
const MINT = PublicKey.unique();

vi.mock("@bondr/core/sharing", async (orig) => ({
  ...((await orig()) as object),
  finalizeConfigIxs: async () => [],
  finalizeUpdateIxs: async () => [],
  finalizeState: async () => ({ complete: true, pool: PublicKey.unique(), sharing: "none" }),
  distributeIxs: async () => [],
}));
vi.mock("@bondr/core/collect", async (orig) => ({
  ...((await orig()) as object),
  collectIxs: async () => [],
}));
vi.mock("@bondr/core/send", async (orig) => ({ ...((await orig()) as object), fetchTx: async () => ({}) }));
vi.mock("@bondr/core/events", () => ({
  innerEvents: () => [{ name: "CreateEvent", data: { mint: MINT.toBase58(), user: DEV.toBase58() } }],
}));

const Q = PublicKey.unique();
const W = Keypair.generate();
const childAta = getAssociatedTokenAddressSync(MINT, W.publicKey, true, T22).toBase58();
const raw = (): AccountInfo<Buffer> => ({
  data: Buffer.alloc(8),
  owner: T22,
  lamports: 1,
  executable: false,
});
const coinOf = (o: Partial<FeeCoin> = {}): FeeCoin => ({
  ...{ mint: MINT, w: W, launchedAt: 0, venue: "pool", feesUnclaimed: 0n, feeBudget: 0n, cost: null },
  ...{ launchSig: "launch", wallet: DEV, finalize: "none" },
  ...o,
});

let jobs: Job[];
// W's child balance (a string, or "throw" for a failed read); every other token account reads 0.
function deps(child = "0") {
  const ledger = memoryLedger();
  let n = 0;
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), ledger, windowMs: 60_000 },
    ...{ treasury: TREASURY, buyback: Keypair.generate(), publish: () => {}, bondrSol: () => 1 },
    conn: {
      getTokenAccountBalance: async (ata: PublicKey) => {
        if (ata.toBase58() !== childAta) return { value: { amount: "0" } };
        if (child === "throw") throw new Error("rpc down");
        return { value: { amount: child } };
      },
      getMinimumBalanceForRentExemption: async () => 1000,
      getBalance: async () => 0,
      getMultipleAccountsInfo: async () => [raw(), null, null, raw()],
    },
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      const sig = `s${n++}`;
      if (!(await ledger.insertPending(job.rows, sig, 1n))) return { state: "done" };
      if (job.rows[0]?.kind === "leftover_burn") child = "0";
      return { state: "landed", sig, rows: await ledger.settle(sig, "landed") };
    },
  };
  return d as unknown as FeeDeps;
}

const kinds = () => jobs.map((j) => j.rows.map((r) => r.kind).join("+"));
let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  jobs = [];
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});

const pending = (amount: bigint) => {
  vi.spyOn(PUMP_AMM_SDK, "decodePool").mockReturnValue({ creatorFees: new BN(String(amount)) } as never);
  vi.spyOn(PUMP_SDK, "decodeSharingConfig").mockReturnValue({
    shareholders: [
      { address: DEV, shareBps: 8000 },
      { address: TREASURY, shareBps: 2000 },
    ],
  } as never);
};

test("finalize burns a leftover child balance after the closing sweep, with no error line", async () => {
  const out = await finalizeJob(deps("50"), coinOf());
  expect(kinds()).toEqual(["finalize_config", "finalize_update", "collect", "leftover_burn"]);
  expect(jobs.at(-1)?.rows).toEqual([{ kind: "leftover_burn", mint: MINT.toBase58(), burned: 50n }]);
  expect(jobs.at(-1)?.signers).toEqual([W]);
  expect(out.at(-1)?.state).toBe("landed");
  expect(err).not.toHaveBeenCalled();
});

test("finalize with W empty logs the success line and burns nothing; a failed read only logs", async () => {
  await finalizeJob(deps("0"), coinOf());
  expect(kinds()).not.toContain("leftover_burn");
  expect(log).toHaveBeenCalledWith(`finalize ${MINT.toBase58()}: W child 0, BONDR 0`);
  jobs = [];
  await expect(finalizeJob(deps("throw"), coinOf())).resolves.toBeDefined();
  expect(kinds()).not.toContain("leftover_burn");
  expect(err).toHaveBeenCalledWith(`finalize ${MINT.toBase58()}: W read failed: rpc down`);
});

test("distributeJob with anyAmount pays below the batch minimum; without it the minimum still applies", async () => {
  pending(100_000n); // under the 1% rule at a price of 1 (fee-batch.test.ts)
  expect((await distributeJob(deps(), coinOf({ finalize: "done" }))).state).toBe("done");
  expect(jobs).toHaveLength(0);
  const out = await distributeJob(deps(), coinOf({ finalize: "done" }), { anyAmount: true });
  expect(out.state).toBe("landed");
  expect(kinds()).toEqual(["distribute"]);
});

test("distributeJob with anyAmount still sends nothing when nothing is pending", async () => {
  pending(0n);
  expect((await distributeJob(deps(), coinOf({ finalize: "done" }), { anyAmount: true })).state).toBe("done");
  expect(jobs).toHaveLength(0);
});
