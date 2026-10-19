// Worker config. Fails at boot on anything missing or malformed, so a bad deploy never serves.
// Never log the seed, the token or the RPC URL.
import { derive, readSeed } from "@bondr/core/keys";
import { PublicKey } from "@solana/web3.js";

type Env = Record<string, string | undefined>;

// D-02: mainnet stays off until Phase 7. ALLOW_MAINNET=1 is the future switch, but even with it this phase
// refuses, because no mainnet RPC or genesis guard is wired yet.
export function launchNet(env: Env): "devnet" {
  const net = env.SOLANA_NET?.trim();
  if (net === "devnet") return "devnet";
  if (net === "mainnet") {
    if (env.ALLOW_MAINNET !== "1")
      throw new Error("SOLANA_NET=mainnet refused: set ALLOW_MAINNET=1 to allow it");
    throw new Error("SOLANA_NET=mainnet refused: mainnet RPC is not wired until Phase 7");
  }
  throw new Error("SOLANA_NET must be devnet");
}

function seedFrom(env: Env): Buffer {
  if (env.MASTER_SEED) {
    const seed = Buffer.from(env.MASTER_SEED.trim(), "base64");
    if (seed.length !== 32) throw new Error("MASTER_SEED must be 32 bytes, base64");
    return seed;
  }
  if (env.MASTER_SEED_FILE) return readSeed(env.MASTER_SEED_FILE);
  throw new Error("MASTER_SEED or MASTER_SEED_FILE is required");
}

function count(name: string, raw: string | undefined, fallback: number): number {
  const n = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be an integer >= 0`);
  return n;
}

export function loadEnv(env: Env = process.env) {
  const net = launchNet(env);
  const token = env.WORKER_TOKEN?.trim() ?? "";
  if (token.length < 32) throw new Error("WORKER_TOKEN must be at least 32 characters");
  const lane = env.VANITY_LANE?.trim();
  if (lane !== "local" && lane !== "staging") throw new Error("VANITY_LANE must be local or staging");
  let quoteMint: PublicKey;
  try {
    quoteMint = new PublicKey(env.BONDR_QUOTE_MINT?.trim() ?? "");
  } catch {
    throw new Error("BONDR_QUOTE_MINT is not a valid address");
  }
  return {
    net,
    seed: seedFrom(env),
    quoteMint,
    token,
    priorityFee: count("PRIORITY_FEE_MICROLAMPORTS", env.PRIORITY_FEE_MICROLAMPORTS, 1000),
    vanityThreads: count("VANITY_THREADS", env.VANITY_THREADS, 1),
    lane: lane as "local" | "staging",
  };
}

export type WorkerEnv = ReturnType<typeof loadEnv>;

// Phase 1 ids, so the worker signs with the same funded wallets the spike used.
export const ops = (seed: Buffer, net: "devnet") => derive(seed, "ops", net, "main");
export const treasury = (seed: Buffer, net: "devnet") => derive(seed, "treasury", net, "main");
