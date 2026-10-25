// The five owner switches in memory (D-18) over a fake settings row. No Postgres: db() is a stub that records
// each select and update.
import { PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({ rows: [] as object[], sets: [] as object[], selects: 0, fail: false }));
vi.mock("@bondr/core/db", async (orig) => ({
  ...((await orig()) as object),
  db: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          m.selects++;
          return m.rows;
        },
      }),
    }),
    update: () => ({
      set: (v: object) => ({
        where: async () => {
          if (m.fail) throw new Error("db down");
          m.sets.push(v);
        },
      }),
    }),
  }),
}));

const { loadSwitches, setJob, switchOn, switchState } = await import("./switches.ts");
const { liveStatus, setSwitch } = await import("./status.ts");

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

test("POST /kill-switch still answers { enabled } and moves the launches switch", async () => {
  await loadSwitches();
  expect(await setSwitch({ enabled: false })).toEqual({ enabled: false });
  expect(m.sets).toEqual([{ launchesEnabled: false }]);
  expect(switchOn("launches")).toBe(false);
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
