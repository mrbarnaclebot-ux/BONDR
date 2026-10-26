// D-04, D-33 (fork): BONDR's genesis launch through the worker's own pipeline before any real SOL moves.
// genesisOne builds it on a mainnet-configured ctx (Sender tip, mainnet fee config), simulateLaunch and cosign
// run exactly as prepare and submit do, then a child launch in the new mint, the contract check and the boot
// check (D-31). Only the database steps and the mint reservation are injected: the fork has no vanity pool.
// consented and genesisLanded are stubbed, so the once-only guard (genesis_landed) is not exercised here:
// apps/worker/src/genesis.test.ts covers it.
import type { PrepareResult } from "@bondr/core/api";
import { checkContract } from "@bondr/core/contract";
import { cosign, signatureOf } from "@bondr/core/cosign";
import { readCurve } from "@bondr/core/curve";
import { close } from "@bondr/core/db";
import { buildGenesis } from "@bondr/core/launch";
import { BN, OnlinePumpSdk } from "@bondr/core/pump";
import { type BlockhashInfo, PACKET_LIMIT, sendRaw } from "@bondr/core/send";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  type AddressLookupTableAccount,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ensureTable, simulateLaunch, tipped } from "../../../apps/worker/src/build.ts";
import type { WorkerEnv } from "../../../apps/worker/src/env.ts";
import { SENDER_TIPS } from "../../../apps/worker/src/fee-config.ts";
import { type GenesisCtx, type GenesisDeps, genesisOne } from "../../../apps/worker/src/genesis.ts";
import { verifyQuoteMint } from "../../../apps/worker/src/genesis-boot.ts";
import { finalMessage } from "../../../apps/worker/src/prepare.ts";
import { LAUNCH_CU_LIMIT } from "../../../apps/worker/src/status.ts";
import { fundSol, prefundMint } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";
import { launchOne, launchRule, tableRule, tokenAmount } from "./launch.ts";

const SOL_IN = 250_000_000;
// The worker's PRIORITY_FEE_MICROLAMPORTS default. Production sets its own at G-1; the price changes only the
// compute-budget value, not the size, CU or accounts this stage measures.
const PRIORITY_FEE = 1000;
const SOL = new Set([NATIVE_MINT.toBase58(), PublicKey.default.toBase58()]);
const CID = "b".repeat(59);
type Facts = Record<string, string | number | boolean>;
type Captured = {
  msg: VersionedMessage;
  bh: BlockhashInfo;
  lookupTable: string;
  wallet: string;
  exit: "burn" | "sell";
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// A fresh Connection (not connect()) so the local-host guard is never involved; the env says mainnet so the
// Sender tip and the mainnet fee profile apply as on production.
function genesisCtx(ctx: Ctx, admin: PublicKey, treasury: PublicKey): GenesisCtx {
  const conn = new Connection(ctx.conn.rpcEndpoint, "confirmed");
  // Only net and adminWallet are read on this path: the table and the database steps are injected below.
  const env = { net: "mainnet", adminWallet: admin.toBase58(), treasury, quoteMint: null } as WorkerEnv;
  return {
    conn,
    online: new OnlinePumpSdk(conn),
    Q: null,
    treasury,
    priorityFee: PRIORITY_FEE,
    net: "mainnet",
    env,
  };
}

// finish without the insert: the same finalMessage (tip, compile, simulate), the message kept in memory.
function deps(mint: Keypair, ops: Keypair, out: { c?: Captured }): GenesisDeps {
  return {
    consented: async () => true,
    genesisLanded: async () => false,
    reserve: async () => ({ idx: 0n, pubkey: mint.publicKey.toBase58() }),
    build: buildGenesis,
    table: (c, keys) => ensureTable(c.conn, ops, keys, null, c.env.net),
    finish: async (c, req, s): Promise<PrepareResult> => {
      const bh = await c.conn.getLatestBlockhash();
      const f = await finalMessage(c, s, bh.blockhash);
      // What submit reads back from the stored row: the table, the wallet and the exit.
      out.c = { msg: f.msg, bh, lookupTable: s.table.key.toBase58(), wallet: req.wallet, exit: req.exit };
      const wire = new VersionedTransaction(f.msg).serialize();
      const tx = Buffer.from(wire).toString("base64");
      const preview = {
        createCost: String(f.createCost),
        networkFee: "0",
        solBack: null,
        tokensOut: f.amount.toString(),
      };
      return { launchId: "fork", tx, mint: s.o.mint.toBase58(), bytes: wire.length, signBy: 0, preview };
    },
  };
}

const body = (dev: string) => ({
  ...{ wallet: dev, actor: dev, name: "BONDR", symbol: "BONDR", exit: "burn", solIn: String(SOL_IN) },
  ...{ uri: `https://ipfs.io/ipfs/${CID}`, imageCid: CID },
});

// The browser signs the prepared wire; submit co-signs it against the stored message and the stored exit.
async function signAndCosign(g: GenesisCtx, res: PrepareResult, c: Captured, dev: Keypair, mint: Keypair) {
  const tx = VersionedTransaction.deserialize(Buffer.from(res.tx, "base64"));
  tx.sign([dev]);
  const table = (await g.conn.getAddressLookupTable(new PublicKey(c.lookupTable))).value;
  if (!table) throw new Error("genesis lookup table not found");
  const stored = Buffer.from(c.msg.serialize());
  const r = cosign({ wire: tx.serialize(), stored, dev: c.wallet, mint, exit: c.exit, tables: [table] });
  if (!r.ok) throw new Error(`cosign refused: ${r.reason}`);
  return { wire: r.wire, table };
}

async function create(ctx: Ctx, g: GenesisCtx, dev: Keypair, mint: Keypair, ops: Keypair) {
  const out: { c?: Captured } = {};
  const res = await genesisOne(g, body(dev.publicKey.toBase58()), deps(mint, ops, out));
  const c = out.c;
  if (!c) throw new Error("genesisOne returned without a stored message");
  const simSpent = await simulateLaunch(g.conn, c.msg, dev.publicKey);
  const { wire, table } = await signAndCosign(g, res, c, dev, mint);
  const supplyBefore = (await g.online.fetchGlobal()).tokenTotalSupply.toString();
  const r = await sendRaw(g.conn, wire, { ...c.bh, sig: signatureOf(wire), bytes: wire.length });
  const curve = r.ok ? await readCurve(g.online, mint.publicKey) : null;
  const facts: Facts = {
    ...{ mint: mint.publicKey.toBase58(), treasury: g.treasury.toBase58(), dev: dev.publicKey.toBase58() },
    ...{ simSpent: simSpent.toString(), cosign: "accepted", table: c.lookupTable, solIn: SOL_IN },
    ...{ tokensOut: res.preview.tokensOut, supplyBefore, vanity: "none (fork: fresh keypair)" },
    ...(curve && { creator: curve.creator, quoteMint: curve.quoteMint }),
    ...(r.ok && {
      devAfter: await tokenAmount(ctx, mint.publicKey, dev.publicKey),
      supplyAfter: (await g.conn.getTokenSupply(mint.publicKey)).value.amount,
    }),
  };
  ctx.record({
    id: "genesis.create",
    step: "Genesis via genesisOne: SOL pair, external treasury creator, dev buy burned (one v0 tx, Sender tip)",
    ...r,
    cuLimit: LAUNCH_CU_LIMIT,
    facts,
  });
  if (!r.ok) throw new Error(`genesis launch failed: ${r.err}`);
  return { msg: c.msg, table, bytes: wire.length };
}

function tip(ctx: Ctx, msg: VersionedMessage, table: AddressLookupTableAccount, bytes: number): void {
  const tips = new Set(SENDER_TIPS);
  const account = msg.staticAccountKeys.map(String).find((k) => tips.has(k)) ?? "";
  const inTable = table.state.addresses.some((a) => a.toBase58() === account);
  const facts = { tipped: tipped(msg), account, inTable, bytes };
  const ok = facts.tipped && !!account && !inTable && bytes <= PACKET_LIMIT;
  ctx.record({
    id: "genesis.tip",
    step: "Genesis carries the Sender tip as a static key, under the packet limit",
    ok,
    bytes,
    facts,
  });
}

async function child(ctx: Ctx, Q: PublicKey): Promise<string> {
  const online = new OnlinePumpSdk(ctx.conn);
  const g = await online.fetchGlobal();
  const run = { ctx, online, Q, supply: g.tokenTotalSupply.toString(), solIn: new BN(SOL_IN) };
  await launchOne(run, "burn", "genesis.", "genesis.child");
  const mint = ctx.file.state["genesis.C.burn"];
  if (!mint) throw new Error("child launch in the genesis mint did not land");
  return mint;
}

async function contract(ctx: Ctx, mint: PublicKey): Promise<void> {
  const r = await checkContract(ctx.conn, "fork", mint);
  const facts = { ...r.slots, failed: r.facts.join("; "), bondr: mint.toBase58() };
  ctx.record({
    id: "genesis.contract",
    step: "Contract check, mainnet profile, with the genesis mint",
    ok: r.facts.length === 0,
    facts,
  });
}

// verify resolves for the genesis mint; verify-neg passes only when the child mint is refused.
async function verify(ctx: Ctx, mint: PublicKey, childMint: PublicKey, treasury: PublicKey): Promise<void> {
  const online = new OnlinePumpSdk(ctx.conn);
  const pos = await verifyQuoteMint(online, mint, treasury).then(() => "", message);
  ctx.record({
    id: "genesis.verify",
    step: "Boot check accepts the genesis mint",
    ok: pos === "",
    ...(pos && { err: pos }),
    facts: { mint: mint.toBase58() },
  });
  const neg = await verifyQuoteMint(online, childMint, treasury).then(() => "", message);
  const facts = { mint: childMint.toBase58(), refusal: neg || "accepted" };
  ctx.record({ id: "genesis.verify-neg", step: "Boot check refuses a child mint", ok: neg !== "", facts });
}

const createRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.cosign !== "accepted") return "cosign not accepted before the send";
  if (f.creator !== f.treasury) return `creator ${f.creator} is not the treasury`;
  if (!SOL.has(String(f.quoteMint))) return `quote ${f.quoteMint} is not SOL`;
  if (f.devAfter !== "0") return `dev still holds ${f.devAfter} genesis tokens`;
  if ((row.bytes ?? Infinity) > PACKET_LIMIT) return `${row.bytes} bytes > ${PACKET_LIMIT}`;
  const burned = BigInt(f.supplyBefore ?? 0) - BigInt(f.supplyAfter ?? 0);
  return burned > 0n && String(burned) === String(f.tokensOut)
    ? null
    : `supply dropped ${burned}, bought ${f.tokensOut}`;
};
const tipRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (f.tipped !== true || !f.account) return "no Sender tip transfer";
  if (f.inTable !== false) return "tip account is in the lookup table";
  return (row.bytes ?? Infinity) <= PACKET_LIMIT ? null : `${row.bytes} bytes > ${PACKET_LIMIT}`;
};
const okRule: Rule = (row) => (row.ok ? null : (row.err ?? String(row.facts?.failed ?? "not ok")));
const negRule: Rule = (row) =>
  row.facts?.refusal && row.facts.refusal !== "accepted" ? null : "child mint was accepted";

export const genesisStage: Stage = {
  name: "genesis",
  rules: () => ({
    "genesis.create": createRule,
    "genesis.tip": tipRule,
    "genesis.launch.table.burn": tableRule,
    "genesis.child": launchRule("burn"),
    "genesis.contract": okRule,
    "genesis.verify": okRule,
    "genesis.verify-neg": negRule,
  }),
  async run(ctx) {
    const [dev, ops, mint, treasury] = [
      ctx.key("sim", "genesis"),
      ctx.key("ops", "main"),
      Keypair.generate(),
      Keypair.generate(),
    ];
    await fundSol(ctx, dev.publicKey, 2 * LAMPORTS_PER_SOL);
    await fundSol(ctx, ops.publicKey, LAMPORTS_PER_SOL);
    await prefundMint(ctx, mint.publicKey, dev);
    ctx.record({
      id: "aux.genesis.fund",
      step: "Fund the genesis dev and the ops key (fork airdrop)",
      ok: true,
      facts: { dev: dev.publicKey.toBase58(), ops: ops.publicKey.toBase58() },
    });
    const g = genesisCtx(ctx, dev.publicKey, treasury.publicKey);
    try {
      const sent = await create(ctx, g, dev, mint, ops);
      tip(ctx, sent.msg, sent.table, sent.bytes);
      const childMint = await child(ctx, mint.publicKey);
      await contract(ctx, mint.publicKey);
      await verify(ctx, mint.publicKey, new PublicKey(childMint), treasury.publicKey);
    } finally {
      await close(); // genesisOne's fresh status reads the switches row once
    }
  },
};
