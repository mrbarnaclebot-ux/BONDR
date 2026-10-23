// The live hub (RESEARCH Pattern 5). One upstream NDJSON stream from the worker per web process, a ring of the
// last 2,000 events, and fan-out to every open /api/live stream. Browsers never reach Postgres or the worker
// (D-04, D-07). Besides lib/worker.ts, the only file that reads WORKER_TOKEN; server-only keeps it out of
// client bundles.
import "server-only";
import type { LiveEvent } from "@bondr/core/api";

export type HubEvent = LiveEvent | { type: "resync"; id?: string };
type Write = (e: HubEvent) => void;
type Line = LiveEvent | { type: "ping"; id: string };
type Open = () => Promise<AsyncIterable<Uint8Array>>;

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

export function createHub(open: Open, wait: (fails: number) => Promise<unknown> = backoff) {
  const ring = new Ring();
  const subs = new Set<{ write: Write; mint?: string }>();
  let started = false;

  const fan = (e: HubEvent) => {
    for (const s of subs) {
      if (!matches(e, s.mint)) continue;
      try {
        s.write(e);
      } catch {
        subs.delete(s); // a closed stream; its route cleans up in cancel()
      }
    }
  };

  // The first ping of a connection carries the worker's current id. Anything other than where the hub left
  // off (worker restart, events published while disconnected) is a gap: clear the ring and resync clients.
  // ponytail: the first connect after a web boot never resyncs; pages rendered just before it may miss
  // events from those seconds.
  const sync = (id: string) => {
    if (ring.head === id) return;
    const gap = ring.head !== null;
    ring.reset(id);
    if (gap) fan({ type: "resync", id });
  };

  async function run(): Promise<never> {
    for (let fails = 0; ; ) {
      try {
        for await (const value of splitLines(await open())) {
          const line = value as Line;
          if (typeof line?.id !== "string") continue;
          fails = 0;
          if (line.type === "ping") {
            sync(line.id);
            continue;
          }
          ring.push(line);
          fan(line);
        }
      } catch (e) {
        console.error(`live upstream failed: ${e instanceof Error ? e.message : "unknown"}`);
      }
      await wait(++fails);
    }
  }

  return {
    head: () => ring.head,
    /** Replays what `lastId` missed (or one resync), then live events; starts the upstream on first use. */
    subscribe(write: Write, { mint, lastId }: { mint?: string; lastId?: string } = {}): () => void {
      const missed = lastId ? ring.since(lastId) : [];
      if (!missed) write({ type: "resync", id: ring.head ?? undefined });
      else for (const e of missed) if (matches(e, mint)) write(e);
      const sub = { write, mint };
      subs.add(sub);
      if (!started) {
        started = true;
        void run();
      }
      return () => void subs.delete(sub);
    },
  };
}

// No timeout: the stream is meant to stay open (worker.ts call() would abort it after 15 s).
async function openWorker(): Promise<AsyncIterable<Uint8Array>> {
  const base = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (!base || !token) throw new Error("WORKER_URL or WORKER_TOKEN missing");
  const res = await fetch(new URL("/events", base), {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok || !res.body) throw new Error(`events answered ${res.status}`);
  return res.body;
}

// On globalThis so dev HMR reuses the one upstream instead of opening another per reload.
const g = globalThis as typeof globalThis & { bondrLiveHub?: ReturnType<typeof createHub> };
g.bondrLiveHub ??= createHub(openWorker);
export const hub = g.bondrLiveHub;
