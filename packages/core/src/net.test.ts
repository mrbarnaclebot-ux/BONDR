import { afterEach, describe, expect, test } from "vitest";
import { redact } from "./net.ts";

const saved = process.env.helius_api_key;
afterEach(() => {
  process.env.helius_api_key = saved;
});

describe("redact", () => {
  test("removes api-key query values", () => {
    process.env.helius_api_key = "";
    const out = redact("fetch failed: https://devnet.helius-rpc.com/?api-key=abc123&x=1");
    expect(out).not.toContain("abc123");
    expect(out).toContain("x=1");
  });

  test("removes every occurrence of the env key value", () => {
    process.env.helius_api_key = "s3cr3t-key";
    const out = redact("s3cr3t-key at start, again s3cr3t-key, and key=s3cr3t-key");
    expect(out).not.toContain("s3cr3t-key");
  });
});
