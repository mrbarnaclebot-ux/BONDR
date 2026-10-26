import { expect, test } from "vitest";
import { forbiddenEnv, scrub } from "./scrub.ts";

test("scrub replaces every base58 address and keeps the other fields", () => {
  const event = {
    message: "wallet 9wRtPq3yq1ZJ8yQd2ynVfUKAnx3bK2SMQkkjD8Kq4e3F failed",
    level: "error",
    extra: { list: ["4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA"], n: 3, ok: true, none: null },
  };
  expect(scrub(event)).toEqual({
    message: "wallet [addr] failed",
    level: "error",
    extra: { list: ["[addr]"], n: 3, ok: true, none: null },
  });
});

test("scrub leaves base58 runs under 32 chars and non-base58 text alone", () => {
  const short = "bndr sig 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9C at slot 42";
  expect(scrub({ message: short, tags: ["0OIl"] })).toEqual({ message: short, tags: ["0OIl"] });
  expect(scrub(7)).toBe(7);
  expect(scrub(null)).toBe(null);
  const ids = { event_id: "c4a1b2d3e4f5a6b7c8d9e1f2a3b4c5d6", trace_id: "ABCDEF123456789ABCDEF123456789AB" };
  expect(scrub(ids)).toEqual(ids);
  expect(scrub({ data: { arguments: ["lamports", 5n] } })).toEqual({
    data: { arguments: ["lamports", "5"] },
  });
});

test("forbiddenEnv names the secrets web must never hold", () => {
  const env = {
    MASTER_SEED: "x",
    OPS_SEED: "y",
    MASTER_SEED_FILE: "/p",
    helius_api_key: "k",
    sentry_auth_token: "t",
    DATABASE_URL_STAGING: "u",
    SENTRY_READ_TOKEN: "r",
    DATABASE_URL: "d",
    PATH: "/bin",
  };
  expect(forbiddenEnv(env)).toEqual([
    "MASTER_SEED",
    "OPS_SEED",
    "MASTER_SEED_FILE",
    "helius_api_key",
    "sentry_auth_token",
    "DATABASE_URL_STAGING",
    "SENTRY_READ_TOKEN",
  ]);
});

test("forbiddenEnv passes the web env names and ignores empty values", () => {
  const web = {
    DATABASE_URL: "d",
    WORKER_URL: "w",
    WORKER_TOKEN: "t",
    pinata_jwt: "j",
    PINATA_GATEWAY: "g",
    SOLANA_NET: "devnet",
    NEXT_PUBLIC_SENTRY_DSN: "dsn",
    SENTRY_TEST_ROUTE: "1",
    MASTER_SEED: "",
  };
  expect(forbiddenEnv(web)).toEqual([]);
});
