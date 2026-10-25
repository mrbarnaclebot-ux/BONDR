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

export type SwitchState = AdminSwitches & { evacuatedAt: string | null };

// Every switch off until the first load (fail closed); the engine starts only after it.
let state: SwitchState | undefined;

export const switchesLoaded = (): boolean => state !== undefined;
export const switchOn = (job: AdminJob): boolean => state?.[job] === true;

export function switchState(): SwitchState {
  const off = { launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false };
  return state ? { ...state } : { ...off, evacuatedAt: null };
}

export async function loadSwitches(): Promise<SwitchState> {
  const [r] = await db().select().from(settings).where(eq(settings.id, 1));
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
  state = { ...switchState(), [job]: on };
  const { evacuatedAt: _, ...switches } = state;
  return switches;
}
