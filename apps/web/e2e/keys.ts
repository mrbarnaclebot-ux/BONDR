// Test keys and the root .env reader, kept free of @playwright/test so playwright.config.ts can import them
// (a config that imports test() fails to load).
import { createHmac, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import bs58 from "bs58";

/** `key` stays in Node: the page only ever sees the address and the public key. */
export type TestAccount = { address: string; publicKey: number[]; key: KeyObject };

// A 32-byte Ed25519 seed becomes a private key through this fixed PKCS8 header (RFC 8410).
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export function accountFromSeed(seed: Buffer): TestAccount {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const raw = Buffer.from(createPublicKey(key).export({ format: "jwk" }).x as string, "base64url");
  return { address: bs58.encode(raw), publicKey: [...raw], key };
}

/** derive(seed, role, net, id) in core/keys.ts for `id` = "role:net:id", without a Solana import. */
export function seedAccount(id: string): TestAccount {
  const file = rootEnv().MASTER_SEED_FILE;
  if (!file) throw new Error("needs MASTER_SEED_FILE in the root .env");
  return accountFromSeed(createHmac("sha256", readFileSync(file)).update(id).digest());
}

/**
 * playwright.config.ts deliberately keeps the root .env out of the runner (02-02), so specs that check the
 * database read it here. Never copy these values into process.env: the dev server inherits that.
 */
export function rootEnv(): {
  DATABASE_URL?: string;
  MASTER_SEED_FILE?: string;
  SESSION_SECRET?: string;
  WORKER_URL?: string;
  WORKER_TOKEN?: string;
  BONDR_QUOTE_MINT?: string;
  VANITY_LANE?: string;
} {
  const file = fileURLToPath(new URL("../../../.env", import.meta.url));
  const all = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const { DATABASE_URL, MASTER_SEED_FILE, SESSION_SECRET, WORKER_URL, WORKER_TOKEN } = all;
  const { BONDR_QUOTE_MINT, VANITY_LANE } = all;
  return {
    DATABASE_URL,
    MASTER_SEED_FILE,
    SESSION_SECRET,
    WORKER_URL,
    WORKER_TOKEN,
    BONDR_QUOTE_MINT,
    VANITY_LANE,
  };
}
