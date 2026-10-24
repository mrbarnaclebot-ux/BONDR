// The worker's request/response calls. Only this file and live-hub.ts (the /events stream) read WORKER_TOKEN;
// server-only fails the build if a client component imports either, so the token never reaches a browser
// bundle (T-02-08-01).
import "server-only";
import type { ApiError } from "@bondr/core/api";

// status and quote: a few RPC reads; 15 s leaves room for a Neon cold start.
const TIMEOUT_MS = 15_000;
// The worker's contract errors are passed through; anything else (401, a crash, a timeout) is one code.
const PASS = new Set([400, 402, 403, 404, 409, 410, 413, 422, 429, 500, 503]);

export type WorkerReply<T> = { status: number; body: T | ApiError };

const unavailable: WorkerReply<never> = { status: 503, body: { error: "worker_unavailable" } };

async function call<T>(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<WorkerReply<T>> {
  const base = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!base || !token) return unavailable;
  try {
    const res = await fetch(new URL(path, base), {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
    if (res.ok && body) return { status: res.status, body };
    // Rebuilt from the two contract fields, so no raw worker text reaches the browser.
    if (PASS.has(res.status) && typeof body?.error === "string")
      return { status: res.status, body: { error: body.error, paused: body.paused } };
    return unavailable;
  } catch {
    return unavailable;
  }
}

export const workerGet = <T>(path: string) => call<T>(path, { method: "GET" });

export const workerPost = <T>(path: string, body: unknown, timeoutMs?: number) =>
  call<T>(
    path,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    timeoutMs,
  );
