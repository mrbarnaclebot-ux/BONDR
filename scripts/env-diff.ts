// Checks production's Railway variables against staging and the go-live policy, by name and fact only: no value
// reaches this process or the terminal (Pitfall 18, D-11, D-12). Exit 1 on any policy failure.
//   --from ENV      the environment production's secrets must differ from (staging)
//   --to ENV        production, the only environment the policy describes
//   --service NAME  web or worker
//   --phase PHASE   g1 (no seed, no quote mint), g2 (treasury set), g3 (seed set), g5 (quote mint set)
// Run: node scripts/env-diff.ts --from staging --to production --service worker --phase g1
//
// How values stay out (CR-O-02, CR-O-03): Railway has no names-only listing, so each `railway variable list --json`
// (raw values) is piped straight into jq inside one sh pipeline, and jq reduces both lists to facts: which names
// exist on each side, whether a D-12 secret is equal on both (compared inside jq, never hashed or returned),
// whether a production value has surrounding whitespace, and the value itself only for the public names in PUBLIC.
// MASTER_SEED is never compared: only its presence is read (D-11), so the seed the owner generated fresh in a
// password manager is the D-12 guarantee for it. A failing pipeline prints a fixed message with its exit code,
// never its output.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

// Railway project bondr (not secret). Pinned on every call, and the linked project must match, so a directory
// linked to another project with web, worker and production (agencybook) is never read here (CR-O-04).
export const PROJECT_ID = "cf985056-2099-4497-a2c1-1aa639343af4";

export type Service = "web" | "worker";
export const PHASES = ["g1", "g2", "g3", "g5"] as const;
export type Phase = (typeof PHASES)[number];
export type Fact = {
  from: boolean;
  to: boolean;
  same: boolean | null;
  padded: boolean;
  value: string | null;
};
export type Facts = Record<string, Fact>;
export type Policy = { present: string[]; absent: string[]; differ: string[]; equal: Record<string, string> };
export type Row = { name: string; fact: Fact; fail?: string };

// Values that are public (a key, a flag, a URL) and may cross into this process for an exact check.
export const PUBLIC = [
  "SOLANA_NET",
  "SITE_URL",
  "VANITY_LANE",
  "ALLOW_MAINNET",
  "FEE_ENGINE",
  "ADMIN_EVACUATE",
  "ADMIN_WALLET",
  "TREASURY_PUBKEY",
  "BONDR_QUOTE_MINT",
];

// Input: the two variable lists (from, then to). Anything else (a failed list echoes "failed") is an error.
export const FILTER = `
if length != 2 or (map(type) != ["object", "object"]) then error("not two variable lists") else . end
| .[0] as $f | .[1] as $t
| reduce (([$f, $t] | map(keys) | add | unique)[]) as $n ({}; .[$n] = {
    from: ($f | has($n)),
    to: ($t | has($n)),
    same: (if $n == "MASTER_SEED" or ($f | has($n) | not) or ($t | has($n) | not) then null
           else $f[$n] == $t[$n] end),
    padded: (($t[$n] | type) == "string" and ($t[$n] | test("^\\\\s|\\\\s$"))),
    value: (if ($t | has($n)) and any($pub[]; . == $n) then $t[$n] else null end)
  })`;

const jqArgs = ["-s", "-c", "--argjson", "pub", JSON.stringify(PUBLIC), FILTER];

// For tests: the facts of two raw lists given as concatenated JSON.
export const factsOf = (input: string): Facts =>
  JSON.parse(execFileSync("jq", jqArgs, { input, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }));

// D-12: secrets that must be new on production, compared with staging inside jq only.
const DIFFER = ["WORKER_TOKEN", "SESSION_SECRET", "DATABASE_URL", "pinata_jwt"];

export function policyFor(service: Service, phase?: Phase): Policy {
  const p: Policy = {
    present: ["WORKER_TOKEN", "DATABASE_URL", "SOLANA_NET", "SITE_URL"],
    absent: [],
    differ: [...DIFFER],
    equal: { SOLANA_NET: "mainnet", SITE_URL: "https://trybondr.fun" },
  };
  if (service === "web") {
    p.present.push("SESSION_SECRET");
    p.absent.push("MASTER_SEED", "helius_api_key"); // web refuses to boot holding either
    return p;
  }
  p.present.push("helius_api_key", "FEE_ENGINE", "ADMIN_EVACUATE");
  p.equal.ALLOW_MAINNET = "1";
  p.equal.VANITY_LANE = "production";
  if (!phase) return p;
  const from = (g: Phase) => PHASES.indexOf(phase) >= PHASES.indexOf(g);
  if (from("g2")) p.present.push("TREASURY_PUBKEY");
  (from("g3") ? p.present : p.absent).push("MASTER_SEED");
  (from("g5") ? p.present : p.absent).push("BONDR_QUOTE_MINT");
  return p;
}

function failure(name: string, f: Fact, p: Policy, all: Facts): string | undefined {
  if (f.padded) return "has surrounding whitespace";
  if (p.absent.includes(name) && f.to) return "must be absent";
  if (p.present.includes(name) && !f.to) return "must be present";
  if (name in p.equal && f.value !== p.equal[name]) return "must equal its expected value";
  if (p.differ.includes(name) && f.same === true) return "must differ from staging";
  if (name === "TREASURY_PUBKEY" && f.value !== null && f.value === all.ADMIN_WALLET?.value)
    return "must differ from ADMIN_WALLET";
  return undefined;
}

const NONE: Fact = { from: false, to: false, same: null, padded: false, value: null };

export function diffEnv(facts: Facts, p: Policy): Row[] {
  const names = new Set([...Object.keys(facts), ...p.present, ...Object.keys(p.equal)]);
  return [...names].sort().map((name) => {
    const fact = facts[name] ?? NONE;
    const fail = failure(name, fact, p, facts);
    return { name, fact, ...(fail ? { fail } : {}) };
  });
}

// Names and facts only: never a value, not even a public one.
export function report(rows: Row[]): string {
  const width = Math.max(...rows.map((r) => r.name.length), 4);
  const set = (on: boolean) => (on ? "set" : "-").padEnd(4);
  const lines = rows.map(({ name, fact: f, fail }) => {
    const cmp = f.same === null ? "-" : f.same ? "same" : "differs";
    return `${name.padEnd(width)}  ${set(f.from)}  ${set(f.to)}  ${cmp.padEnd(7)}${fail ? `  FAIL ${fail}` : ""}`;
  });
  const failed = rows.filter((r) => r.fail).length;
  const head = `${"name".padEnd(width)}  from  to    compare`;
  return [head, ...lines, failed ? `${failed} failed` : "all checks passed"].join("\n");
}

// Both lists go straight from railway into jq; only jq's facts come back. stderr is dropped: it may echo values.
const PIPELINE = `{ railway variable list --project "$1" --environment "$2" --service "$4" --json || echo '"failed"'
railway variable list --project "$1" --environment "$3" --service "$4" --json || echo '"failed"'
} | jq -s -c --argjson pub "$5" "$6"`;

function readFacts(from: string, to: string, service: Service): Facts {
  const args = ["-c", PIPELINE, "sh", PROJECT_ID, from, to, service, JSON.stringify(PUBLIC), FILTER];
  let out: string;
  try {
    out = execFileSync("sh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    const status = (e as { status?: number | null }).status;
    throw new Error(`reading the ${service} variables failed (exit ${status ?? "?"}); output not shown`);
  }
  try {
    return JSON.parse(out) as Facts;
  } catch {
    throw new Error(`reading the ${service} variables returned no facts; output not shown`);
  }
}

function linkedProject(): string | undefined {
  try {
    const out = execFileSync("railway", ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (JSON.parse(out) as { id?: string }).id;
  } catch {
    return undefined;
  }
}

function args() {
  const s = { type: "string" } as const;
  const v = parseArgs({ options: { from: s, to: s, service: s, phase: s } }).values;
  if (!v.from || v.to !== "production") throw new Error("--from ENV and --to production are required");
  if (v.service !== "web" && v.service !== "worker") throw new Error("--service must be web or worker");
  if (v.phase !== undefined && !(PHASES as readonly string[]).includes(v.phase))
    throw new Error("--phase must be g1, g2, g3 or g5");
  return { from: v.from, to: v.to, service: v.service as Service, phase: v.phase as Phase | undefined };
}

if (import.meta.main) {
  try {
    const a = args();
    if (linkedProject() !== PROJECT_ID)
      throw new Error("this checkout is not linked to the Railway project bondr");
    const rows = diffEnv(readFacts(a.from, a.to, a.service), policyFor(a.service, a.phase));
    console.log(`${a.service}: ${a.from} -> ${a.to}${a.phase ? ` (${a.phase})` : ""}`);
    console.log(report(rows));
    if (rows.some((r) => r.fail)) process.exitCode = 1;
  } catch (e) {
    console.error(`env-diff: ${e instanceof Error ? e.message : "failed"}`);
    process.exitCode = 1;
  }
}
