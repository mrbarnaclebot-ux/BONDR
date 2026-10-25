// The worker's admin door (D-08, D-11): closed unless ADMIN_WALLET is set and the forwarded actor matches it.
import { Keypair } from "@solana/web3.js";
import { expect, test } from "vitest";
import { adminRoutes, gated } from "./admin-routes.ts";
import type { WorkerEnv } from "./env.ts";
import { Fail } from "./http.ts";

const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();
const ok = async (body: unknown) => ({ got: body });

async function status(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof Fail && e.body.error === "forbidden") return e.status;
    throw e;
  }
}

test("no admin wallet answers 403 for any body", async () => {
  expect(await status(gated(null, ok)({ actor: A }))).toBe(403);
  expect(await status(gated(null, ok)(undefined))).toBe(403);
});

test("another or a missing actor answers 403; the admin actor reaches the handler with the full body", async () => {
  expect(await status(gated(A, ok)({ actor: B }))).toBe(403);
  expect(await status(gated(A, ok)({}))).toBe(403);
  expect(await gated(A, ok)({ actor: A, x: 1 })).toEqual({ got: { actor: A, x: 1 } });
});

test("every admin route is a POST behind the gate", async () => {
  const env = {
    adminWallet: A,
    feeEngine: "off",
    adminEvacuate: "simulate",
    sentryReadToken: null,
  } as unknown as WorkerEnv;
  const routes = adminRoutes({ env, engine: () => null, conn: {} as never });
  expect(Object.keys(routes)).toEqual(["POST /admin/health", "POST /admin/switch", "POST /admin/act"]);
  for (const [key, h] of Object.entries(routes)) {
    expect(key).toMatch(/^POST \/admin\//);
    expect(await status(h({ actor: B }))).toBe(403);
    expect(await status(h(undefined))).toBe(403);
  }
});
