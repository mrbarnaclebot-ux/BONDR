// multi_hop_swap routes (SPIKE-05). The SDK resolves each hop's venue from chain, simulates the output and
// builds the WSOL and buyback ATA handling; BONDR owns only the amount, the slippage floor and the signing.
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { applyBps } from "./math.ts";
import { BN, type OnlinePumpSdk, PUMP_SDK } from "./pump.ts";

export type RouteOpts = {
  online: InstanceType<typeof OnlinePumpSdk>;
  path: PublicKey[]; // mints in trade order: [SOL, Q, C] for a buy, [C, Q, SOL] for a sell
  user: PublicKey; // must already hold amountIn: the simulation runs as this wallet
  amountIn: BN;
  slippageBps: number;
};
// venues lists each hop's venue in trade order ("pool,curve" once Q has migrated), so a row can show it.
export type Route = { ixs: TransactionInstruction[]; expectedOut: BN; minAmountOut: BN; venues: string };

async function route(side: "buy" | "sell", o: RouteOpts): Promise<Route> {
  const hops = await o.online.resolveMultiHopRoute(o.path, side);
  const base = { user: o.user, hops, side, amountIn: o.amountIn };
  const expectedOut = await o.online.simulateMultiHopSwap(base);
  const minAmountOut = new BN(applyBps(BigInt(expectedOut.toString()), 10_000 - o.slippageBps).toString());
  // The program refuses 0, and a zero floor would also mean no slippage protection at all (T-01-19).
  if (minAmountOut.isZero()) throw new Error(`route ${side} quotes ${expectedOut} out: no floor above 0`);
  const ixs = await PUMP_SDK.multiHopSwapInstructions({ ...base, minAmountOut });
  return { ixs, expectedOut, minAmountOut, venues: hops.map((h) => h.venue).join(",") };
}

export const routeBuy = (o: RouteOpts): Promise<Route> => route("buy", o);
export const routeSell = (o: RouteOpts): Promise<Route> => route("sell", o);
