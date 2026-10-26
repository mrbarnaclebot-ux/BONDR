import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { diffEnv, factsOf, type Phase, PROJECT_ID, policyFor, report } from "./env-diff.ts";

// Distinctive raw values: none may ever appear in a report or in the script's output (T-07-20-01).
const STAGING = {
  WORKER_TOKEN: "stg-token-zq81",
  SESSION_SECRET: "stg-session-xr42",
  DATABASE_URL: "postgres://stg-user:stg-pass-77@host/db",
  SOLANA_NET: "devnet",
  SITE_URL: "https://staging.example",
  MASTER_SEED: "stg-seed-kk19",
  BONDR_QUOTE_MINT: "StgMint1111",
  pinata_jwt: "jwt-shared-qq55",
  helius_api_key: "helius-shared-hh44",
  FEE_ENGINE: "on",
};
const WEB = {
  WORKER_TOKEN: "prd-token-mm03",
  SESSION_SECRET: "prd-session-vv08",
  DATABASE_URL: "postgres://prd-user:prd-pass-66@host/db",
  SOLANA_NET: "mainnet",
  SITE_URL: "https://trybondr.fun",
  pinata_jwt: "jwt-new-pp21",
};
const { SESSION_SECRET: _s, pinata_jwt: _p, ...shared } = WEB;
const WORKER = {
  ...shared,
  helius_api_key: "helius-shared-hh44", // D-12: the same key on purpose
  ALLOW_MAINNET: "1",
  VANITY_LANE: "production",
  FEE_ENGINE: "dry",
  ADMIN_EVACUATE: "simulate",
  ADMIN_WALLET: "Adm1nWa11et1111",
};

const failures = (from: object, to: object, service: "web" | "worker", phase?: Phase) =>
  diffEnv(factsOf(JSON.stringify(from) + JSON.stringify(to)), policyFor(service, phase))
    .filter((r) => r.fail)
    .map((r) => `${r.name}: ${r.fail}`);

describe("diffEnv", () => {
  it("passes a correct g1 production web and worker", () => {
    expect(failures(STAGING, WEB, "web", "g1")).toEqual([]);
    expect(failures(STAGING, WORKER, "worker", "g1")).toEqual([]);
  });

  it("fails a D-12 secret equal to staging", () => {
    expect(failures(STAGING, { ...WORKER, WORKER_TOKEN: STAGING.WORKER_TOKEN }, "worker")).toEqual([
      "WORKER_TOKEN: must differ from staging",
    ]);
    expect(failures(STAGING, { ...WEB, pinata_jwt: STAGING.pinata_jwt }, "web")).toEqual([
      "pinata_jwt: must differ from staging",
    ]);
  });

  it("fails a missing D-12 secret instead of skipping it", () => {
    const { SESSION_SECRET: _, ...web } = WEB;
    expect(failures(STAGING, web, "web")).toEqual(["SESSION_SECRET: must be present"]);
    const { DATABASE_URL: _d, ...worker } = WORKER;
    expect(failures(STAGING, worker, "worker")).toEqual(["DATABASE_URL: must be present"]);
  });

  it("needs the exact public values, and rejects surrounding whitespace on any value", () => {
    expect(failures(STAGING, { ...WEB, SOLANA_NET: "Mainnet" }, "web")).toEqual([
      "SOLANA_NET: must equal its expected value",
    ]);
    expect(failures(STAGING, { ...WEB, SOLANA_NET: "mainnet " }, "web")).toEqual([
      "SOLANA_NET: has surrounding whitespace",
    ]);
    expect(failures(STAGING, { ...WEB, WORKER_TOKEN: " prd-token-mm03" }, "web")).toEqual([
      "WORKER_TOKEN: has surrounding whitespace",
    ]);
    expect(failures(STAGING, { ...WORKER, VANITY_LANE: "staging" }, "worker")).toEqual([
      "VANITY_LANE: must equal its expected value",
    ]);
    const { ALLOW_MAINNET: _, ...none } = WORKER;
    expect(failures(STAGING, none, "worker")).toEqual(["ALLOW_MAINNET: must equal its expected value"]);
  });

  it("refuses the seed and the Helius key on web", () => {
    expect(failures(STAGING, { ...WEB, helius_api_key: "k-web-1" }, "web")).toEqual([
      "helius_api_key: must be absent",
    ]);
  });

  it("g2 needs a treasury that is not the admin wallet", () => {
    expect(failures(STAGING, WORKER, "worker", "g2")).toEqual(["TREASURY_PUBKEY: must be present"]);
    const same = { ...WORKER, TREASURY_PUBKEY: WORKER.ADMIN_WALLET };
    expect(failures(STAGING, same, "worker", "g2")).toEqual([
      "TREASURY_PUBKEY: must differ from ADMIN_WALLET",
    ]);
    expect(failures(STAGING, { ...WORKER, TREASURY_PUBKEY: "Treasury1111" }, "worker", "g2")).toEqual([]);
  });

  it("g3 needs the seed present by name only; g5 needs the quote mint", () => {
    const treasury = { ...WORKER, TREASURY_PUBKEY: "Treasury1111" };
    expect(failures(STAGING, treasury, "worker", "g3")).toEqual(["MASTER_SEED: must be present"]);
    const seeded = { ...treasury, MASTER_SEED: STAGING.MASTER_SEED };
    expect(failures(STAGING, seeded, "worker", "g3")).toEqual([]); // never compared (D-11)
    expect(failures(STAGING, { ...seeded, MASTER_SEED: "seed " }, "worker", "g3")).toEqual([
      "MASTER_SEED: has surrounding whitespace",
    ]);
    expect(failures(STAGING, seeded, "worker", "g5")).toEqual(["BONDR_QUOTE_MINT: must be present"]);
    expect(failures(STAGING, { ...seeded, BONDR_QUOTE_MINT: "Q" }, "worker", "g1")).toEqual([
      "BONDR_QUOTE_MINT: must be absent",
      "MASTER_SEED: must be absent",
    ]);
  });

  it("returns no value for a secret, and never compares the seed", () => {
    const facts = factsOf(JSON.stringify(STAGING) + JSON.stringify({ ...WORKER, MASTER_SEED: "x" }));
    expect(facts.WORKER_TOKEN).toEqual({ from: true, to: true, same: false, padded: false, value: null });
    expect(facts.MASTER_SEED?.same).toBeNull();
    expect(facts.SOLANA_NET?.value).toBe("mainnet");
  });
});

describe("report", () => {
  it("shows names, states and failures, never a value", () => {
    const bad = { ...WORKER, WORKER_TOKEN: STAGING.WORKER_TOKEN, MASTER_SEED: "prd-seed-aa11" };
    const rows = diffEnv(factsOf(JSON.stringify(STAGING) + JSON.stringify(bad)), policyFor("worker", "g1"));
    const text = report(rows);
    for (const word of ["WORKER_TOKEN", "same", "differs", "FAIL", "2 failed"]) expect(text).toContain(word);
    for (const raw of [...Object.values(STAGING), ...Object.values(bad)].filter((v) => v.length >= 6))
      expect(text).not.toContain(raw);
  });
});

// CR-O-03, CR-O-04: the real script against a fake railway on PATH.
describe("env-diff script", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-diff-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const SECRET = "SECRET-SEED-zz91";
  const fake = (body: string) => {
    writeFileSync(join(dir, "railway"), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, "railway"), 0o755);
  };
  const run = () => {
    const script = fileURLToPath(new URL("./env-diff.ts", import.meta.url));
    const argv = [script, "--from", "staging", "--to", "production", "--service", "worker"];
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    const r = spawnSync(process.execPath, argv, { encoding: "utf8", env });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const linked = `[ "$1" = status ] && { echo '{"id":"${PROJECT_ID}"}'; exit 0; }`;

  it("prints a fixed message with the exit code when railway fails after printing values", () => {
    fake(`${linked}\necho '{"MASTER_SEED":"${SECRET}"}'; echo '${SECRET}' >&2; exit 3`);
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out).toMatch(/reading the worker variables failed \(exit \d+\); output not shown/);
    expect(out).not.toContain(SECRET);
  });

  it("refuses a checkout linked to another project", () => {
    fake(`[ "$1" = status ] && { echo '{"id":"other"}'; exit 0; }\necho '{}'`);
    expect(run()).toEqual({
      status: 1,
      out: "env-diff: this checkout is not linked to the Railway project bondr\n",
    });
  });

  it("pins the project on every list call and prints no value on success", () => {
    const vars = `case "$*" in *"--project ${PROJECT_ID}"*) ;; *) exit 9 ;; esac
case "$*" in *staging*) echo '${JSON.stringify(STAGING)}' ;; *) echo '${JSON.stringify(WORKER)}' ;; esac`;
    fake(`${linked}\n${vars}`);
    const { status, out } = run();
    expect(out).toContain("all checks passed");
    expect(status).toBe(0);
    for (const raw of [WORKER.WORKER_TOKEN, WORKER.DATABASE_URL, WORKER.helius_api_key])
      expect(out).not.toContain(raw);
  });
});
