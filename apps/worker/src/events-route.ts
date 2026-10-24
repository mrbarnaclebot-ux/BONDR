// GET /events (RESEARCH Pattern 5): every indexed change as one NDJSON line to each open stream. Each web
// process holds one of these and fans it out to browsers. Ids are "<epoch>-<seq>" with epoch the boot time,
// so web sees a restart. Every ping carries the current id: a reconnecting web hub compares it with the last
// id it saw and knows whether it missed anything.
// ponytail: no replay here; a web hub that missed lines sends its clients a resync (one refetch each).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LiveEvent } from "@bondr/core/api";

export type LiveBody = LiveEvent extends infer E ? (E extends LiveEvent ? Omit<E, "id"> : never) : never;

const EPOCH = Date.now();
const PING_MS = 15_000;
let seq = 0;
const subscribers = new Set<ServerResponse>();

const ping = () => `${JSON.stringify({ type: "ping", id: `${EPOCH}-${seq}` })}\n`;

export const listening = (): number => subscribers.size;

export function publish(e: LiveBody): void {
  const line = `${JSON.stringify({ id: `${EPOCH}-${++seq}`, ...e })}\n`;
  for (const res of subscribers) res.write(line);
}

// A skipped id is a gap: every web hub resyncs its clients at the next ping, one refetch per open page. For
// changes that are not live events, such as a gap fill's historical trades.
export function skipId(): void {
  seq++;
}

export function eventsHandler(req: IncomingMessage, res: ServerResponse, pingMs = PING_MS): void {
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  res.write(ping());
  subscribers.add(res);
  const timer = setInterval(() => res.write(ping()), pingMs);
  req.on("close", () => {
    clearInterval(timer);
    subscribers.delete(res);
  });
}

// SIGTERM: open streams would keep server.close() waiting forever.
export function endStreams(): void {
  for (const res of subscribers) res.end();
}
