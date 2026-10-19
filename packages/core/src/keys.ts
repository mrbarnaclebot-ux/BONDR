// Port of agencybook claimKeypair: role, network and id in the HMAC input domain-separate every key,
// so one master seed can never yield the same key for two roles or two networks.
import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

export type Role = "w" | "treasury" | "ops" | "sim";
export type Net = "devnet" | "fork";

export const derive = (master: Buffer, role: Role, net: Net, id: string): Keypair =>
  Keypair.fromSeed(createHmac("sha256", master).update(`${role}:${net}:${id}`).digest());

// Every key derives from this seed, so a group- or world-readable file counts as already leaked.
export function readSeed(file: string): Buffer {
  if (statSync(file).mode & 0o077) throw new Error(`${file} is readable by others: chmod 600 it`);
  const seed = readFileSync(file);
  if (seed.length !== 32) throw new Error(`${file} is not a 32-byte seed`);
  return seed;
}
