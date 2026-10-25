// Leftover recovery (ADMIN-03, D-16, D-17): the W child burn, closing W's empty token accounts and the composed
// sweep. No RPC: balances and account reads are stubbed by address and land records each job against a
// memoryLedger. Every built instruction runs through the admin destination lock.
import { windowOf } from "@bondr/core/fees";
import { COIN_DECIMALS } from "@bondr/core/launch";
import {
  AccountLayout,
  decodeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
  TokenInstruction,
} from "@solana/spl-token";
import { type AccountInfo, Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { allowFor, refusedDestination } from "./admin-dest.ts";
import { closeAccountsJob, leftoverBurnJob, sweepLeftoversJob } from "./admin-leftover.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";

const Q = PublicKey.unique();
const MINT = PublicKey.unique();
const TREASURY = Keypair.generate().publicKey;
const DAY = 86_400_000;

const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);

function tokenAccount(mint: PublicKey, amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      ...{ mint, owner: PublicKey.default, amount, delegateOption: 0, delegate: PublicKey.default },
      ...{ state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0 },
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner: T22, lamports: 2_039_280, executable: false };
}

let jobs: Job[];
// Balances by ATA address; a missing key is a missing account. land zeroes what a job moved out of W.
type Opts = { child?: bigint; bondr?: bigint; fail?: string };
function setup(o: Opts = {}) {
  const coin: FeeCoin = {
    ...{ mint: MINT, w: Keypair.generate(), launchedAt: Date.now() - 3 * DAY, venue: "pool" },
    ...{ feesUnclaimed: 0n, feeBudget: 0n, cost: null, launchSig: "l", wallet: TREASURY, finalize: "done" },
  };
  const W = coin.w.publicKey;
  const bal = new Map<string, bigint>();
  if (o.child !== undefined) bal.set(ataOf(MINT, W).toBase58(), o.child);
  if (o.bondr !== undefined) bal.set(ataOf(Q, W).toBase58(), o.bondr);
  const ledger = memoryLedger();
  let n = 0;
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), ledger, windowMs: DAY },
    ...{ treasury: TREASURY, buyback: Keypair.generate(), publish: () => {}, bondrSol: () => 1 },
    conn: {
      getTokenAccountBalance: async (ata: PublicKey) => {
        const x = bal.get(ata.toBase58());
        if (x === undefined) throw new Error("could not find account");
        return { value: { amount: String(x) } };
      },
      getMultipleAccountsInfo: async (keys: PublicKey[]) =>
        keys.map((k) => {
          const x = bal.get(k.toBase58());
          const mint = k.equals(ataOf(MINT, W)) ? MINT : Q;
          return x === undefined ? null : tokenAccount(mint, x);
        }),
    },
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      const sig = `s${n++}`;
      if (!(await ledger.insertPending(job.rows, sig, 1n))) return { state: "done" };
      const to = job.rows[0]?.kind === o.fail ? "failed" : "landed";
      if (to === "landed" && job.rows[0]?.kind === "leftover_burn") bal.set(ataOf(MINT, W).toBase58(), 0n);
      if (to === "landed" && job.rows[0]?.kind === "sweep_buyback") bal.set(ataOf(Q, W).toBase58(), 0n);
      return { state: to, sig, rows: await ledger.settle(sig, to) };
    },
  };
  const allowed = allowFor({
    ...{ treasury: TREASURY, buyback: d.buyback.publicKey, internal: [W] },
    ...{ mints: [Q, MINT], closeTo: TREASURY },
  });
  return { d: d as unknown as FeeDeps, coin, W, allowed, ledger };
}

const kinds = () => jobs.map((j) => j.rows.map((r) => r.kind).join("+") || "close");
const decoded = (job: Job | undefined) => (job?.ixs ?? []).map((ix) => decodeInstruction(ix, T22));

beforeEach(() => {
  jobs = [];
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("leftoverBurnJob burns W's whole child balance in one W-signed BurnChecked with a leftover_burn row", async () => {
  const { d, coin, W, allowed } = setup({ child: 1234n });
  const out = await leftoverBurnJob(d, coin);
  expect(out.state).toBe("landed");
  expect(kinds()).toEqual(["leftover_burn"]);
  const [job] = jobs;
  expect(job?.rows).toEqual([{ kind: "leftover_burn", mint: MINT.toBase58(), burned: 1234n }]);
  expect(job?.signers).toEqual([coin.w]);
  const [burn] = decoded(job);
  expect(job?.ixs).toHaveLength(1);
  expect(burn?.data).toMatchObject({ instruction: TokenInstruction.BurnChecked, decimals: COIN_DECIMALS });
  expect((burn?.data as { amount: bigint }).amount).toBe(1234n);
  expect(burn?.keys).toMatchObject({ mint: { pubkey: MINT }, owner: { pubkey: W } });
  expect(refusedDestination(job?.ixs ?? [], allowed)).toBeNull();
});

test("leftoverBurnJob sends nothing when W holds no child tokens or has no child account", async () => {
  expect((await leftoverBurnJob(setup({ child: 0n }).d, setup().coin)).state).toBe("done");
  expect((await leftoverBurnJob(setup().d, setup().coin)).state).toBe("done");
  expect(jobs).toHaveLength(0);
});

test("closeAccountsJob closes each empty W token account to the treasury and leaves a funded one", async () => {
  const { d, coin, W, allowed } = setup({ child: 0n, bondr: 0n });
  expect((await closeAccountsJob(d, coin)).state).toBe("landed");
  const [job] = jobs;
  expect(job?.rows).toEqual([]);
  expect(job?.signers).toEqual([coin.w]);
  const closes = decoded(job);
  expect(closes.map((c) => c.data.instruction)).toEqual([
    TokenInstruction.CloseAccount,
    TokenInstruction.CloseAccount,
  ]);
  const accounts = closes.map((c) => (c.keys as { account: { pubkey: PublicKey } }).account.pubkey.toBase58());
  expect(accounts.sort()).toEqual([ataOf(Q, W).toBase58(), ataOf(MINT, W).toBase58()].sort());
  for (const c of closes)
    expect((c.keys as { destination: { pubkey: PublicKey } }).destination.pubkey).toEqual(TREASURY);
  expect(refusedDestination(job?.ixs ?? [], allowed)).toBeNull();

  jobs = [];
  const funded = setup({ child: 5n, bondr: 0n });
  await closeAccountsJob(funded.d, funded.coin);
  expect(decoded(jobs[0]).map((c) => (c.keys as { account: { pubkey: PublicKey } }).account.pubkey)).toEqual([
    ataOf(Q, funded.W),
  ]);
});

test("closeAccountsJob sends nothing when W has no token accounts", async () => {
  const { d, coin } = setup();
  expect((await closeAccountsJob(d, coin)).state).toBe("done");
  expect(jobs).toHaveLength(0);
});

test("sweepLeftoversJob sweeps at the next free window, then burns, then closes, all inside the allowlist", async () => {
  const { d, coin, allowed, ledger } = setup({ child: 50n, bondr: 1000n });
  const now = windowOf(coin.launchedAt, Date.now(), d.windowMs);
  await ledger.insertPending([{ kind: "sweep_buyback", mint: MINT.toBase58(), windowIndex: now }], "x", 1n);
  const out = await sweepLeftoversJob(d, coin);
  expect(out.map((l) => l.state)).toEqual(["landed", "landed", "landed"]);
  expect(kinds()).toEqual(["sweep_buyback+sweep_treasury", "leftover_burn", "close"]);
  expect(jobs[0]?.rows.map((r) => r.windowIndex)).toEqual([now + 1, now + 1]);
  expect(decoded(jobs[2])).toHaveLength(2); // both accounts are empty after the sweep and the burn
  for (const job of jobs) expect(refusedDestination(job.ixs, allowed)).toBeNull();
});

test("sweepLeftoversJob stops after a failed step: a failed burn sends no close", async () => {
  const { d, coin } = setup({ child: 50n, bondr: 0n, fail: "leftover_burn" });
  const out = await sweepLeftoversJob(d, coin);
  expect(out.map((l) => l.state)).toEqual(["done", "failed"]);
  expect(kinds()).toEqual(["leftover_burn"]);
});
