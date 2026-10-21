// The landed-launch assertions of the devnet driver (02-12): what "dev holds 0 launch supply" means on chain.
import { readCurve } from "@bondr/core/curve";
import { derive } from "@bondr/core/keys";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { LaunchRow } from "../apps/worker/src/launches.ts";
import type { PrepareCtx } from "../apps/worker/src/prepare.ts";

const devnet = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

async function childBalance(ctx: PrepareCtx, mint: PublicKey, dev: PublicKey): Promise<string> {
  const ata = getAssociatedTokenAddressSync(mint, dev, true, T22);
  const r = await ctx.conn.getTokenAccountBalance(ata).catch(() => null);
  return r?.value.amount ?? "0 (no account)";
}

// Exits 1 through the caller on the first failed assertion.
export async function assertLanded(ctx: PrepareCtx, row: LaunchRow): Promise<void> {
  const mint = new PublicKey(row.mint);
  const facts = (row.facts ?? {}) as { tokens?: string };
  const [curve, held, supply, g] = await Promise.all([
    readCurve(ctx.online, mint),
    childBalance(ctx, mint, new PublicKey(row.wallet)),
    ctx.conn.getTokenSupply(mint),
    ctx.online.fetchGlobal(),
  ]);
  const W = derive(ctx.env.seed, "w", ctx.env.net, row.mint).publicKey.toBase58();
  const burned = BigInt(g.tokenTotalSupply.toString()) - BigInt(supply.value.amount);
  const checks: [string, boolean][] = [
    ["state landed", row.state === "landed"],
    ["mint ends in bndr", row.mint.endsWith("bndr")],
    [`creator ${curve.creator} is W ${W}`, curve.creator === W],
    [`dev child balance ${held} is 0`, held === "0"],
    ...(row.exit === "burn"
      ? [
          [`supply dropped ${burned}, bought ${facts.tokens}`, burned === BigInt(facts.tokens ?? -1)] as [
            string,
            boolean,
          ],
        ]
      : []),
  ];
  console.log(`${row.exit} ${row.signature} ${devnet(row.signature ?? "")}`);
  for (const [what, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"}: ${what}`);
  if (checks.some(([, ok]) => !ok)) throw new Error(`launch ${row.id} failed its assertions`);
}
