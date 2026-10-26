// The owner's five switches (D-18), held in memory like the Phase 2 launches switch: one settings read at boot,
// one write per flip, nothing on a timer (D-02, the 500 CU-h Neon budget). A switch written straight in SQL takes
// effect at the next restart, or at the next prepare or submit, which re-read the row (status.ts liveStatus).
import type { AdminJob, AdminSwitches } from "@bondr/core/api-admin";
import { db, settings } from "@bondr/core/db";
import { eq } from "drizzle-orm";

const COLUMN = {
  launches: "launchesEnabled",
  forcedBond: "forcedBondEnabled",
  sweeps: "sweepsEnabled",
  finalize: "finalizeEnabled",
  buybackBurn: "buybackBurnEnabled",
} as const satisfies Record<AdminJob, keyof typeof settings.$inferSelect>;

export const isJob = (v: unknown): v is AdminJob => typeof v === "string" && Object.hasOwn(COLUMN, v);

export type SwitchState = AdminSwitches & { evacuatedAt: string | null };

// Every switch off until the first load (fail closed); the engine starts only after it.
let state: SwitchState | undefined;
// WR-W-01: bumped after each committed write, so a read whose snapshot may predate the write never lands over it.
let writes = 0;

export const switchesLoaded = (): boolean => state !== undefined;
export const switchOn = (job: AdminJob): boolean => state?.[job] === true;

export function switchState(): SwitchState {
  const off = { launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false };
  return state ? { ...state } : { ...off, evacuatedAt: null };
}

export async function loadSwitches(): Promise<SwitchState> {
  const seen = writes;
  const [r] = await db().select().from(settings).where(eq(settings.id, 1));
  if (seen !== writes) return switchState();
  // fail closed: a missing settings row counts as every switch off
  const on = (job: AdminJob) => r?.[COLUMN[job]] === true;
  state = {
    ...{ launches: on("launches"), forcedBond: on("forcedBond"), sweeps: on("sweeps") },
    ...{ finalize: on("finalize"), buybackBurn: on("buybackBurn") },
    evacuatedAt: r?.evacuatedAt ? r.evacuatedAt.toISOString() : null,
  };
  return switchState();
}

// The database first: a failed write leaves memory as it was.
export async function setJob(job: AdminJob, on: boolean): Promise<AdminSwitches> {
  await db()
    .update(settings)
    .set({ [COLUMN[job]]: on })
    .where(eq(settings.id, 1));
  writes++;
  state = { ...switchState(), [job]: on };
  const { evacuatedAt: _, ...switches } = state;
  return switches;
}

// The contract check pause (D-20): the same five columns off in one write, but not pauseAll, because evacuated_at
// would show the EVACUATE callout and make the runbook /kill-switch refuse (Pitfall 7).
export async function switchesOff(): Promise<void> {
  const off = Object.fromEntries(Object.values(COLUMN).map((c) => [c, false]));
  await db().update(settings).set(off).where(eq(settings.id, 1));
  writes++;
  const none = { launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false };
  state = { ...none, evacuatedAt: switchState().evacuatedAt };
}

// EVACUATE (D-35): every switch off, launches included, and evacuated_at in one write, then memory set from what
// was written, so no re-read can fail after the write. The switches stay off until the owner turns each back on
// (D-36).
export async function pauseAll(): Promise<void> {
  const off = Object.fromEntries(Object.values(COLUMN).map((c) => [c, false]));
  const evacuatedAt = new Date();
  await db()
    .update(settings)
    .set({ ...off, evacuatedAt })
    .where(eq(settings.id, 1));
  writes++;
  const none = { launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false };
  state = { ...none, evacuatedAt: evacuatedAt.toISOString() };
}
