// Funding helpers that differ by net: devnet SOL is real and comes from the ops payer, fork SOL is airdropped.
import { confirm, sendTx } from "@bondr/core/send";
import { type Keypair, type PublicKey, SystemProgram } from "@solana/web3.js";
import type { Ctx } from "./results.ts";

// Helius free tier: about one send per second (Pitfall 8). The fork is local and unlimited.
export const paceMs = (ctx: Ctx): number => (ctx.net === "devnet" ? 1100 : 0);

// Tops `to` up to `lamports`; a no-op when it already holds that much, so reruns spend nothing.
export async function fundSol(ctx: Ctx, to: PublicKey, lamports: number): Promise<void> {
  const need = lamports - (await ctx.conn.getBalance(to));
  if (need <= 0) return;
  const short = to.toBase58().slice(0, 8);
  if (ctx.net === "fork") {
    const sig = await ctx.conn.requestAirdrop(to, need);
    const bh = await ctx.conn.getLatestBlockhash();
    await confirm(ctx.conn, sig, bh.lastValidBlockHeight);
    return;
  }
  const ops = ctx.key("ops", "main");
  const ix = SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: to, lamports: need });
  const r = await sendTx({ conn: ctx.conn, payer: ops, ixs: [ix], paceMs: paceMs(ctx) });
  ctx.record({
    id: `aux.fund.${short}`,
    step: `Fund ${short} from ops`,
    ...r,
    facts: { to: to.toBase58(), lamports: need },
  });
  if (!r.ok) throw new Error(`funding ${short} failed: ${r.err}`);
}

// Surfpool still charges 6.96k lamports per byte of rent (Pitfall 2), more than the program budgets for a
// fresh mint, so the fork pads the mint address first. Devnet runs real rent and needs none.
export async function prefundMint(ctx: Ctx, mint: PublicKey, payer: Keypair): Promise<void> {
  if (ctx.net !== "fork") return;
  const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mint, lamports: 5_000_000 });
  const r = await sendTx({ conn: ctx.conn, payer, ixs: [ix] });
  if (!r.ok) throw new Error(`prefund ${mint.toBase58().slice(0, 8)} failed: ${r.err}`);
}
