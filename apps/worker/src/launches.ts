// Launch rows (RESEARCH Pattern 8). Every state change is one guarded UPDATE, so a double submit or a resumed
// worker racing a live one changes nothing and gets null back.
import { randomBytes } from "node:crypto";
import type { LaunchState } from "@bondr/core/api";
import type { Db } from "@bondr/core/db";
import { launches, vanityMints, wallets } from "@bondr/core/schema";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// A transaction exposes the same builders as the db, so tests can run inside one and roll back.
export type Exec = Pick<Db, "select" | "update" | "insert" | "$count">;
export type LaunchRow = typeof launches.$inferSelect;
export type NewLaunch = Omit<typeof launches.$inferInsert, "state" | "id" | "createdAt" | "updatedAt">;

export const newId = (): string => randomBytes(16).toString("hex");

export async function insertPrepared(exec: Exec, id: string, row: NewLaunch): Promise<void> {
  await exec.insert(launches).values({ ...row, id, state: "prepared" });
}

// A prepare that failed after paying for a table still records it, so a retry reuses it and the cap counts it.
export async function insertFailed(exec: Exec, row: NewLaunch, error: string): Promise<void> {
  await exec.insert(launches).values({ ...row, id: newId(), state: "failed", error });
}

export async function advance(
  exec: Exec,
  id: string,
  from: LaunchState,
  to: LaunchState,
  set: Partial<NewLaunch> = {},
): Promise<LaunchRow | null> {
  const [row] = await exec
    .update(launches)
    .set({ ...set, state: to, updatedAt: sql`now()` })
    .where(and(eq(launches.id, id), eq(launches.state, from)))
    .returning();
  return row ?? null;
}

export const consented = async (exec: Exec, wallet: string): Promise<boolean> =>
  (await exec.$count(wallets, eq(wallets.address, wallet))) > 0;

export async function getLaunch(exec: Exec, id: string): Promise<LaunchRow | null> {
  const [row] = await exec.select().from(launches).where(eq(launches.id, id)).limit(1);
  return row ?? null;
}

// The table of the wallet's latest launch of `mint`. Without a mint: of the mint the wallet still holds, i.e.
// the one reserve() will hand back, so the guard knows before reserving and an expired hold never counts.
export async function tableFor(
  exec: Exec,
  wallet: string,
  mint?: string,
): Promise<{ mint: string; table: string } | null> {
  const held = mint
    ? eq(launches.mint, mint)
    : and(
        eq(vanityMints.reservedBy, wallet),
        sql`${vanityMints.reservedUntil} > now()`,
        isNull(vanityMints.usedAt),
      );
  const [row] = await exec
    .select({ mint: launches.mint, table: launches.lookupTable })
    .from(launches)
    .innerJoin(vanityMints, eq(vanityMints.pubkey, launches.mint))
    .where(and(eq(launches.wallet, wallet), isNotNull(launches.lookupTable), held))
    .orderBy(desc(launches.createdAt))
    .limit(1);
  return row?.table ? { mint: row.mint, table: row.table } : null;
}

export const newTablesLastHour = (exec: Exec): Promise<number> =>
  exec.$count(
    launches,
    and(eq(launches.newTable, true), sql`${launches.createdAt} > now() - interval '1 hour'`),
  );

// Rows a restart must pick up: signed (maybe never sent), sent and unknown (maybe landed).
export const unsettled = (exec: Exec): Promise<LaunchRow[]> =>
  exec
    .select()
    .from(launches)
    .where(inArray(launches.state, ["signed", "sent", "unknown"]));
