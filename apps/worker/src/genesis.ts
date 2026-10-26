// POST /prepare and /quote in genesis mode (D-28, D-29): BONDR's own launch, a SOL pair with the treasury as
// creator and the dev buy burned. Owner only, once, burn only. It reuses child prepare's mint reservation, ops
// table, Sender tip, simulation and stored message, so submit treats it like any launch. No ticker cooldown or
// reserved check: BONDR is the genesis ticker (D-44, the one exemption).

import { tableKeys } from "@bondr/core/alt";
import type { PrepareResult, Quote } from "@bondr/core/api";
import { db } from "@bondr/core/db";
import { buildGenesis, type GenesisOpts, genesisAmount } from "@bondr/core/launch";
import { BN } from "@bondr/core/pump";
import { launches } from "@bondr/core/schema";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { and, eq, inArray } from "drizzle-orm";
import { ensureTable } from "./build.ts";
import { contractFailed } from "./contract-check.ts";
import { ops } from "./env.ts";
import { launchTip } from "./fee-config.ts";
import { fail } from "./http.ts";
import { consented, tableFor } from "./launches.ts";
import { finish, type PrepareCtx, recordPaid, reserveMint, rowOf, type Sized } from "./prepare.ts";
import { parseRequest, walletOf } from "./prepare-rules.ts";
import { LAUNCH_CU_LIMIT, liveStatus, networkFee, parseQuote } from "./status.ts";

export type GenesisCtx = Omit<PrepareCtx, "Q"> & { Q: null; treasury: PublicKey };
type Table = Awaited<ReturnType<typeof ensureTable>>;

export type GenesisDeps = {
  consented: (wallet: string) => Promise<boolean>;
  genesisLanded: (treasury: PublicKey) => Promise<boolean>;
  reserve: typeof reserveMint;
  build: (o: GenesisOpts) => Promise<{ ixs: Sized["builds"]["burn"]["ixs"]; amount: BN }>;
  table: (ctx: GenesisCtx, keys: PublicKey[], wallet: string, mint: string) => Promise<Table>;
  finish: typeof finish;
};

// In flight counts too: a second genesis signed while the first is still settling would make a second BONDR.
const genesisLanded = async (treasury: PublicKey): Promise<boolean> =>
  (await db().$count(
    launches,
    and(
      eq(launches.w, treasury.toBase58()),
      inArray(launches.state, ["signed", "sent", "unknown", "landed"]),
    ),
  )) > 0;

const live: GenesisDeps = {
  consented: (wallet) => consented(db(), wallet),
  genesisLanded,
  reserve: reserveMint,
  build: buildGenesis,
  // Same mint after an expired hold: its table still fits, so ops pays rent once (as prepareOne).
  table: async (ctx, keys, wallet, mint) => {
    const held = await tableFor(db(), wallet, mint);
    return ensureTable(ctx.conn, ops(ctx.env.seed, ctx.env.net), keys, held?.table ?? null, ctx.env.net);
  },
  finish,
};

// D-29: the web adds actor only from a valid admin cookie, so no actor is a child prepare (or an owner whose
// session ended). The worker still checks both against ADMIN_WALLET: the web is not the gate.
async function admitOwner(ctx: GenesisCtx, body: unknown, deps: GenesisDeps): Promise<string> {
  const raw = (body ?? {}) as { actor?: unknown; wallet?: unknown; exit?: unknown };
  if (raw.actor === undefined) throw fail({ error: "not_ready" });
  const wallet = walletOf(raw.wallet);
  const admin = ctx.env.adminWallet;
  if (!admin || raw.actor !== admin || wallet !== admin) throw fail({ error: "forbidden" });
  if (!(await deps.consented(admin))) throw fail({ error: "consent_required" });
  if (raw.exit !== "burn") throw fail({ error: "invalid_input" });
  if (await deps.genesisLanded(ctx.treasury)) throw fail({ error: "genesis_landed" });
  // D-20: a failed contract check blocks even the genesis launch; refused here before ops pays a table.
  if (contractFailed()) throw fail({ error: "paused", paused: "contract_check" });
  return admin;
}

export async function genesisOne(ctx: GenesisCtx, body: unknown, deps = live): Promise<PrepareResult> {
  const wallet = await admitOwner(ctx, body, deps);
  const status = await liveStatus(ctx, true);
  if (status.minLamports === null) throw fail({ error: "build_failed" });
  const req = parseRequest(body, BigInt(status.minLamports));
  if (!req) throw fail({ error: "invalid_input" });
  const cost = BigInt(status.createCostEstimate ?? 0);
  const need = req.solIn + cost + networkFee(ctx.priorityFee) + launchTip(ctx.env.net);
  if (BigInt(await ctx.conn.getBalance(new PublicKey(wallet))) < need)
    throw fail({ error: "insufficient_balance" });
  const mint = await deps.reserve(ctx, wallet);
  const solIn = new BN(req.solIn.toString());
  const coin = { name: req.name, symbol: req.symbol, uri: req.uri, online: ctx.online, solIn };
  const dev = new PublicKey(wallet);
  const g = { ...coin, mint: new PublicKey(mint.pubkey), dev, cuLimit: LAUNCH_CU_LIMIT };
  const built = await deps.build({ ...g, treasury: ctx.treasury, priorityFee: ctx.priorityFee });
  // W is what the row stores as w (notNull): the treasury, the coin's creator. Q is SOL; the burn path never
  // reads it, and finish never reads the sell build.
  const o = { ...g, Q: NATIVE_MINT, W: ctx.treasury, exit: "burn" as const };
  const t = await deps.table(ctx, tableKeys(built.ixs), wallet, mint.pubkey);
  try {
    if (!t.table) throw fail({ error: "build_failed" }); // ensureTable logged why
    return await deps.finish(
      ctx,
      req,
      { o, builds: { burn: built, sell: built }, table: t.table },
      t.created,
    );
  } catch (e) {
    if (t.created) await recordPaid(rowOf(req, o, t.address, true), e);
    throw e;
  }
}

// The tokens solIn buys on a fresh SOL curve (what buildGenesis buys) and nothing back: genesis is burn only.
export async function genesisQuote(ctx: GenesisCtx, body: unknown): Promise<Quote> {
  const { solIn, wallet } = parseQuote(body);
  const { amount } = await genesisAmount(ctx.online, new BN(solIn.toString()));
  const out: Quote = { tokensOut: amount.toString(), solBackEstimate: "0" };
  if (wallet) out.balance = String(await ctx.conn.getBalance(wallet));
  return out;
}
