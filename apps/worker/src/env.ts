// Worker config. Fails at boot on anything missing or malformed, so a bad deploy never serves.
// Never log the seed, the tokens, the admin wallet or the RPC URL.
import { derive, type Net, readSeed } from "@bondr/core/keys";
import { PublicKey } from "@solana/web3.js";
import type { Lane } from "./vanity.ts";

type Env = Record<string, string | undefined>;

// D-01: mainnet runs only behind the double flag SOLANA_NET=mainnet plus ALLOW_MAINNET=1, so a stray
// SOLANA_NET alone never reaches mainnet. The worker never runs on the fork; only the spike does.
export function launchNet(env: Env): "devnet" | "mainnet" {
  const net = env.SOLANA_NET?.trim();
  if (net === "devnet") return "devnet";
  if (net === "mainnet") {
    if (env.ALLOW_MAINNET !== "1")
      throw new Error("SOLANA_NET=mainnet refused: set ALLOW_MAINNET=1 to allow it");
    return "mainnet";
  }
  throw new Error("SOLANA_NET must be devnet or mainnet");
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

// The address only if it round-trips exactly, so a near-miss paste never names some other key.
// D-08: an unset or invalid ADMIN_WALLET closes every /admin route instead of failing boot (ship dark).
function exactKey(raw: string | undefined): string | null {
  const v = raw?.trim() ?? "";
  try {
    return new PublicKey(v).toBase58() === v ? v : null;
  } catch {
    return null;
  }
}

// WR-B-03: the site origin the intent text names, as the web's admin sign-in does. Unset or invalid refuses
// simulate and execute (admin-routes.ts) instead of failing boot, like ADMIN_WALLET.
function siteOrigin(raw: string | undefined): string | null {
  try {
    return new URL(raw?.trim() ?? "").origin;
  } catch {
    return null;
  }
}

// D-10: on mainnet the treasury is an owner-held wallet the seed cannot derive, so EVACUATE after a seed leak
// lands out of the attacker's reach. Errors name the variable, never its value.
function treasuryFrom(env: Env, net: "devnet" | "mainnet", seed: Buffer, lane: Lane) {
  if (net === "devnet") return { key: treasury(seed, "devnet").publicKey, external: false };
  const v = exactKey(env.TREASURY_PUBKEY);
  if (!env.TREASURY_PUBKEY?.trim()) throw new Error("TREASURY_PUBKEY is required on mainnet");
  if (!v) throw new Error("TREASURY_PUBKEY is not a valid address");
  const key = new PublicKey(v);
  if (!PublicKey.isOnCurve(key.toBytes()))
    throw new Error("TREASURY_PUBKEY must be a wallet, not a program address");
  const derived = [ops(seed, net), buyback(seed, net, lane), treasury(seed, net)].map((k) => k.publicKey);
  if (derived.some((d) => d.equals(key))) throw new Error("TREASURY_PUBKEY must not derive from MASTER_SEED");
  if (v === exactKey(env.ADMIN_WALLET))
    console.warn("TREASURY_PUBKEY equals ADMIN_WALLET: G-2 advises separate wallets");
  return { key, external: true };
}

// D-37: EVACUATE may execute on devnet, or on mainnet only when its destination is the external treasury, so a
// leaked seed can never be the key to the wallet the funds flee to. Boot and the execute loop share this rule.
export const evacuateAllowed = (net: Net, treasuryExternal: boolean): boolean =>
  net === "devnet" || (net === "mainnet" && treasuryExternal);

// A2: EVACUATE only simulates unless set to on; on is refused at boot wherever evacuateAllowed says no.
function adminEvacuate(raw: string | undefined, allowed: boolean): "simulate" | "on" {
  const v = raw?.trim() || "simulate";
  if (v !== "simulate" && v !== "on") throw new Error("ADMIN_EVACUATE must be simulate or on");
  if (v === "on" && !allowed)
    throw new Error("ADMIN_EVACUATE=on needs devnet, or mainnet with TREASURY_PUBKEY");
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
  if (lane !== "local" && lane !== "staging" && lane !== "production")
    throw new Error("VANITY_LANE must be local, staging or production");
  let quoteMint: PublicKey;
  try {
    quoteMint = new PublicKey(env.BONDR_QUOTE_MINT?.trim() ?? "");
  } catch {
    throw new Error("BONDR_QUOTE_MINT is not a valid address");
  }
  const seed = seedFrom(env);
  const t = treasuryFrom(env, net, seed, lane);
  return {
    net,
    seed,
    treasury: t.key,
    treasuryExternal: t.external,
    quoteMint,
    token,
    priorityFee: count("PRIORITY_FEE_MICROLAMPORTS", env.PRIORITY_FEE_MICROLAMPORTS, 1000),
    vanityThreads: count("VANITY_THREADS", env.VANITY_THREADS, 1),
    lane: lane as Lane,
    feeEngine: feeEngine(env.FEE_ENGINE),
    feeWindowMs: atLeast("FEE_WINDOW_MS", env.FEE_WINDOW_MS, 86_400_000, 60_000),
    feeBatchHourUtc: batchHour(env.FEE_BATCH_HOUR_UTC),
    adminWallet: exactKey(env.ADMIN_WALLET),
    siteUrl: siteOrigin(env.SITE_URL),
    adminEvacuate: adminEvacuate(env.ADMIN_EVACUATE, evacuateAllowed(net, t.external)),
    sentryReadToken: env.SENTRY_READ_TOKEN?.trim() || null,
  };
}

export type WorkerEnv = ReturnType<typeof loadEnv>;

// Phase 1 ids, so the worker signs with the same funded wallets the spike used. The net is in the HMAC domain,
// so mainnet ids never equal devnet ones. Jobs read env.treasury; this derived key is devnet's treasury.
export const ops = (seed: Buffer, net: Net) => derive(seed, "ops", net, "main");
export const treasury = (seed: Buffer, net: Net) => derive(seed, "treasury", net, "main");
// Local and staging share the devnet seed, so the lane gives each database its own buyback wallet and one
// lane's reconcile (05-09) never sees the other's sweeps (T-05-05-06).
export const buyback = (seed: Buffer, net: Net, lane: Lane) => derive(seed, "buyback", net, lane);
