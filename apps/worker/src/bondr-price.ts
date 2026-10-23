// BONDR's SOL price (lamports per BONDR base unit), held in memory only so open pages never wake Neon (D-04).
// Seeded from chain at boot, then moved by every BONDR event the ingest sees.
import { redact } from "@bondr/core/net";
import { curvePrice, poolPrice } from "@bondr/core/price";
import { canonicalPumpPoolPdaWithQuote, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { poolState } from "@bondr/core/trade";
import type { Bondr } from "@bondr/core/trades";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { type Ctx, venueOf } from "./status.ts";

let id: Omit<Bondr, "sol"> | null = null;
let sol: number | null = null;

export const bondrPrice = {
  get: (): number | null => sol,
  set: (n: number): void => {
    sol = n;
  },
};

// What parseTx needs: BONDR's mint and pool plus the last price. Null before seedBondrPrice ran.
export const bondr = (): Bondr | null => id && { ...id, sol };

const big = (v: { toString(): string }): bigint => BigInt(v.toString());

async function readPrice(ctx: Ctx): Promise<number> {
  if ((await venueOf(ctx)) !== "pool") {
    const c = await ctx.online.fetchBondingCurve(ctx.Q);
    return curvePrice(big(c.virtualQuoteReserves), big(c.virtualTokenReserves));
  }
  const amm = new OnlinePumpAmmSdk(ctx.conn);
  const { state: s } = await poolState({ amm, mint: ctx.Q, quoteMint: NATIVE_MINT, user: PublicKey.default });
  return poolPrice(big(s.poolQuoteAmount) + big(s.pool.virtualQuoteReserves), big(s.poolBaseAmount));
}

// The identity is set before the first await, so an ingest racing the boot read still knows BONDR.
export async function seedBondrPrice(ctx: Ctx): Promise<void> {
  id = { mint: ctx.Q.toBase58(), pool: canonicalPumpPoolPdaWithQuote(ctx.Q, NATIVE_MINT).toBase58() };
  try {
    sol = await readPrice(ctx);
  } catch (e) {
    console.error(`bondr price seed failed: ${redact(e instanceof Error ? e.message : String(e))}`);
  }
}
