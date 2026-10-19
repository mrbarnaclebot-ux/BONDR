// Runs each net's stage list in order. Every failure becomes a saved row before the exit code is decided,
// so the page can always show what broke; nothing here sends a transaction itself.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { derive } from "@bondr/core/keys";
import { connect, redact } from "@bondr/core/net";
import {
  type Ctx,
  dropRow,
  emptyResults,
  loadResults,
  type Net,
  netsFromEnv,
  type ResultsFile,
  recordRow,
  type Stage,
} from "./results.ts";

const message = (e: unknown): string => redact(e instanceof Error ? e.message : String(e));

function readSeed(net: Net): Buffer {
  const file = join(process.env.SPIKE_KEYS_DIR || join(homedir(), ".bondr-spike"), net, "master.seed");
  if (!existsSync(file)) throw new Error(`${net} master seed missing: run pnpm spike:keys first`);
  const seed = readFileSync(file);
  if (seed.length !== 32) throw new Error(`${file} is not a 32-byte seed`);
  return seed;
}

async function loadNet(net: Net, file: ResultsFile): Promise<{ ctx: Ctx; stages: Stage[] }> {
  const master = readSeed(net);
  const conn = await connect(net);
  const stages = (await import(`./nets/${net}.ts`)).default as Stage[];
  const ctx: Ctx = {
    net,
    conn,
    file,
    key: (role, id) => derive(master, role, net, id),
    record: (row) => recordRow(file, row),
  };
  return { ctx, stages };
}

// Devnet SOL is scarce (Pitfall 9), so a stage whose rows all pass is not paid for twice. The rule counts
// too: an expected failure with the wrong code is ok as a row but must still be retried.
function done(stage: Stage, ctx: Ctx): boolean {
  if (ctx.net !== "devnet" || process.env.SPIKE_FRESH === "1") return false;
  return Object.entries(stage.rules(ctx.net)).every(([id, rule]) => {
    const row = ctx.file.rows.find((r) => r.id === id);
    return row?.ok === true && rule(row, ctx.file) === null;
  });
}

async function runStage(stage: Stage, ctx: Ctx): Promise<boolean> {
  try {
    await stage.run(ctx);
    dropRow(ctx.file, `${stage.name}.error`);
    return true;
  } catch (e) {
    ctx.record({
      id: `${stage.name}.error`,
      step: `${stage.name} stage crashed`,
      ok: false,
      err: message(e),
    });
    return false;
  }
}

// Returns false when the net aborted; later stages depend on earlier state, so a crash stops the net.
async function runNet(net: Net): Promise<{ file: ResultsFile; ok: boolean }> {
  // Each fork run builds a fresh stand-in, so old fork rows and state would describe a dead chain.
  const file = net === "fork" ? emptyResults(net) : loadResults(net);
  let loaded: { ctx: Ctx; stages: Stage[] };
  try {
    loaded = await loadNet(net, file);
    dropRow(file, `${net}.error`);
  } catch (e) {
    recordRow(file, { id: `${net}.error`, step: `${net} setup failed`, ok: false, err: message(e) });
    console.log(`net ${net}: aborted, ${message(e)}`);
    return { file, ok: false };
  }
  for (const stage of loaded.stages) {
    if (process.env.SPIKE_ONLY && process.env.SPIKE_ONLY !== stage.name) continue;
    const skip = done(stage, loaded.ctx);
    console.log(`stage ${stage.name}: ${skip ? "skip" : "run"}`);
    if (!skip && !(await runStage(stage, loaded.ctx))) return { file, ok: false };
  }
  return { file, ok: true };
}

function summarize(results: { file: ResultsFile; ok: boolean }[]): number {
  let failed = 0;
  for (const { file, ok } of results) {
    const bad = file.rows.filter((r) => !r.ok);
    for (const r of bad) console.log(`FAIL ${file.net} ${r.id}: ${r.err ?? "not ok"}`);
    console.log(
      `${file.net}: ${file.rows.length - bad.length} ok, ${bad.length} failed${ok ? "" : ", aborted"}`,
    );
    if (bad.length || !ok) failed++;
  }
  return failed ? 1 : 0;
}

const results = [];
for (const net of netsFromEnv()) results.push(await runNet(net));
process.exitCode = summarize(results);
