// CR-W-02: the gatherer against a fake RPC. A layout change pump could ship (a missing account, a new owner, a
// new discriminator, a shorter FeeConfig) is a mismatch fact, never the "could not run" that pauses nothing.
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect, test } from "vitest";
import { checkContract } from "./contract.ts";
import {
  GLOBAL_CONFIG_PDA,
  GLOBAL_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
} from "./pump.ts";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const info = (owner: PublicKey, data: Buffer, executable = false) => ({
  ...{ owner, data, executable },
  ...{ lamports: 1, rentEpoch: 0 },
});
const program = () =>
  info(LOADER, Buffer.concat([Buffer.alloc(4), Keypair.generate().publicKey.toBuffer()]), true);
const head = () => info(LOADER, Buffer.alloc(45));
// Plausible owners and sizes with bytes the pinned SDK cannot decode (the case each test overrides).
const junk = (owner: PublicKey, size: number) => info(owner, Buffer.alloc(size, 7));
const BASE = new Map<string, ReturnType<typeof info> | null>([
  [GLOBAL_PDA.toBase58(), junk(PUMP_PROGRAM_ID, 1088)],
  [PUMP_FEE_CONFIG_PDA.toBase58(), junk(PUMP_FEE_PROGRAM_ID, 4097)],
  [GLOBAL_CONFIG_PDA.toBase58(), junk(PUMP_AMM_PROGRAM_ID, 949)],
  [PUMP_AMM_FEE_CONFIG_PDA.toBase58(), junk(PUMP_FEE_PROGRAM_ID, 4097)],
]);

function rpc(over: [PublicKey, ReturnType<typeof info> | null][] = [], down = false) {
  const accounts = new Map([...BASE, ...over.map(([k, v]) => [k.toBase58(), v] as const)]);
  return {
    getMultipleAccountsInfo: async (keys: PublicKey[], o?: { dataSlice?: object }) => {
      if (down) throw new Error("fetch failed");
      if (o?.dataSlice) return keys.map(head);
      if (keys[0]?.equals(PUMP_PROGRAM_ID)) return keys.map(program);
      return keys.map((k) => accounts.get(k.toBase58()) ?? null);
    },
  };
}
const check = (conn: ReturnType<typeof rpc>) => checkContract(conn as never, "mainnet");
const NO_DECODE = "live config no longer decodes with the pinned SDK";

test("a missing Global account is a mismatch", async () => {
  const { facts } = await check(rpc([[GLOBAL_PDA, null]]));
  expect(facts).toContain("Global account not owned by the pump program");
  expect(facts).toContain(NO_DECODE);
});

test("a Global account owned by another program is a mismatch", async () => {
  const { facts } = await check(rpc([[GLOBAL_PDA, junk(PUMP_AMM_PROGRAM_ID, 1088)]]));
  expect(facts).toContain("Global account not owned by the pump program");
  expect(facts).toContain(NO_DECODE);
});

test("a new Global discriminator is a mismatch", async () => {
  const { facts } = await check(rpc());
  expect(facts).toContain("Global discriminator changed");
  expect(facts).toContain(NO_DECODE);
});

test("a FeeConfig shorter than the SDK decodes is a mismatch", async () => {
  const { facts } = await check(rpc([[PUMP_FEE_CONFIG_PDA, junk(PUMP_FEE_PROGRAM_ID, 100)]]));
  expect(facts).toContain("FeeConfig account is 100 bytes, expected 4097");
  expect(facts).toContain(NO_DECODE);
});

test("an RPC failure still rejects, so the worker reports could not run", async () => {
  await expect(check(rpc([], true))).rejects.toThrow("fetch failed");
});
