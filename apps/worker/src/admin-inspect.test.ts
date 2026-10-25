// ADMIN-09 (D-32): the inspector decodes recorded devnet and fork transactions as web3.js parses them in
// production, from a fake fetch that answers the fixture's raw getTransaction result. RPC only, no database.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { expect, test } from "vitest";
import { decodeIx, inspect, knownKeys } from "./admin-inspect.ts";
import { buyback, ops, treasury, type WorkerEnv } from "./env.ts";

type Fixture = { source: string; response: Record<string, unknown> & { meta: Record<string, unknown> } };
const fixture = (name: string): Fixture =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/core/src/fixtures/${name}.json`, import.meta.url), "utf8"),
  );

// Answers every JSON-RPC call with `result`, echoing the request id, or throws as a dead RPC would.
function connOf(result: unknown, dead = false): Connection {
  const fetch = (async (_url: string, init: { body: string }) => {
    if (dead) throw new Error("socket hang up");
    const { id } = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }) as unknown as typeof globalThis.fetch;
  return new Connection("http://127.0.0.1:1", { fetch });
}

const none = new Map<string, { label: string; mint?: string }>();

test("curve-buy decodes ComputeBudget, the ATA creates and the pump buy with arguments", async () => {
  const f = fixture("curve-buy");
  const r = await inspect(connOf(f.response), f.source, none);
  expect(r.found).toBe(true);
  expect(r.status).toBe("success");
  expect(r.slot).toBe(514267874);
  expect(r.error).toBeNull();
  expect(r.explorer).toBe(`https://solscan.io/tx/${f.source}?cluster=devnet`);
  const names = r.instructions?.map((i) => `${i.program}: ${i.name}`);
  expect(names?.slice(0, 2)).toEqual(["Compute Budget: SetComputeUnitLimit", "Compute Budget: SetComputeUnitPrice"]);
  expect(names?.[2]).toBe("Associated Token: CreateIdempotent");
  const buy = r.instructions?.[4];
  expect(buy?.index).toBe(5);
  expect(`${buy?.program}: ${buy?.name}`).toMatch(/^pump: buy/);
  expect(buy?.args.some((a) => /^amount: \d+$/.test(a))).toBe(true);
  expect(r.instructions?.[0].args).toEqual([expect.stringMatching(/^units: \d+$/)]);
});

test("forced-bond decodes the pump buy and the Token-2022 BurnChecked with its amount", async () => {
  const f = fixture("forced-bond");
  const r = await inspect(connOf(f.response), f.source, none);
  const names = r.instructions?.map((i) => `${i.program}: ${i.name}`) ?? [];
  expect(names).toContain("System: Transfer");
  expect(names.some((n) => n.startsWith("pump: buy"))).toBe(true);
  const burn = r.instructions?.find((i) => i.program === "Token-2022");
  expect(burn?.name).toBe("BurnChecked");
  expect(burn?.args).toContainEqual(expect.stringMatching(/^amount: [1-9]\d*$/));
  expect(burn?.args).toContainEqual(expect.stringMatching(/^decimals: \d+$/));
});

test("a failed transaction shows the mapped contract error, never the raw logs", async () => {
  const f = fixture("pool-buy");
  const logs = [
    "Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]",
    "Program log: AnchorError occurred. Error Code: ExceededSlippage. Error Number: 6004. <script>x</script>",
    "Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA failed: custom program error: 0x1774",
  ];
  const meta = { ...f.response.meta, err: { InstructionError: [3, { Custom: 6004 }] }, logMessages: logs };
  const r = await inspect(connOf({ ...f.response, meta }), f.source, none);
  expect(r.status).toBe("failed");
  expect(r.error).toBe("slippage (#4, code 6004 ExceededSlippage)");
});

test("a non-custom instruction error names its kind", async () => {
  const f = fixture("curve-sell");
  const meta = { ...f.response.meta, err: { InstructionError: [0, "InvalidAccountData"] }, logMessages: [] };
  const r = await inspect(connOf({ ...f.response, meta }), f.source, none);
  expect(r.error).toBe("build_failed (#1, InvalidAccountData)");
});

test("an unknown program reads Unknown program {short} with no arguments", () => {
  const programId = new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");
  const ix = new TransactionInstruction({ programId, keys: [], data: Buffer.from([1, 2, 3]) });
  expect(decodeIx(ix)).toEqual({ program: "Unknown program TSLv…eokM", name: "", args: [] });
});

test("garbage data for a known program stays an undecoded line, never a throw", () => {
  const programId = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const ix = new TransactionInstruction({ programId, keys: [], data: Buffer.from([250]) });
  expect(decodeIx(ix)).toEqual({ program: "Token-2022", name: "Undecoded", args: [] });
});

test("a null getTransaction is found false; a dead RPC rejects", async () => {
  expect(await inspect(connOf(null), fixture("curve-buy").source, none)).toEqual({ found: false });
  await expect(inspect(connOf(null, true), fixture("curve-buy").source, none)).rejects.toThrow();
});

test("the fee payer is labelled ops, treasury, buyback or W with its mint, else blank", async () => {
  const seed = Buffer.alloc(32, 7);
  const env = { seed, net: "devnet", lane: "local" } as unknown as WorkerEnv;
  const w = Keypair.generate();
  const mint = PublicKey.unique().toBase58();
  const engine = { coins: new Map([[mint, { w }]]) } as never;
  const known = knownKeys(env, engine);
  expect(known.get(ops(seed, "devnet").publicKey.toBase58())).toEqual({ label: "ops" });
  expect(known.get(treasury(seed, "devnet").publicKey.toBase58())).toEqual({ label: "treasury" });
  expect(known.get(buyback(seed, "devnet", "local").publicKey.toBase58())).toEqual({ label: "buyback" });
  expect(known.get(w.publicKey.toBase58())).toEqual({ label: "W", mint });
  expect(knownKeys(env, null).size).toBe(3);

  const f = fixture("curve-buy");
  const payer = (f.response.transaction as { message: { accountKeys: string[] } }).message.accountKeys[0];
  const labelled = await inspect(connOf(f.response), f.source, new Map([[payer, { label: "W", mint }]]));
  expect(labelled.feePayer).toEqual({ label: "W", address: payer, mint });
  expect((await inspect(connOf(f.response), f.source, none)).feePayer).toEqual({ label: "", address: payer });
});
