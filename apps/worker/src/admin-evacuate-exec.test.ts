// EVACUATE's execute loop (ADMIN-11, D-35, D-37): every switch off before the first send, each batch after its
// coins' queued jobs settle and rebuilt from fresh balances, paced, gated by the signed allowlist, with the
// intent counting moved and failed W and the audit settled once. Refused unless ADMIN_EVACUATE is on and devnet.
import {
  AccountLayout,
  decodeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
  TokenInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { memoryAudit } from "./admin-audit.ts";
import { allowFor } from "./admin-dest.ts";
import { evacuateAllow, executeEvacuate } from "./admin-evacuate.ts";
import { type Intent, putIntent, viewIntent } from "./admin-intent.ts";
import type { MoneyCtx } from "./admin-money.ts";
import type { Engine } from "./fee-engine.ts";
import type { FeeDeps, Job, Landed } from "./fee-send.ts";
import { Fail } from "./http.ts";

const order = vi.hoisted(() => [] as string[]);
vi.mock("./switches.ts", () => ({ pauseAll: vi.fn(async () => void order.push("pause")) }));
vi.mock("@bondr/core/send", async (orig) => ({
  ...((await orig()) as object),
  pace: vi.fn(async () => void order.push("pace")),
}));

const Q = PublicKey.unique();
const OPS = Keypair.generate();
const TREASURY = PublicKey.unique();
const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);

let chain: Map<string, { lamports: number; data: Buffer; owner: PublicKey }>;
function bondrAt(owner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      ...{ mint: Q, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1 },
      ...{ isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0 },
      closeAuthority: PublicKey.default,
    },
    data,
  );
  chain.set(ata(Q, owner).toBase58(), { lamports: 2_039_280, data, owner: T22 });
}
function coin() {
  const c = { mint: PublicKey.unique(), w: Keypair.generate() };
  chain.set(c.w.publicKey.toBase58(), {
    lamports: 900_000,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
  });
  bondrAt(c.w.publicKey, 1_000_000n);
  return c;
}

let list: ReturnType<typeof coin>[];
let jobs: Job[];
let outcomes: Landed[];
let audit: ReturnType<typeof memoryAudit>;
let ctx: MoneyCtx;
let deps: FeeDeps;
let n = 0;

beforeEach(() => {
  [chain, jobs, outcomes, order.length] = [new Map(), [], [], 0];
  list = Array.from({ length: 8 }, coin);
  const conn = {
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => chain.get(k.toBase58()) ?? null),
  };
  deps = {
    ...{ net: "devnet", mode: "on", Q, ops: OPS, treasury: TREASURY, conn, bondrSol: () => 1 },
    land: vi.fn(async (job: Job) => {
      order.push("land");
      jobs.push(job);
      return outcomes.shift() ?? { state: "landed", sig: `e${++n}` };
    }),
  } as unknown as FeeDeps;
  audit = memoryAudit();
  ctx = { deps, engine: null, audit, admin: null, evacuate: "on", coins: async () => list };
});

async function started(allowed = evacuateAllow(deps)): Promise<{ e: Intent; auditId: string }> {
  const e = putIntent({ action: "evacuate", mint: null, to: [], data: { allowed, summary: {} } });
  Object.assign(e, { used: true, state: "sending" });
  const auditId = await audit.insertPending({
    ...{ actor: "owner", action: "evacuate", mint: null, params: { wallets: list.length } },
    ...{ simulation: {}, intentSig: "sig" },
  });
  return { e, auditId };
}

const amounts = (job: Job) =>
  job.ixs
    .filter((ix) => ix.programId.equals(T22))
    .map((ix) => decodeInstruction(ix, T22).data as { instruction: number; amount: bigint })
    .filter((d) => d.instruction === TokenInstruction.TransferChecked)
    .map((d) => d.amount);

test("pauses every job first, then each batch after idle, rebuilt fresh and paced; audit settles landed", async () => {
  const idle = vi.fn(async (mints: string[]) => void order.push(`idle ${mints.length}`));
  ctx.engine = { idle } as unknown as Engine;
  (deps.land as ReturnType<typeof vi.fn>).mockImplementationOnce(async (job: Job) => {
    order.push("land");
    jobs.push(job);
    bondrAt(list[7]?.w.publicKey as PublicKey, 5n); // moved on chain between batches
    return { state: "landed", sig: "first" };
  });
  const { e, auditId } = await started();
  await executeEvacuate(ctx, e, auditId);
  expect(order[0]).toBe("pause");
  expect(order.indexOf("pause")).toBeLessThan(order.indexOf("land"));
  expect(order.filter((o) => o === "land").length).toBe(jobs.length);
  expect(jobs.length).toBeGreaterThan(1);
  expect(order.slice(1)).toEqual(
    jobs.flatMap((j, i) => [...(i ? ["pace"] : []), `idle ${j.signers.length}`, "land"]),
  );
  expect(amounts(jobs.at(-1) as Job).at(-1)).toBe(5n);
  const v = viewIntent(e.id);
  expect(v).toMatchObject({ state: "landed", moved: 8, failed: 0, landed: jobs.length, total: jobs.length });
  expect(audit.rows[0]).toMatchObject({ result: "landed", sigs: v?.sigs });
  expect(v?.sigs[0]).toBe("first");
});

test("a failed batch counts its wallets failed, later batches still go, and the audit settles failed", async () => {
  outcomes = [{ state: "failed", sig: "bad", code: 1 }];
  const { e, auditId } = await started();
  await executeEvacuate(ctx, e, auditId);
  const failed = jobs[0]?.signers.length ?? 0;
  expect(viewIntent(e.id)).toMatchObject({ state: "failed", code: "code 1", moved: 8 - failed, failed });
  expect(audit.rows[0]).toMatchObject({ result: "failed", error: "code 1" });
  expect(audit.rows[0]?.sigs).toHaveLength(jobs.length);
});

test("a batch whose land throws counts its wallets failed and later batches still go (WR-W-02)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  (deps.land as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
    throw new Error("getLatestBlockhash 429");
  });
  const { e, auditId } = await started();
  await executeEvacuate(ctx, e, auditId);
  const sent = jobs.flatMap((j) => j.signers).length;
  expect(sent).toBeGreaterThan(0);
  expect(viewIntent(e.id)).toMatchObject({
    state: "failed",
    code: "build_failed",
    moved: sent,
    failed: 8 - sent,
  });
  expect(audit.rows[0]).toMatchObject({ result: "failed", error: "build_failed" });
});

test("the gated land refuses a tx outside the signed allowlist and stops before base land", async () => {
  const { e, auditId } = await started(allowFor({ internal: [], mints: [Q], closeTo: TREASURY }));
  await executeEvacuate(ctx, e, auditId);
  expect(deps.land).not.toHaveBeenCalled();
  expect(viewIntent(e.id)).toMatchObject({ state: "refused", code: "destination_refused" });
  expect(audit.rows[0]).toMatchObject({ result: "refused" });
});

test("simulate mode and any net but devnet refuse with 409 before pausing anything", async () => {
  const { e, auditId } = await started();
  const refusal = async () =>
    executeEvacuate(ctx, e, auditId).then(
      () => "ok",
      (err) => (err instanceof Fail ? `${err.status} ${err.body.error} ${err.body.reason}` : "threw"),
    );
  ctx.evacuate = "simulate";
  expect(await refusal()).toBe("409 not_applicable simulate_only");
  ctx = { ...ctx, evacuate: "on", deps: { ...deps, net: "mainnet" } };
  expect(await refusal()).toBe("409 not_applicable devnet_only");
  expect(order).toEqual([]);
  expect(audit.rows[0]?.result).toBe("pending");
});
