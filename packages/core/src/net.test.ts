import { afterEach, describe, expect, test } from "vitest";
import { redact, wsUrl } from "./net.ts";

const NAMES = ["helius_api_key", "SPIKE_FORK_WS_URL"] as const;
const saved = NAMES.map((n) => process.env[n]);
// Assigning undefined to process.env stores the string "undefined", so unset names are deleted.
afterEach(() => {
  NAMES.forEach((n, i) => {
    if (saved[i] === undefined) delete process.env[n];
    else process.env[n] = saved[i];
  });
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

describe("wsUrl", () => {
  test("devnet carries the key, and redact strips it", () => {
    process.env.helius_api_key = "k3y-value";
    expect(wsUrl("devnet")).toBe("wss://devnet.helius-rpc.com/?api-key=k3y-value");
    expect(redact(wsUrl("devnet"))).not.toContain("k3y-value");
  });

  test("fork uses SPIKE_FORK_WS_URL, else the local Surfpool port", () => {
    process.env.SPIKE_FORK_WS_URL = "ws://localhost:9";
    expect(wsUrl("fork")).toBe("ws://localhost:9");
    delete process.env.SPIKE_FORK_WS_URL;
    expect(wsUrl("fork")).toBe("ws://127.0.0.1:18900");
  });

  test("devnet without a key throws", () => {
    delete process.env.helius_api_key;
    expect(() => wsUrl("devnet")).toThrow("helius_api_key missing in .env");
  });
});
