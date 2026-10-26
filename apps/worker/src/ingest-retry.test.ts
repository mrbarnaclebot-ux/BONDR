// ingestOrKeep's retry rules with an injected ingest: no RPC, no database (Pitfall 1 of Phase 7).
import { type Connection, SolanaJSONRPCError } from "@solana/web3.js";
import { afterEach, expect, test, vi } from "vitest";
import { failedSigs, ingestOrKeep } from "./ingest.ts";

const conn = {} as Connection;
afterEach(() => vi.restoreAllMocks());

test("-32015 (unsupported transaction version) is dropped after one call and logged once", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const v2 = new SolanaJSONRPCError({ code: -32015, message: "Transaction version (2) is not supported" });
  const ingest = vi.fn().mockRejectedValue(v2);
  await ingestOrKeep(conn, "sig-v2", ingest);
  expect(ingest).toHaveBeenCalledTimes(1);
  expect(failedSigs()).not.toContain("sig-v2");
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain("transaction version not supported");
  expect(err).not.toHaveBeenCalled();
});

test("a transient error keeps the signature for retry; a later success removes it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await ingestOrKeep(conn, "sig-flaky", vi.fn().mockRejectedValue(new Error("fetch failed")));
  expect(failedSigs()).toContain("sig-flaky");
  await ingestOrKeep(conn, "sig-flaky", vi.fn().mockResolvedValue([]));
  expect(failedSigs()).not.toContain("sig-flaky");
});
