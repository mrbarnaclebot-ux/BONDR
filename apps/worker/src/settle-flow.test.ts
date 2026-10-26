// settleLaunch end to end with the DB stubbed and every wait instant.
import { beforeEach, expect, test, vi } from "vitest";
import { landed, setTreasury, settleLaunch } from "./settle.ts";

const m = vi.hoisted(() => ({ advance: vi.fn(), fetchTx: vi.fn(), ingest: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => undefined }));
vi.mock("@bondr/core/db", async (orig) => ({
  ...(await orig()),
  db: () => ({ transaction: (fn: (tx: object) => unknown) => fn({}) }),
}));
vi.mock("@bondr/core/send", async (orig) => ({ ...(await orig()), fetchTx: m.fetchTx }));
vi.mock("@bondr/core/events", async (orig) => ({ ...(await orig()), innerEvents: () => [] }));
vi.mock("./ingest.ts", async (orig) => ({ ...(await orig()), ingestLaunch: m.ingest }));
vi.mock("./launches.ts", async (orig) => ({ ...(await orig()), advance: m.advance }));
vi.mock("./vanity.ts", async (orig) => ({ ...(await orig()), markUsed: async () => undefined }));

const row = {
  ...{ id: "l1", state: "sent", signature: "sig", lastValidBlockHeight: 150n, mint: "M", wallet: "W" },
  ...{ exit: "burn", solIn: 1n, w: "CHILD_W" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.advance.mockResolvedValue(row);
  m.fetchTx.mockResolvedValue(null);
  m.ingest.mockResolvedValue(undefined);
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

// CR-W-01: the row submit leaves "sent" after a Sender timeout and an RPC "already processed" lands from the
// signature status, found only by the history search past expiry; it is never failed.
test("a launch unseen in the window lands when the history recheck finds its signature", async () => {
  const history: boolean[] = [];
  const conn = {
    getSignatureStatuses: async (_s: string[], o: { searchTransactionHistory: boolean }) => {
      history.push(o.searchTransactionHistory);
      return { value: [o.searchTransactionHistory ? { confirmationStatus: "finalized", err: null } : null] };
    },
    getBlockHeight: async () => 200,
  };
  await settleLaunch(conn as never, row);
  expect(history).toEqual([false, true]);
  expect(m.advance.mock.calls.map((c) => `${c[2]}->${c[3]}`)).toEqual(["sent->landed"]);
});

// WR-W-03: keyed on the row, so a genesis row that lands after a restart in child mode is still not ingested.
test("the genesis row (w = the treasury) records its facts but gets no coin row, in any boot mode (D-31)", async () => {
  m.fetchTx.mockResolvedValue({ meta: { postTokenBalances: [] } });
  setTreasury("TREASURY");
  await landed({} as never, { ...row, w: "TREASURY" });
  const moves = m.advance.mock.calls.map((c) => `${c[2]}->${c[3]}`);
  expect(moves).toEqual(["sent->landed", "landed->landed"]);
  expect(m.advance.mock.calls[1]?.[4]).toMatchObject({ facts: { devChildAfter: "0" } });
  expect(m.ingest).not.toHaveBeenCalled();
  await landed({} as never, row); // the control: a child row (its own W) is ingested
  expect(m.ingest).toHaveBeenCalledTimes(1);
});
