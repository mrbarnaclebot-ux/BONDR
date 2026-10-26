// submit's refusals and its broadcast choice (D-34) with the DB, the co-sign and the chain stubbed.
import { Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { SENDER_TIPS } from "./fee-config.ts";
import type { PrepareCtx } from "./prepare.ts";
import { submit } from "./submit.ts";

const m = vi.hoisted(() => ({
  advance: vi.fn(),
  getLaunch: vi.fn(),
  status: vi.fn(),
  broadcast: vi.fn(),
  urgent: vi.fn(),
}));
vi.mock("@bondr/core/db", async (orig) => ({ ...(await orig()), db: () => ({}) }));
vi.mock("./status.ts", async (orig) => ({
  ...(await orig()),
  liveStatus: m.status,
}));
vi.mock("./settle.ts", async (orig) => ({
  ...(await orig()),
  releaseMint: async () => undefined,
  settleInBackground: () => undefined,
}));
vi.mock("./launches.ts", async (orig) => ({ ...(await orig()), advance: m.advance, getLaunch: m.getLaunch }));
vi.mock("./vanity.ts", async (orig) => ({
  ...(await orig()),
  vanityRow: async () => ({}),
  mintKeyFor: () => ({}),
}));
vi.mock("@bondr/core/cosign", async (orig) => ({
  ...(await orig()),
  cosign: (i: { wire: Uint8Array }) => ({ ok: true, wire: i.wire }),
  signatureOf: () => "sig",
}));
vi.mock("@bondr/core/send", async (orig) => ({ ...(await orig()), broadcast: m.broadcast }));
vi.mock("./fee-send.ts", async (orig) => ({ ...(await orig()), urgentBroadcast: m.urgent }));

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

const dev = Keypair.generate().publicKey;
const stored = (to: string) =>
  Buffer.from(
    new TransactionMessage({
      payerKey: dev,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: dev, toPubkey: new PublicKey(to), lamports: 1 })],
    })
      .compileToV0Message()
      .serialize(),
  );
const ctx = {
  env: { net: "mainnet", seed: Buffer.alloc(32), lane: "local" },
  conn: { getBlockHeight: async () => 0, getAddressLookupTable: async () => ({ value: {} }) },
} as unknown as PrepareCtx;
const wire = Buffer.from([7, 7, 7]);
const sendBody = { launchId: id, signed: wire.toString("base64") };
const prepared = (message: Buffer) => {
  const row = {
    id,
    state: "prepared",
    mint: "M",
    wallet: dev.toBase58(),
    message,
    lookupTable: dev.toBase58(),
  };
  m.getLaunch.mockResolvedValue({ ...row, lastValidBlockHeight: "100", blockhash: "bh" });
  m.status.mockResolvedValue({ paused: null, minLamports: "1" });
  m.advance.mockImplementation(async (_db, _id, _from, to) => ({ ...row, state: to }));
};
const unknown = { ok: false, status: "unknown", sig: "sig", err: "sender 400 bad tip" };

test("a tipped launch goes out through Sender at the default tip, and RPC is not used when it accepts", async () => {
  prepared(stored(SENDER_TIPS[0] as string));
  m.urgent.mockResolvedValue(null);
  await expect(submit(ctx, sendBody)).resolves.toEqual({ state: "sent", signature: "sig" });
  expect(m.urgent).toHaveBeenCalledTimes(1);
  const [net, , raw, opts] = m.urgent.mock.calls[0] as [string, unknown, Uint8Array, { swqosOnly: boolean }];
  expect([net, Buffer.from(raw).equals(wire), opts.swqosOnly]).toEqual(["mainnet", true, false]);
  expect(m.broadcast).not.toHaveBeenCalled();
});

test("a Sender error sends the identical bytes once through RPC, and RPC decides failed or sent", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  prepared(stored(SENDER_TIPS[1] as string));
  m.urgent.mockResolvedValue(unknown);
  m.broadcast.mockResolvedValue({ ok: false, status: "failed", sig: "sig", err: "preflight" });
  await expect(submit(ctx, sendBody)).resolves.toEqual({ state: "failed", signature: "sig" });
  expect(m.broadcast).toHaveBeenCalledTimes(1);
  expect(Buffer.from(m.broadcast.mock.calls[0]?.[1] as Uint8Array).equals(wire)).toBe(true);
  m.broadcast.mockResolvedValue(null);
  m.broadcast.mockClear();
  await expect(submit(ctx, sendBody)).resolves.toEqual({ state: "sent", signature: "sig" });
  expect(m.broadcast).toHaveBeenCalledTimes(1);
});

test("an untipped launch goes through RPC only", async () => {
  prepared(stored(Keypair.generate().publicKey.toBase58()));
  m.broadcast.mockResolvedValue(null);
  await expect(submit(ctx, sendBody)).resolves.toEqual({ state: "sent", signature: "sig" });
  expect(m.urgent).not.toHaveBeenCalled();
  expect(m.broadcast).toHaveBeenCalledTimes(1);
});
