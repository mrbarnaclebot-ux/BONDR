// The five owner switches in memory (D-18) over a fake settings row. No Postgres: db() is a stub that records
// each select and update.
import { PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({
  ...{ rows: [] as object[], sets: [] as object[], selects: 0, fail: false },
  gate: null as Promise<void> | null, // holds a select open after it took its snapshot
}));
vi.mock("@bondr/core/db", async (orig) => ({
  ...((await orig()) as object),
  db: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          m.selects++;
          const snap = m.rows.map((r) => ({ ...r }));
          if (m.gate) await m.gate;
          return snap;
        },
      }),
    }),
    update: () => ({
      set: (v: object) => ({
        where: async () => {
          if (m.fail) throw new Error("db down");
          m.sets.push(v);
          if (m.rows[0]) Object.assign(m.rows[0], v);
        },
      }),
    }),
  }),
}));

const { loadSwitches, pauseAll, setJob, switchesOff, switchOn, switchState } = await import("./switches.ts");
const { liveStatus, setSwitch } = await import("./status.ts");
const { memoryAudit } = await import("./admin-audit.ts");

const row = (o: object = {}) => ({
  ...{ id: 1, launchesEnabled: true, forcedBondEnabled: true, sweepsEnabled: true },
  ...{ finalizeEnabled: true, buybackBurnEnabled: true, evacuatedAt: null },
  ...o,
});

beforeEach(() => {
  m.rows = [row()];
  m.sets = [];
  m.selects = 0;
  m.fail = false;
  m.gate = null;
});

test("loadSwitches holds the row in memory with evacuatedAt", async () => {
  m.rows = [row({ sweepsEnabled: false, evacuatedAt: new Date("2026-10-25T00:00:00Z") })];
  const s = await loadSwitches();
  expect(s).toEqual({
    ...{ launches: true, forcedBond: true, sweeps: false, finalize: true, buybackBurn: true },
    evacuatedAt: "2026-10-25T00:00:00.000Z",
  });
  expect(switchOn("sweeps")).toBe(false);
  expect(switchOn("forcedBond")).toBe(true);
  expect(switchState()).toEqual(s);
});

test("a missing settings row switches every job off (fail closed)", async () => {
  m.rows = [];
  await loadSwitches();
  for (const j of ["launches", "forcedBond", "sweeps", "finalize", "buybackBurn"] as const)
    expect(switchOn(j)).toBe(false);
});

test("setJob writes the column, then memory; a failed write leaves memory as it was", async () => {
  await loadSwitches();
  const s = await setJob("finalize", false);
  expect(m.sets).toEqual([{ finalizeEnabled: false }]);
  expect(s.finalize).toBe(false);
  expect(switchOn("finalize")).toBe(false);
  m.fail = true;
  await expect(setJob("finalize", true)).rejects.toThrow("db down");
  expect(switchOn("finalize")).toBe(false);
});

test("POST /kill-switch answers { enabled }, moves the launches switch and audits as the runbook", async () => {
  await loadSwitches();
  const audit = memoryAudit();
  expect(await setSwitch({ enabled: false }, audit)).toEqual({ enabled: false });
  expect(m.sets).toEqual([{ launchesEnabled: false }]);
  expect(switchOn("launches")).toBe(false);
  expect(audit.rows[0]).toMatchObject({
    ...{ actor: "runbook", action: "switch", result: "landed" },
    params: { job: "launches", enabled: false },
  });
});

test("POST /kill-switch never re-enables launches after EVACUATE (WR-W-08)", async () => {
  m.rows = [row({ launchesEnabled: false, evacuatedAt: new Date() })];
  const audit = memoryAudit();
  await expect(setSwitch({ enabled: true }, audit)).rejects.toMatchObject({
    status: 409,
    body: { error: "not_applicable", reason: "evacuated" },
  });
  expect(m.sets).toEqual([]);
  expect(audit.rows).toEqual([]);
  expect(await setSwitch({ enabled: false }, audit)).toEqual({ enabled: false }); // pausing still works
});

test("liveStatus reads launches from memory, and fresh re-reads the row into the same memory", async () => {
  const fail = async () => {
    throw new Error("no chain in this test");
  };
  const online = { fetchGlobal: fail, fetchBondingCurve: fail, fetchFeeConfig: fail, fetchPumpQuote: fail };
  const ctx = { conn: {}, online, Q: PublicKey.unique(), priorityFee: 0 } as never;
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.rows = [row({ launchesEnabled: false })];
  expect((await liveStatus(ctx, true)).paused).toBe("kill_switch");
  expect(switchOn("launches")).toBe(false);
  m.rows = [row()];
  const before = m.selects;
  expect((await liveStatus(ctx)).paused).toBe("kill_switch");
  expect(m.selects).toBe(before);
  expect((await liveStatus(ctx, true)).paused).toBe(null);
  expect(switchOn("launches")).toBe(true);
});

test("pauseAll switches all five jobs off and stamps evacuatedAt in one UPDATE, then memory", async () => {
  await loadSwitches();
  await pauseAll();
  expect(m.sets).toHaveLength(1);
  const set = m.sets[0] as Record<string, unknown>;
  expect(set).toMatchObject({
    ...{ launchesEnabled: false, forcedBondEnabled: false, sweepsEnabled: false },
    ...{ finalizeEnabled: false, buybackBurnEnabled: false },
  });
  expect(set.evacuatedAt).toBeInstanceOf(Date);
  const s = switchState();
  for (const j of ["launches", "forcedBond", "sweeps", "finalize", "buybackBurn"] as const)
    expect(s[j]).toBe(false);
  expect(s.evacuatedAt).toBe((set.evacuatedAt as Date).toISOString());
});

test("switchesOff turns the five jobs off in one UPDATE and leaves evacuatedAt alone (Pitfall 7)", async () => {
  m.rows = [row({ evacuatedAt: new Date("2026-10-25T00:00:00Z") })];
  await loadSwitches();
  await switchesOff();
  expect(m.sets).toEqual([
    {
      ...{ launchesEnabled: false, forcedBondEnabled: false, sweepsEnabled: false },
      ...{ finalizeEnabled: false, buybackBurnEnabled: false },
    },
  ]);
  expect(switchState()).toEqual({
    ...{ launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false },
    evacuatedAt: "2026-10-25T00:00:00.000Z",
  });
  m.rows = [row()];
  await loadSwitches();
  await switchesOff();
  expect(switchState().evacuatedAt).toBeNull();
});

test("a read that started before a flip or pauseAll never puts the old values back (WR-W-01)", async () => {
  await loadSwitches();
  let open = () => {};
  m.gate = new Promise((r) => {
    open = r;
  });
  const stale = loadSwitches();
  await setJob("sweeps", false);
  open();
  expect((await stale).sweeps).toBe(false);
  expect(switchOn("sweeps")).toBe(false);
  m.gate = new Promise((r) => {
    open = r;
  });
  const staler = loadSwitches();
  await pauseAll();
  open();
  await staler;
  expect(switchOn("launches")).toBe(false);
  expect(switchState().evacuatedAt).not.toBeNull();
});
