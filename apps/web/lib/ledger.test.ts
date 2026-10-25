// The ledger read against the Neon dev branch (seeded coin, removed after); CI has no .env and skips.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { dropCoin, fakeSig, type Seeded, seedCoin, seedLedger } from "../e2e/fixtures.ts";
import { close } from "./db";
import { ledgerPage, parseLedgerCursor } from "./ledger";

vi.mock("server-only", () => ({}));

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

test("parseLedgerCursor takes landedMs.id and nothing else", () => {
  expect(parseLedgerCursor("1730000000000.42")).toEqual({ ms: 1_730_000_000_000, id: 42n });
  for (const bad of ["x", "1.", "-1.2", "1e3.2", `${"9".repeat(16)}.1`, "1.9223372036854775808"])
    expect(parseLedgerCursor(bad)).toBeNull();
});

const ago = (min: number) => new Date(Date.now() - min * 60_000);

// 60 s: the first query may wake a suspended Neon compute.
describe.skipIf(!process.env.DATABASE_URL)("ledgerPage", { timeout: 60_000 }, () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });
  let coin: Seeded;
  let other: Seeded;
  let platformId = "";
  beforeAll(async () => {
    [coin, other] = [await seedCoin(sql, { trades: 0 }), await seedCoin(sql, { trades: 0 })];
  }, 60_000);
  afterAll(async () => {
    if (platformId) await sql`delete from fee_ledger where id = ${platformId}`;
    if (coin) await dropCoin(sql, coin.mint);
    if (other) await dropCoin(sql, other.mint);
    await sql.end();
    await close();
  }, 30_000);

  test("only landed public rows of the coin come back", async () => {
    const [collect] = await seedLedger(sql, coin.mint, [
      { kind: "collect", amount: "1000", sol: "10", detail: { dBps: 1, reason: "x" }, landed_at: ago(5) },
      { kind: "collect", state: "pending", amount: "2000" },
      { kind: "held", state: null, signature: null, detail: { reason: "deployer is off curve" } },
      { kind: "sweep_buyback", state: "failed", amount: "3000", window_index: 0 },
    ]);
    await seedLedger(sql, other.mint, [{ kind: "collect", amount: "4000", landed_at: ago(4) }]);
    const [p] = await sql<{ id: string }[]>`insert into fee_ledger
      (kind, mint, state, burned, signature, last_valid_block_height, landed_at)
      values ('buyback_burn', null, 'landed', '5', ${fakeSig()}, 1000, now()) returning id`;
    platformId = p.id;
    const page = await ledgerPage(coin.mint);
    expect(page.rows.map((r) => r.id)).toEqual([String(collect.id)]);
    expect(page.rows[0].detail).toEqual({ dBps: 1 }); // the reason key never leaves the server
    expect([page.more, page.next]).toEqual([false, null]);
  });

  test("25 rows page as 20 then 5 with no duplicate, ties ordered by id", async () => {
    await sql`delete from fee_ledger where mint = ${coin.mint}`;
    const at = (i: number) => new Date(Date.now() - 10 * 60_000 - Math.floor(i / 2) * 60_000);
    const rows = Array.from({ length: 25 }, (_, i) => ({ kind: "collect", amount: "1", landed_at: at(i) }));
    const seeded = await seedLedger(sql, coin.mint, rows);
    const first = await ledgerPage(coin.mint);
    expect([first.rows.length, first.more]).toEqual([20, true]);
    const cursor = parseLedgerCursor(first.next as string);
    expect(cursor).not.toBeNull();
    const second = await ledgerPage(coin.mint, cursor ?? undefined);
    expect([second.rows.length, second.more]).toEqual([5, false]);
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(25);
    expect(ids.sort()).toEqual(seeded.map((s) => String(s.id)).sort());
  });
});
