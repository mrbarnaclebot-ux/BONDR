// Probe for 03-RESEARCH assumptions A1 (Helius logsSubscribe mentions [BONDR] sees every BONDR coin trade,
// including txs that load keys from a lookup table) and A2 (getSignaturesForAddress(mint) lists them).
// Devnet only. Node 24 global WebSocket, no ws package. Every printed error goes through redact().
//   --listen SECONDS --out PATH   subscribe at confirmed, ping every 30 s, write every notification
//                                 { signature, err, hasPumpInvoke } to PATH as a JSON array, exit after SECONDS
//   --check --notified PATH --mint MINT --sigs a,b,c
//                                 PASS or FAIL per sig: in the notified file (A1) and in the mint's
//                                 getSignaturesForAddress, limit 1000 (A2); exit 1 on any FAIL
// Run: node --env-file=.env scripts/stream-probe.ts --listen 600 --out /tmp/claude-probe-run.json
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { connect, redact, wsUrl } from "@bondr/core/net";
import { PublicKey } from "@solana/web3.js";
import { loadEnv } from "../apps/worker/src/env.ts";

type Note = { signature: string; err: unknown; hasPumpInvoke: boolean };
const INVOKES = [
  "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke",
  "Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke",
];

function listen(seconds: number, out: string): Promise<void> {
  const q = loadEnv().quoteMint.toBase58();
  const notes: Note[] = [];
  writeFileSync(out, "[]\n");
  const ws = new WebSocket(wsUrl("devnet"));
  let subscribed = false;
  let ping: NodeJS.Timeout | undefined;
  return new Promise((resolve, reject) => {
    const stop = setTimeout(() => {
      clearInterval(ping);
      ws.close();
      if (subscribed) resolve();
      else reject(new Error("no logsSubscribe confirmation before the listen ended"));
    }, seconds * 1000);
    ws.onopen = () => {
      const params = [{ mentions: [q] }, { commitment: "confirmed" }];
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params }));
      ping = setInterval(() => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })), 30_000);
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id === 1) {
        subscribed = typeof msg.result === "number";
        console.log(subscribed ? `subscribed to mentions ${q}` : `subscribe refused: ${JSON.stringify(msg)}`);
      }
      const v = msg.params?.result?.value;
      if (!v?.signature) return;
      const hasPumpInvoke = (v.logs as string[]).some((l) => INVOKES.some((p) => l.startsWith(p)));
      notes.push({ signature: v.signature, err: v.err, hasPumpInvoke });
      writeFileSync(out, `${JSON.stringify(notes, null, 2)}\n`);
      console.log(`notified ${v.signature} err ${JSON.stringify(v.err)} pump ${hasPumpInvoke}`);
    };
    ws.onerror = (e) => {
      clearTimeout(stop);
      clearInterval(ping);
      reject(new Error(redact(`websocket error: ${String((e as ErrorEvent).message ?? e.type)}`)));
    };
  });
}

async function check(notified: string, mint: string, sigs: string[]): Promise<boolean> {
  const seen = new Set((JSON.parse(readFileSync(notified, "utf8")) as Note[]).map((n) => n.signature));
  const conn = await connect("devnet");
  const listed = new Set(
    (await conn.getSignaturesForAddress(new PublicKey(mint), { limit: 1000 })).map((s) => s.signature),
  );
  let ok = true;
  for (const sig of sigs) {
    const [a1, a2] = [seen.has(sig), listed.has(sig)];
    ok &&= a1 && a2;
    console.log(`${a1 && a2 ? "PASS" : "FAIL"} ${sig} A1 ${a1 ? "PASS" : "FAIL"} A2 ${a2 ? "PASS" : "FAIL"}`);
  }
  return ok;
}

async function main(): Promise<void> {
  const s = { type: "string" } as const;
  const options = { listen: s, out: s, check: { type: "boolean" }, notified: s, mint: s, sigs: s } as const;
  const v = parseArgs({ options }).values;
  if (v.listen) {
    if (!v.out) throw new Error("--listen needs --out PATH");
    return listen(Number(v.listen), v.out);
  }
  if (!v.check || !v.notified || !v.mint || !v.sigs)
    throw new Error("pass --listen or --check with all flags");
  if (!(await check(v.notified, v.mint, v.sigs.split(",").filter(Boolean)))) process.exitCode = 1;
}

if (import.meta.main)
  main().catch((e: unknown) => {
    console.error(`stream-probe failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    process.exitCode = 1;
  });
