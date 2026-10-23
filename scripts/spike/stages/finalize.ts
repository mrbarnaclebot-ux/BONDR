// SPIKE-04 after bond (fork): sim pool trades on the migrated C2 accrue creator fees to W2, then W2 runs the
// finalize (sweeps, create_fee_sharing_config, the one update to 80/20), distribution pays both shareholders,
// and a second update must be rejected (PROJECT.md item 8). Devnet cannot prove this: its pump-fees bytecode
// differs and its post-bond creator fee is 0 (Pitfall 7).
import { poolBaseOut } from "@bondr/core/bond";
import { applyBps } from "@bondr/core/math";
import { BN, canonicalPumpPoolPdaWithQuote, getPumpFeeProgram, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { budget, PACKET_LIMIT, sendTx, wireSize } from "@bondr/core/send";
import {
  configSweeps,
  distributeIxs,
  FINAL_SHARES,
  finalizeIxs,
  readSharing,
  SHARING_CONFIG_SIZE,
  updateIxs,
} from "@bondr/core/sharing";
import { poolBuy, poolSell } from "@bondr/core/trade";
import { type Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { loadResults, type Rule, type Stage } from "../results.ts";
import { CU, land, newRun, type Run, sigOk, topUp } from "./bond.ts";
import { tokenAmount } from "./launch.ts";
import { tokenDelta } from "./multihop.ts";
import { rejectedRule, updateRule } from "./sharing.ts";

const W_BUFFER = 0.01 * LAMPORTS_PER_SOL;
type K = Run & {
  mint: PublicKey;
  pool: PublicKey;
  W: Keypair;
  trader: Keypair;
  deployer: PublicKey;
  treasury: PublicKey;
};

const bal = async (k: K, owner: PublicKey) => BigInt(await tokenAmount(k.ctx, k.Q, owner));
const pct = (x: bigint, bps: number) => new BN(applyBps(x, bps).toString());

// The trader keeps its prebond Q; only an empty trader is topped up by the whale (an aux row, not fees).
async function traderQ(k: K): Promise<bigint> {
  const have = await bal(k, k.trader.publicKey);
  if (have > 0n) return have;
  const amount = new BN(await tokenAmount(k.ctx, k.Q, k.whale.publicKey)).divn(100);
  await topUp(k, "aux.finalize.trader.topup", k.trader.publicKey, amount, {});
  return bal(k, k.trader.publicKey);
}

// A buy takes 10% of the trader's Q worth of C2, sized from 95% of it so the fees fit. A sell returns the
// whole C2 balance with a 90% floor on what the last buy spent. Both sides pay the pool creator fee.
async function tradeIxs(k: K, buy: boolean, spent: bigint) {
  const o = { amm: new OnlinePumpAmmSdk(k.ctx.conn), mint: k.mint, quoteMint: k.Q, user: k.trader.publicKey };
  if (!buy) {
    const baseIn = new BN(await tokenAmount(k.ctx, k.mint, o.user));
    return { base: baseIn, ixs: await poolSell({ ...o, baseIn, minQuoteOut: pct(spent, 9000) }) };
  }
  const quote = (await traderQ(k)) / 10n;
  const baseOut = await poolBaseOut({ ...o, w: o.user, quote: pct(quote, 9500) });
  return { base: baseOut, ixs: await poolBuy({ ...o, baseOut, maxQuoteIn: new BN(quote.toString()) }) };
}

// Rows alternate buy (odd) and sell (even); qDelta is the trader's Q change in the landed meta.
async function poolTrades(k: K, from: number, to: number): Promise<void> {
  let spent = 0n;
  for (let i = from; i <= to; i++) {
    const buy = i % 2 === 1;
    const { base, ixs } = await tradeIxs(k, buy, spent);
    const step = `Sim trader PumpSwap ${buy ? "buy_v2" : "sell_v2"} on C2's pool (creator fees accrue)`;
    await land(k, { id: `finalize.trade.${i}`, step, payer: k.trader, ixs }, async ({ meta }) => {
      const qDelta = tokenDelta(meta, k.Q, k.trader.publicKey);
      if (buy) spent = -qDelta;
      return { side: buy ? "buy" : "sell", base: base.toString(), qDelta: qDelta.toString() };
    });
  }
}

// Tx A, split in two (A2). Pitfall 3: create_fee_sharing_config charges its rent to W2, so ops floats W2 in
// the config tx. The update tx repeats the pool sweep under the new creator first (pump-fees 6033). One tx
// never fits on a bonded coin without a lookup table; oneTxBytes records by how much.
async function finalizeTx(k: K): Promise<void> {
  const wFloatLamports = (await k.ctx.conn.getMinimumBalanceForRentExemption(SHARING_CONFIG_SIZE)) + W_BUFFER;
  const fund = SystemProgram.transfer({
    fromPubkey: k.ops.publicKey,
    toPubkey: k.W.publicKey,
    lamports: wFloatLamports,
  });
  const base = {
    payer: k.ops.publicKey,
    mint: k.mint,
    quoteMint: k.Q,
    bondingCurveComplete: true,
    pool: k.pool,
  };
  const who = { creator: k.W.publicKey, deployer: k.deployer, treasury: k.treasury };
  const ixs = [fund, ...(await finalizeIxs({ ...base, ...who }))]; // [fund, sweeps x2, config, vault ATA, update]
  const oneTxBytes = wireSize(k.ops.publicKey, [...budget(CU), ...ixs]);
  if (oneTxBytes <= PACKET_LIMIT)
    throw new Error(`finalize fits one tx (${oneTxBytes} bytes): send it whole`);
  const facts = { split: true, oneTxBytes, wFloatLamports };
  const tx = { payer: k.ops, signers: [k.W] };
  const step = "Sweeps + create_fee_sharing_config with C2's pool (W2 signs, ops floats W2)";
  await land(k, { ...tx, id: "finalize.config", step, ixs: ixs.slice(0, -2) }, async () => facts);
  const update = "Pool sweep + update_fee_shares_v2 to deployer 8000 / treasury 2000 (bonded C2)";
  const resweep = await configSweeps(base);
  const updateTx = { ...tx, id: "finalize.update", step: update, ixs: [...resweep, ...ixs.slice(-2)] };
  await land(k, updateTx, readShares(k, facts));
}

// The decoded SharingConfig: shares, holders and admin_revoked are the row's proof, not the send result.
function readShares(k: K, facts: Record<string, string | number | boolean>) {
  return async () => {
    const s = await readSharing(k.ctx.conn, k.mint);
    const holders = s.holders.join(",");
    const who = { deployer: k.deployer.toBase58(), treasury: k.treasury.toBase58() };
    return { ...facts, ...who, shares: s.shares.join(","), holders, adminRevoked: s.adminRevoked };
  };
}

// Tx C: permissionless, ops pays. The deltas come from balances read around the landed tx.
async function distribute(k: K): Promise<void> {
  const before = [await bal(k, k.deployer), await bal(k, k.treasury)];
  const ixs = await distributeIxs({ online: k.online, mint: k.mint, quoteMint: k.Q, payer: k.ops.publicKey });
  const step = "Distribute: sweeps, transfer_creator_fees_to_pump_v2, distribute_creator_fees_v2 (ops pays)";
  await land(k, { id: "finalize.distribute", step, payer: k.ops, ixs }, async () => {
    const deployerDelta = (await bal(k, k.deployer)) - (before[0] ?? 0n);
    const treasuryDelta = (await bal(k, k.treasury)) - (before[1] ?? 0n);
    const total = deployerDelta + treasuryDelta;
    return {
      deployerDelta: deployerDelta.toString(),
      treasuryDelta: treasuryDelta.toString(),
      total: total.toString(),
    };
  });
}

// Tx B: must land as a failure. The devnet code (01-05) is read from devnet.json, never retyped.
async function secondUpdate(k: K): Promise<void> {
  const ixs = await updateIxs({
    authority: k.W.publicKey,
    mint: k.mint,
    quoteMint: k.Q,
    current: [k.deployer, k.treasury],
    next: [
      { address: k.deployer, shareBps: 5000 },
      { address: k.treasury, shareBps: 5000 },
    ],
    bondingCurveComplete: true,
    pool: k.pool,
  });
  const conn = k.ctx.conn;
  const r = await sendTx({
    conn,
    payer: k.ops,
    signers: [k.W],
    ixs: [...budget(CU), ...ixs],
    expectFail: true,
  });
  const name = getPumpFeeProgram(conn).idl.errors.find((e) => e.code === r.code)?.name;
  const devnet = loadResults("devnet").rows.find((x) => x.id === "sharing.update2.rejected")?.code;
  const facts = {
    ...(name && { idlName: name }),
    devnetCode: devnet ?? "none",
    matchesDevnet: r.code === devnet,
  };
  const notes = `pump-fees ${r.code} ${name ?? "not in the pump-fees IDL"}; devnet ${devnet}`;
  const step = "Second update_fee_shares_v2 on bonded C2 (must be rejected)";
  k.ctx.record({ id: "finalize.update2.rejected", step, ...r, expectFail: true, cuLimit: CU, notes, facts });
}

const fits =
  (rule: Rule): Rule =>
  (row, file) =>
    (row.bytes ?? Infinity) > PACKET_LIMIT ? `${row.bytes} bytes > ${PACKET_LIMIT}` : rule(row, file);

// 80:20 within 1 unit of the total actually paid, and both sides above 0.
const distributeRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  const [d, t] = [BigInt(f.deployerDelta ?? 0), BigInt(f.treasuryDelta ?? 0)];
  if (d <= 0n || t <= 0n) return `deltas ${d} / ${t}, both must be above 0`;
  const want = ((d + t) * BigInt(FINAL_SHARES.treasury)) / 10000n;
  const off = t > want ? t - want : want - t;
  return off <= 1n ? null : `treasury got ${t}, 20% of ${d + t} is ${want}`;
};

export const finalizeStage: Stage = {
  name: "finalize",
  rules: () => ({
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`finalize.trade.${i}`, fits(sigOk)])),
    "finalize.config": fits(sigOk),
    "finalize.update": fits(updateRule),
    "finalize.distribute": fits(distributeRule),
    "finalize.update2.rejected": fits(rejectedRule),
  }),
  async run(ctx) {
    if (!ctx.file.state.C2) throw new Error("no C2 in state: run the bond and pool stages first");
    const run = await newRun(ctx);
    const mint = new PublicKey(ctx.file.state.C2);
    const k: K = {
      ...run,
      mint,
      pool: canonicalPumpPoolPdaWithQuote(mint, run.Q),
      W: ctx.key("w", mint.toBase58()),
      trader: ctx.key("sim", "trader"),
      deployer: ctx.key("sim", "dev").publicKey,
      treasury: ctx.key("treasury", "main").publicKey,
    };
    await poolTrades(k, 1, 4);
    await finalizeTx(k);
    await poolTrades(k, 5, 6);
    await distribute(k);
    await secondUpdate(k);
  },
};
