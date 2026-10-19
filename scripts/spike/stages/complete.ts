// D-05 state 2: a child create on a complete, unmigrated stand-in must fail with 6107
// QuoteCurveAwaitingMigration, then a whale completes Q for real. Runs last on devnet: a complete Q blocks
// every later child and route there.
//
// Pump runs a migration crank on devnet: it migrated Q 10 slots after the whale completed it (slot
// 512704051 -> 512704061), before a separate create could land. So the 6107 proof is one tx, [buy that
// completes the stand-in, child create on it]: the create always sees the window, and the whole tx reverts,
// so the stand-in stays untouched and the buy costs only the fee.
import { createTable, tableKeys } from "@bondr/core/alt";
import { costToComplete, readCurve } from "@bondr/core/curve";
import { buildCreate } from "@bondr/core/launch";
import { BN, OnlinePumpSdk, PUMP_SDK } from "@bondr/core/pump";
import { budget, PACKET_LIMIT, sendTx, wireSize } from "@bondr/core/send";
import {
  createAssociatedTokenAccountIdempotentInstruction as ataIx,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type AddressLookupTableAccount,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { fundSol, paceMs, prefundMint } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";
import { CHILD, STANDIN } from "./create.ts";

const CU = 600_000;
const FEES = 0.05 * LAMPORTS_PER_SOL; // tx fees, Q ATA, volume accumulator and lookup table rent
const RESERVE = LAMPORTS_PER_SOL; // devnet SOL plan 01-10 still needs for its refresh
const SKIP_NOTE = "devnet SOL short; 6107 proven on the fork per D-01";
type Online = InstanceType<typeof OnlinePumpSdk>;
type Plan = { Q: PublicKey; cost: BN; spend: BN };
const facts = (p: Plan) => ({ quote: p.Q.toBase58(), cost: p.cost.toString(), spend: p.spend.toString() });

function skip(ctx: Ctx, p: Plan): void {
  const row = { ok: true, notes: SKIP_NOTE, facts: { ...facts(p), skipped: true } };
  ctx.record({ id: "quote.complete", step: "Whale completes stand-in Q (skipped)", ...row });
  ctx.record({ id: "child.create.6107", step: "Child create on a complete Q (skipped)", ...row });
}

// 6% over the quoted cost: Q moves between quote and landing, and any excess buys from the pool-to-be.
// applyBps stops at 100% on purpose (it is the slippage-floor helper), so the markup is plain BN math.
async function plan(online: Online, Q: PublicKey): Promise<Plan> {
  const cost = await costToComplete(online, Q);
  return { Q, cost, spend: cost.muln(106).divn(100) };
}

async function buyIxs(online: Online, buyer: PublicKey, p: Plan): Promise<TransactionInstruction[]> {
  const buyback = (await online.fetchGlobal()).buybackFeeRecipients[0];
  const ata = getAssociatedTokenAddressSync(p.Q, buyer, true, T22);
  return [
    ataIx(buyer, ata, buyer, p.Q, T22),
    await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({
      user: buyer,
      mint: p.Q,
      spendableQuoteIn: p.spend,
      minTokensOut: new BN(1),
      tokenProgram: T22,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      buybackFeeRecipient: buyback,
    }),
  ];
}

async function completeQ(ctx: Ctx, online: Online, p: Plan): Promise<void> {
  const whale = ctx.key("sim", "whale");
  const ixs = [...budget(CU), ...(await buyIxs(online, whale.publicKey, p))];
  const r = await sendTx({ conn: ctx.conn, payer: whale, ixs, paceMs: paceMs(ctx) });
  const complete = r.ok && (await readCurve(online, p.Q)).complete;
  const step = "Whale buy_exact_quote_in_v3 completes stand-in Q";
  ctx.record({ id: "quote.complete", step, ...r, cuLimit: CU, facts: { ...facts(p), complete } });
  if (!complete) throw new Error(`Q did not complete: ${r.err ?? "curve not complete after the buy"}`);
  ctx.file.state["Q.complete"] = "true";
}

// Only when Q already completed in an earlier run: the atomic test needs a curve that is not complete yet.
async function freshStandIn(ctx: Ctx): Promise<PublicKey> {
  const whale = ctx.key("sim", "whale");
  const mint = Keypair.generate();
  await prefundMint(ctx, mint.publicKey, whale);
  const creator = ctx.key("treasury", "main").publicKey;
  const ix = await buildCreate({ ...STANDIN, mint: mint.publicKey, creator, user: whale.publicKey });
  const r = await sendTx({
    conn: ctx.conn,
    payer: whale,
    signers: [mint],
    ixs: [...budget(CU), ix],
    paceMs: paceMs(ctx),
  });
  ctx.record({
    id: "aux.standin2.create",
    step: "Fresh stand-in Q2 for the 6107 test",
    ...r,
    facts: { Q2: mint.publicKey.toBase58() },
  });
  if (!r.ok) throw new Error(`stand-in Q2 create failed: ${r.err}`);
  ctx.file.state.Q2 = mint.publicKey.toBase58();
  return mint.publicKey;
}

// The buy plus the create can pass the packet limit; a lookup table is made only when it does.
async function tablesFor(ctx: Ctx, ixs: TransactionInstruction[]): Promise<AddressLookupTableAccount[]> {
  const whale = ctx.key("sim", "whale");
  if (wireSize(whale.publicKey, ixs) <= PACKET_LIMIT) return [];
  const { table, txs, ...t } = await createTable(ctx.conn, whale, tableKeys(ixs), paceMs(ctx));
  ctx.record({ id: "aux.6107.table", step: "Lookup table for the 6107 tx", ...t, facts: { txs } });
  if (!table) throw new Error(`lookup table for the 6107 tx failed: ${t.err}`);
  return [table];
}

async function child6107(ctx: Ctx, online: Online, p: Plan): Promise<void> {
  const whale = ctx.key("sim", "whale").publicKey;
  const mint = Keypair.generate();
  const W = ctx.key("w", mint.publicKey.toBase58()).publicKey;
  const pq = await online.fetchPumpQuote(p.Q, { global: await online.fetchGlobal() });
  if (!pq) throw new Error(`fetchPumpQuote returned null for ${p.Q.toBase58()}`);
  await prefundMint(ctx, mint.publicKey, ctx.key("sim", "whale"));
  const create = await buildCreate({
    ...CHILD,
    mint: mint.publicKey,
    creator: W,
    user: whale,
    quoteMint: p.Q,
    pumpQuote: pq.accounts,
  });
  const ixs = [...budget(CU), ...(await buyIxs(online, whale, p)), create];
  const r = await sendTx({
    conn: ctx.conn,
    payer: ctx.key("sim", "whale"),
    signers: [mint],
    ixs,
    tables: await tablesFor(ctx, ixs),
    expectFail: true,
    paceMs: paceMs(ctx),
  });
  const step = "One tx: buy completes the stand-in, then child create_v2 on it (must fail 6107)";
  const f = { ...facts(p), mint: mint.publicKey.toBase58(), W: W.toBase58() };
  ctx.record({ id: "child.create.6107", step, ...r, expectFail: true, cuLimit: CU, facts: f });
}

// Devnet may skip both rows together (D-01); the fork never skips.
const allowSkip =
  (net: Ctx["net"], rule: Rule): Rule =>
  (row, file) => {
    if (!row.facts?.skipped) return rule(row, file);
    const both = file.rows.filter((r) => r.id === "quote.complete" || r.id === "child.create.6107");
    const ok = net === "devnet" && both.length === 2 && both.every((r) => r.facts?.skipped === true);
    return ok ? null : `skipped on ${net}, or only one of the two rows skipped`;
  };

const completeRule: Rule = (row) => {
  if (!row.sig) return "no signature";
  return row.facts?.complete === true ? null : "Q curve not complete after the buy";
};

const refusedRule: Rule = (row) => {
  if (!row.expectFail || !row.sig) return "not a landed expected failure";
  if (row.code !== 6107) return `code ${row.code}, expected 6107`;
  return row.err?.startsWith("QuoteCurveAwaitingMigration") ? null : `logged error ${row.err}`;
};

export const completeStage: Stage = {
  name: "complete",
  rules: (net) => ({
    "quote.complete": allowSkip(net, completeRule),
    "child.create.6107": allowSkip(net, refusedRule),
  }),
  async run(ctx) {
    if (!ctx.file.state.Q) throw new Error("no stand-in Q in state: run the create stage first");
    const online = new OnlinePumpSdk(ctx.conn);
    const Q = new PublicKey(ctx.file.state.Q);
    const whale = ctx.key("sim", "whale").publicKey;
    const qDone = (await readCurve(online, Q)).complete;
    if (qDone) await fundSol(ctx, whale, FEES); // the Q2 create comes before the spend is known
    const p = await plan(online, qDone ? await freshStandIn(ctx) : Q);
    const ops = await ctx.conn.getBalance(ctx.key("ops", "main").publicKey);
    if (ctx.net === "devnet" && ops < p.spend.toNumber() + FEES + RESERVE) {
      skip(ctx, p);
      return;
    }
    await fundSol(ctx, whale, p.spend.toNumber() + FEES);
    await child6107(ctx, online, p); // reverts, so the whale still holds the spend for completeQ
    if (!qDone) await completeQ(ctx, online, p);
  },
};
