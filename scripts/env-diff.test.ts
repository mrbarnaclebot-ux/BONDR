import { describe, expect, it } from "vitest";
import { diffEnv, hashAll, policyFor, report } from "./env-diff.ts";

// Distinctive raw values: none may ever appear in a report (T-07-20-01).
const STAGING = {
  WORKER_TOKEN: "stg-token-zq81",
  SESSION_SECRET: "stg-session-xr42",
  DATABASE_URL: "postgres://stg-user:stg-pass-77@host/db",
  SOLANA_NET: "devnet",
  MASTER_SEED: "stg-seed-kk19",
  BONDR_QUOTE_MINT: "StgMint1111",
  pinata_jwt: "jwt-shared-qq55",
  FEE_ENGINE: "on",
};
const PRODUCTION = {
  WORKER_TOKEN: "prd-token-mm03",
  SESSION_SECRET: "prd-session-vv08",
  DATABASE_URL: "postgres://prd-user:prd-pass-66@host/db",
  SOLANA_NET: "mainnet",
  pinata_jwt: "jwt-new-pp21",
  ALLOW_MAINNET: "1",
  FEE_ENGINE: "dry",
  ADMIN_EVACUATE: "simulate",
};

const failures = (from: object, to: object, service: "web" | "worker", phase?: "g1" | "g3" | "g5") =>
  diffEnv(hashAll(from as Record<string, string>), hashAll(to as Record<string, string>), policyFor(service, phase))
    .filter((r) => r.fail)
    .map((r) => `${r.name}: ${r.fail}`);

describe("diffEnv", () => {
  it("passes a correct g1 production worker", () => {
    expect(failures(STAGING, PRODUCTION, "worker", "g1")).toEqual([]);
  });

  it("fails a must-differ name with equal hashes", () => {
    expect(failures(STAGING, { ...PRODUCTION, WORKER_TOKEN: STAGING.WORKER_TOKEN }, "worker")).toEqual([
      "WORKER_TOKEN: must differ",
    ]);
  });

  it("fails pinata_jwt copied from staging (D-12)", () => {
    expect(failures(STAGING, { ...PRODUCTION, pinata_jwt: STAGING.pinata_jwt }, "web")).toEqual([
      "pinata_jwt: must differ",
    ]);
  });

  it("skips a must-differ name the service does not have", () => {
    const { pinata_jwt: _a, ...from } = STAGING;
    const { pinata_jwt: _b, ...to } = PRODUCTION;
    expect(failures(from, to, "web")).toEqual([]);
  });

  it("fails a must-be-absent name present, passes it absent", () => {
    expect(failures(STAGING, { ...PRODUCTION, MASTER_SEED: "prd-seed-aa11" }, "worker", "g1")).toEqual([
      "MASTER_SEED: must be absent",
    ]);
    expect(failures(STAGING, PRODUCTION, "worker", "g1")).toEqual([]);
  });

  it("g3 needs the seed present and new; g5 needs the quote mint", () => {
    expect(failures(STAGING, PRODUCTION, "worker", "g3")).toEqual(["MASTER_SEED: must be present"]);
    const seeded = { ...PRODUCTION, MASTER_SEED: STAGING.MASTER_SEED };
    expect(failures(STAGING, seeded, "worker", "g3")).toEqual(["MASTER_SEED: must differ"]);
    const fresh = { ...PRODUCTION, MASTER_SEED: "prd-seed-aa11" };
    expect(failures(STAGING, fresh, "worker", "g3")).toEqual([]);
    expect(failures(STAGING, fresh, "worker", "g5")).toEqual(["BONDR_QUOTE_MINT: must be present"]);
  });

  it("fails a must-equal name with another value or missing", () => {
    expect(failures(STAGING, { ...PRODUCTION, ALLOW_MAINNET: "true" }, "worker")).toEqual([
      "ALLOW_MAINNET: must equal its expected value",
    ]);
    const { ALLOW_MAINNET: _, ...none } = PRODUCTION;
    expect(failures(STAGING, none, "worker")).toEqual(["ALLOW_MAINNET: must equal its expected value"]);
  });

  it("does not apply the worker-only rules to web", () => {
    expect(failures(STAGING, { SOLANA_NET: "mainnet" }, "web")).toEqual([]);
  });
});

describe("report", () => {
  it("shows names, states and short hashes, never a raw value", () => {
    const bad = { ...PRODUCTION, WORKER_TOKEN: STAGING.WORKER_TOKEN, MASTER_SEED: "prd-seed-aa11" };
    const text = report(diffEnv(hashAll(STAGING), hashAll(bad), policyFor("worker", "g1")));
    for (const word of ["WORKER_TOKEN", "same", "differs", "absent", "FAIL"]) expect(text).toContain(word);
    expect(text).toMatch(/\b[0-9a-f]{8}\b/);
    // Short flag values ("1", "on") would match hex digits; every secret above is longer.
    const raws = [...Object.values(STAGING), ...Object.values(bad)].filter((v) => v.length >= 6);
    for (const raw of raws) expect(text).not.toContain(raw);
  });
});
