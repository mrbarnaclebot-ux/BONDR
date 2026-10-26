// The reconcile's skips and dedupe (WR-09) over memoryLedger and an empty chain: every W reads 0 BONDR.
import { Keypair, PublicKey } from "@solana/web3.js";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, test, vi } from "vitest";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { impliedOf, pgImplied, reconcile } from "./fee-reconcile.ts";
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

// Pitfall 6: EVACUATE drains W's BONDR, so it is an outflow; leftover_burn burns child tokens, not BONDR.
test("evacuate is an outflow of W's BONDR in memory and in the pgImplied SQL; leftover_burn is not", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const ledger = memoryLedger();
  const a = coinOf();
  const m = a.mint.toBase58();
  await ledger.insertPending([{ kind: "collect", mint: m, amount: 1000n }], "c", 1n);
  await ledger.insertPending([{ kind: "leftover_burn", mint: m, amount: 5n }], "l", 1n);
  await ledger.insertPending([{ kind: "evacuate", mint: m, amount: 1000n }], "e", 1n);
  for (const s of ["c", "l", "e"]) await ledger.settle(s, "landed");
  expect((await ledger.implied()).byMint.get(m)).toBe(0n);
  expect(impliedOf([{ kind: "evacuate", mint: m, amount: 7n, state: "landed" }]).byMint.get(m)).toBe(-7n);
  const conn = { getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => null) };
  const d = {
    mode: "on",
    Q: PublicKey.unique(),
    buyback: Keypair.generate(),
    ledger,
    conn,
  } as unknown as FeeDeps;
  const diff = vi.spyOn(ledger, "diff");
  expect(await reconcile(d, new Map([[m, a]]))).toEqual({ accounts: 2, diffs: 0 });
  expect(diff).not.toHaveBeenCalled();
  const execute = vi.fn(async (_q: SQL) => []);
  await pgImplied({ execute } as never);
  const q = execute.mock.calls[0]?.[0];
  const text = q ? new PgDialect().sqlToQuery(q).sql : "";
  expect(text).toContain("'evacuate'");
  expect(text).not.toContain("leftover_burn");
  vi.restoreAllMocks();
});
