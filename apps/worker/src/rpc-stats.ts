// RPC health for the console (D-26): the worker's one Connection fetches through timedFetch, which keeps the last
// hour of calls in memory. web3.js retries a 429 itself, so each retry counts. Resets on restart ("since boot").
// ponytail: HTTP-level only; JSON-RPC errors inside a 200 are not counted. Parse a clone if that matters.
import type { AdminHealth } from "@bondr/core/api-admin";

const HOUR = 3_600_000;
const CAP = 50_000;
const ring: { at: number; ms: number; status: number }[] = [];

// Status 0 is a fetch that threw (no response).
export function note(status: number, ms: number, now = Date.now()): void {
  ring.push({ at: now, ms: Math.round(ms), status });
  let drop = 0;
  while (drop < ring.length && ring[drop].at < now - HOUR) drop++;
  drop = Math.max(drop, ring.length - CAP);
  if (drop > 0) ring.splice(0, drop);
}

export const timedFetch: typeof fetch = async (input, init) => {
  const t = performance.now();
  try {
    const res = await fetch(input, init);
    note(res.status, performance.now() - t);
    return res;
  } catch (e) {
    note(0, performance.now() - t);
    throw e;
  }
};

// Nearest rank, so every percentile is a latency that really happened.
const rank = (sorted: number[], p: number): number | null =>
  sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;

export function rpcStats(now = Date.now()): AdminHealth["rpc"] {
  const recent = ring.filter((s) => s.at >= now - HOUR);
  const ms = recent.map((s) => s.ms).sort((a, b) => a - b);
  const errors = recent.filter((s) => s.status < 200 || s.status >= 300).length;
  return {
    p50: rank(ms, 0.5),
    p95: rank(ms, 0.95),
    errorRate: recent.length ? errors / recent.length : 0,
    rateLimited: recent.filter((s) => s.status === 429).length,
    count: recent.length,
  };
}
