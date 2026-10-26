// Runs the pump contract check (OPS-02) once against devnet or the Surfpool fork and prints { net, facts, slots }
// as JSON; exits 1 when any fact failed. Mainnet is checked only by the production worker (D-03).
//   --net NET      devnet (default) or fork
//   --bondr MINT   BONDR's mint: also check its bonding curve, or its pool once migrated (optional)
// Run: node --env-file=.env scripts/contract-check.ts --net devnet [--bondr <mint>]
import { parseArgs } from "node:util";
import { checkContract } from "@bondr/core/contract";
import type { Net } from "@bondr/core/keys";
import { connect, redact } from "@bondr/core/net";
import { PublicKey } from "@solana/web3.js";

async function main(): Promise<void> {
  const s = { type: "string" } as const;
  const v = parseArgs({ options: { net: { ...s, default: "devnet" }, bondr: s } }).values;
  if (v.net !== "devnet" && v.net !== "fork") throw new Error("--net must be devnet or fork");
  const net: Net = v.net;
  const conn = await connect(net);
  const r = await checkContract(conn, net, v.bondr ? new PublicKey(v.bondr) : undefined);
  console.log(JSON.stringify({ net, ...r }, null, 2));
  process.exitCode = r.facts.length ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(redact(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
