// SPIKE-02: create + exact-out dev buy + insta exit in ONE v0 tx with a per-coin lookup table (D-14, D-16).
// Each launch row also carries the size with no table and with a shared-only table (RESEARCH Open Question 1).
import { createTable, memoryTable, sharedKeys, tableKeys } from "@bondr/core/alt";
import { buildLaunch, type Exit, type LaunchOpts } from "@bondr/core/launch";
import { BN, OnlinePumpSdk } from "@bondr/core/pump";
import { PACKET_LIMIT, sendTx, wireSize } from "@bondr/core/send";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import {
  type AddressLookupTableAccount,
  Keypair,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { fundSol, paceMs, prefundMint } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";
import { CHILD, PER_CREATE } from "./create.ts";

const CU_LIMIT = 600_000;
const DEVNET_NOTE = "devnet scaled; curves are 100x cheaper";
type Facts = Record<string, string | number>;
export type Run = {
  ctx: Ctx;
  online: InstanceType<typeof OnlinePumpSdk>;
  Q: PublicKey;
  supply: string;
  solIn: BN;
};

// prefix "migrated." gives the pool-route rows (pool-launch.ts); the curve rows keep their ids.
const rowId = (exit: Exit, table = false, prefix = ""): string =>
  exit === "sellq"
    ? `aux.${prefix}launch.${table ? "table." : ""}sellq`
    : `${prefix}launch.${table ? "table." : ""}${exit}`;

// Shared-only: keys every launch has in common, found by building a second launch offline (never sent).
async function sizes(base: LaunchOpts, ixs: TransactionInstruction[]) {
  const random = () => Keypair.generate().publicKey;
  const other = await buildLaunch({ ...base, mint: random(), W: random(), dev: random() });
  return {
    noTableBytes: wireSize(base.dev, ixs),
    sharedOnlyBytes: wireSize(base.dev, ixs, [memoryTable(sharedKeys(ixs, other.ixs))]),
  };
}

// The longest coin fields the launch form allows (32-byte name, 13-char symbol, an 80-char ipfs.io URI),
// rebuilt offline (never sent) with the same keys, so the same per-coin table covers it.
const MAX_FIELDS = {
  name: "N".repeat(32),
  symbol: "S".repeat(13),
  uri: `https://ipfs.io/ipfs/${"b".repeat(59)}`,
};
async function maxFieldBytes(base: LaunchOpts, table: AddressLookupTableAccount): Promise<number> {
  return wireSize(base.dev, (await buildLaunch({ ...base, ...MAX_FIELDS })).ixs, [table]);
}

export async function tokenAmount(ctx: Ctx, mint: PublicKey, owner: PublicKey): Promise<string> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, T22);
  if (!(await ctx.conn.getAccountInfo(ata))) return "0"; // a closed or never-created ATA holds nothing
  return (await ctx.conn.getTokenAccountBalance(ata)).value.amount;
}

async function after(run: Run, mint: PublicKey, dev: PublicKey): Promise<Facts> {
  return {
    devChildAfter: await tokenAmount(run.ctx, mint, dev),
    supplyAfter: (await run.ctx.conn.getTokenSupply(mint)).value.amount,
    devQLeft: await tokenAmount(run.ctx, run.Q, dev),
  };
}

async function prepare(run: Run, exit: Exit, mint: Keypair, dev: Keypair) {
  const { ctx } = run;
  const rent = await ctx.conn.getMinimumBalanceForRentExemption(0);
  await fundSol(ctx, dev.publicKey, rent + PER_CREATE + run.solIn.toNumber());
  await prefundMint(ctx, mint.publicKey, dev);
  const base: LaunchOpts = {
    ...CHILD,
    online: run.online,
    Q: run.Q,
    mint: mint.publicKey,
    W: ctx.key("w", mint.publicKey.toBase58()).publicKey,
    dev: dev.publicKey,
    solIn: run.solIn,
    exit,
    creatorFeeBps: ctx.net === "fork" ? new BN(150) : undefined,
    cuLimit: CU_LIMIT,
  };
  const built = await buildLaunch(base);
  return { base, built, sized: await sizes(base, built.ixs) };
}

export async function launchOne(run: Run, exit: Exit, prefix = ""): Promise<boolean> {
  const { ctx } = run;
  const [mint, dev] = [Keypair.generate(), ctx.key("sim", "dev")];
  const { base, built, sized } = await prepare(run, exit, mint, dev);
  const keys = tableKeys(built.ixs);
  const { address, table, txs, ...t } = await createTable(ctx.conn, dev, keys, paceMs(ctx));
  const tableFacts = { table: address.toBase58(), keys: keys.length, txs };
  ctx.record({
    id: rowId(exit, true, prefix),
    step: `Per-coin lookup table (${exit})`,
    ...t,
    facts: tableFacts,
  });
  if (!table) throw new Error(`lookup table for ${exit} failed: ${t.err}`);
  const r = await sendTx({
    conn: ctx.conn,
    payer: dev,
    signers: [mint],
    ixs: built.ixs,
    tables: [table],
    paceMs: paceMs(ctx),
  });
  const facts: Facts = {
    venue: built.venue,
    mint: mint.publicKey.toBase58(),
    W: base.W.toBase58(),
    amount: built.amount.toString(),
    qMin: built.qMin.toString(),
    solIn: run.solIn.toString(),
    ...sized,
    maxFieldBytes: await maxFieldBytes(base, table),
    tableKeys: keys.length,
    supplyBefore: run.supply,
    ...(r.ok ? await after(run, mint.publicKey, dev.publicKey) : {}),
  };
  if (r.ok) ctx.file.state[`${prefix}C.${exit}`] = mint.publicKey.toBase58();
  ctx.record({
    id: rowId(exit, false, prefix),
    step: `Launch via Q's ${built.venue}: create + exact-out dev buy + insta ${exit} (one v0 tx, per-coin table)`,
    ...r,
    cuLimit: CU_LIMIT,
    facts,
    notes: ctx.net === "devnet" ? DEVNET_NOTE : undefined,
  });
  return r.ok;
}

export const tableRule: Rule = (row) => (row.sig ? null : "no signature");

export function launchRule(exit: Exit): Rule {
  return (row) => {
    const f = row.facts ?? {};
    if (!row.sig) return "no signature";
    if ((row.bytes ?? Infinity) > PACKET_LIMIT) return `${row.bytes} bytes > ${PACKET_LIMIT}`;
    if ((row.cu ?? Infinity) > (row.cuLimit ?? 0)) return `cu ${row.cu} > limit ${row.cuLimit}`;
    if (f.devChildAfter !== "0") return `dev still holds ${f.devChildAfter} child tokens`;
    if (typeof f.noTableBytes !== "number" || typeof f.sharedOnlyBytes !== "number")
      return "size facts missing";
    if (exit !== "burn") return null;
    const burned = BigInt(f.supplyBefore ?? 0) - BigInt(f.supplyAfter ?? 0);
    return burned === BigInt(f.amount ?? -1) ? null : `supply dropped ${burned}, bought ${f.amount}`;
  };
}

export const launchStage: Stage = {
  name: "launch",
  rules: () => ({
    "launch.table.burn": tableRule,
    "launch.burn": launchRule("burn"),
    "launch.table.sell": tableRule,
    "launch.sell": launchRule("sell"),
  }),
  async run(ctx) {
    if (!ctx.file.state.Q) throw new Error("no stand-in Q in state: run the create stage first");
    const online = new OnlinePumpSdk(ctx.conn);
    const g = await online.fetchGlobal();
    // Pitfall 1: every SOL through Q moves it toward completion; devnet curves are 100x cheaper than mainnet.
    const solIn = ctx.net === "fork" ? new BN(250_000_000) : g.initialVirtualSolReserves.divn(120);
    const run: Run = {
      ctx,
      online,
      Q: new PublicKey(ctx.file.state.Q),
      supply: g.tokenTotalSupply.toString(),
      solIn,
    };
    const fresh = process.env.SPIKE_FRESH === "1" || ctx.net === "fork";
    for (const exit of ["burn", "sell"] as const) {
      if (!fresh && ctx.file.rows.some((r) => r.id === rowId(exit) && r.ok)) continue;
      // A failed multi_hop sell forces a PROJECT.md change (Risk 1); sell_v3 to Q is the evidence fallback.
      if (!(await launchOne(run, exit)) && exit === "sell") await launchOne(run, "sellq");
    }
  },
};
