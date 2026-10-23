// Live ingestion (RESEARCH Pattern 1): one log subscription on the BONDR mint (D-05), which every BONDR coin
// trade names as an account. A notification is only a hint: it queues a signature, and ingestTx fetches the
// tx and checks the emit_cpi authority before writing anything. Every (re)connect subscribes first and then
// gap fills, so nothing falls between. Never started in Vitest (Pitfall 1).
import type { Net } from "@bondr/core/keys";
import { redact, wsUrl } from "@bondr/core/net";
import type { Connection } from "@solana/web3.js";
import { gapFillAll, ingestTx } from "./ingest.ts";
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

// De-duplicated and drained one at a time, so a burst never exceeds the Helius request rate.
const queue = new Set<string>();
let draining = false;
async function drain(conn: Connection): Promise<void> {
  draining = true;
  for (const sig of queue) {
    await ingestTx(conn, sig).catch(logged(`ingest ${sig}`));
    queue.delete(sig);
  }
  draining = false;
}

// One fill at a time; an open during a fill runs one more fill after it, from the then-current last_sig.
let filling = false;
let again = false;
async function fillAll(conn: Connection): Promise<void> {
  if (filling) {
    again = true;
    return;
  }
  filling = true;
  do {
    again = false;
    const n = await gapFillAll(conn).catch(logged("gap fill"));
    if (n) console.log(`gap fill: ${n} txs`);
  } while (again);
  filling = false;
}

type Note = { params?: { result?: { value?: { signature: string; err: unknown; logs: string[] } } } };
function onMessage(conn: Connection, data: unknown): void {
  let msg: Note & { error?: unknown };
  try {
    msg = JSON.parse(String(data));
  } catch {
    return;
  }
  if (msg.error) console.error(`stream rpc error: ${redact(JSON.stringify(msg.error))}`);
  const v = msg.params?.result?.value;
  if (!v || !shouldIngest(v) || queue.has(v.signature)) return;
  queue.add(v.signature);
  if (!draining) void drain(conn);
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
  let ping: NodeJS.Timeout | undefined;
  let healthy: NodeJS.Timeout | undefined;
  ws.onopen = () => {
    const params = [{ mentions: [ctx.Q.toBase58()] }, { commitment: "confirmed" }];
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params }));
    ping = setInterval(() => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })), PING_MS);
    healthy = setTimeout(() => {
      attempt = 0;
    }, HEALTHY_MS);
    console.log("stream subscribed");
    void fillAll(ctx.conn);
  };
  ws.onmessage = (m) => onMessage(ctx.conn, m.data);
  // An error is always followed by close, which reconnects.
  ws.onerror = (e) => console.error(`stream error: ${redact(String((e as ErrorEvent).message ?? e.type))}`);
  ws.onclose = (e) => {
    clearInterval(ping);
    clearTimeout(healthy);
    console.warn(`stream closed (${e.code}${e.reason ? ` ${redact(e.reason)}` : ""}), reconnecting`);
    retry();
  };
}
