// The bndr mint pool (D-11, D-21). A mint key is derived from the master seed, the lane and an index, so the
// database holds only (idx, pubkey) and no mint secret ever exists at rest.
import { createHmac, createPrivateKey, createPublicKey } from "node:crypto";
import type { Db } from "@bondr/core/db";
import { derive, type Net } from "@bondr/core/keys";
import { launches, vanityMints } from "@bondr/core/schema";
import type { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { and, eq, isNull, lt, notExists, or, sql } from "drizzle-orm";

export type Lane = "local" | "staging";
// A transaction exposes the same builders as the db, so tests can run everything inside one and roll back.
export type Exec = Pick<Db, "select" | "update" | "$count">;

// The lane is part of the id, so the local and staging pools never share a mint while both use the devnet seed.
const mintId = (lane: Lane, idx: bigint) => `${lane}.${idx}`;

export const mintKey = (seed: Buffer, net: Net, lane: Lane, idx: bigint): Keypair =>
  derive(seed, "mint", net, mintId(lane, idx));

export const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const M = 58 ** 4;
export const BNDR = [..."bndr"].reduce((a, c) => a * 58 + ALPHABET.indexOf(c), 0);
// RFC 8032: this PKCS8 prefix plus the 32-byte seed is the same key Keypair.fromSeed builds.
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

// Same bytes as mintKey(...).publicKey, without building a Keypair: the grinder's hot path.
export function mintPub(seed: Buffer, net: Net, lane: Lane, idx: bigint): Buffer {
  const key = createHmac("sha256", seed)
    .update(`mint:${net}:${mintId(lane, idx)}`)
    .digest();
  const der = createPrivateKey({ key: Buffer.concat([PKCS8, key]), format: "der", type: "pkcs8" });
  return createPublicKey(der).export({ format: "der", type: "spki" }).subarray(12);
}

// The last 4 base58 digits are n mod 58^4, so a miss costs no base58 encode.
export function tail4(pub: Buffer): number {
  let r = 0;
  for (const b of pub) r = (r * 256 + b) % M;
  return r;
}

export function isBndr(seed: Buffer, net: Net, lane: Lane, idx: bigint): string | null {
  const pub = mintPub(seed, net, lane, idx);
  return tail4(pub) === BNDR ? bs58.encode(pub) : null;
}

// Re-derive and compare before any signature, so a lane or seed mismatch can never sign with a wrong key.
export function mintKeyFor(
  row: { idx: bigint; pubkey: string },
  seed: Buffer,
  net: Net,
  lane: Lane,
): Keypair {
  const key = mintKey(seed, net, lane, row.idx);
  if (key.publicKey.toBase58() !== row.pubkey)
    throw new Error(`vanity ${row.idx} does not match this seed and lane`);
  return key;
}

const free = or(isNull(vanityMints.reservedUntil), lt(vanityMints.reservedUntil, sql`now()`));
// An expired reservation whose launch is signed, sent, unknown or landed may still land: never hand it out.
const inFlight = notExists(
  sql`(select 1 from ${launches} where ${launches.mint} = ${vanityMints.pubkey}
       and ${launches.state} in ('signed','sent','unknown','landed'))`,
);
const ready = and(isNull(vanityMints.usedAt), free, inFlight);
const picked = { idx: vanityMints.idx, pubkey: vanityMints.pubkey };

// Same wallet inside the 10-minute window gets its mint back; otherwise one statement claims the lowest free row.
export async function reserve(exec: Exec, wallet: string): Promise<{ idx: bigint; pubkey: string } | null> {
  const [live] = await exec
    .select(picked)
    .from(vanityMints)
    .where(
      and(
        eq(vanityMints.reservedBy, wallet),
        sql`${vanityMints.reservedUntil} > now()`,
        isNull(vanityMints.usedAt),
      ),
    )
    .limit(1);
  if (live) return live;
  const next = exec
    .select({ idx: vanityMints.idx })
    .from(vanityMints)
    .where(ready)
    .orderBy(vanityMints.idx)
    .limit(1)
    .for("update", { skipLocked: true });
  const [row] = await exec
    .update(vanityMints)
    .set({ reservedBy: wallet, reservedUntil: sql`now() + interval '10 minutes'` })
    // A scalar "= (subquery)" runs once; "IN (subquery)" was re-run per row and reserved every free mint.
    .where(sql`${vanityMints.idx} = (${next})`)
    .returning(picked);
  return row ?? null;
}

// Releasing while signed, sent or unknown could hand the next dev a mint that is about to land.
export async function release(exec: Exec, idx: bigint, launchState: string): Promise<void> {
  if (launchState !== "prepared" && launchState !== "failed")
    throw new Error(`refusing to release vanity ${idx} while ${launchState}`);
  await exec
    .update(vanityMints)
    .set({ reservedBy: null, reservedUntil: null })
    .where(and(eq(vanityMints.idx, idx), isNull(vanityMints.usedAt)));
}

export async function markUsed(exec: Exec, pubkey: string): Promise<void> {
  await exec.update(vanityMints).set({ usedAt: sql`now()` }).where(eq(vanityMints.pubkey, pubkey));
}

export const poolSize = (exec: Exec): Promise<number> => exec.$count(vanityMints, ready);
