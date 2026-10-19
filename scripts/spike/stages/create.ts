// SPIKE-01: the BONDR stand-in Q (SOL pair, treasury creator, D-04), then a child create_v2 with creator = W
// and quote = Q. Devnet also proves the program refuses creator_fee_bps 150 (Pitfall 7).
import { buildCreate, type Coin } from "@bondr/core/launch";
import { BN, OnlinePumpSdk, type PumpQuoteAccounts } from "@bondr/core/pump";
import { budget, sendTx } from "@bondr/core/send";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundFork, fundSol, paceMs, prefundMint } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";

const CU = 300_000;
const URI = "https://gateway.pinata.cloud/ipfs/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
export const STANDIN: Coin = { name: "BONDR Stand In", symbol: "BSTAND", uri: URI };
export const CHILD: Coin = { name: "BONDR Spike Child", symbol: "BCHILD", uri: URI };
// Spend estimate per create (mint, curve, ATAs) on top of the live rent; leftovers stay with the dev.
export const PER_CREATE = 0.05 * LAMPORTS_PER_SOL;

const fresh = (): boolean => process.env.SPIKE_FRESH === "1";
const passed = (ctx: Ctx, id: string): boolean => ctx.file.rows.some((r) => r.id === id && r.ok);

async function standIn(ctx: Ctx, dev: Keypair): Promise<PublicKey> {
  if (ctx.file.state.Q && passed(ctx, "standin.create") && !fresh()) return new PublicKey(ctx.file.state.Q);
  const mint = Keypair.generate();
  await prefundMint(ctx, mint.publicKey, dev);
  const creator = ctx.key("treasury", "main").publicKey;
  const ix = await buildCreate({ ...STANDIN, mint: mint.publicKey, creator, user: dev.publicKey });
  const r = await sendTx({
    conn: ctx.conn,
    payer: dev,
    signers: [mint],
    ixs: [...budget(CU), ix],
    paceMs: paceMs(ctx),
  });
  if (r.ok) ctx.file.state.Q = mint.publicKey.toBase58();
  ctx.record({
    id: "standin.create",
    step: "Stand-in Q create_v2 (SOL pair, treasury creator)",
    ...r,
    cuLimit: CU,
    facts: { Q: mint.publicKey.toBase58(), creator: creator.toBase58() },
  });
  if (!r.ok) throw new Error(`stand-in create failed: ${r.err}`);
  return mint.publicKey;
}

type ChildOpts = { ctx: Ctx; dev: Keypair; Q: PublicKey; pumpQuote: PumpQuoteAccounts; bps?: number };

async function childTx(o: ChildOpts, expectFail: boolean) {
  const mint = Keypair.generate();
  const W = o.ctx.key("w", mint.publicKey.toBase58()).publicKey;
  await prefundMint(o.ctx, mint.publicKey, o.dev);
  const ix = await buildCreate({
    ...CHILD,
    mint: mint.publicKey,
    creator: W,
    user: o.dev.publicKey,
    quoteMint: o.Q,
    pumpQuote: o.pumpQuote,
    creatorFeeBps: o.bps === undefined ? undefined : new BN(o.bps),
  });
  const ixs = [...budget(CU), ix];
  const r = await sendTx({
    conn: o.ctx.conn,
    payer: o.dev,
    signers: [mint],
    ixs,
    expectFail,
    paceMs: paceMs(o.ctx),
  });
  return { r, mint: mint.publicKey, W };
}

async function child(o: ChildOpts, online: InstanceType<typeof OnlinePumpSdk>): Promise<void> {
  const { r, mint, W } = await childTx(o, false);
  const facts: Record<string, string | number> = { mint: mint.toBase58(), W: W.toBase58() };
  if (r.ok) {
    const curve = await online.fetchBondingCurve(mint);
    facts.creator = curve.creator.toBase58();
    facts.quoteMint = curve.quoteMint.toBase58();
    facts.depth = curve.depth;
    facts.creatorFeeBps = curve.creatorFeeBps.toString();
    o.ctx.file.state.C0 = mint.toBase58();
  }
  const step = `Child create_v2 (quote Q, creator W${o.bps ? `, ${o.bps} bps` : ", default fee"})`;
  o.ctx.record({ id: "child.create", step, ...r, cuLimit: CU, facts });
  if (!r.ok) throw new Error(`child create failed: ${r.err}`);
}

// createV2Instruction holds no Global, so the refusal normally comes from the program itself (6077). Only
// the builders that read Global throw CreatorFeeNotConfigurableError client-side.
async function refused150(o: ChildOpts): Promise<void> {
  const id = "child.create150.refused";
  const step = "Child create_v2 with creator_fee_bps 150 (devnet must refuse)";
  try {
    const { r, mint } = await childTx({ ...o, bps: 150 }, true);
    o.ctx.record({ id, step, ...r, expectFail: true, cuLimit: CU, facts: { mint: mint.toBase58() } });
  } catch (e) {
    if (!(e instanceof Error) || e.name !== "CreatorFeeNotConfigurableError") throw e;
    const notes = "refused client-side by SDK; program code 6077 per IDL";
    o.ctx.record({ id, step, ok: true, expectFail: true, err: e.name, notes });
  }
}

const sigOk: Rule = (row) => (row.sig ? null : "no signature");

function childRule(net: Ctx["net"]): Rule {
  return (row, file) => {
    const f = row.facts ?? {};
    if (!row.sig) return "no signature";
    if (f.creator !== f.W) return `creator ${f.creator} is not W ${f.W}`;
    if (f.quoteMint !== file.state.Q) return `quoteMint ${f.quoteMint} is not Q ${file.state.Q}`;
    if (f.depth !== 1) return `depth ${f.depth}, expected 1`;
    if (net === "fork" && f.creatorFeeBps !== "150") return `creatorFeeBps ${f.creatorFeeBps}, expected 150`;
    return null;
  };
}

// Code and name together, so another program's 6077 cannot pass. The SDK's client-side refusal has no
// code because nothing was sent.
const refusedRule: Rule = (row) => {
  if (!row.expectFail) return "not recorded as an expected failure";
  if (!row.err?.startsWith("CreatorFeeNotConfigurable")) return `logged error ${row.err}, expected 6077 name`;
  const clientSide = !row.sig && row.code === undefined;
  return row.code === 6077 || clientSide ? null : `code ${row.code}, expected 6077`;
};

export const createStage: Stage = {
  name: "create",
  rules: (net) => ({
    "standin.create": sigOk,
    "child.create": childRule(net),
    ...(net === "devnet" ? { "child.create150.refused": refusedRule } : {}),
  }),
  async run(ctx) {
    const online = new OnlinePumpSdk(ctx.conn);
    const dev = ctx.key("sim", "dev");
    await fundFork(ctx);
    const rent = await ctx.conn.getMinimumBalanceForRentExemption(0);
    await fundSol(ctx, dev.publicKey, rent + 2 * PER_CREATE);
    const Q = await standIn(ctx, dev);
    const pq = await online.fetchPumpQuote(Q, { global: await online.fetchGlobal() });
    if (!pq) throw new Error(`fetchPumpQuote returned null for Q ${Q.toBase58()}`);
    const o: ChildOpts = { ctx, dev, Q, pumpQuote: pq.accounts, bps: ctx.net === "fork" ? 150 : undefined };
    if (!passed(ctx, "child.create") || fresh()) await child(o, online);
    if (ctx.net === "devnet" && (!passed(ctx, "child.create150.refused") || fresh())) await refused150(o);
  },
};
