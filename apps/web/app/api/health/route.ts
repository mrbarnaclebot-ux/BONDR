// Railway deploy healthcheck: liveness only. No DB or worker call, so a Neon cold start or a worker restart
// never blocks a web deploy.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
