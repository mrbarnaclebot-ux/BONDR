// Genesis boot (D-29, D-31): the reduced route table, the BONDR mint check after genesis, and the switch write.
// The enterGenesis case runs on the Neon dev branch (it writes the settings row and restores it) and skips
// without DATABASE_URL.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adminAudit, close, db, settings } from "@bondr/core/db";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { and, eq, gt } from "drizzle-orm";
import { afterAll, describe, expect, test, vi } from "vitest";
import type { GenesisCtx } from "./genesis.ts";
import { enterGenesis, genesisRoutes, NOT_READY_ROUTES, verifyQuoteMint } from "./genesis-boot.ts";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) console.log("genesis-boot.test.ts: DB case skipped, DATABASE_URL is not set");

const ADMIN = Keypair.generate().publicKey.toBase58();
const TREASURY = Keypair.generate().publicKey;
const gctx = {
  ...{ conn: {}, online: {}, Q: null, treasury: TREASURY, priorityFee: 0, net: "mainnet" },
  env: { adminWallet: ADMIN, treasury: TREASURY, net: "mainnet" },
} as unknown as GenesisCtx;
const admin = { "POST /admin/health": async () => ({ ok: true }) };

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { body?: { error?: string } }) => e.body?.error ?? String(e),
  );

test("the genesis table keeps status, quote, prepare, submit, kill-switch and admin, and closes the rest", async () => {
  const r = genesisRoutes(gctx, admin);
  for (const k of ["GET /status", "POST /quote", "POST /prepare", "POST /submit", "POST /kill-switch"])
    expect(r[k]).toBeTypeOf("function");
  expect(r["POST /admin/health"]).toBe(admin["POST /admin/health"]);
  expect(NOT_READY_ROUTES).toEqual(expect.arrayContaining(["POST /trade/prepare", "POST /fee/batch"]));
  for (const k of NOT_READY_ROUTES) expect(await code(r[k]?.({}) ?? Promise.resolve())).toBe("not_ready");
});

test("/prepare goes to genesisOne: no actor is not_ready, another actor is forbidden", async () => {
  const r = genesisRoutes(gctx, admin);
  const other = Keypair.generate().publicKey.toBase58();
  expect(await code(r["POST /prepare"]?.({ wallet: other }) ?? Promise.resolve())).toBe("not_ready");
  expect(await code(r["POST /prepare"]?.({ wallet: other, actor: other }) ?? Promise.resolve())).toBe(
    "forbidden",
  );
});

const curve = (quoteMint: PublicKey, creator: PublicKey) => ({
  fetchBondingCurve: async () => ({ quoteMint, creator, complete: false, realTokenReserves: 0 }),
});
const Q = Keypair.generate().publicKey;
type Online = Parameters<typeof verifyQuoteMint>[0];

test("verifyQuoteMint accepts a SOL-pair coin created by the treasury and names the failed fact otherwise", async () => {
  await expect(
    verifyQuoteMint(curve(NATIVE_MINT, TREASURY) as unknown as Online, Q, TREASURY),
  ).resolves.toBeUndefined();
  await expect(
    verifyQuoteMint(curve(PublicKey.default, TREASURY) as unknown as Online, Q, TREASURY),
  ).resolves.toBeUndefined();
  const bondrQuoted = curve(Keypair.generate().publicKey, TREASURY) as unknown as Online;
  await expect(verifyQuoteMint(bondrQuoted, Q, TREASURY)).rejects.toThrow("not a SOL-pair coin");
  const copycat = curve(NATIVE_MINT, Keypair.generate().publicKey) as unknown as Online;
  await expect(verifyQuoteMint(copycat, Q, TREASURY)).rejects.toThrow("creator is not the treasury");
  const missing = {
    fetchBondingCurve: async () => Promise.reject(new Error("Account not found")),
  } as unknown;
  const err = await verifyQuoteMint(missing as Online, Q, TREASURY).catch((e: Error) => e.message);
  expect(err).toContain("no pump curve");
  expect(err).not.toContain(Q.toBase58());
});

describe.skipIf(!process.env.DATABASE_URL)("enterGenesis on Postgres", { timeout: 60_000 }, () => {
  let before: typeof settings.$inferSelect | undefined;

  afterAll(async () => {
    if (before) await db().update(settings).set(before).where(eq(settings.id, 1));
    await close();
  });

  test("a seeded all-on settings row ends all off, evacuated_at null, with one genesis audit row", async () => {
    [before] = await db().select().from(settings).where(eq(settings.id, 1));
    const on = { launchesEnabled: true, forcedBondEnabled: true, sweepsEnabled: true };
    await db()
      .update(settings)
      .set({ ...on, finalizeEnabled: true, buybackBurnEnabled: true, evacuatedAt: null })
      .where(eq(settings.id, 1));
    const start = new Date(Date.now() - 1000);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await enterGenesis();
    const [row] = await db().select().from(settings).where(eq(settings.id, 1));
    expect(row).toMatchObject({
      ...{ launchesEnabled: false, forcedBondEnabled: false, sweepsEnabled: false },
      ...{ finalizeEnabled: false, buybackBurnEnabled: false, evacuatedAt: null },
    });
    const audits = await db()
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.actor, "genesis"), gt(adminAudit.at, start)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "switch",
      result: "landed",
      params: { job: "all", enabled: false },
    });
    expect(log).toHaveBeenCalledWith(
      "switches: launches=off forcedBond=off sweeps=off finalize=off buybackBurn=off",
    );
    log.mockRestore();
  });
});
