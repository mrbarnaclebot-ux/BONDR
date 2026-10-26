// The console's live reads (D-23, D-24, D-31): platform balances and one coin's W, each one RPC call, with
// engine memory beside them. No database: the engine-off coin load is injected.
import { windowEnd, windowOf } from "@bondr/core/fees";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { type AccountInfo, Keypair, PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import { coinLive, overview } from "./admin-overview.ts";
import { bondrPrice } from "./bondr-price.ts";
import { buyback, ops, treasury, type WorkerEnv } from "./env.ts";
import { nextBatchAt } from "./fee-batch.ts";
import { OPS_FLOOR_LAMPORTS } from "./fee-config.ts";
import type { FeeCoin } from "./fee-send.ts";
import { Fail } from "./http.ts";

const Q = PublicKey.unique();
const DAY = 86_400_000;
const seed = Buffer.alloc(32, 7);
const env = {
  ...{ seed, net: "devnet", lane: "local", quoteMint: Q, feeBatchHourUtc: 4, feeWindowMs: DAY },
  treasury: treasury(seed, "devnet").publicKey,
} as unknown as WorkerEnv;
const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);

function tokenAccount(mint: PublicKey, amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      ...{ mint, owner: PublicKey.default, amount, delegateOption: 0, delegate: PublicKey.default },
      ...{ state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0 },
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner: T22, lamports: 2_039_280, executable: false };
}
const system = (lamports: number): AccountInfo<Buffer> => ({
  ...{ data: Buffer.alloc(0), owner: PublicKey.default, lamports, executable: false },
});

// Answers by address; a missing key is a missing account. Counts calls and records the keys asked for.
function chain(accounts: Map<string, AccountInfo<Buffer>>) {
  const asked: string[][] = [];
  const getMultipleAccountsInfo = vi.fn(async (keys: PublicKey[]) => {
    asked.push(keys.map((k) => k.toBase58()));
    return keys.map((k) => accounts.get(k.toBase58()) ?? null);
  });
  return { conn: { getMultipleAccountsInfo } as never, asked, getMultipleAccountsInfo };
}

const memory = { mint: "m", stuck: null, hold: "review", busy: true };

test("overview reads the five platform accounts in one call and adds engine memory", async () => {
  const t = treasury(seed, "devnet").publicKey;
  const b = buyback(seed, "devnet", "local").publicKey;
  const opsKey = ops(seed, "devnet").publicKey;
  const accounts = new Map([
    [t.toBase58(), system(5_000_000_000)],
    [b.toBase58(), system(1_000)],
    [opsKey.toBase58(), system(70_000_000)],
    [ataOf(Q, t).toBase58(), tokenAccount(Q, 123_456n)],
  ]);
  const c = chain(accounts);
  bondrPrice.set(0.000_04, 10);
  const now = Date.UTC(2026, 9, 25, 12);
  const engine = () => ({ memory: () => [memory], coin: () => undefined });
  const r = await overview({ env, engine, conn: c.conn }, now);
  expect(c.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  expect(c.asked[0]).toEqual([t, b, opsKey, ataOf(Q, t), ataOf(Q, b)].map((k) => k.toBase58()));
  expect(r).toEqual({
    balances: {
      ...{ treasurySol: "5000000000", treasuryBondr: "123456", buybackSol: "1000", buybackBondr: "0" },
      ...{ opsSol: "70000000", opsFloor: String(OPS_FLOOR_LAMPORTS), bondrSol: 0.000_04 },
      nextBurnAt: nextBatchAt(now, 4),
    },
    coins: [memory],
  });
  const off = await overview({ env, engine: () => null, conn: chain(accounts).conn }, now);
  expect(off.coins).toEqual([]);
});

function feeCoin(): FeeCoin {
  return {
    ...{
      mint: PublicKey.unique(),
      w: Keypair.generate(),
      launchedAt: Date.now() - 2.5 * DAY,
      venue: "curve",
    },
    ...{ feesUnclaimed: 0n, feeBudget: 0n, cost: null, launchSig: "l", wallet: PublicKey.unique() },
    finalize: "none",
  };
}

test("coinLive reads W, its BONDR and child accounts in one call, with the coin's memory and window", async () => {
  const coin = feeCoin();
  const W = coin.w.publicKey;
  const mint = coin.mint.toBase58();
  const c = chain(
    new Map([
      [W.toBase58(), system(9_000)],
      [ataOf(Q, W).toBase58(), tokenAccount(Q, 77n)],
    ]),
  );
  const mem = { ...memory, mint };
  const engine = () => ({
    memory: () => [memory, mem],
    coin: (m: string) => (m === mint ? coin : undefined),
  });
  const load = vi.fn();
  const now = Date.now();
  const r = await coinLive({ env, engine, conn: c.conn }, { mint }, load, now);
  expect(c.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  expect(c.asked[0]).toEqual([W, ataOf(Q, W), ataOf(coin.mint, W)].map((k) => k.toBase58()));
  const windowIndex = windowOf(coin.launchedAt, now, DAY);
  expect(r).toEqual({
    ...{ mint, w: W.toBase58(), sol: "9000", bondr: "77", tokens: "0", memory: mem },
    ...{ windowIndex, windowEndsAt: windowEnd(coin.launchedAt, windowIndex, DAY) },
  });
  expect(windowIndex).toBe(2);
  expect(load).not.toHaveBeenCalled();
});

test("with the engine off coinLive loads the one coin; an unknown mint is not_found", async () => {
  const coin = feeCoin();
  const mint = coin.mint.toBase58();
  const load = vi.fn(async (m: string) => (m === mint ? { ...coin, hold: "review" } : undefined));
  const r = await coinLive({ env, engine: () => null, conn: chain(new Map()).conn }, { mint }, load);
  expect(load).toHaveBeenCalledWith(mint);
  expect(r.memory).toEqual({ mint, stuck: null, hold: "review", busy: false });
  expect([r.sol, r.bondr, r.tokens]).toEqual(["0", "0", "0"]);
  const unknown = PublicKey.unique().toBase58();
  const c = chain(new Map());
  const err = await coinLive({ env, engine: () => null, conn: c.conn }, { mint: unknown }, load).catch(
    (e) => e,
  );
  expect(err).toBeInstanceOf(Fail);
  expect((err as Fail).body.error).toBe("not_found");
  expect(c.getMultipleAccountsInfo).not.toHaveBeenCalled();
  const live = () => ({ memory: () => [], coin: () => undefined });
  const err2 = await coinLive({ env, engine: live, conn: c.conn }, { mint: unknown }, load).catch((e) => e);
  expect((err2 as Fail).body.error).toBe("not_found");
});
