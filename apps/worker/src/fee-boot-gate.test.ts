// CR-W-03: every automatic fee job asks allowed(), which reads the contract check in memory as well as the
// switches, so a mismatch whose switches-off write failed still stops the engine.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import type { WorkerEnv } from "./env.ts";
import { feeDeps } from "./fee-boot.ts";
import type { Ctx } from "./status.ts";

const m = vi.hoisted(() => ({ failed: vi.fn(() => false) }));
vi.mock("./contract-check.ts", async (orig) => ({ ...(await orig()), contractFailed: m.failed }));
vi.mock("./switches.ts", async (orig) => ({ ...(await orig()), switchOn: () => true }));

test("a failed contract check refuses every engine job even with its switch on", () => {
  const ctx = {
    conn: new Connection("http://127.0.0.1:1"),
    online: {},
    Q: PublicKey.default,
  } as unknown as Ctx;
  const env = {
    ...{ net: "devnet", seed: Buffer.alloc(32), lane: "local", feeWindowMs: 1 },
    ...{ treasury: Keypair.generate().publicKey, treasuryExternal: false },
  } as unknown as WorkerEnv;
  const d = feeDeps(ctx, env, "on");
  expect(d.allowed?.("sweeps", null)).toBe(true);
  m.failed.mockReturnValue(true);
  for (const job of ["forcedBond", "sweeps", "finalize", "buybackBurn"] as const)
    expect(d.allowed?.(job, null)).toBe(false);
});
