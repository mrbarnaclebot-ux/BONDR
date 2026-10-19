// Strict gate over the results files: every rule id needs an ok row that passes its rule, every recorded
// row must be ok, and no file may carry the RPC key. Exits 1 on any failure.
import { existsSync, readFileSync } from "node:fs";
import { type Net, netsFromEnv, type ResultsFile, resultsPath, type Stage } from "./results.ts";

type Line = { id: string; fail?: string };

function secretScan(raw: string): Line {
  const key = process.env.helius_api_key;
  const leaked = (key && raw.includes(key)) || raw.includes("api-key=");
  return {
    id: "secret-scan",
    fail: leaked ? "results file contains the RPC key or an api-key= URL" : undefined,
  };
}

function ruleLines(stages: Stage[], file: ResultsFile): Line[] {
  const lines: Line[] = [];
  for (const stage of stages) {
    for (const [id, rule] of Object.entries(stage.rules(file.net))) {
      const row = file.rows.find((r) => r.id === id);
      if (!row) lines.push({ id, fail: "no row" });
      else if (!row.ok) lines.push({ id, fail: `row not ok: ${row.err ?? "no error text"}` });
      else lines.push({ id, fail: rule(row, file) ?? undefined });
    }
  }
  const covered = new Set(lines.map((l) => l.id));
  for (const row of file.rows) {
    if (!covered.has(row.id)) lines.push({ id: row.id, fail: row.ok ? undefined : `row not ok: ${row.err}` });
  }
  return lines;
}

async function checkNet(net: Net): Promise<Line[]> {
  const path = resultsPath(net);
  if (!existsSync(path)) return [{ id: "results", fail: `no results file, run SPIKE_NET=${net} pnpm spike` }];
  const raw = readFileSync(path, "utf8");
  let stages: Stage[];
  try {
    stages = (await import(`./nets/${net}.ts`)).default as Stage[];
  } catch {
    return [secretScan(raw), { id: "stages", fail: `scripts/spike/nets/${net}.ts failed to load` }];
  }
  return [secretScan(raw), ...ruleLines(stages, JSON.parse(raw) as ResultsFile)];
}

let failed = 0;
let total = 0;
for (const net of netsFromEnv()) {
  for (const line of await checkNet(net)) {
    total++;
    if (line.fail) failed++;
    console.log(line.fail ? `FAIL ${net} ${line.id}: ${line.fail}` : `PASS ${net} ${line.id}`);
  }
}
console.log(`${total - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
