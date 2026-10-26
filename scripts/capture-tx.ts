// Saves one landed tx as a parser fixture in the forced-bond.json shape: { capturedAt, mint?, net, response,
// slot, source }, where response is the raw JSON-RPC getTransaction result (encoding json), so events.test.ts
// fixture() reads it unchanged. Fixtures are public chain data. Refuses to overwrite an existing file.
//   --sig SIG    the transaction signature (required)
//   --name NAME  the file name without .json (required)
//   --net NET    devnet (default) or fork
//   --mint MINT  the coin the fixture is about (optional)
// Run: node --env-file=.env scripts/capture-tx.ts --sig <sig> --name curve-buy --mint <mint>
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Net } from "@bondr/core/keys";
import { connect, redact } from "@bondr/core/net";
import { fetchTx } from "@bondr/core/send";

const DIR = new URL("../packages/core/src/fixtures/", import.meta.url);

function args() {
  const s = { type: "string" } as const;
  const v = parseArgs({ options: { sig: s, name: s, net: { ...s, default: "devnet" }, mint: s } }).values;
  if (!v.sig || !v.name) throw new Error("--sig and --name are required");
  if (!/^[a-z0-9-]+$/.test(v.name)) throw new Error("--name must be lowercase letters, digits and dashes");
  if (v.net !== "devnet" && v.net !== "fork") throw new Error("--net must be devnet or fork");
  const net: Net = v.net;
  return { sig: v.sig, name: v.name, net, mint: v.mint };
}

async function main(): Promise<void> {
  const a = args();
  const file = new URL(`${a.name}.json`, DIR);
  if (existsSync(file)) throw new Error(`fixtures/${a.name}.json exists; refusing to overwrite`);
  const conn = await connect(a.net);
  // fetchTx waits until the tx is visible at confirmed; the raw read below then keeps the wire JSON shape.
  if (!(await fetchTx(conn, a.sig))) throw new Error(`tx ${a.sig} not found`);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [a.sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }],
  });
  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const json = (await res.json()) as { result?: { slot: number } | null; error?: unknown };
  if (!json.result) throw new Error(`getTransaction failed: ${JSON.stringify(json.error ?? null)}`);
  const capturedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const out = {
    source: a.sig,
    net: a.net,
    mint: a.mint,
    slot: json.result.slot,
    capturedAt,
    response: json.result,
  };
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, { flag: "wx" });
  console.log(`wrote fixtures/${a.name}.json (slot ${json.result.slot})`);
}

if (import.meta.main)
  main().catch((e: unknown) => {
    console.error(`capture-tx failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    process.exitCode = 1;
  });
