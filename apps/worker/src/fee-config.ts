// Fee engine settings per network (D-11, D-16, D-20). Constants, not env: none changes between deploys of one
// network. FEE_BATCH_HOUR_UTC may override batchHourUtc when the batch is wired (05-09).
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { TradeNet } from "./trade-quote.ts";

// Helius Sender, mainnet only (A1, re-verified against the Sender docs 2026-10-25; check again in Phase 7).
export const SENDER_URL = "https://sender.helius-rpc.com/fast";
export const SENDER_TIPS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
];

export type FeeConfig = {
  collectMinLamports: number; // a collect below this SOL value waits for the next window (D-11)
  senderTipLamports: number; // Sender Max minimum, 0.001 SOL
  paceMs: number; // Helius free tier allows about one send per second (Pitfall 8)
  // Below this, ops pauses non-urgent fee sends and launches pay for no new table (build.ts): what is left stays
  // for fee and recovery txs, and the error log tells the owner to top ops up by hand (01-10).
  opsFloorLamports: number;
  launchTipLamports: number; // the Sender tip inside a mainnet launch tx, paid by the creator (D-34)
  creatorFeeBps: number; // devnet refuses 150 bps (D-06), so devnet coins accrue 0
  batchHourUtc: number;
};

export function feeConfig(net: TradeNet): FeeConfig {
  const devnet = net === "devnet";
  return {
    collectMinLamports: devnet ? 10_000 : 1_000_000,
    senderTipLamports: 1_000_000,
    // G-10: one send a second on every net until the Helius plan changes and the D-14 numbers allow less.
    paceMs: 1100,
    opsFloorLamports: (devnet ? 0.05 : 0.1) * LAMPORTS_PER_SOL, // mainnet: the G-4 default
    // G-6 default. Pitfall 10: a tip under 0.001 SOL routes only with swqos_only (fewer relays).
    launchTipLamports: 1_000_000,
    creatorFeeBps: devnet ? 0 : 150,
    batchHourUtc: 4,
  };
}
