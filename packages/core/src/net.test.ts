import { afterEach, describe, expect, test, vi } from "vitest";
import { connect, redact, wsUrl } from "./net.ts";

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

  test("mainnet uses the Helius mainnet host", () => {
    process.env.helius_api_key = "k3y-value";
    expect(wsUrl("mainnet")).toBe("wss://mainnet.helius-rpc.com/?api-key=k3y-value");
  });

  test("devnet without a key throws", () => {
    delete process.env.helius_api_key;
    expect(() => wsUrl("devnet")).toThrow("helius_api_key missing in .env");
  });
});

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
// Answers every JSON-RPC call with `result` and records the host it was sent to; no network.
function rpcStub(result: unknown, hosts: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    hosts.push(new URL(String(input)).host);
    const { id } = JSON.parse(String(init?.body ?? "{}")) as { id?: unknown };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }) as typeof fetch;
}

describe("connect (D-03)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SPIKE_FORK_URL;
  });

  test("mainnet goes to the Helius mainnet host and accepts the mainnet genesis", async () => {
    process.env.helius_api_key = "k3y-value";
    const hosts: string[] = [];
    await expect(connect("mainnet", { fetch: rpcStub(MAINNET_GENESIS, hosts) })).resolves.toBeDefined();
    expect(hosts).toEqual(["mainnet.helius-rpc.com"]);
  });

  test("mainnet refuses a devnet genesis", async () => {
    process.env.helius_api_key = "k3y-value";
    await expect(connect("mainnet", { fetch: rpcStub(DEVNET_GENESIS) })).rejects.toThrow(
      "unexpected genesis",
    );
  });

  test("fork still refuses a non-local host", async () => {
    process.env.SPIKE_FORK_URL = "https://mainnet.helius-rpc.com/?api-key=x";
    await expect(connect("fork", { fetch: rpcStub(MAINNET_GENESIS) })).rejects.toThrow(
      "127.0.0.1 or localhost",
    );
  });

  test("fork accepts a local host with the mainnet genesis that answers as Surfpool", async () => {
    process.env.SPIKE_FORK_URL = "http://127.0.0.1:9";
    vi.stubGlobal("fetch", rpcStub([]));
    await expect(connect("fork", { fetch: rpcStub(MAINNET_GENESIS) })).resolves.toBeDefined();
  });
});
