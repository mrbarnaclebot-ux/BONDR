// Quote state, read on demand and shared: one chain read per mint per 2 s however many pages quote it, and the
// fee configs once a minute (Phase 3 D-05 Helius budget, T6). The status.ts live() single flight, keyed.
// Callers pass only knownCoins mints and BONDR, which bounds the map.
// ponytail: per-process cache; upgrade path is feeding post-trade reserves from the ingest stream if the
// Helius dashboard shows quote reads above about 3M a month (RESEARCH Credit Budget).
import { type Configs, type MintState, readConfigs, readMintState } from "@bondr/core/quote-read";
import type { Connection, PublicKey } from "@solana/web3.js";

type Entry<T> = { at: number; p: Promise<T> };
type Read = { conn: Connection };

const MINT_TTL_MS = 2_000;
const CONFIG_TTL_MS = 60_000;
const mints = new Map<string, Entry<MintState>>();
const configMap = new Map<string, Entry<Configs>>();

// One shared promise per window; a failed read is evicted so the next caller reads again.
function flight<T>(map: Map<string, Entry<T>>, key: string, ttl: number, read: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const entry = { at: Date.now(), p: read() };
  map.set(key, entry);
  entry.p.catch(() => {
    if (map.get(key) === entry) map.delete(key);
  });
  return entry.p;
}

export const mintState = (ctx: Read, mint: PublicKey, quoteMint: PublicKey): Promise<MintState> =>
  flight(mints, mint.toBase58(), MINT_TTL_MS, () => readMintState(ctx.conn, mint, quoteMint));

export const configs = (ctx: Read): Promise<Configs> =>
  flight(configMap, "configs", CONFIG_TTL_MS, () => readConfigs(ctx.conn));
