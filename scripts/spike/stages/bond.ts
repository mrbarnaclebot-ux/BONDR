// SPIKE-03 forced bond on the fork (RESEARCH Pattern 6 step 2). A whale buys Q to about 90%, so a child's
// raise in Q is small. The whale tops up W2 (D-11, a TOP-UP, not trading fees), and W2's whole budget
// completes child C2 and burns what it bought in the same tx. The buy_v3 exact variant does the same on C2b.
// The burn is atomic with completion on purpose: on devnet pump's keeper migrated a completed curve about
// 10 slots later (01-05), so nothing may run between completion and the burn on mainnet.
import { exactBondIxs, forcedBondIxs } from "@bondr/core/bond";
import { costToComplete, readCurve } from "@bondr/core/curve";
import { completeEvents } from "@bondr/core/events";
import { buildCreate, COIN_DECIMALS } from "@bondr/core/launch";
import { applyBps, trigger105 } from "@bondr/core/math";
import { BN, type Global, OnlinePumpSdk } from "@bondr/core/pump";
import { budget, PACKET_LIMIT, type SendResult, sendTx } from "@bondr/core/send";
import { ataIx, buyExactIn } from "@bondr/core/trade";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { fundSol, prefundMint } from "../fund.ts";
import type { Ctx, Row, Rule, Stage } from "../results.ts";
import { CHILD } from "./create.ts";
import { tokenAmount } from "./launch.ts";

export const CU = 600_000;
type Online = InstanceType<typeof OnlinePumpSdk>;
type Facts = NonNullable<Row["facts"]>;
export type Run = { ctx: Ctx; online: Online; g: Global; Q: PublicKey; whale: Keypair; ops: Keypair };
type Tx = { id: string; step: string; payer: Keypair; ixs: TransactionInstruction[]; signers?: Keypair[] };
type Landed = { r: SendResult; tx: VersionedTransactionResponse };

const markup106 = (x: BN): BN => x.muln(106).divn(100); // applyBps stops at 100% (it is the floor helper)
export const supply = async (run: Run, mint: PublicKey) =>
  (await run.ctx.conn.getTokenSupply(mint)).value.amount;

// One landed tx per row. Facts are read after landing; a failed send still records its row, then throws.
export async function land(run: Run, tx: Tx, facts: (l: Landed) => Promise<Facts>, extra: Partial<Row> = {}) {
  const ixs = [...budget(CU), ...tx.ixs];
  const r = await sendTx({ conn: run.ctx.conn, payer: tx.payer, signers: tx.signers, ixs });
  const got =
    r.ok && r.sig
      ? await run.ctx.conn.getTransaction(r.sig, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
      : null;
  const f = got ? await facts({ r, tx: got }) : {};
  run.ctx.record({ id: tx.id, step: tx.step, ...r, cuLimit: CU, facts: f, ...extra });
  if (!r.ok || !got) throw new Error(`${tx.id} failed: ${r.err ?? "no transaction"}`);
  return f;
}

// Pitfall 3: W must stay rent-exempt and pays rent for its child ATA, a buyback Q ATA and the volume
// accumulator (137 bytes). Any excess stays in W as its gas float (PROJECT.md item 9).
export async function wFloat(run: Run, W: PublicKey, bytes = [0, 170, 170, 137]): Promise<number> {
  const rents = await Promise.all(bytes.map((b) => run.ctx.conn.getMinimumBalanceForRentExemption(b)));
  const need = rents.reduce((a, b) => a + b, 0) - (await run.ctx.conn.getBalance(W));
  return Math.max(0, need);
}

async function whale(run: Run): Promise<void> {
  const cost = await costToComplete(run.online, run.Q);
  const spend = new BN(applyBps(BigInt(cost.toString()), 9000).toString());
  await fundSol(run.ctx, run.whale.publicKey, spend.toNumber() + LAMPORTS_PER_SOL);
  const side = { global: run.g, mint: run.Q, user: run.whale.publicKey, quoteMint: NATIVE_MINT };
  const ixs = await buyExactIn({ ...side, spend, minOut: new BN(1) });
  const step = "Whale buy_exact_quote_in_v3 takes stand-in Q to about 90% (still state 1)";
  await land(run, { id: "bond.whale", step, payer: run.whale, ixs }, async () => ({
    qCost: cost.toString(),
    spend: spend.toString(),
    whaleQ: await tokenAmount(run.ctx, run.Q, run.whale.publicKey),
    complete: (await readCurve(run.online, run.Q)).complete,
  }));
}

async function createChild(run: Run, id: string, key: string): Promise<{ mint: PublicKey; W: Keypair }> {
  const [mint, dev] = [Keypair.generate(), run.ctx.key("sim", "dev")];
  const W = run.ctx.key("w", mint.publicKey.toBase58());
  await prefundMint(run.ctx, mint.publicKey, dev);
  const pq = await run.online.fetchPumpQuote(run.Q, { global: run.g });
  if (!pq) throw new Error(`fetchPumpQuote returned null for ${run.Q.toBase58()}`);
  const ix = await buildCreate({
    ...CHILD,
    mint: mint.publicKey,
    creator: W.publicKey,
    user: dev.publicKey,
    quoteMint: run.Q,
    pumpQuote: pq.accounts,
    creatorFeeBps: new BN(150),
  });
  const step = `Child ${key} create_v2 (quote Q, creator W, 150 bps) on the 90% Q`;
  await land(run, { id, step, payer: dev, signers: [mint], ixs: [ix] }, async () => ({
    mint: mint.publicKey.toBase58(),
    W: W.publicKey.toBase58(),
    childRaiseQ: (await costToComplete(run.online, mint.publicKey)).toString(),
  }));
  run.ctx.file.state[key] = mint.publicKey.toBase58();
  return { mint: mint.publicKey, W };
}

// D-11: the whale sends Q straight to W. It is labelled TOP-UP so it never reads as earned fees.
export async function topUp(run: Run, id: string, W: PublicKey, amount: BN, facts: Facts): Promise<void> {
  const ata = (o: PublicKey) => getAssociatedTokenAddressSync(run.Q, o, true, T22);
  const from = run.whale.publicKey;
  const ixs = [
    ataIx(from, run.Q, W),
    createTransferCheckedInstruction(
      ata(from),
      run.Q,
      ata(W),
      from,
      BigInt(amount.toString()),
      COIN_DECIMALS,
      [],
      T22,
    ),
  ];
  const step = `TOP-UP: whale sends ${amount} Q to W ${W.toBase58().slice(0, 8)}`;
  const notes = "D-11 direct top-up, not trading fees";
  await land(
    run,
    { id, step, payer: run.whale, ixs },
    async () => ({ ...facts, amount: amount.toString() }),
    {
      topUp: true,
      notes,
    },
  );
}

async function forced(run: Run, mint: PublicKey, W: Keypair, spend: BN): Promise<void> {
  const before = await supply(run, mint);
  const wFloatLamports = await wFloat(run, W.publicKey);
  const o = {
    conn: run.ctx.conn,
    global: run.g,
    ops: run.ops.publicKey,
    w: W.publicKey,
    mint,
    quoteMint: run.Q,
  };
  const { ixs, burnAmount } = await forcedBondIxs({ ...o, budget: spend, wFloatLamports });
  const step =
    "Forced bond: W buy_exact_quote_in_v3 with its whole budget completes C2, BurnChecked(simOut), one tx";
  const tx = { id: "bond.forced", step, payer: run.ops, signers: [W], ixs };
  await land(run, tx, async ({ r, tx: got }) => {
    run.ctx.file.state["bond.forced.sig"] = r.sig ?? "";
    const wChildAfter = await tokenAmount(run.ctx, mint, W.publicKey);
    return {
      simPath: "accounts",
      simOut: burnAmount.toString(),
      burnAmount: burnAmount.toString(),
      landedOut: (BigInt(burnAmount.toString()) + BigInt(wChildAfter)).toString(),
      budget: spend.toString(),
      wQAfter: await tokenAmount(run.ctx, run.Q, W.publicKey),
      supplyBefore: before,
      supplyAfter: await supply(run, mint),
      complete: (await readCurve(run.online, mint)).complete,
      wChildAfter,
      completeEvents: completeEvents(got).filter((e) => e.mint === mint.toBase58()).length,
      wFloatLamports,
    };
  });
}

async function exact(run: Run, mint: PublicKey, W: Keypair, maxQuote: BN): Promise<void> {
  const before = await supply(run, mint);
  const amount = (await readCurve(run.online, mint)).realTokenReserves;
  const wFloatLamports = await wFloat(run, W.publicKey);
  const o = { global: run.g, ops: run.ops.publicKey, w: W.publicKey, mint, quoteMint: run.Q };
  const ixs = await exactBondIxs({ ...o, amount, maxQuote, wFloatLamports });
  const step = "Exact bond: W buy_v3 of every token left completes C2b, BurnChecked(amount), one tx (D-16)";
  await land(run, { id: "bond.exact", step, payer: run.ops, signers: [W], ixs }, async ({ tx: got }) => ({
    amount: amount.toString(),
    maxQuote: maxQuote.toString(),
    wQAfter: await tokenAmount(run.ctx, run.Q, W.publicKey),
    supplyBefore: before,
    supplyAfter: await supply(run, mint),
    complete: (await readCurve(run.online, mint)).complete,
    wChildAfter: await tokenAmount(run.ctx, mint, W.publicKey),
    completeEvents: completeEvents(got).filter((e) => e.mint === mint.toBase58()).length,
    wFloatLamports,
  }));
}

async function forcedPath(run: Run): Promise<void> {
  const { mint, W } = await createChild(run, "bond.create", "C2");
  const cost2 = await costToComplete(run.online, mint);
  const spend = markup106(cost2);
  const trigger = trigger105(BigInt(spend.toString()), BigInt(cost2.toString()));
  await topUp(run, "bond.topup", W.publicKey, spend, {
    cost2: cost2.toString(),
    budget: spend.toString(),
    trigger,
  });
  if (!trigger) {
    run.ctx.record({ id: "bond.forced", step: "Forced bond (not sent)", ok: false, err: "trigger105 false" });
    throw new Error("trigger105 false: the budget is below 105% of the cost to complete");
  }
  await forced(run, mint, W, spend);
}

async function exactPath(run: Run): Promise<void> {
  const { mint, W } = await createChild(run, "bond.exact.create", "C2b");
  const cost = await costToComplete(run.online, mint);
  const maxQuote = markup106(cost);
  await topUp(run, "bond.exact.topup", W.publicKey, maxQuote, {
    cost: cost.toString(),
    maxQuote: maxQuote.toString(),
  });
  await exact(run, mint, W, maxQuote);
}

export async function newRun(ctx: Ctx): Promise<Run> {
  if (!ctx.file.state.Q) throw new Error("no stand-in Q in state: run the create stage first");
  const online = new OnlinePumpSdk(ctx.conn);
  const [whale, ops] = [ctx.key("sim", "whale"), ctx.key("ops", "main")];
  return { ctx, online, g: await online.fetchGlobal(), Q: new PublicKey(ctx.file.state.Q), whale, ops };
}

export const sigOk: Rule = (row) => (row.sig ? null : "no signature");
export const topUpRule: Rule = (row) =>
  !row.sig ? "no signature" : row.topUp === true ? null : "not labelled topUp";
export const burned = (f: Facts): bigint => BigInt(f.supplyBefore ?? 0) - BigInt(f.supplyAfter ?? 0);

function bondRule(amountKey: "burnAmount" | "amount"): Rule {
  return (row, file) => {
    const f = row.facts ?? {};
    if (!row.sig) return "no signature";
    if ((row.bytes ?? Infinity) > PACKET_LIMIT) return `${row.bytes} bytes > ${PACKET_LIMIT}`;
    if ((row.cu ?? Infinity) > (row.cuLimit ?? 0)) return `cu ${row.cu} > limit ${row.cuLimit}`;
    if (f.complete !== true) return "curve not complete after the bond";
    if (f.wChildAfter !== "0") return `W still holds ${f.wChildAfter} child tokens`;
    if (Number(f.completeEvents) < 1) return "no CompleteEvent for the child";
    if (burned(f) !== BigInt(f[amountKey] ?? -1))
      return `supply dropped ${burned(f)}, ${amountKey} ${f[amountKey]}`;
    if (amountKey === "amount") return null;
    const topup = file.rows.find((r) => r.id === "bond.topup")?.facts;
    return topup?.trigger === true ? null : "trigger105 not true on bond.topup";
  };
}

export const bondStage: Stage = {
  name: "bond",
  rules: () => ({
    "bond.whale": (row) => (!row.sig ? "no signature" : row.facts?.complete === false ? null : "Q completed"),
    "bond.create": sigOk,
    "bond.topup": topUpRule,
    "bond.forced": bondRule("burnAmount"),
    "bond.exact.create": sigOk,
    "bond.exact.topup": topUpRule,
    "bond.exact": bondRule("amount"),
  }),
  async run(ctx) {
    const run = await newRun(ctx);
    await whale(run);
    await forcedPath(run);
    await exactPath(run);
  },
};
