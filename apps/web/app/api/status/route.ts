import type { Status } from "@bondr/core/api";
import { workerGet } from "@/lib/worker";

// Polled every 10 s by /launch; the worker caches its chain read 5 s, so nothing here caches again.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { status, body } = await workerGet<Status>("/status");
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
