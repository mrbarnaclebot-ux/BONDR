// The results contract every stage, the checker and the page share. Rows are saved to disk after every
// record() so a crash mid-run never loses the evidence gathered before it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Net as CoreNet, Role } from "@bondr/core/keys";
import { redact } from "@bondr/core/net";
import type { Connection, Keypair } from "@solana/web3.js";

// The spike never touches mainnet (D-03): its nets stay devnet and the fork.
export type Net = Exclude<CoreNet, "mainnet">;
export type Row = {
  id: string; // stable id the rules key on, e.g. "child.create"; helper rows use the "aux." prefix
  env: Net;
  step: string; // human label for the page
  ok: boolean; // the step met its expectation (for expectFail rows: it failed with the expected code)
  expectFail?: boolean;
  sig?: string; // full base58 signature
  bytes?: number; // serialized wire length
  cu?: number; // meta.computeUnitsConsumed
  cuLimit?: number; // the ComputeBudget limit the tx set
  err?: string; // redacted error text
  code?: number; // program custom error code
  topUp?: boolean; // D-11 direct top-up, shown as TOP-UP on the page
  notes?: string;
  facts?: Record<string, string | number | boolean>;
};
export type ResultsFile = { net: Net; updatedAt: string; state: Record<string, string>; rows: Row[] };
export type Rule = (row: Row, file: ResultsFile) => string | null; // null = pass, string = failure reason
export type Ctx = {
  net: Net;
  conn: Connection;
  key(role: Role, id: string): Keypair; // derive(master, role, net, id)
  file: ResultsFile;
  record(row: Omit<Row, "env">): void; // upsert by id, then save to disk immediately
};
export type Stage = { name: string; rules(net: Net): Record<string, Rule>; run(ctx: Ctx): Promise<void> };

export const resultsPath = (net: Net): string =>
  fileURLToPath(new URL(`./results/${net}.json`, import.meta.url));

export function netsFromEnv(): Net[] {
  const v = process.env.SPIKE_NET || "all";
  if (v === "all") return ["devnet", "fork"];
  if (v === "devnet" || v === "fork") return [v];
  throw new Error(`SPIKE_NET must be devnet, fork or all, got ${v}`);
}

export const emptyResults = (net: Net): ResultsFile => ({ net, updatedAt: "", state: {}, rows: [] });

export function loadResults(net: Net): ResultsFile {
  const path = resultsPath(net);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ResultsFile) : emptyResults(net);
}

// redact() over the whole serialized file is the last line of defense: no RPC URL fragment reaches disk.
export function saveResults(file: ResultsFile): void {
  const path = resultsPath(file.net);
  mkdirSync(dirname(path), { recursive: true });
  file.updatedAt = new Date().toISOString();
  writeFileSync(path, `${redact(JSON.stringify(file, null, 2))}\n`);
}

export function recordRow(file: ResultsFile, row: Omit<Row, "env">): void {
  const full: Row = { ...row, env: file.net };
  const i = file.rows.findIndex((r) => r.id === row.id);
  if (i === -1) file.rows.push(full);
  else file.rows[i] = full;
  saveResults(file);
}

// A stage or net that succeeds on a rerun clears its old crash row, so stale failures do not linger.
export function dropRow(file: ResultsFile, id: string): void {
  const before = file.rows.length;
  file.rows = file.rows.filter((r) => r.id !== id);
  if (file.rows.length !== before) saveResults(file);
}
