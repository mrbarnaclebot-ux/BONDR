// The Timeline's one Postgres read (D-31): the coin's launch row and every fee_ledger row of its mint, oldest
// first. Server-only and apart from admin-timeline.ts, so the client can build the steps without the database.
// Runs from the coin op on a selection only, never a timer (D-21).
import "server-only";
import type { Exit, LedgerKind, LedgerState } from "@bondr/core/api";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { CoinTimeline, TimelineLaunch } from "./admin-timeline";
import { db, feeLedger, launches } from "./db";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// The landed launch when there is one, else the newest attempt (an unconfirmed launch has no coin row yet).
async function launchOf(mint: string): Promise<TimelineLaunch | null> {
  const [l] = await db()
    .select({
      ...{ state: launches.state, exit: launches.exit, solIn: launches.solIn, signature: launches.signature },
      ...{ wallet: launches.wallet, facts: launches.facts, landedAt: launches.landedAt },
      createdAt: launches.createdAt,
    })
    .from(launches)
    .where(eq(launches.mint, mint))
    .orderBy(desc(sql`${launches.state} = 'landed'`), desc(launches.createdAt))
    .limit(1);
  if (!l) return null;
  const tokens = (l.facts as { tokens?: string } | null)?.tokens ?? null;
  const { facts: _facts, ...rest } = l;
  return {
    ...rest,
    exit: l.exit as Exit,
    solIn: String(l.solIn),
    tokens,
    ...{ landedAt: iso(l.landedAt), createdAt: l.createdAt.toISOString() },
  };
}

// ponytail: every row of the coin; a coin collects a few times a day, so cap or aggregate in SQL past ~10k rows.
async function rowsOf(mint: string): Promise<CoinTimeline["rows"]> {
  const found = await db()
    .select({
      ...{ kind: feeLedger.kind, state: feeLedger.state, amount: feeLedger.amount, burned: feeLedger.burned },
      ...{ sol: feeLedger.sol, signature: feeLedger.signature, windowIndex: feeLedger.windowIndex },
      ...{ detail: feeLedger.detail, createdAt: feeLedger.createdAt, landedAt: feeLedger.landedAt },
    })
    .from(feeLedger)
    .where(eq(feeLedger.mint, mint))
    .orderBy(asc(feeLedger.createdAt), asc(feeLedger.id));
  return found.map((r) => ({
    ...r,
    kind: r.kind as LedgerKind,
    state: r.state as LedgerState | null,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
    landedAt: iso(r.landedAt),
  }));
}

/** One coin's launch and ledger rows for the Timeline; launch is null for a mint BONDR never launched. */
export async function coinTimeline(mint: string): Promise<CoinTimeline> {
  const [launch, rows] = await Promise.all([launchOf(mint), rowsOf(mint)]);
  return { launch, rows };
}
