import bs58 from "bs58";
import { afterEach, expect, test, vi } from "vitest";
import type { WalletApi } from "@/components/wallet";
import { type RunInput, runTrade } from "./trade-run";

// One empty signature slot, then a dummy message; the fake wallet fills slot 0 with 9s.
const TX = btoa(String.fromCharCode(1, ...Array(64).fill(0), ...Array(10).fill(7)));
const SIGNED = Uint8Array.from([1, ...Array(64).fill(9), ...Array(10).fill(7)]);
const SIG = bs58.encode(new Uint8Array(64).fill(9));
const PREPARED = { tradeId: "a".repeat(32), tx: TX, signBy: 60, expectedOut: "1", minAmountOut: "1" };

/** Prepare answers; the submit and every read get a 502, as while the worker is down. */
function workerDown() {
  const fetch = vi.fn(async (url: string) =>
    url.endsWith("/prepare") ? Response.json(PREPARED) : new Response(null, { status: 502 }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function input(signal: AbortSignal): RunInput {
  const wallet = {
    address: "Trader1111111111111111111111111111111111111",
    signTransaction: async () => SIGNED,
    onAccountChange: () => () => {},
  } as unknown as WalletApi;
  return { wallet, mint: "M", side: "buy", amount: "1", slippageBps: 100, onPhase: () => {}, signal };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a posted trade with no answer ends unknown at the deadline, with the slot 0 signature (C-CR-02)", async () => {
  vi.useFakeTimers();
  workerDown();
  const run = runTrade(input(new AbortController().signal));
  await vi.advanceTimersByTimeAsync(151_000);
  await expect(run).resolves.toEqual({ state: "unknown", signature: SIG });
});

test("an abort stops the poll and its requests (C-CR-02)", async () => {
  vi.useFakeTimers();
  const fetch = workerDown();
  const ctrl = new AbortController();
  const run = runTrade(input(ctrl.signal)).catch((e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(3_000);
  ctrl.abort();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await run).toBe("worker_unavailable");
  const calls = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch.mock.calls.length).toBe(calls);
});
