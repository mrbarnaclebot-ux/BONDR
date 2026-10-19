// Port of agencybook claimKeypair: role, network and id in the HMAC input domain-separate every key,
// so one master seed can never yield the same key for two roles or two networks.
import { createHmac } from "node:crypto";
import { Keypair } from "@solana/web3.js";

export type Role = "w" | "treasury" | "ops" | "sim";
export type Net = "devnet" | "fork";

export const derive = (master: Buffer, role: Role, net: Net, id: string): Keypair =>
  Keypair.fromSeed(createHmac("sha256", master).update(`${role}:${net}:${id}`).digest());
