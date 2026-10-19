// The worker's private HTTP API (RESEARCH Pattern 12): node:http, a bearer token, JSON in and out.
// Only the web server calls it, over Railway private networking; the worker never gets a public domain.
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ApiError } from "@bondr/core/api";
import { redact } from "@bondr/core/net";

export const MAX_BODY = 16_384;

// A handler throws this to answer with a specific status and contract error instead of a 500.
export class Fail extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

export type Handler = (body: unknown) => Promise<unknown>;
export type Routes = Record<string, Handler>; // keyed "METHOD /path"

// Code Example 4: timingSafeEqual needs equal lengths, and the length check leaks only the length.
export function authorized(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function readJson(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > max) throw new Fail(413, { error: "invalid_input" });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new Fail(413, { error: "invalid_input" });
    chunks.push(chunk);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Fail(400, { error: "invalid_input" });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  // An unread request body (413) would otherwise keep the socket busy; close it after the answer.
  if (status === 413) res.setHeader("connection", "close");
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handle(routes: Routes, token: string, req: IncomingMessage, res: ServerResponse) {
  const key = `${req.method} ${new URL(req.url ?? "/", "http://worker").pathname}`;
  try {
    if (key === "GET /healthz") return send(res, 200, { ok: true });
    if (!authorized(req.headers.authorization, token)) return send(res, 401, { error: "unauthorized" });
    const route = routes[key];
    if (!route) return send(res, 404, { error: "not_found" });
    const body = req.method === "POST" ? await readJson(req) : undefined;
    send(res, 200, await route(body));
  } catch (e) {
    if (e instanceof Fail) return send(res, e.status, e.body);
    console.error(`${key} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    send(res, 500, { error: "build_failed" });
  }
}

// No host argument: Node binds dual-stack ::, which Railway private networking needs.
export function start(routes: Routes, token: string, port?: number): Server {
  const server = createServer((req, res) => void handle(routes, token, req, res));
  server.listen(port ?? Number(process.env.WORKER_PORT || process.env.PORT || 8080));
  return server;
}
