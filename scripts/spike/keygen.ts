// Idempotent: an existing master seed is reused, never overwritten, so every run prints the same keys.
// Seeds live outside the repo (dir 0700, file 0600) and only public keys are printed.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { derive, type Role } from "@bondr/core/keys";

const NETS = ["devnet", "fork"] as const;
const FIXED: [Role, string][] = [
  ["ops", "main"],
  ["treasury", "main"],
  ["sim", "dev"],
  ["sim", "trader"],
  ["sim", "whale"],
];

function loadOrCreate(net: string): Buffer {
  const dir = join(process.env.SPIKE_KEYS_DIR || join(homedir(), ".bondr-spike"), net);
  const file = join(dir, "master.seed");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // flag "wx" refuses to clobber a seed created between the check and the write.
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  }
  const seed = readFileSync(file);
  if (seed.length !== 32) throw new Error(`${file} is not a 32-byte seed`);
  return seed;
}

for (const net of NETS) {
  const master = loadOrCreate(net);
  for (const [role, id] of FIXED) {
    console.log(`${net} ${role}:${id} ${derive(master, role, net, id).publicKey.toBase58()}`);
  }
}
const devnet = loadOrCreate("devnet");
console.log(`Fund this devnet payer: ${derive(devnet, "ops", "devnet", "main").publicKey.toBase58()}`);
