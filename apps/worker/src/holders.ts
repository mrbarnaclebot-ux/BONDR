// Holder counts (D-19, RESEARCH Pattern 9). A trade recounts its coin at once when the last recount is 5 min
// old or more, and does nothing otherwise: no timer, so the write lands while the trade's write has Neon awake
// (D-04), and a quiet coin costs no Helius credits. The last count time lives in memory: after a restart the
// first trade of a coin recounts at once. A trade inside the window shows in the count at the coin's next due
// trade, not before.
// ponytail: getProgramAccounts costs 10 credits per call; switch to Helius getProgramAccountsV2 (1 credit)
// if monthly credits pass 80 percent.
import { coins, db } from "@bondr/core/db";
import { redact } from "@bondr/core/net";
import type { KnownCoin } from "@bondr/core/trades";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { publish } from "./events-route.ts";

export const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
const EVERY_MS = 5 * 60_000;

export type Holding = { owner: string; amount: bigint };

// Wallets with a positive balance, each once; the curve, the pool and the incinerator are not holders.
export function countHolders(accounts: readonly Holding[], exclude: ReadonlySet<string>): number {
  return new Set(accounts.filter((a) => a.amount > 0n && !exclude.has(a.owner)).map((a) => a.owner)).size;
}

export const due = (countedAt: number | undefined, now: number): boolean =>
  countedAt === undefined || now - countedAt >= EVERY_MS;

const countedAt = new Map<string, number>();

// Token-2022 accounts of the mint, sliced to owner (bytes 0-32) and u64 LE amount (32-40) of the base layout.
async function recount(conn: Connection, coin: KnownCoin): Promise<void> {
  const accounts = await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: coin.mint } }],
    dataSlice: { offset: 32, length: 40 },
  });
  const held = accounts.map(({ account: { data } }) => ({
    owner: new PublicKey(data.subarray(0, 32)).toBase58(),
    amount: data.readBigUInt64LE(32),
  }));
  const holders = countHolders(held, new Set([coin.bondingCurve, coin.pool, INCINERATOR]));
  await db().update(coins).set({ holders, holdersAt: new Date() }).where(eq(coins.mint, coin.mint));
  publish({ type: "holders", data: { mint: coin.mint, holders } });
}

export function touch(conn: Connection, coin: KnownCoin): void {
  const now = Date.now();
  if (!due(countedAt.get(coin.mint), now)) return;
  countedAt.set(coin.mint, now); // a failure waits for the next due trade, never retries on its own
  recount(conn, coin).catch((e: unknown) =>
    console.error(`holders ${coin.mint} failed: ${redact(e instanceof Error ? e.message : String(e))}`),
  );
}
