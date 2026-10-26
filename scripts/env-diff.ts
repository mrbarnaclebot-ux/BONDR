// Compares two Railway environments' variables by name and SHA-256 only (Pitfall 18): each value is hashed the
// moment it is read and dropped, so no secret ever reaches the terminal. Exit 1 on any policy failure.
//   --from ENV      the environment to compare against (staging)
//   --to ENV        the environment under check (production)
//   --service NAME  web or worker
//   --phase PHASE   g1 (no seed, no quote mint), g3 (new seed), g5 (quote mint set); omit for the base rules
// Run: node scripts/env-diff.ts --from staging --to production --service worker --phase g1
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

export type Hashed = Record<string, string>;
export type Service = "web" | "worker";
export type Phase = "g1" | "g3" | "g5";
export type Policy = { differ: string[]; absent: string[]; present: string[]; equal: Hashed };
export type Row = { name: string; from?: string; to?: string; fail?: string };

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export const hashAll = (vars: Record<string, string>): Hashed =>
  Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, sha(v)]));

// D-12: every production secret is new. Checked only where both sides have the name (pinata_jwt is web only).
const DIFFER = [
  "WORKER_TOKEN",
  "SESSION_SECRET",
  "DATABASE_URL",
  "SOLANA_NET",
  "SITE_URL",
  "VANITY_LANE",
  "pinata_jwt",
];

export function policyFor(service: Service, phase?: Phase): Policy {
  const p: Policy = { differ: [...DIFFER], absent: [], present: [], equal: {} };
  if (service === "web") return p;
  p.equal.ALLOW_MAINNET = sha("1");
  p.present.push("FEE_ENGINE", "ADMIN_EVACUATE");
  if (phase === "g1") p.absent.push("MASTER_SEED", "BONDR_QUOTE_MINT");
  if (phase === "g3") p.absent.push("BONDR_QUOTE_MINT");
  if (phase === "g3" || phase === "g5") {
    p.present.push("MASTER_SEED");
    p.differ.push("MASTER_SEED");
  }
  if (phase === "g5") p.present.push("BONDR_QUOTE_MINT");
  return p;
}

function failure(
  name: string,
  from: string | undefined,
  to: string | undefined,
  p: Policy,
): string | undefined {
  if (p.absent.includes(name) && to !== undefined) return "must be absent";
  if (p.present.includes(name) && to === undefined) return "must be present";
  if (name in p.equal && to !== p.equal[name]) return "must equal its expected value";
  if (p.differ.includes(name) && from !== undefined && from === to) return "must differ";
  return undefined;
}

export function diffEnv(from: Hashed, to: Hashed, p: Policy): Row[] {
  const names = new Set([...Object.keys(from), ...Object.keys(to), ...p.present, ...Object.keys(p.equal)]);
  return [...names].sort().map((name) => {
    const fail = failure(name, from[name], to[name], p);
    return { name, from: from[name], to: to[name], ...(fail ? { fail } : {}) };
  });
}

const short = (h?: string) => (h ? h.slice(0, 8) : "-".padEnd(8));

export function report(rows: Row[]): string {
  const width = Math.max(...rows.map((r) => r.name.length), 4);
  const lines = rows.map((r) => {
    const state = !r.from || !r.to ? "absent" : r.from === r.to ? "same" : "differs";
    const tail = r.fail ? `  FAIL ${r.fail}` : "";
    return `${r.name.padEnd(width)}  ${state.padEnd(7)}  ${short(r.from)}  ${short(r.to)}${tail}`;
  });
  const failed = rows.filter((r) => r.fail).length;
  return [...lines, failed ? `${failed} failed` : "all checks passed"].join("\n");
}

// The JSON holds raw values: it is parsed and hashed in this function and never logged or returned.
function readHashed(environment: string, service: Service): Hashed {
  const args = ["variable", "list", "--environment", environment, "--service", service, "--json"];
  const out = execFileSync("railway", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return hashAll(JSON.parse(out) as Record<string, string>);
}

function args() {
  const s = { type: "string" } as const;
  const v = parseArgs({ options: { from: s, to: s, service: s, phase: s } }).values;
  if (!v.from || !v.to) throw new Error("--from and --to are required");
  if (v.service !== "web" && v.service !== "worker") throw new Error("--service must be web or worker");
  if (v.phase !== undefined && !["g1", "g3", "g5"].includes(v.phase))
    throw new Error("--phase must be g1, g3 or g5");
  return { from: v.from, to: v.to, service: v.service as Service, phase: v.phase as Phase | undefined };
}

if (import.meta.main) {
  const a = args();
  const rows = diffEnv(
    readHashed(a.from, a.service),
    readHashed(a.to, a.service),
    policyFor(a.service, a.phase),
  );
  console.log(`${a.service}: ${a.from} -> ${a.to}${a.phase ? ` (${a.phase})` : ""}`);
  console.log(report(rows));
  if (rows.some((r) => r.fail)) process.exit(1);
}
