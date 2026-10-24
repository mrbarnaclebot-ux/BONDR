// The live hub (RESEARCH Pattern 5). One upstream NDJSON stream from the worker per web process, a ring of the
// last 2,000 events, and fan-out to every open /api/live stream. Browsers never reach Postgres or the worker
// (D-04, D-07). Besides lib/worker.ts, the only file that reads WORKER_TOKEN; server-only keeps it out of
// client bundles.
import "server-only";
import type { LiveEvent } from "@bondr/core/api";

export type HubEvent = LiveEvent | { type: "resync"; id?: string };
type Write = (e: HubEvent) => void;
type Line = LiveEvent | { type: "ping"; id: string };
type Open = (signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>;

/** Parsed NDJSON objects from a byte stream; a line may span chunks, a malformed line is skipped. */
export async function* splitLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      yield value;
    }
  }
}

const RING = 2000;

/**
 * The last 2,000 events after `base`, the id the hub was at when it last (re)synced or the id of the oldest
 * event pushed out. An id it no longer holds (pushed out, another epoch, before a gap) cannot be replayed.
 */
export class Ring {
  private base: string | null = null;
  private items: LiveEvent[] = [];
  get head(): string | null {
    return this.items.at(-1)?.id ?? this.base;
  }
  reset(at: string): void {
    this.base = at;
    this.items = [];
  }
  push(e: LiveEvent): void {
    this.items.push(e);
    if (this.items.length > RING) this.base = this.items.shift()?.id ?? this.base;
  }
  since(id: string): LiveEvent[] | null {
    if (id === this.base) return [...this.items];
    const i = this.items.findIndex((e) => e.id === id);
    return i < 0 ? null : this.items.slice(i + 1);
  }
}

const mintOf = (e: LiveEvent) => (e.type === "trade" ? e.data.coin.mint : e.data.mint);
// A coin page gets its coin's events; a list (no mint) gets everything, launches included.
const matches = (e: HubEvent, mint?: string) =>
  e.type === "resync" || !mint || (e.type !== "launch" && mintOf(e) === mint);

const backoff = (n: number) => new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** (n - 1))));

type Sub = { write: Write; mint?: string };
type State = { ring: Ring; subs: Set<Sub> };

function fan(h: State, e: HubEvent): void {
  for (const s of h.subs) {
    if (!matches(e, s.mint)) continue;
    try {
      s.write(e);
    } catch {
      h.subs.delete(s); // a closed stream; its route cleans up in cancel()
    }
  }
}

// The first ping of a connection carries the worker's current id. Anything other than where the hub left
// off (worker restart, events published while disconnected) is a gap: clear the ring and resync clients.
// ponytail: the first connect after a web boot never resyncs; pages rendered just before it may miss
// events from those seconds.
function sync(h: State, id: string): void {
  if (h.ring.head === id) return;
  const gap = h.ring.head !== null;
  h.ring.reset(id);
  if (gap) fan(h, { type: "resync", id });
}

function take(h: State, line: Line): void {
  if (line.type === "ping") {
    sync(h, line.id);
    return;
  }
  h.ring.push(line);
  fan(h, line);
}

const STALL_MS = 45_000; // the worker pings every 15 s

// One upstream connection's lines. A link dropped with no FIN or RST would hang here forever, so a connection
// silent for `stallMs` is aborted; the loop reconnects, and the first ping resyncs clients if anything was missed.
async function* upstream(open: Open, stallMs: number): AsyncGenerator<Line> {
  const ac = new AbortController();
  const stall = setTimeout(() => ac.abort(new Error("upstream silent")), stallMs);
  try {
    for await (const value of splitLines(await open(ac.signal))) {
      stall.refresh();
      const line = value as Line;
      if (typeof line?.id === "string") yield line;
    }
  } finally {
    clearTimeout(stall);
  }
}

type Wait = (fails: number) => Promise<unknown>;

async function run(h: State, open: Open, wait: Wait, stallMs: number): Promise<never> {
  for (let fails = 0; ; ) {
    try {
      for await (const line of upstream(open, stallMs)) {
        fails = 0;
        take(h, line);
      }
    } catch (e) {
      console.error(`live upstream failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
    await wait(++fails);
  }
}

export function createHub(open: Open, wait: Wait = backoff, stallMs = STALL_MS) {
  const h: State = { ring: new Ring(), subs: new Set() };
  let started = false;
  return {
    head: () => h.ring.head,
    /** Replays what `lastId` missed (or one resync), then live events; starts the upstream on first use. */
    subscribe(write: Write, { mint, lastId }: { mint?: string; lastId?: string } = {}): () => void {
      const missed = lastId ? h.ring.since(lastId) : [];
      if (!missed) write({ type: "resync", id: h.ring.head ?? undefined });
      else for (const e of missed) if (matches(e, mint)) write(e);
      const sub = { write, mint };
      h.subs.add(sub);
      if (!started) {
        started = true;
        void run(h, open, wait, stallMs);
      }
      return () => void h.subs.delete(sub);
    },
  };
}

// No fixed timeout: the stream is meant to stay open (worker.ts call() would abort it after 15 s); the hub
// aborts it through `signal` only when it goes silent.
async function openWorker(signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
  const base = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!base || !token) throw new Error("WORKER_URL or WORKER_TOKEN missing");
  const res = await fetch(new URL("/events", base), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`events answered ${res.status}`);
  return res.body;
}

// On globalThis so dev HMR reuses the one upstream instead of opening another per reload.
const g = globalThis as typeof globalThis & { bondrLiveHub?: ReturnType<typeof createHub> };
g.bondrLiveHub ??= createHub(openWorker);
export const hub = g.bondrLiveHub;
