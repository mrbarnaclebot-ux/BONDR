// The only web file that talks to the worker or reads WORKER_TOKEN. server-only fails the build if a client
// component imports it, so the token can never reach a browser bundle (T-02-08-01).
import "server-only";
import type { ApiError } from "@bondr/core/api";

// prepare (02-11) takes about 6 s on devnet; 15 s leaves room for a Neon cold start.
const TIMEOUT_MS = 15_000;
// The worker's contract errors are passed through; anything else (401, a crash, a timeout) is one code.
const PASS = new Set([400, 404, 409, 413, 429, 500]);

export type WorkerReply<T> = { status: number; body: T | ApiError };

const unavailable: WorkerReply<never> = { status: 503, body: { error: "worker_unavailable" } };

async function call<T>(path: string, init: RequestInit): Promise<WorkerReply<T>> {
  const base = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!base || !token) return unavailable;
  try {
    const res = await fetch(new URL(path, base), {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

export const workerPost = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
