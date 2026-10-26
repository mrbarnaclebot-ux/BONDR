// Session-only admin actions (D-13): switch, hold, release hold, re-check launch, each written to the audit.
// The DB cases run on the Neon dev branch inside a transaction that is always rolled back, and skip without
// DATABASE_URL. Chain reads and the landed path are stubbed (OQ4).
import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { close, coins, db, launches, vanityMints, wallets } from "@bondr/core/db";
import { Keypair } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test, vi } from "vitest";
import { type ActDeps, act, switchRoute } from "./admin-act.ts";
import { memoryAudit } from "./admin-audit.ts";
import { Fail } from "./http.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const actor = Keypair.generate().publicKey.toBase58();
const SWITCHES = { launches: true, forcedBond: true, sweeps: false, finalize: true, buybackBurn: true };

function deps(over: Partial<ActDeps> = {}) {
  const audit = memoryAudit();
  const setHold = vi.fn();
  const d: ActDeps = {
    ...{ audit, engine: () => ({ setHold }), conn: {} as never, exec: {} as never },
    observe: vi.fn(async () => ({ seen: { confirmed: true, err: null }, height: 0 })),
    landed: vi.fn(async () => {}),
    setJob: vi.fn(async () => SWITCHES),
    ...over,
  };
  return { d, audit, setHold };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.body.error;
    throw e;
  }
  return "ok";
}

describe("switchRoute", () => {
  test("flips one job, writes one landed switch row and returns the switches", async () => {
    const { d, audit } = deps();
    expect(await switchRoute(d, { actor, job: "sweeps", enabled: false })).toEqual(SWITCHES);
    expect(d.setJob).toHaveBeenCalledTimes(1);
    expect(d.setJob).toHaveBeenCalledWith("sweeps", false);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      ...{ actor, action: "switch", mint: null, result: "landed" },
      params: { job: "sweeps", enabled: false },
    });
  });

  test("a flip whose write throws settles its row failed, never landed (WR-W-07)", async () => {
    const down = new Error("db down");
    const { d, audit } = deps({ setJob: vi.fn(async () => Promise.reject(down)) });
    await expect(switchRoute(d, { actor, job: "sweeps", enabled: false })).rejects.toBe(down);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "switch", result: "failed", error: "change_failed" });
  });

  test("an unknown job or a non-boolean answers invalid_input with no audit row", async () => {
    const { d, audit } = deps();
    expect(await code(switchRoute(d, { actor, job: "drain", enabled: false }))).toBe("invalid_input");
    expect(await code(switchRoute(d, { actor, job: "sweeps", enabled: "no" }))).toBe("invalid_input");
    expect(await code(switchRoute(d, { actor, job: "__proto__", enabled: true }))).toBe("invalid_input");
    expect(d.setJob).not.toHaveBeenCalled();
    expect(audit.rows).toHaveLength(0);
  });
});

test("a bad action, mint or hold reason answers invalid_input with no audit row", async () => {
  const { d, audit } = deps();
  const mint = Keypair.generate().publicKey.toBase58();
  expect(await code(act(d, { actor, action: "drain", mint }))).toBe("invalid_input");
  expect(await code(act(d, { actor, action: "hold", mint: "nope", reason: "x" }))).toBe("invalid_input");
  expect(await code(act(d, { actor, action: "hold", mint }))).toBe("invalid_input");
  expect(await code(act(d, { actor, action: "hold", mint, reason: "x".repeat(121) }))).toBe("invalid_input");
  expect(await code(act(d, { actor, action: "hold", mint, reason: "   " }))).toBe("invalid_input");
  expect(audit.rows).toHaveLength(0);
});

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
const ROLLBACK = new Error("rollback");
async function rolledBack(fn: (tx: Tx, mint: string) => Promise<void>): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await fn(tx, await seed(tx));
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

const id = () => randomBytes(16).toString("hex");
const launch = (mint: string, wallet: string) => ({
  ...{ id: id(), wallet, mint, w: wallet, name: "Test", symbol: "TEST" },
  ...{ uri: "ipfs://test", solIn: 1n, exit: "burn" },
});

// A coin on a failed launch; the mint is a real key so the route's validator accepts it.
async function seed(tx: Tx): Promise<string> {
  const mint = Keypair.generate().publicKey.toBase58();
  const wallet = `test-${randomBytes(8).toString("hex")}`;
  await tx.insert(wallets).values({ address: wallet, consentedAt: new Date(), termsVersion: "test" });
  await tx.insert(vanityMints).values({ idx: -BigInt(randomInt(1, 2 ** 47)), pubkey: mint });
  const l = launch(mint, wallet);
  await tx.insert(launches).values({ ...l, state: "failed" });
  await tx.insert(coins).values({
    ...{ mint, launchId: l.id, launchedAt: new Date(), bondingCurve: "curve", pool: "pool" },
    ...{ initialRealTokenReserves: "1", realTokenReserves: "1", realQuoteReserves: "0" },
    ...{ virtualTokenReserves: "1", virtualQuoteReserves: "1", mcapSol: 1, launchMcapSol: 1 },
  });
  return mint;
}

const coinOf = async (tx: Tx, mint: string) => (await tx.select().from(coins).where(eq(coins.mint, mint)))[0];

describe.skipIf(!process.env.DATABASE_URL)("act on the database", { timeout: 30_000 }, () => {
  afterAll(() => close());

  test("hold sets the columns and the engine hold; release clears both", async () => {
    await rolledBack(async (tx, mint) => {
      const { d, audit, setHold } = deps({ exec: tx as never });
      expect(await act(d, { actor, action: "hold", mint, reason: "review" })).toEqual({ outcome: "held" });
      expect(await coinOf(tx, mint)).toMatchObject({ heldReason: "review", finalize: "none" });
      expect((await coinOf(tx, mint))?.heldAt).toBeInstanceOf(Date);
      expect(setHold).toHaveBeenCalledWith(mint, "review");
      expect(await act(d, { actor, action: "release_hold", mint })).toEqual({ outcome: "released" });
      expect(await coinOf(tx, mint)).toMatchObject({ heldAt: null, heldReason: null, finalize: "none" });
      expect(setHold).toHaveBeenLastCalledWith(mint, null, false);
      expect(audit.rows.map((r) => [r.action, r.result, r.mint])).toEqual([
        ["hold", "landed", mint],
        ["release_hold", "landed", mint],
      ]);
      expect(audit.rows[0]?.params).toEqual({ reason: "review" });
    });
  });

  test("release on a finalize-held coin sets finalize none so the next batch re-runs the pre-flight", async () => {
    await rolledBack(async (tx, mint) => {
      await tx.update(coins).set({ finalize: "held" }).where(eq(coins.mint, mint));
      const { d, setHold } = deps({ exec: tx as never });
      expect(await act(d, { actor, action: "release_hold", mint })).toEqual({ outcome: "released" });
      expect((await coinOf(tx, mint))?.finalize).toBe("none");
      expect(setHold).toHaveBeenCalledWith(mint, null, true);
    });
  });

  test("with the engine off hold and release still update the database; an unknown coin is not_found", async () => {
    await rolledBack(async (tx, mint) => {
      const { d, audit } = deps({ exec: tx as never, engine: () => null });
      await act(d, { actor, action: "hold", mint, reason: "review" });
      expect((await coinOf(tx, mint))?.heldReason).toBe("review");
      await act(d, { actor, action: "release_hold", mint });
      expect((await coinOf(tx, mint))?.heldReason).toBeNull();
      const other = Keypair.generate().publicKey.toBase58();
      expect(await code(act(d, { actor, action: "hold", mint: other, reason: "x" }))).toBe("not_found");
      expect(audit.rows).toHaveLength(2);
    });
  });

  test("re-check runs the landed path once on a confirmed signature", async () => {
    await rolledBack(async (tx, mint) => {
      const [l] = await tx.select().from(launches).where(eq(launches.mint, mint));
      const row = { ...launch(mint, l?.wallet ?? ""), state: "unknown", signature: `test-${id()}` };
      await tx.insert(launches).values(row);
      const { d, audit } = deps({ exec: tx as never });
      expect(await act(d, { actor, action: "recheck_launch", mint })).toEqual({ outcome: "landed" });
      expect(d.observe).toHaveBeenCalledTimes(1);
      expect(d.observe).toHaveBeenCalledWith(d.conn, row.signature, true, 0);
      expect(d.landed).toHaveBeenCalledTimes(1);
      expect(d.landed).toHaveBeenCalledWith(
        d.conn,
        expect.objectContaining({ id: row.id, state: "unknown" }),
      );
      expect(audit.rows.map((r) => [r.action, r.params])).toEqual([
        ["recheck_launch", { outcome: "landed" }],
      ]);
    });
  });

  test("a failed or unseen signature answers not_on_chain and changes nothing; no launch is not_applicable", async () => {
    await rolledBack(async (tx, mint) => {
      const { d: none, audit: a0 } = deps({ exec: tx as never });
      expect(await code(act(none, { actor, action: "recheck_launch", mint }))).toBe("not_applicable");
      expect(a0.rows.map((r) => r.params)).toEqual([{ outcome: "not_applicable" }]);
      const [l] = await tx.select().from(launches).where(eq(launches.mint, mint));
      const row = { ...launch(mint, l?.wallet ?? ""), state: "sent", signature: `test-${id()}` };
      await tx.insert(launches).values(row);
      for (const seen of [{ confirmed: true, err: { InstructionError: [0, "x"] } }, null]) {
        const { d, audit } = deps({ exec: tx as never, observe: vi.fn(async () => ({ seen, height: 0 })) });
        expect(await act(d, { actor, action: "recheck_launch", mint })).toEqual({ outcome: "not_on_chain" });
        expect(d.landed).not.toHaveBeenCalled();
        expect(audit.rows.map((r) => r.params)).toEqual([{ outcome: "not_on_chain" }]);
      }
      const [after] = await tx.select().from(launches).where(eq(launches.id, row.id));
      expect(after?.state).toBe("sent");
    });
  });
});
