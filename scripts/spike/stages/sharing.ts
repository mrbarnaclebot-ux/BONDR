// SPIKE-04 devnet part: on unbonded C0, create_fee_sharing_config plus the one allowed update_fee_shares_v2
// (80/20), then a second update that pump-fees must reject. Ops pays fees; W signs as creator.
import { getPumpFeeProgram } from "@bondr/core/pump";
import { budget, type SendResult, sendTx } from "@bondr/core/send";
import { FINAL_SHARES, finalizeIxs, readSharing, SHARING_CONFIG_SIZE, updateIxs } from "@bondr/core/sharing";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { paceMs } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";

const CU = 400_000;
const W_BUFFER = 0.01 * LAMPORTS_PER_SOL;
type Keys = { mint: PublicKey; Q: PublicKey; deployer: PublicKey; treasury: PublicKey };

const passed = (ctx: Ctx, id: string): boolean =>
  ctx.file.rows.some((r) => r.id === id && r.ok) && process.env.SPIKE_FRESH !== "1";

function send(ctx: Ctx, ixs: TransactionInstruction[], expectFail = false): Promise<SendResult> {
  const W = ctx.key("w", ctx.file.state.C0);
  const ops = ctx.key("ops", "main");
  return sendTx({
    conn: ctx.conn,
    payer: ops,
    signers: [W],
    ixs: [...budget(CU), ...ixs],
    expectFail,
    paceMs: paceMs(ctx),
  });
}

// Pitfall 3: create_fee_sharing_config charges its rent to the creator, so ops tops W up in the same tx.
async function topUpW(ctx: Ctx): Promise<TransactionInstruction> {
  const rent = await ctx.conn.getMinimumBalanceForRentExemption(SHARING_CONFIG_SIZE);
  const toPubkey = ctx.key("w", ctx.file.state.C0).publicKey;
  return SystemProgram.transfer({
    fromPubkey: ctx.key("ops", "main").publicKey,
    toPubkey,
    lamports: rent + W_BUFFER,
  });
}

// One tx when it fits; a size refusal splits it into config then update, in the same order (A2).
async function finalize(ctx: Ctx, k: Keys): Promise<{ config: SendResult; update: SendResult }> {
  const W = ctx.key("w", k.mint.toBase58()).publicKey;
  const opts = { ...k, creator: W, payer: ctx.key("ops", "main").publicKey, quoteMint: k.Q };
  const ixs = [await topUpW(ctx), ...(await finalizeIxs(opts))];
  const one = await send(ctx, ixs);
  if (!one.err?.startsWith("too large")) return { config: one, update: one };
  const config = await send(ctx, ixs.slice(0, -1));
  return { config, update: config.ok ? await send(ctx, ixs.slice(-1)) : config };
}

async function setShares(ctx: Ctx, k: Keys): Promise<void> {
  const { config, update } = await finalize(ctx, k);
  const split = config.sig !== update.sig;
  const notes = split ? "split: config and update in two txs" : "config and update in one tx";
  ctx.record({
    id: "sharing.config",
    step: "create_fee_sharing_config (unbonded C0)",
    ...config,
    cuLimit: CU,
    notes,
  });
  if (!config.ok) throw new Error(`sharing config failed: ${config.err}`);
  const read = update.ok ? await readSharing(ctx.conn, k.mint) : undefined;
  const facts = {
    deployer: k.deployer.toBase58(),
    treasury: k.treasury.toBase58(),
    ...(read && {
      shares: read.shares.join(","),
      holders: read.holders.join(","),
      adminRevoked: read.adminRevoked,
    }),
  };
  ctx.record({
    id: "sharing.update",
    step: "update_fee_shares_v2 to 80/20",
    ...update,
    cuLimit: CU,
    notes,
    facts,
  });
  if (!update.ok) throw new Error(`sharing update failed: ${update.err}`);
}

async function secondUpdate(ctx: Ctx, k: Keys): Promise<void> {
  const ixs = await updateIxs({
    authority: ctx.key("w", k.mint.toBase58()).publicKey,
    mint: k.mint,
    quoteMint: k.Q,
    current: [k.deployer, k.treasury],
    next: [
      { address: k.deployer, shareBps: 5000 },
      { address: k.treasury, shareBps: 5000 },
    ],
  });
  const r = await send(ctx, ixs, true);
  // A1: the code was not known before this run, so the row names it from the pump-fees IDL.
  const name = getPumpFeeProgram(ctx.conn).idl.errors.find((e) => e.code === r.code)?.name;
  const notes = `pump-fees ${r.code} ${name ?? "not in the pump-fees IDL"}`;
  const step = "Second update_fee_shares_v2 (must be rejected)";
  ctx.record({ id: "sharing.update2.rejected", step, ...r, expectFail: true, cuLimit: CU, notes });
}

const sigOk: Rule = (row) => (row.sig ? null : "no signature");
const expectedShares = `${FINAL_SHARES.deployer},${FINAL_SHARES.treasury}`;

const updateRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.shares !== expectedShares) return `shares ${f.shares}, expected ${expectedShares}`;
  if (f.holders !== `${f.deployer},${f.treasury}`) return `holders ${f.holders} are not deployer, treasury`;
  return f.adminRevoked === true ? null : "admin not revoked";
};

// The IDL name (camelCase in the Anchor TS IDL) must be the one the program logged, so a pump (not
// pump-fees) 6xxx error cannot pass.
const rejectedRule: Rule = (row) => {
  if (!row.expectFail || !row.sig) return "not a landed expected failure";
  if (row.code === undefined || row.code < 6000 || row.code > 6999) return `code ${row.code} not 6000..6999`;
  const name = row.notes?.split(" ")[2];
  return name && row.err?.toLowerCase().startsWith(name.toLowerCase())
    ? null
    : `logged error ${row.err} does not match notes ${row.notes}`;
};

export const sharingStage: Stage = {
  name: "sharing",
  rules: () => ({
    "sharing.config": sigOk,
    "sharing.update": updateRule,
    "sharing.update2.rejected": rejectedRule,
  }),
  async run(ctx) {
    const { Q, C0 } = ctx.file.state;
    if (!Q || !C0) throw new Error("no Q or C0 in state: run the create stage first");
    const k: Keys = {
      mint: new PublicKey(C0),
      Q: new PublicKey(Q),
      deployer: ctx.key("sim", "dev").publicKey,
      treasury: ctx.key("treasury", "main").publicKey,
    };
    // A landed update revokes the admin for good, so a rerun never repeats it.
    if (!passed(ctx, "sharing.update")) await setShares(ctx, k);
    if (!passed(ctx, "sharing.update2.rejected")) await secondUpdate(ctx, k);
  },
};
