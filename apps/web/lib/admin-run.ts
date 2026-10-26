// The simulation dialog's calls (ADMIN-01, ADMIN-04, D-12): simulate, execute with the owner's signature over the
// worker's intent text, and the intent poll, all POSTed through the admin forwarder. Client-safe: no program ids,
// no Solana library, bytes in and out only (mirrors trade-run.ts).
import type { AdminIntentView, AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";

const POLL_MS = 1_500;
const DEADLINE_MS = 90_000;

/** A 401 comes back as status 401 so the caller runs onUnauthorized. */
/** reason is the worker's not_applicable code (window_swept), when it sent one. */
export type Reply<T> = { ok: true; body: T } | { ok: false; status: number; code: string; reason?: string };

async function post<T>(op: string, body: object, signal: AbortSignal): Promise<Reply<T>> {
  const res = await fetch(`/api/admin/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as (T & { error?: unknown; reason?: unknown }) | null;
  if (res?.ok && out) return { ok: true, body: out };
  const code = typeof out?.error === "string" ? out.error : "worker_unavailable";
  const reason = typeof out?.reason === "string" ? out.reason : undefined;
  return { ok: false, status: res?.status ?? 0, code, ...(reason && { reason }) };
}

export const simulateAdmin = (action: AdminTxAction, mint: string | null, signal: AbortSignal) =>
  post<AdminSimResult>("simulate", { action, mint }, signal);

/** Carries only the intent id and the raw 64-byte signature as base64 (T-06-18 boundary). */
export const executeAdmin = (id: string, signature: Uint8Array, signal: AbortSignal) =>
  post<{ id: string }>("execute", { id, signature: btoa(String.fromCharCode(...signature)) }, signal);

const unknown = (id: string, last: AdminIntentView | null): AdminIntentView => ({
  ...(last ?? { id, sigs: [], landed: 0, total: 0 }),
  state: "unknown",
});

/**
 * Polls the intent in worker memory (no database read, D-21) every 1.5 s, only after a user send, until it
 * settles. A lost intent (a worker restart) or 90 s with no answer is unknown: it may still land, so it is never
 * reported failed and never resent. Each "sending" answer goes to `onView` (EVACUATE's progress line) and restarts
 * the 90 s, so a run of many paced batches is not cut off while the worker keeps answering.
 */
export async function pollIntent(
  id: string,
  signal: AbortSignal,
  onView?: (v: AdminIntentView) => void,
): Promise<Reply<AdminIntentView>> {
  let start = Date.now();
  let last: AdminIntentView | null = null;
  while (!signal.aborted && Date.now() - start < DEADLINE_MS) {
    const r = await post<AdminIntentView>("intent", { id }, signal);
    if (!r.ok && r.status === 401) return r;
    if (!r.ok && r.status === 404) return { ok: true, body: unknown(id, last) };
    if (r.ok && r.body.state !== "sending") return r;
    if (r.ok) {
      last = r.body;
      start = Date.now();
      onView?.(r.body);
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
  return { ok: true, body: unknown(id, last) };
}
