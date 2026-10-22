// Public reads of launch rows for the browser. The message and the signed wire never leave the server
// (T-02-13-01): only the columns below are selected.
import "server-only";
import type { Exit, LaunchErrorCode, LaunchState, LaunchView, Links } from "@bondr/core/api";
import { and, eq, type SQL } from "drizzle-orm";
import { db, launches } from "./db";

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

/** The wallet that prepared a launch, or null when there is no such row (the worker then answers not_found). */
export async function launchWallet(id: string): Promise<string | null> {
  const [row] = await db()
    .select({ wallet: launches.wallet })
    .from(launches)
    .where(eq(launches.id, id))
    .limit(1);
  return row?.wallet ?? null;
}
