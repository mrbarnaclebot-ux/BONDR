// The console's live chain reads (D-23, D-24, D-31), each one getMultipleAccountsInfo. Read on load and on
// Refresh only. The W table uses coins.fee_budget, so only the selected coin's W is read live (T-06-10-06).
import type { AdminCoinLive, AdminCoinMemory, AdminOverviewWorker } from "@bondr/core/api-admin";
import { windowEnd, windowOf } from "@bondr/core/fees";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { bondrPrice } from "./bondr-price.ts";
import { buyback, ops, type WorkerEnv } from "./env.ts";
import { nextBatchAt } from "./fee-batch.ts";
import { loadCoin } from "./fee-boot.ts";
import { feeConfig } from "./fee-config.ts";
import type { Engine } from "./fee-engine.ts";
import { key } from "./fee-routes.ts";
import type { FeeCoin } from "./fee-send.ts";
import { fail } from "./http.ts";

export type LiveOpts = {
  env: WorkerEnv;
  engine: () => Pick<Engine, "memory" | "coin"> | null;
  conn: Pick<Connection, "getMultipleAccountsInfo">;
};

type Info = AccountInfo<Buffer> | null;
const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);
const sol = (a: Info | undefined) => String(a?.lamports ?? 0);
// A missing token account holds nothing.
const units = (a: Info | undefined) => (a ? String(AccountLayout.decode(a.data).amount) : "0");

export async function overview(o: LiveOpts, now = Date.now()): Promise<AdminOverviewWorker> {
  const { seed, net, lane, quoteMint: Q, treasury: t } = o.env;
  const b = buyback(seed, net, lane).publicKey;
  const keys = [t, b, ops(seed, net).publicKey, ataOf(Q, t), ataOf(Q, b)];
  const [ta, ba, oa, tq, bq] = await o.conn.getMultipleAccountsInfo(keys);
  return {
    balances: {
      ...{ treasurySol: sol(ta), treasuryBondr: units(tq), buybackSol: sol(ba), buybackBondr: units(bq) },
      ...{ opsSol: sol(oa), opsFloor: String(feeConfig(net).opsFloorLamports), bondrSol: bondrPrice.get() },
      nextBurnAt: nextBatchAt(now, o.env.feeBatchHourUtc),
    },
    coins: o.engine()?.memory() ?? [],
  };
}

// With the engine on, its coin and memory; off (A1), one coin row from the database and an idle memory.
async function coinOf(o: LiveOpts, mint: string, load: typeof loadCoin) {
  const e = o.engine();
  const coin: FeeCoin | undefined = e ? e.coin(mint) : await load(mint);
  if (!coin) throw fail({ error: "not_found" });
  const idle: AdminCoinMemory = { mint, stuck: null, hold: coin.hold ?? null, busy: false };
  return { coin, memory: e?.memory().find((m) => m.mint === mint) ?? idle };
}

export async function coinLive(
  o: LiveOpts,
  body: unknown,
  load = loadCoin,
  now = Date.now(),
): Promise<AdminCoinLive> {
  const mint = key((body as { mint?: unknown } | null | undefined)?.mint).toBase58();
  const { coin, memory } = await coinOf(o, mint, load);
  const W = coin.w.publicKey;
  const [wa, wq, wt] = await o.conn.getMultipleAccountsInfo([
    W,
    ataOf(o.env.quoteMint, W),
    ataOf(coin.mint, W),
  ]);
  const windowIndex = windowOf(coin.launchedAt, now, o.env.feeWindowMs);
  return {
    ...{ mint, w: W.toBase58(), sol: sol(wa), bondr: units(wq), tokens: units(wt), memory, windowIndex },
    windowEndsAt: windowEnd(coin.launchedAt, windowIndex, o.env.feeWindowMs),
  };
}
