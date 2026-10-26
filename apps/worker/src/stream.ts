// Live ingestion (RESEARCH Pattern 1): one log subscription on the BONDR mint (D-05), which every BONDR coin
// trade names as an account. A notification is only a hint: it queues a signature, and ingestTx fetches the
// tx and checks the emit_cpi authority before writing anything. Every (re)connect reads each coin's last_sig,
// subscribes, then gap fills from those marks, so nothing falls between. Never started in Vitest (Pitfall 1).
import type { Net } from "@bondr/core/keys";
import { redact, wsUrl } from "@bondr/core/net";
import type { Connection } from "@solana/web3.js";
import { mark } from "./health.ts";
import { gapFillAll, ingestOrKeep, lastSigs, type Marks, retryFailed } from "./ingest.ts";
import type { Ctx } from "./status.ts";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const INVOKES = [PUMP, PUMP_AMM].map((p) => `Program ${p} invoke`);
const PING_MS = 30_000; // Helius drops sockets idle for 10 min and asks for a ping at least once a minute
const HEALTHY_MS = 60_000; // a connection up this long resets the backoff

const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

export const isPumpInvoke = (logs: readonly string[]): boolean =>
  logs.some((l) => l.includes("Log truncated") || INVOKES.some((p) => l.startsWith(p)));

// Plain BONDR transfers and failed txs cost no fetch.
export const shouldIngest = (v: { err: unknown; logs: readonly string[] }): boolean =>
  v.err === null && isPumpInvoke(v.logs);

// 1 s doubling to a 30 s cap, +-20 percent jitter so a fleet of clients does not reconnect in step.
export const backoff = (attempt: number, r = Math.random()): number =>
  Math.min(30_000, 1000 * 2 ** attempt) * (0.8 + 0.4 * r);

// De-duplicated and drained one at a time, so a burst never exceeds the Helius request rate. A drain first
// retries what failed before.
const queue = new Set<string>();
let draining = false;
async function drain(conn: Connection): Promise<void> {
  draining = true;
  await retryFailed(conn);
  for (const sig of queue) {
    await ingestOrKeep(conn, sig);
    queue.delete(sig);
  }
  draining = false;
}

// One fill at a time. An open during a fill queues its marks for one more fill after it; for a coin in both
// snapshots the older mark wins (last_sig only moves forward), so it covers what both disconnects missed.
let filling = false;
let next: Marks | null = null;
async function fillAll(conn: Connection, marks: Marks): Promise<void> {
  next = next ? new Map([...marks, ...next]) : marks;
  if (filling) return;
  filling = true;
  for (let m: Marks | null = next; m; m = next) {
    next = null;
    await retryFailed(conn);
    const n = await gapFillAll(conn, m).catch(logged("gap fill"));
    if (n) console.log(`gap fill: ${n} txs`);
  }
  filling = false;
}

type Note = { params?: { result?: { value?: { signature: string; err: unknown; logs: string[] } } } };
type Reply = Note & { id?: number; result?: unknown; error?: unknown };
// False when the socket is useless: the reply to logsSubscribe (id 1) refused the subscription.
export function onMessage(conn: Connection, data: unknown): boolean {
  let msg: Reply;
  try {
    msg = JSON.parse(String(data));
  } catch {
    return true;
  }
  if (msg.error) console.error(`stream rpc error: ${redact(JSON.stringify(msg.error))}`);
  if (msg.id === 1 && typeof msg.result !== "number") return false;
  const v = msg.params?.result?.value;
  if (!v || !shouldIngest(v) || queue.has(v.signature)) return true;
  queue.add(v.signature);
  if (!draining) void drain(conn);
  return true;
}

const SUBSCRIBE = (ctx: Ctx) =>
  JSON.stringify({
    ...{ jsonrpc: "2.0", id: 1, method: "logsSubscribe" },
    params: [{ mentions: [ctx.Q.toBase58()] }, { commitment: "confirmed" }],
  });
// The keepalive is getHealth, not "ping": Helius devnet never answers a JSON-RPC ping (probed 2026-10-24), and an
// answer is what proves the link is alive. ponytail: about 86k getHealth calls a month; drop to 50 s if credits pinch.
const PING = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getHealth" });

type Link = { ws: WebSocket; ping?: NodeJS.Timeout; healthy?: NodeJS.Timeout; seen: number; down: boolean };

// Once per socket. Also the way out of a half-open socket, which may never fire close on its own.
function drop(l: Link, why: string, retry: () => void): void {
  if (l.down) return;
  l.down = true;
  clearInterval(l.ping);
  clearTimeout(l.healthy);
  console.warn(`stream ${why}, reconnecting`);
  l.ws.close();
  retry();
}

function subscribe(ctx: Ctx, l: Link, marks: Marks, dead: (why: string) => void): boolean {
  if (l.ws.readyState !== WebSocket.OPEN) return false;
  l.ws.send(SUBSCRIBE(ctx));
  l.seen = Date.now();
  // Every getHealth is answered, so two intervals of silence mean the link is dead.
  l.ping = setInterval(() => (Date.now() - l.seen > 2 * PING_MS ? dead("silent") : l.ws.send(PING)), PING_MS);
  console.log("stream subscribed");
  void fillAll(ctx.conn, marks);
  return true;
}

export function startStream(ctx: Ctx, net: Net, attempt = 0): void {
  const retry = () => setTimeout(() => startStream(ctx, net, attempt + 1), backoff(attempt));
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(net));
  } catch (e) {
    logged("stream open")(e);
    retry();
    return;
  }
  const l: Link = { ws, seen: 0, down: false };
  const dead = (why: string) => drop(l, why, retry);
  const healthy = () => {
    attempt = 0;
  };
  ws.onopen = () =>
    lastSigs().then(
      (marks) => {
        if (subscribe(ctx, l, marks, dead)) l.healthy = setTimeout(healthy, HEALTHY_MS);
      },
      (e: unknown) => {
        logged("stream marks")(e);
        dead("could not read marks");
      },
    );
  ws.onmessage = (m) => {
    l.seen = Date.now();
    mark("stream");
    if (!onMessage(ctx.conn, m.data)) dead("subscription refused");
  };
  // An error is always followed by close, which reconnects.
  ws.onerror = (e) => console.error(`stream error: ${redact(String((e as ErrorEvent).message ?? e.type))}`);
  ws.onclose = (e) => dead(`closed (${e.code}${e.reason ? ` ${redact(e.reason)}` : ""})`);
}
