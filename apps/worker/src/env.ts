// Worker config. Fails at boot on anything missing or malformed, so a bad deploy never serves.
// Never log the seed, the tokens, the admin wallet or the RPC URL.
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

function atLeast(name: string, raw: string | undefined, fallback: number, min: number): number {
  const n = count(name, raw, fallback);
  if (n < min) throw new Error(`${name} must be at least ${min}`);
  return n;
}

// D-09: anything but a known value refuses to boot, so a typo never moves funds (T-05-05-04).
function feeEngine(raw: string | undefined): "off" | "dry" | "on" {
  const v = raw?.trim() || "off";
  if (v !== "off" && v !== "dry" && v !== "on") throw new Error("FEE_ENGINE must be off, dry or on");
  return v;
}

// D-08: an unset or invalid ADMIN_WALLET closes every /admin route instead of failing boot (ship dark).
function adminWallet(raw: string | undefined): string | null {
  const v = raw?.trim() ?? "";
  try {
    return new PublicKey(v).toBase58() === v ? v : null;
  } catch {
    return null;
  }
}

// A2: EVACUATE only simulates unless set to on, and on is devnet only until the mainnet runbook flips it (D-37).
function adminEvacuate(raw: string | undefined, net: string): "simulate" | "on" {
  const v = raw?.trim() || "simulate";
  if (v !== "simulate" && v !== "on") throw new Error("ADMIN_EVACUATE must be simulate or on");
  if (v === "on" && net !== "devnet") throw new Error("ADMIN_EVACUATE=on is devnet only");
  return v;
}

function batchHour(raw: string | undefined): number {
  const n = count("FEE_BATCH_HOUR_UTC", raw, 4);
  if (n > 23) throw new Error("FEE_BATCH_HOUR_UTC must be 0-23");
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
    feeEngine: feeEngine(env.FEE_ENGINE),
    feeWindowMs: atLeast("FEE_WINDOW_MS", env.FEE_WINDOW_MS, 86_400_000, 60_000),
    feeBatchHourUtc: batchHour(env.FEE_BATCH_HOUR_UTC),
    adminWallet: adminWallet(env.ADMIN_WALLET),
    adminEvacuate: adminEvacuate(env.ADMIN_EVACUATE, net),
    sentryReadToken: env.SENTRY_READ_TOKEN?.trim() || null,
  };
}

export type WorkerEnv = ReturnType<typeof loadEnv>;

// Phase 1 ids, so the worker signs with the same funded wallets the spike used.
export const ops = (seed: Buffer, net: "devnet") => derive(seed, "ops", net, "main");
export const treasury = (seed: Buffer, net: "devnet") => derive(seed, "treasury", net, "main");
// Local and staging share the devnet seed, so the lane gives each database its own buyback wallet and one
// lane's reconcile (05-09) never sees the other's sweeps (T-05-05-06).
export const buyback = (seed: Buffer, net: "devnet", lane: "local" | "staging") =>
  derive(seed, "buyback", net, lane);
