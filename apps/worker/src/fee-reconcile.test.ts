// The reconcile's skips and dedupe (WR-09) over memoryLedger and an empty chain: every W reads 0 BONDR.
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { reconcile } from "./fee-reconcile.ts";
import type { FeeCoin, FeeDeps } from "./fee-send.ts";

const coinOf = () => ({ mint: PublicKey.unique(), w: Keypair.generate() }) as unknown as FeeCoin;

test("a W with a pending row or a busy queue is skipped; a diff that persists writes one row", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const ledger = memoryLedger();
  const conn = { getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => null) };
  const d = {
    mode: "on",
    Q: PublicKey.unique(),
    buyback: Keypair.generate(),
    ledger,
    conn,
  } as unknown as FeeDeps;
  const [a, b, c] = [coinOf(), coinOf(), coinOf()];
  const mints = [a, b, c].map((x) => x.mint.toBase58());
  for (const m of mints) {
    await ledger.insertPending([{ kind: "collect", mint: m, amount: 1000n }], `l${m}`, 1n);
    await ledger.settle(`l${m}`, "landed");
  }
  await ledger.insertPending([{ kind: "collect", mint: mints[1] ?? "" }], "inflight", 1n);
  const coins = new Map([a, b, c].map((x) => [x.mint.toBase58(), x]));
  const diff = vi.spyOn(ledger, "diff");
  const busy = (m: string) => m === mints[2];
  await reconcile(d, coins, busy);
  await reconcile(d, coins, busy);
  expect(diff.mock.calls.map(([m]) => m)).toEqual([mints[0]]);
  vi.restoreAllMocks();
});
