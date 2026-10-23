// Public reads of launch rows for the browser. The message and the signed wire never leave the server
// (T-02-13-01): only the columns below are selected.
import "server-only";
import type { Exit, LaunchErrorCode, LaunchState, LaunchView, Links } from "@bondr/core/api";
import { and, eq, type SQL } from "drizzle-orm";
import { cache } from "react";
import { db, launches } from "./db";
import { BASE58_KEY } from "./guard";

const COLUMNS = {
  id: launches.id,
  state: launches.state,
  mint: launches.mint,
  name: launches.name,
  symbol: launches.symbol,
  exit: launches.exit,
  solIn: launches.solIn,
  signature: launches.signature,
  error: launches.error,
  facts: launches.facts,
  imageCid: launches.imageCid,
  links: launches.links,
  wallet: launches.wallet,
  createdAt: launches.createdAt,
};

// The error column also holds raw preflight and on-chain text; the browser gets a code, never that text.
const CODES = new Set<string>([
  "paused",
  "consent_required",
  "invalid_input",
  "pool_empty",
  "rate_limited",
  "insufficient_balance",
  "build_failed",
  "expired",
  "cosign_refused",
  "not_found",
  "worker_unavailable",
  "pin_failed",
] satisfies LaunchErrorCode[]);

type Row = Pick<typeof launches.$inferSelect, keyof typeof COLUMNS>;

function toView(r: Row): LaunchView {
  return {
    ...r,
    state: r.state as LaunchState,
    exit: r.exit as Exit,
    solIn: String(r.solIn),
    error: r.error === null ? null : CODES.has(r.error) ? r.error : "onchain",
    facts: (r.facts as LaunchView["facts"]) ?? null,
    links: (r.links as Links | null) ?? {},
    createdAt: r.createdAt.toISOString(),
  };
}

async function one(where: SQL | undefined): Promise<LaunchView | null> {
  const [row] = await db().select(COLUMNS).from(launches).where(where).limit(1);
  return row ? toView(row) : null;
}

export const launchView = (id: string): Promise<LaunchView | null> => one(eq(launches.id, id));

/** The landed launch of a mint: retries of a mint can fail, but only one may land (launches_landed_mint). */
export const launchByMint = (mint: string): Promise<LaunchView | null> =>
  one(and(eq(launches.mint, mint), eq(launches.state, "landed")));

// A landed coin with its facts never changes, so it is kept an hour; a miss or a coin still waiting on facts
// for a minute. Repeat views, share card fetches and crawlers then do not wake Neon (500 CU-h budget).
// ponytail: per-process map cleared at 1000 entries; move to a shared cache if web runs more than one instance.
const HOUR = 3_600_000;
const MINUTE = 60_000;
const seen = new Map<string, { at: number; ttl: number; v: LaunchView | null }>();

async function read(mint: string): Promise<LaunchView | null> {
  const hit = seen.get(mint);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  const v = await launchByMint(mint);
  if (seen.size >= 1000) seen.clear();
  seen.set(mint, { at: Date.now(), ttl: v?.facts ? HOUR : MINUTE, v });
  return v;
}

/**
 * The token page's and share card's lookup: anything that is not base58 never reaches the query
 * (T-02-15-01), and metadata, page and card image share one read per request.
 */
export const landedCoin = cache(async (mint: string) => (BASE58_KEY.test(mint) ? read(mint) : null));

/** The wallet that prepared a launch, or null when there is no such row (the worker then answers not_found). */
export async function launchWallet(id: string): Promise<string | null> {
  const [row] = await db()
    .select({ wallet: launches.wallet })
    .from(launches)
    .where(eq(launches.id, id))
    .limit(1);
  return row?.wallet ?? null;
}
