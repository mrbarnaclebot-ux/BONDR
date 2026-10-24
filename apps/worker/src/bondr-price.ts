// BONDR's SOL price (lamports per BONDR base unit), held in memory only so open pages never wake Neon (D-04).
// Seeded from chain at boot, then moved by BONDR events the ingest sees, only forward in slots: a gap fill or
// the boot backfill re-parses old txs, and their price must not become the price of the next live trade.
import { curvePrice, poolPrice } from "@bondr/core/price";
import { canonicalPumpPoolPdaWithQuote, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { poolState } from "@bondr/core/trade";
import type { Bondr } from "@bondr/core/trades";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { type Ctx, venueOf } from "./status.ts";

let id: Omit<Bondr, "sol"> | null = null;
let sol: number | null = null;
let at = -1; // the slot `sol` was read at

export const bondrPrice = {
  get: (): number | null => sol,
  set: (n: number, slot: number): void => {
    if (slot < at) return;
    sol = n;
    at = slot;
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

// The identity is set before the first await, so an ingest racing the boot read still knows BONDR. A failed
// read throws: with no price every trade without a BONDR leg would be unpriced, so the boot fails instead.
export async function seedBondrPrice(ctx: Ctx): Promise<void> {
  id = { mint: ctx.Q.toBase58(), pool: canonicalPumpPoolPdaWithQuote(ctx.Q, NATIVE_MINT).toBase58() };
  const slot = await ctx.conn.getSlot("confirmed"); // before the read, so a newer live price still wins
  bondrPrice.set(await readPrice(ctx), slot);
}
