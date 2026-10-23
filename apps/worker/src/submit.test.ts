// submit's refusals with the DB and the chain stubbed.
import { beforeEach, expect, test, vi } from "vitest";
import type { PrepareCtx } from "./prepare.ts";
import { submit } from "./submit.ts";

const m = vi.hoisted(() => ({ advance: vi.fn(), getLaunch: vi.fn(), status: vi.fn() }));
vi.mock("@bondr/core/db", async (orig) => ({ ...(await orig()), db: () => ({}) }));
vi.mock("./status.ts", async (orig) => ({
  ...(await orig()),
  liveStatus: m.status,
}));
vi.mock("./settle.ts", async (orig) => ({ ...(await orig()), releaseMint: async () => undefined }));
vi.mock("./launches.ts", async (orig) => ({ ...(await orig()), advance: m.advance, getLaunch: m.getLaunch }));

const id = "a".repeat(32);
const body = { launchId: id, signed: Buffer.from([1]).toString("base64") };

beforeEach(() => {
  vi.resetAllMocks();
  m.status.mockResolvedValue({ paused: "kill_switch", minLamports: "1" });
});

test("a refusal that loses the race to a concurrent signed submit answers the row's state (web WR-05)", async () => {
  m.getLaunch
    .mockResolvedValueOnce({ id, state: "prepared", mint: "M" })
    .mockResolvedValueOnce({ id, state: "signed", signature: "sig", mint: "M" });
  m.advance.mockResolvedValue(null); // the row was no longer prepared
  await expect(submit({} as PrepareCtx, body)).resolves.toEqual({ state: "signed", signature: "sig" });
});

test("a refusal that wins still answers the contract error", async () => {
  m.getLaunch.mockResolvedValue({ id, state: "prepared", mint: "M" });
  m.advance.mockResolvedValue({ id, state: "failed" });
  await expect(submit({} as PrepareCtx, body)).rejects.toMatchObject({ body: { error: "paused" } });
});

test("a failed chain read refuses instead of co-signing past an unchecked pause (worker-core IN-02)", async () => {
  m.status.mockResolvedValue({ paused: null, minLamports: null });
  m.getLaunch.mockResolvedValue({ id, state: "prepared", mint: "M" });
  m.advance.mockResolvedValue({ id, state: "failed" });
  await expect(submit({} as PrepareCtx, body)).rejects.toMatchObject({ body: { error: "build_failed" } });
});
