// D-18 (fork): once the stand-in Q has migrated, the launch routes SOL to Q and the sell's Q to SOL through
// Q's PumpSwap pool. The rows reuse the curve launch (launch.ts) with the "migrated." prefix. The sell's
// landed message becomes the co-sign test fixture (02-12): public chain data only.
import { writeFileSync } from "node:fs";
import { AwaitingMigration, quoteVenue } from "@bondr/core/launch";
import { BN, OnlinePumpSdk } from "@bondr/core/pump";
import { PACKET_LIMIT } from "@bondr/core/send";
import { PublicKey } from "@solana/web3.js";
import type { Ctx, Rule, Stage } from "../results.ts";
import { launchOne, launchRule, type Run, tableRule } from "./launch.ts";

const P = "migrated.";
const FIXTURE = new URL("../../../packages/core/src/fixtures/pool-sell-launch.json", import.meta.url);

function poolRule(exit: "burn" | "sell"): Rule {
  const base = launchRule(exit);
  return (row, file) => {
    const f = row.facts ?? {};
    if (f.venue !== "pool") return `venue ${f.venue}, expected pool`;
    if (typeof f.maxFieldBytes !== "number" || f.maxFieldBytes > PACKET_LIMIT)
      return `max-field launch is ${f.maxFieldBytes} bytes > ${PACKET_LIMIT}`;
    return base(row, file);
  };
}

const factOf = (ctx: Ctx, id: string, key: string): string => {
  const v = ctx.file.rows.find((r) => r.id === id)?.facts?.[key];
  if (typeof v !== "string") throw new Error(`row ${id} has no ${key} fact`);
  return v;
};

async function writeFixture(ctx: Ctx, dev: PublicKey): Promise<void> {
  const sig = ctx.file.rows.find((r) => r.id === `${P}launch.sell`)?.sig;
  if (!sig) throw new Error("no landed migrated.launch.sell to capture");
  const tx = await ctx.conn.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  const table = factOf(ctx, `${P}launch.table.sell`, "table");
  const alt = (await ctx.conn.getAddressLookupTable(new PublicKey(table))).value;
  if (!tx || !alt) throw new Error(`fixture source missing: tx ${!!tx}, table ${!!alt}`);
  const fixture = {
    message: Buffer.from(tx.transaction.message.serialize()).toString("base64"),
    table,
    addresses: alt.state.addresses.map((a) => a.toBase58()),
    mint: factOf(ctx, `${P}launch.sell`, "mint"),
    dev: dev.toBase58(),
    exit: "sell",
  };
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
}

// Same size as the fork curve launches (launch.ts), so the two routes compare directly.
async function poolRun(ctx: Ctx): Promise<Run> {
  if (!ctx.file.state.Q) throw new Error("no stand-in Q in state: run the create stage first");
  const online = new OnlinePumpSdk(ctx.conn);
  const Q = new PublicKey(ctx.file.state.Q);
  const venue = await quoteVenue(online, Q);
  if (venue !== "pool") throw new Error(`Q ${Q.toBase58()} is on its ${venue}: run the migrated stage first`);
  const supply = (await online.fetchGlobal()).tokenTotalSupply.toString();
  return { ctx, online, Q, supply, solIn: new BN(250_000_000) };
}

export const poolLaunchStage: Stage = {
  name: "migrated.launch",
  rules: () => ({
    [`${P}launch.table.burn`]: tableRule,
    [`${P}launch.burn`]: poolRule("burn"),
    [`${P}launch.table.sell`]: tableRule,
    [`${P}launch.sell`]: poolRule("sell"),
  }),
  async run(ctx) {
    if (ctx.net !== "fork") throw new Error("migrated.launch runs on the fork only");
    const run = await poolRun(ctx);
    await launchOne(run, "burn", P);
    if (await launchOne(run, "sell", P)) await writeFixture(ctx, ctx.key("sim", "dev").publicKey);
  },
};

// The 6107 window (fork): Q is complete and not yet migrated, so the launch builder must refuse.
export const awaitingStage: Stage = {
  name: "migrated.awaiting",
  rules: () => ({
    [`${P}launch.awaiting`]: (row) =>
      row.facts?.error === "AwaitingMigration" ? null : `got ${row.facts?.error}, expected AwaitingMigration`,
  }),
  async run(ctx) {
    if (!ctx.file.state.Q) throw new Error("no stand-in Q in state: run the create stage first");
    let error = "none (venue resolved)";
    try {
      await quoteVenue(new OnlinePumpSdk(ctx.conn), new PublicKey(ctx.file.state.Q));
    } catch (e) {
      error = e instanceof AwaitingMigration ? e.name : String(e);
    }
    const step = "Launch builder on complete, unmigrated Q refuses (AwaitingMigration)";
    ctx.record({ id: `${P}launch.awaiting`, step, ok: error === "AwaitingMigration", facts: { error } });
  },
};
