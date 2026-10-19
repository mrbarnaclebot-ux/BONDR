// Funding helpers that differ by net: devnet SOL is real and comes from the ops payer, fork SOL is airdropped.
import { confirm, sendTx } from "@bondr/core/send";
import { type Keypair, LAMPORTS_PER_SOL, type PublicKey, SystemProgram } from "@solana/web3.js";
import type { Ctx } from "./results.ts";

// Helius free tier: about one send per second (Pitfall 8). The fork is local and unlimited.
export const paceMs = (ctx: Ctx): number => (ctx.net === "devnet" ? 1100 : 0);

// Surfpool fetches mainnet accounts lazily, so warm-up can fail with a transient "from remote" error
// (Pitfall 8); agencybook retried 4 times, 10 s apart.
async function airdrop(ctx: Ctx, to: PublicKey, lamports: number): Promise<void> {
  for (let t = 1; ; t++) {
    try {
      const sig = await ctx.conn.requestAirdrop(to, lamports);
      const bh = await ctx.conn.getLatestBlockhash();
      await confirm(ctx.conn, sig, bh.lastValidBlockHeight);
      return;
    } catch (e) {
      if (t >= 4 || !String(e).includes("from remote")) throw e;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

// Fork SOL is fake, so ops, treasury and the sim dev each get 100 SOL once, one airdrop at a time.
export async function fundFork(ctx: Ctx): Promise<void> {
  if (ctx.net !== "fork") return;
  for (const [role, id] of [
    ["ops", "main"],
    ["treasury", "main"],
    ["sim", "dev"],
  ] as const)
    await fundSol(ctx, ctx.key(role, id).publicKey, 100 * LAMPORTS_PER_SOL);
}

// Tops `to` up to `lamports`; a no-op when it already holds that much, so reruns spend nothing.
export async function fundSol(ctx: Ctx, to: PublicKey, lamports: number): Promise<void> {
  const need = lamports - (await ctx.conn.getBalance(to));
  if (need <= 0) return;
  const short = to.toBase58().slice(0, 8);
  if (ctx.net === "fork") return airdrop(ctx, to, need);
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
  const short = mint.toBase58().slice(0, 8);
  ctx.record({
    id: `aux.prefund.${short}`,
    step: `Prefund mint ${short} (fork rent)`,
    ...r,
    facts: { mint: mint.toBase58() },
  });
  if (!r.ok) throw new Error(`prefund ${short} failed: ${r.err}`);
}
