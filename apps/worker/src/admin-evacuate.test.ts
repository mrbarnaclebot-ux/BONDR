// EVACUATE (ADMIN-11, D-35, D-36) over a fake chain: one batched balance read, greedy packing under the packet
// limit, batches that only pay the treasury or burn, a capped parallel simulation with exact totals, and an
// execute loop that pauses every job before its first send.
import { PACKET_LIMIT, wireSize } from "@bondr/core/send";
import {
  AccountLayout,
  decodeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
  TokenInstruction,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { memoryAudit } from "./admin-audit.ts";
import { allowFor, refusedDestination } from "./admin-dest.ts";
import {
  buildBatch,
  EVAC_SIM_CONCURRENCY,
  evacuateBalances,
  packBatches,
  simulateEvacuate,
  type WBalance,
} from "./admin-evacuate.ts";
import type { MoneyCtx } from "./admin-money.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { type FeeDeps, land, noteOps } from "./fee-send.ts";

vi.mock("./switches.ts", () => ({ pauseAll: vi.fn() }));

const Q = PublicKey.unique();
const OPS = Keypair.generate();
const TREASURY = PublicKey.unique();
const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);

type Info = { lamports: number; data: Buffer; owner: PublicKey };
let chain: Map<string, Info>;
let reads: number[];
let sims: { inFlight: number; max: number; count: number; failOn: PublicKey | null; delay: number };

function token(mint: PublicKey, owner: PublicKey, amount: bigint): Info {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      ...{ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1 },
      ...{ isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0 },
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { lamports: 2_039_280, data, owner: T22 };
}

// One coin's W on the fake chain; zero balances leave the account absent.
function coin(lamports = 5_000_000n, bondr = 1_000_000n, child = 42_000_000n) {
  const c = { mint: PublicKey.unique(), w: Keypair.generate() };
  const w = c.w.publicKey;
  if (lamports)
    chain.set(w.toBase58(), {
      lamports: Number(lamports),
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
    });
  if (bondr) chain.set(ata(Q, w).toBase58(), token(Q, w, bondr));
  if (child) chain.set(ata(c.mint, w).toBase58(), token(c.mint, w, child));
  return c;
}
const coins = (n: number) => Array.from({ length: n }, () => coin());

const conn = {
  getMultipleAccountsInfo: async (keys: PublicKey[]) => {
    reads.push(keys.length);
    return keys.map((k) => chain.get(k.toBase58()) ?? null);
  },
  simulateTransaction: async (tx: VersionedTransaction) => {
    sims.inFlight++;
    sims.max = Math.max(sims.max, sims.inFlight);
    sims.count++;
    await new Promise((r) => setTimeout(r, sims.delay));
    sims.inFlight--;
    const bad = sims.failOn && tx.message.staticAccountKeys.some((k) => k.equals(sims.failOn as PublicKey));
    return {
      value: {
        err: bad ? { InstructionError: [2, { Custom: 1 }] } : null,
        unitsConsumed: 9_000,
        accounts: null,
      },
    };
  },
};

let deps: FeeDeps;
let ctx: MoneyCtx & { evacuate: "simulate" | "on" };
let list: ReturnType<typeof coins>;

beforeEach(() => {
  [chain, reads] = [new Map(), []];
  sims = { inFlight: 0, max: 0, count: 0, failOn: null, delay: 0 };
  deps = {
    ...{ net: "devnet", mode: "on", Q, ops: OPS, treasury: TREASURY, buyback: Keypair.generate(), conn },
    ...{ ledger: memoryLedger(), windowMs: 1000, bondrSol: () => 0.5, publish: vi.fn(), land: vi.fn() },
  } as unknown as FeeDeps;
  list = [];
  const audit = memoryAudit();
  ctx = { deps, engine: null, audit, admin: null, site: "https://trybondr.fun", evacuate: "simulate" };
  ctx.coins = async () => list;
});

const balances = (n: number) => evacuateBalances(deps, coins(n));
const perW = (bs: WBalance[]) => bs.map((b) => ({ b, ixs: buildBatch(deps, [b]).ixs.slice(1) }));
const sizeOf = (ixs: TransactionInstruction[]) =>
  wireSize(OPS.publicKey, [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
    ...ixs,
  ]);

test("balances come from one read per 100 accounts and skip an empty W", async () => {
  const cs = [...coins(39), coin(0n, 0n, 0n)];
  const bs = await evacuateBalances(deps, cs);
  expect(reads).toEqual([100, 20]);
  expect(bs).toHaveLength(39);
  expect(bs[0]).toMatchObject({ lamports: 5_000_000n, bondr: 1_000_000n, child: 42_000_000n });
  expect(bs[0]?.childProgram.equals(T22)).toBe(true);
});

test("packing keeps every batch under the packet limit, in order, each W exactly once", async () => {
  const bs = await balances(10);
  const batches = packBatches(OPS.publicKey, perW(bs));
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flat()).toEqual(bs);
  for (const batch of batches) expect(sizeOf(buildBatch(deps, batch).ixs)).toBeLessThanOrEqual(PACKET_LIMIT);
  // A W that alone nearly fills a packet goes in its own batch.
  const [a, b, c] = bs as [WBalance, WBalance, WBalance];
  const fat = SystemProgram.transfer({ fromPubkey: b.w.publicKey, toPubkey: TREASURY, lamports: 1 });
  fat.data = Buffer.alloc(800);
  const packed = packBatches(OPS.publicKey, [...perW([a]), { b, ixs: [fat] }, ...perW([c])]);
  expect(packed).toEqual([[a], [b], [c]]);
});

test("a batch pays only the treasury, burns child tokens and lets each W sign", async () => {
  const bs = await balances(3);
  const job = buildBatch(deps, bs);
  expect(job.signers).toEqual(bs.map((b) => b.w));
  expect(job.facts).toBeUndefined();
  const toTreasury = ata(Q, TREASURY);
  const seen = { transfer: 0, burn: 0, sol: 0 };
  for (const ix of job.ixs) {
    if (ix.programId.equals(SystemProgram.programId)) {
      const t = SystemInstruction.decodeTransfer(ix);
      const b = bs.find((x) => x.w.publicKey.equals(t.fromPubkey));
      expect(t.toPubkey.equals(TREASURY) && t.lamports === b?.lamports).toBe(true);
      seen.sol++;
    } else if (ix.programId.equals(T22)) {
      const d = decodeInstruction(ix, T22);
      const b = bs.find((x) => ix.keys.some((k) => k.pubkey.equals(x.w.publicKey)));
      if (d.data.instruction === TokenInstruction.TransferChecked) {
        expect(ix.keys[1]?.pubkey.equals(Q) && ix.keys[2]?.pubkey.equals(toTreasury)).toBe(true);
        expect((d.data as { amount: bigint }).amount).toBe(b?.bondr);
        seen.transfer++;
      } else {
        expect(d.data.instruction).toBe(TokenInstruction.BurnChecked);
        expect(ix.keys[1]?.pubkey.equals(b?.mint as PublicKey)).toBe(true);
        expect((d.data as { amount: bigint }).amount).toBe(b?.child);
        seen.burn++;
      }
    }
  }
  expect(seen).toEqual({ transfer: 3, burn: 3, sol: 3 });
  const mints = [Q, ...bs.map((b) => b.mint)];
  const loose = allowFor({
    treasury: TREASURY,
    internal: bs.map((b) => b.w.publicKey),
    mints,
    closeTo: TREASURY,
  });
  expect(refusedDestination(job.ixs, loose)).toBeNull();
  const strict = allowFor({ treasury: TREASURY, internal: [], mints: [Q], closeTo: TREASURY });
  expect(refusedDestination(job.ixs, strict)).toBeNull();
});

test("an EVACUATE batch is urgent, so base land sends it below the ops floor (CR-W-01)", async () => {
  noteOps(0);
  try {
    const job = buildBatch(deps, await balances(1));
    expect(job.urgent).toBe(true);
    const past = new Error("past the ops floor");
    const d = {
      ...deps,
      conn: { getLatestBlockhash: async () => Promise.reject(past) },
    } as unknown as FeeDeps;
    await expect(land(d, job)).rejects.toBe(past);
    await expect(land(d, { ...job, urgent: false })).resolves.toEqual({ state: "skipped" });
  } finally {
    noteOps(1_000_000_000);
  }
});

test("rows: one evacuate row per W with its own amount and sol, a leftover_burn row per W with child", async () => {
  const cs = [coin(), coin(1n, 3_000_000n, 0n)];
  const bs = await evacuateBalances(deps, cs);
  const { rows } = buildBatch(deps, bs);
  const [m0, m1] = cs.map((c) => c.mint.toBase58());
  expect(rows).toEqual([
    { kind: "evacuate", mint: m0, amount: 1_000_000n, sol: 500_000n },
    { kind: "leftover_burn", mint: m0, burned: 42_000_000n },
    { kind: "evacuate", mint: m1, amount: 3_000_000n, sol: 1_500_000n },
  ]);
  // IN-W-01: SOL only names the lamports, never "Moved 0 BONDR"; child only writes just its burn.
  const [solOnly, childOnly] = [coin(7n, 0n, 0n), coin(0n, 0n, 9n)];
  const more = buildBatch(deps, await evacuateBalances(deps, [solOnly, childOnly])).rows;
  expect(more).toEqual([
    { kind: "evacuate", mint: solOnly.mint.toBase58(), sol: 7n },
    { kind: "leftover_burn", mint: childOnly.mint.toBase58(), burned: 9n },
  ]);
});

test("an unsplit collect closes as its split in the same tx, out of the evacuate amount (WR-W-10)", async () => {
  const c = coin(1n, 3_000_000n, 0n);
  const mint = c.mint.toBase58();
  await deps.ledger.insertPending([{ kind: "collect", mint }], "col", 1n);
  await deps.ledger.settle("col", "landed", { facts: { collect: { amount: 2_000_000n } }, slot: 1n });
  const [open] = await deps.ledger.openCollects(mint);
  const { rows } = buildBatch(deps, await evacuateBalances(deps, [c]));
  expect(rows).toEqual([
    { kind: "split_treasury", mint, ref: open?.id, amount: 200_000n, sol: 100_000n },
    { kind: "evacuate", mint, amount: 2_800_000n, sol: 1_400_000n },
  ]);
  await deps.ledger.insertPending(rows, "evac", 1n);
  await deps.ledger.settle("evac", "landed", { slot: 2n });
  expect(await deps.ledger.openCollects(mint)).toEqual([]);
});

test("simulate totals the wallets; simulate mode gives no intent, on mode does; nothing gives nothing", async () => {
  list = [coin(), coin(7n, 2_000_000n, 0n)];
  const sim = await simulateEvacuate(ctx);
  expect(sim).toMatchObject({ action: "evacuate", mint: null, ok: true, nothing: false });
  expect(sim.totals).toEqual({
    ...{ wallets: 2, bondr: "3000000", bondrSol: "1500000", sol: "5000007", burnedIn: 1, failures: 0 },
  });
  expect(sim.destinations).toEqual({ ok: true, passed: ["treasury matches config"] });
  expect(sim.intent).toBeUndefined();
  ctx.evacuate = "on";
  const on = await simulateEvacuate(ctx);
  expect(on.intent?.message).toContain(`Treasury ${TREASURY.toBase58()}`);
  expect(on.intent?.message).toContain("Action: evacuate");
  deps.bondrSol = () => null;
  expect((await simulateEvacuate(ctx)).totals?.bondrSol).toBe("0");
  list = [coin(0n, 0n, 0n)];
  const none = await simulateEvacuate(ctx);
  expect(none).toMatchObject({ nothing: true, ok: false });
  expect(none.intent).toBeUndefined();
});

test("200 W simulate at most 8 at a time, each batch once; a failing batch counts only its wallets", async () => {
  list = coins(200);
  sims.delay = 5;
  sims.failOn = list[100]?.w.publicKey ?? null;
  ctx.evacuate = "on";
  const sim = await simulateEvacuate(ctx);
  expect(EVAC_SIM_CONCURRENCY).toBe(8);
  expect(sims.max).toBe(8);
  expect(sims.count).toBe(sim.steps.length);
  expect(sim.totals?.wallets).toBe(200);
  const failed = sim.steps.filter((s) => !s.ok).length;
  expect(failed).toBe(1);
  expect(sim.totals?.failures).toBeGreaterThan(0);
  expect(sim.totals?.failures).toBeLessThan(10);
  expect(sim.error).toBe("insufficient_balance");
  expect(sim.ok).toBe(true);
  expect(sim.intent).toBeDefined();
});
