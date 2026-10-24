// Live updates over same-origin SSE (RESEARCH Pattern 5). Each stream is fed by the process's one hub, never
// by Postgres. proxy.ts limits connects to 30 a minute per IP; here each IP holds at most 6 open streams.
// Railway closes requests at 15 minutes, so a stream closes itself at 14 and EventSource resumes from
// Last-Event-ID out of the hub's ring.
import { BASE58_KEY, clientIp } from "@/lib/guard";
import { type HubEvent, hub } from "@/lib/live-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PER_IP = 6;
const LIFETIME_MS = 14 * 60_000;
const HEARTBEAT_MS = 20_000;
// ponytail: per-process counts, like guard.ts's limiter; fine while web runs one replica.
const open = new Map<string, number>();
const enc = new TextEncoder();

const frame = (e: HubEvent) =>
  e.type === "resync"
    ? `${e.id ? `id: ${e.id}\n` : ""}event: resync\ndata: {}\n\n`
    : `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;

const release = (ip: string) => {
  const n = (open.get(ip) ?? 1) - 1;
  if (n > 0) open.set(ip, n);
  else open.delete(ip);
};

const refuse = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

function stream(ip: string, signal: AbortSignal, mint?: string, lastId?: string): ReadableStream {
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(c) {
      let done = false;
      const send = (s: string) => {
        if (!done) c.enqueue(enc.encode(s));
      };
      // 2 KB first: Safari holds the first 1 KB of a stream before dispatching anything.
      send(`:${" ".repeat(2048)}\nretry: 1000\n\n`);
      const off = hub.subscribe((e) => send(frame(e)), { mint, lastId });
      // An id-only frame sets the browser's Last-Event-ID, so a reconnect after a web restart is a resync.
      const head = hub.head();
      if (head) send(`id: ${head}\n\n`);
      const beat = setInterval(() => send(":hb\n\n"), HEARTBEAT_MS);
      const end = setTimeout(() => {
        stop();
        c.close();
      }, LIFETIME_MS);
      stop = () => {
        if (done) return;
        done = true;
        off();
        clearInterval(beat);
        clearTimeout(end);
        release(ip);
      };
      signal.addEventListener("abort", () => stop());
    },
    cancel: () => stop(),
  });
}

export function GET(req: Request): Response {
  const q = new URL(req.url).searchParams;
  const mint = q.get("mint") ?? undefined;
  if (mint !== undefined && !BASE58_KEY.test(mint)) return refuse(400, "invalid_input");
  // A first EventSource can't send Last-Event-ID, so the page passes the hub id it rendered at as `last`.
  const lastId = req.headers.get("last-event-id") ?? q.get("last") ?? undefined;
  if (lastId && lastId.length > 64) return refuse(400, "invalid_input");
  const ip = clientIp(req) ?? "unknown";
  const n = open.get(ip) ?? 0;
  if (n >= MAX_PER_IP) return refuse(429, "rate_limited");
  open.set(ip, n + 1);
  return new Response(stream(ip, req.signal, mint, lastId), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
