// WR-W-02: no switch turns on in genesis, and on mainnet the launches switch needs D-30 (a passing contract
// check, 100 free vanity mints). The contract check and the pool count are stubbed: no RPC, no database.
import { Keypair } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { memoryAudit } from "./admin-audit.ts";
import { setSwitch } from "./status.ts";
import { gateFor, switchGate } from "./switch-gate.ts";

const m = vi.hoisted(() => ({ failed: vi.fn(() => false) }));
vi.mock("./contract-check.ts", async (orig) => ({ ...(await orig()), contractFailed: m.failed }));

const Q = Keypair.generate().publicKey;
const GENESIS = { net: "mainnet", quoteMint: null } as const;
const MAINNET = { net: "mainnet", quoteMint: Q } as const;
const DEVNET = { net: "devnet", quoteMint: Q } as const;
const reason = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { status?: number; body?: { error: string; reason?: string } }) =>
      `${e.status} ${e.body?.error} ${e.body?.reason}`,
  );

beforeEach(() => m.failed.mockReturnValue(false));

test("in genesis every switch-on is refused, and switching off still works", async () => {
  for (const job of ["launches", "forcedBond", "sweeps", "finalize", "buybackBurn"] as const)
    expect(await reason(switchGate(GENESIS, job, true, async () => 500))).toBe("409 not_ready genesis");
  expect(await reason(switchGate(GENESIS, "launches", false))).toBe("ok");
});

test("on mainnet launches needs a passing contract check, then 100 free mints (D-30)", async () => {
  m.failed.mockReturnValue(true);
  expect(await reason(switchGate(MAINNET, "launches", true, async () => 500))).toBe(
    "409 not_ready contract_check",
  );
  m.failed.mockReturnValue(false);
  expect(await reason(switchGate(MAINNET, "launches", true, async () => 99))).toBe(
    "409 not_ready vanity_pool",
  );
  expect(await reason(switchGate(MAINNET, "launches", true, async () => 100))).toBe("ok");
  expect(await reason(switchGate(MAINNET, "sweeps", true, async () => 0))).toBe("ok");
});

test("devnet keeps its small pool: only genesis refuses there", async () => {
  m.failed.mockReturnValue(true);
  expect(await reason(switchGate(DEVNET, "launches", true, async () => 0))).toBe("ok");
});

test("the runbook /kill-switch is refused in genesis before any read or audit row", async () => {
  const audit = memoryAudit();
  expect(await reason(setSwitch({ enabled: true }, audit, gateFor(GENESIS)))).toBe("409 not_ready genesis");
  expect(audit.rows).toEqual([]);
});
