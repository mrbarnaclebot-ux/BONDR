// settleLaunch end to end with the DB stubbed and every wait instant.
import { beforeEach, expect, test, vi } from "vitest";
import { settleLaunch } from "./settle.ts";

const m = vi.hoisted(() => ({ advance: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => undefined }));
vi.mock("@bondr/core/db", async (orig) => ({
  ...(await orig()),
  db: () => ({ transaction: (fn: (tx: object) => unknown) => fn({}) }),
}));
vi.mock("@bondr/core/send", async (orig) => ({ ...(await orig()), fetchTx: async () => null }));
vi.mock("./launches.ts", async (orig) => ({ ...(await orig()), advance: m.advance }));
vi.mock("./vanity.ts", async (orig) => ({ ...(await orig()), markUsed: async () => undefined }));

const row = {
  ...{ id: "l1", state: "sent", signature: "sig", lastValidBlockHeight: 150n, mint: "M", wallet: "W" },
  ...{ exit: "burn", solIn: 1n },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.advance.mockResolvedValue(row);
});

test("an unknown launch is checked again and lands once the RPC answers (WR-05)", async () => {
  const replies = [
    async () => ({ value: [null] }), // past expiry and unseen: recheck with history
    async () => Promise.reject(new Error("503")), // the history recheck fails: unknown
    async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }), // the later check sees it
  ];
  const conn = {
    getSignatureStatuses: () => (replies.shift() as () => Promise<unknown>)(),
    getBlockHeight: async () => 200,
  };
  await settleLaunch(conn as never, row);
  const moves = m.advance.mock.calls.map((c) => `${c[2]}->${c[3]}`);
  expect(moves).toEqual(["sent->unknown", "unknown->landed"]);
});
