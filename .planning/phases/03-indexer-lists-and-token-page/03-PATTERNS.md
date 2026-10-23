# Phase 3: Indexer, Lists and Token Page - Pattern Map

**Mapped:** 2026-10-23
**Files analyzed:** 52 new or modified (from 03-CONTEXT, 03-RESEARCH "Recommended Project Structure" and 03-UI-SPEC "Component Inventory")
**Analogs found:** 45 / 52 (7 have no real analog: worker websocket, SSE route, live hub fan-out, OG cards, OG fonts, lightweight-charts wrapper, hero media)

Hard boundary for every web file: Biome `noRestrictedImports` lets web import only `@bondr/core/{math,rules,db,schema,api,scrub,sig}` (biome.json lines 31-43). So `core/trades.ts`, `core/price.ts`, `core/events.ts`, `core/pump.ts` are worker-only; web gets shapes from `core/api.ts` (types only) and reads Postgres through `lib/db.ts`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/events.ts` (mod) | utility (decoder) | transform | itself (lines 21-64) | exact |
| `packages/core/src/events.test.ts` (extend) | test | transform | itself | exact |
| `packages/core/src/pump.ts` (mod) | config (SDK load point) | n/a | itself (lines 12-35) | exact |
| `packages/core/src/trades.ts` (new) | utility (pure parser) | transform | `core/events.ts` `completeEvents` + `worker/settle.ts` `launchFacts` | role-match |
| `packages/core/src/trades.test.ts` (new) | test | transform | `core/events.test.ts` | exact |
| `packages/core/src/price.ts` (new) | utility (pure math) | transform | `core/math.ts` | exact |
| `packages/core/src/price.test.ts` (new) | test | transform | `core/math.test.ts` | exact |
| `packages/core/src/schema.ts` (mod) | model | CRUD | itself, `launches` table (lines 50-92) | exact |
| `packages/core/migrations/0003_indexer.sql` + meta (new, generated) | migration | n/a | `0002_consent_nonces.sql` + `_journal.json` | exact |
| `packages/core/src/api.ts` (mod) | model (types) | n/a | itself (`LaunchView`, lines 68-83) | exact |
| `packages/core/src/net.ts` (mod, `wsUrl`) | utility | n/a | `rpcUrl` (lines 16-20) | exact |
| `packages/core/src/README.md` (mod) | docs | n/a | itself | exact |
| `apps/worker/src/stream.ts` (new) | service | event-driven (websocket) | `worker/settle.ts` background loop + `main.ts` boot | partial |
| `apps/worker/src/ingest.ts` (new) | service | CRUD (idempotent write) + pub | `worker/settle.ts` `landed()` + `worker/launches.ts` `Exec` | role-match |
| `apps/worker/src/bondr-price.ts` (new) | service | request-response (chain read) + memory | `worker/status.ts` `readChain`/`live()` + kill-switch memory | role-match |
| `apps/worker/src/holders.ts` (new) | service | batch (throttled timer) | `worker/status.ts` cache + `settle.ts` timers | role-match |
| `apps/worker/src/holders.test.ts` (new) | test | pure | `worker/status.test.ts` | exact |
| `apps/worker/src/events-route.ts` (new) | controller | streaming (NDJSON) + pub-sub | `worker/http.ts` `handle`/`authorized` | partial |
| `apps/worker/src/settle.ts` (mod) | service | CRUD | itself `landed()` (lines 85-95) | exact |
| `apps/worker/src/http.ts` (mod) | controller | request-response | itself | exact |
| `apps/worker/src/main.ts` (mod) | config (boot) | n/a | itself | exact |
| `apps/worker/README.md` (mod) | docs | n/a | itself | exact |
| `apps/web/lib/coins.ts` (new) | service (read model) | CRUD read | `web/lib/launches.ts` + coin page cache | exact |
| `apps/web/lib/trades.ts` (new) | service (read model) | CRUD read | `web/lib/launches.ts` | exact |
| `apps/web/lib/coins.test.ts`, `lib/trades.test.ts` (new) | test (DB integration) | CRUD | `core/src/db.test.ts` | exact |
| `apps/web/lib/live-hub.ts` (new) | service (server-only) | streaming + pub-sub | `web/lib/worker.ts` (auth, env, server-only) | partial |
| `apps/web/lib/live-hub.test.ts` (new) | test | pure | `worker/src/http.test.ts` | role-match |
| `apps/web/lib/use-live.ts` (new) | hook | event-driven | `web/lib/use-status.ts` | role-match |
| `apps/web/lib/format.ts` + `format.test.ts` (mod) | utility | transform | itself | exact |
| `apps/web/app/page.tsx` (new, home) | page (RSC) | request-response | `app/coin/[mint]/page.tsx`, `app/launch/page.tsx` | role-match |
| `apps/web/app/api/live/route.ts` (new) | route | streaming (SSE) | `app/api/status/route.ts` (headers, dynamic) | partial |
| `apps/web/app/api/coins/route.ts` (new) | route | request-response | `app/api/launch/[id]/route.ts` | exact |
| `apps/web/app/api/coin/[mint]/trades/route.ts` (new) | route | request-response | `app/api/launch/[id]/route.ts` | exact |
| `apps/web/app/api/coin/[mint]/candles/route.ts` (new) | route | request-response | `app/api/launch/[id]/route.ts` | exact |
| `apps/web/app/coin/[mint]/page.tsx` (mod) | page (RSC) | request-response | itself | exact |
| `apps/web/app/coin/[mint]/opengraph-image.tsx` (new) | route (image) | file-I/O + fetch | coin page lookup + `lib/pinata.ts` | none (see below) |
| `apps/web/app/opengraph-image.tsx` (new) | route (image) | file-I/O | none | none |
| `apps/web/assets/og/*.ttf` + `OFL.txt` (new) | asset | n/a | none | none |
| `apps/web/public/art/hero-bond*.{jpg,mp4}` (new) | asset | n/a | `public/art/hero-bond-960.jpg` | exact |
| `apps/web/app/layout.tsx` (mod, `metadataBase`) | config | n/a | itself | exact |
| `apps/web/next.config.ts` (mod) | config | n/a | itself | exact |
| `apps/web/proxy.ts` (mod) | middleware | request-response | itself | exact |
| `apps/web/app/globals.css` (mod, flash keyframes) | config (style) | n/a | itself lines 55-110 | exact |
| `apps/web/components/chrome.tsx` (mod) | component | n/a | itself | exact |
| `apps/web/components/coin-identity.tsx` (mod) + `tag.tsx` (new) | component | n/a | itself (tag at line 32) | exact |
| `apps/web/components/token-stats.tsx` (new) | component | event-driven (live values) | `coin-identity.tsx` `Meta` | role-match |
| `apps/web/components/bond-glyph.tsx` (new) | component (SVG) | n/a | `chrome.tsx` `BrandMark`, `launch-stepper.tsx` | role-match |
| `apps/web/components/coin-card.tsx` (new) | component | n/a | `coin-identity.tsx` | role-match |
| `apps/web/components/ui-seg.tsx` (new) | component (primitive) | n/a | `ui-button.tsx` | role-match |
| `apps/web/components/home-trending.tsx`, `home-coins.tsx` (new) | component (client) | event-driven + request-response | `launch-buy.tsx` `useQuote` (debounced fetch) | role-match |
| `apps/web/components/token-chart.tsx` (new) | component (client) | event-driven | none (lightweight-charts) | none |
| `apps/web/components/token-bond.tsx`, `token-trades.tsx` (new) | component | event-driven | `coin-identity.tsx`, `tx-link.tsx`, `callout.tsx` | role-match |
| `apps/web/components/README.md` (mod) | docs | n/a | itself | exact |
| `scripts/devnet-trades.ts` (new) | utility (script) | batch | `scripts/devnet-launch.ts` | exact |
| `scripts/capture-tx.ts` (new) | utility (script) | file-I/O | `scripts/devnet-launch.ts` + fixture shape | role-match |
| `apps/web/e2e/home.e2e.ts`, `og.e2e.ts` (new); `coin.e2e.ts`, `responsive.e2e.ts` (extend) | test (e2e) | request-response | `e2e/coin.e2e.ts`, `e2e/responsive.e2e.ts` | exact |
| `apps/web/e2e/live.e2e.ts` (new) | test (e2e devnet) | event-driven | `e2e/launch-live.e2e.ts` devnet group (lines 234-245) | exact |

## Pattern Assignments

### `packages/core/src/events.ts` (decoder, transform) - extend in place

**Analog:** itself. Today the name map and the program check are pump-only; key both by program.

Name map and decoder table (lines 21-31):
```ts
const TAG = "e445a52e51cb9a1d"; // anchor EVENT_IX_TAG
const NAMES: Record<string, string> = Object.fromEntries(
  pumpIdl.events.map((e) => [Buffer.from(e.discriminator).toString("hex"), e.name]),
);
const DECODE: Record<string, (b: Buffer) => object> = {
  CreateEvent: (b) => PUMP_SDK.decodeCreateEventBc(b),
  TradeEvent: (b) => PUMP_SDK.decodeTradeEventBc(b),
  CompleteEvent: (b) => PUMP_SDK.decodeCompleteEventBc(b),
};
```
Emit-cpi authority check (lines 50-61), the line to generalize to a `PROGRAMS` list (pump + PumpSwap):
```ts
const [program, authority] = [PUMP_PROGRAM_ID.toBase58(), PUMP_EVENT_AUTHORITY_PDA.toBase58()];
...
if (keys[ix.programIdIndex] !== program || keys[ix.accounts[0] ?? -1] !== authority) continue;
```
Keep `normalize()` (BN/PublicKey to string) and the `if (tx.meta?.err) return []` guard. Add the `ix` index to each output row (needed for the `trades (signature, ix)` key). Also return the program so `trades.ts` can tell curve vs pool. The header comment's "ponytail: add a decoder when a phase needs one" is the ladder: add exactly `PostCompleteBuyEvent`, `BuyEvent`, `SellEvent`, `CreatePoolEvent`.

### `packages/core/src/pump.ts` (SDK load point)

**Analog:** itself, lines 12-32. Add new names to the existing destructures, never a second `require`:
```ts
export const { PUMP_SDK, ..., PUMP_EVENT_AUTHORITY_PDA, pumpIdl } = pump;
export const { PUMP_AMM_SDK, OnlinePumpAmmSdk, buyQuoteInput } = amm;
```
Add `pumpAmmJson`, `PUMP_AMM_EVENT_AUTHORITY_PDA` to the `amm` line. With D-22 (fixed 1B supply) `bondingCurveMarketCap` and `poolMarketCap` are not needed; see price.ts.

### `packages/core/src/trades.ts` (pure parser, transform)

**Analog:** `core/events.ts` `completeEvents` (lines 66-70) for filtering decoded events, and `worker/settle.ts` `launchFacts` (lines 66-83) for reading `postTokenBalances` and typing the fetched tx.
```ts
export function completeEvents(tx: EventTx): { mint: string; bondingCurve: string }[] {
  return innerEvents(tx)
    .filter((e) => e.name === "CompleteEvent")
    .map((e) => ({ mint: String(e.data.mint), bondingCurve: String(e.data.bondingCurve) }));
}
```
```ts
const held = tx.meta.postTokenBalances?.find((b) => b.mint === row.mint && b.owner === row.wallet);
```
Input type: extend `EventTx` with `slot`, `blockTime`, `transaction.signatures`, `meta.postTokenBalances` (the raw fixture shape has all of them: `response` keys `blockTime, meta, slot, transaction`). Output plain objects with string amounts (api.ts rule: "Every amount is a decimal string"). Use `quoteAmount`, never `solAmount` (RESEARCH anti-pattern).

### `packages/core/src/price.ts` (pure math, transform)

**Analog:** `core/math.ts` lines 1-27. Header states purity; bigint in, bigint out; guard rails throw.
```ts
// Pure bigint amount math. No SDK import, so every fee and slippage rule here is unit-testable offline.
export function applyBps(x: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`bps out of range: ${bps}`);
```
D-22 makes mcap = price x 1e9 tokens, so `progress`, `bondrAtBond`, `toSol`, `mcapSol` need only reserves: keep price.ts SDK-free like math.ts. Then it could be web-importable too (add to biome allowlist only if web needs it; default: do not).

### Core tests: `events.test.ts` (extend), `trades.test.ts`, `price.test.ts`

**Analog:** `core/events.test.ts` lines 1-18 (fixture loader) and `core/math.test.ts` lines 1-8 (table of exact values).
```ts
const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = (name: string): EventTx => load(name).response;
```
Fixture file shape (from `fixtures/forced-bond.json`): `{ capturedAt, mint?, net, response, slot, source }`. `scripts/capture-tx.ts` must write exactly that.

### `packages/core/src/schema.ts` (model) + migration 0003

**Analog:** `launches` table, lines 50-92. Constraints-first: checks and partial unique indexes in the third argument, `tstz()` helper, `bigint({ mode: "bigint" })`.
```ts
const tstz = () => timestamp({ withTimezone: true });
export const launches = pgTable(
  "launches",
  { id: text().primaryKey(), mint: text().notNull().references(() => vanityMints.pubkey), ... },
  () => [
    check("launches_exit", sql`exit in ('burn','sell')`),
    uniqueIndex("launches_landed_mint").on(sql`mint`).where(sql`state = 'landed'`),
  ],
);
```
`coins` and `trades` follow RESEARCH "Data Model". Composite PK: import `primaryKey` and `index` from `drizzle-orm/pg-core` (not imported yet). `casing: "snake_case"` is set in `core/db.ts` line 18, so camelCase TS names map to snake_case columns.
Migration: `pnpm --filter @bondr/core exec drizzle-kit generate --name indexer` (root `db:generate` hard-codes `--name init`, package.json line 22). Output lands next to `0002_consent_nonces.sql` and appends `_journal.json` idx 3. Constraint test goes in `core/src/db.test.ts` (pattern below).

### `packages/core/src/api.ts` (types only)

**Analog:** itself. Header rule (lines 1-2): "Types only, no imports and no runtime code, so web may import it ... Every amount is a decimal string." Add `CoinRow`, `TradeRow`, `Candle`, `LiveEvent` in the `LaunchView` style (lines 68-83): ISO strings for times, string for lamports and base units, `number` only for display doubles (`mcapSol`).

### `packages/core/src/net.ts` (`wsUrl`)

**Analog:** `rpcUrl`, lines 16-20, and `redact`, lines 10-14:
```ts
function rpcUrl(net: Net): string {
  if (net === "fork") return process.env.SPIKE_FORK_URL || "http://127.0.0.1:18899";
  if (!process.env.helius_api_key) throw new Error("helius_api_key missing in .env");
  return `https://devnet.helius-rpc.com/?api-key=${process.env.helius_api_key}`;
}
```
`wsUrl` = same with `wss://`; fork returns the Surfpool ws port. `redact()` already scrubs `api-key=` so websocket errors pass through it unchanged.

---

### `apps/worker/src/ingest.ts` (service, idempotent write + publish)

**Analog:** `worker/settle.ts` `landed()` lines 85-95 (one DB transaction, then follow-up) and `worker/launches.ts` lines 9-12, 25-38 (`Exec` type so tests run inside a rolled-back tx; guarded write returning rows).
```ts
const moved = await db().transaction(async (tx) => {
  const r = await advance(tx, row.id, row.state as LaunchState, "landed", { landedAt: new Date() });
  if (r) await markUsed(tx, row.mint);
  return r;
});
if (!moved) return;
const tx = await fetchTx(conn, row.signature ?? "");
```
```ts
export type Exec = Pick<Db, "select" | "update" | "insert" | "$count">;
const [row] = await exec.update(launches).set({ ...set, state: to, updatedAt: sql`now()` })
  .where(and(eq(launches.id, id), eq(launches.state, from))).returning();
```
Insert trades with `.onConflictDoNothing().returning()` and publish only the returned rows (D-04: no write, no event). `fetchTx` (core/send.ts lines 157-167) is the only fetcher: 20 x 500 ms retry, `maxSupportedTransactionVersion: 0`.

### `apps/worker/src/stream.ts` (service, websocket, event-driven)

**Analog (partial):** no websocket exists. Copy the background-loop and logging shape from `settle.ts` lines 129-143 and the boot hook from `main.ts` lines 39-45:
```ts
const logged = (id: string) => (e: unknown) =>
  console.error(`settle ${id} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
export function settleInBackground(conn: Connection, row: Row): void {
  void settleLaunch(conn, row).catch(logged(row.id));
}
```
```ts
server.on("listening", () => {
  void startRefill(env);
  resumeLaunches(conn).catch((e: unknown) =>
    console.error(`resume failed: ${redact(e instanceof Error ? e.message : String(e))}`),
  );
});
```
Use `delay` from `node:timers/promises` (settle.ts line 4) for backoff. Websocket body: RESEARCH "Worker websocket" code example. Never start in Vitest (Pitfall 1): export pure helpers (`isPumpInvoke`, `backoff`) and test those.

### `apps/worker/src/bondr-price.ts` (service, chain read + memory)

**Analog:** `worker/status.ts` lines 108-115 (venue with `AwaitingMigration`), lines 77-106 (`fetchBondingCurve(ctx.Q)` vs `poolState({ amm, mint: ctx.Q, quoteMint: NATIVE_MINT, user: PublicKey.default })`), and lines 176-188 (a value held in memory so open pages never wake Neon):
```ts
// The kill switch, held in memory so the 10 s status poll of every open page never wakes Neon (500 CU-h
// budget).
let switchOn: boolean | undefined;
```
Reuse `Ctx` (`{ conn, online, Q, priorityFee }`, status.ts line 24) rather than a new context type.

### `apps/worker/src/holders.ts` (+ `holders.test.ts`)

**Analog:** status.ts cache (lines 163-174) for "one in-flight promise, failure not cached", and `status.test.ts` for testing the pure part:
```ts
let cached: { at: number; live: Promise<Live> } | undefined;
function live(ctx: Ctx): Promise<Live> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.live;
  const entry = { at: Date.now(), live: readLive(ctx) };
  cached = entry;
  entry.live.catch(() => { if (cached === entry) cached = undefined; });
  return entry.live;
}
```
```ts
test("pauseReason: kill switch first, ...", () => {
  expect(pauseReason({ enabled: false, venue: "curve" })).toBe("kill_switch");
```
Split `countHolders(accounts, exclude)` (pure, tested) from `touch(mint)` (timer, `Map<mint, Timeout>`). Exclusions: curve PDA, pool PDA, incinerator.

### `apps/worker/src/events-route.ts` + `http.ts` (NDJSON stream)

**Analog (partial):** `worker/http.ts`. Auth must be the same `authorized()` (lines 40-44); today `handle` (lines 72-86) only answers JSON via `send()`, so add one raw branch before route lookup:
```ts
if (key === "GET /healthz") return send(res, 200, { ok: true });
if (!authorized(req.headers.authorization, token)) return send(res, 401, { error: "unauthorized" });
const route = routes[key];
```
Keep `Routes` for JSON; pass the stream handler separately (for example `start(routes, token, port, { "GET /events": events })`) so the JSON contract and its tests (`http.test.ts`) stay untouched. Clean up subscribers on `req.on("close")`. Test with the `http.test.ts` harness (lines 6-29: `start(..., token, 0)`, read the port, `fetch` with bearer).

### `apps/worker/src/settle.ts` (mod) and `main.ts` (mod)

`landed()` line 94: after `advance(... { facts })`, call `ingestLaunch(tx)` with the already-fetched `tx` (no second fetch). `main.ts` line 23 builds `ctx`; start the stream in the `listening` handler next to `resumeLaunches`. README "Routes" table gains `GET /events | bearer WORKER_TOKEN`.

---

### `apps/web/lib/coins.ts`, `apps/web/lib/trades.ts` (read models)

**Analog:** `web/lib/launches.ts` lines 1-6, 8-23, 41-59 (server-only, explicit column list, `toView` mapper, bigint to string, Date to ISO):
```ts
import "server-only";
import type { Exit, LaunchErrorCode, LaunchState, LaunchView, Links } from "@bondr/core/api";
import { and, eq, type SQL } from "drizzle-orm";
import { db, launches } from "./db";
...
function toView(r: Row): LaunchView {
  return { ...r, solIn: String(r.solIn), createdAt: r.createdAt.toISOString(), ... };
}
```
Windowed SQL (RESEARCH Pattern 6, 7) goes through drizzle's `sql` template (`db().execute(sql\`...\`)`), always parameterized. Per-process cache: copy `app/coin/[mint]/page.tsx` lines 16-30 (Map, ttl, clear at 1000, `ponytail:` comment) with a 10 s ttl:
```ts
// ponytail: per-process map cleared at 1000 entries; move to a shared cache if web runs more than one instance.
const seen = new Map<string, { at: number; ttl: number; v: LaunchView | null }>();
async function read(mint: string): Promise<LaunchView | null> {
  const hit = seen.get(mint);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
```
Mint validation: `BASE58_KEY` from `lib/guard.ts` line 46 (the coin page duplicates it as `MINT`; reuse guard's).

### `apps/web/lib/coins.test.ts`, `lib/trades.test.ts` (DB integration)

**Analog:** `packages/core/src/db.test.ts` lines 8-10, 45-62:
```ts
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
...
describe.skipIf(!process.env.DATABASE_URL)("database constraints", { timeout: 30_000 }, () => {
  afterAll(async () => { ...delete test rows...; await close(); }, 30_000);
```
Test rows use `test-` prefixed random ids and negative `vanity_mints.idx` (line 58-61) so they never collide with the grinder. `lib/launches.ts` imports `server-only`; check that Vitest can load it (no existing web test imports a `server-only` file; if it throws, keep the SQL builders in a file without that import, as `guard.ts` does: "No Next-only imports, so a unit test can load this file").

### `apps/web/lib/live-hub.ts` (server-only fan-out)

**Analog (partial):** `web/lib/worker.ts` lines 1-3, 15-25 for env, token and server-only:
```ts
// The only web file that talks to the worker or reads WORKER_TOKEN. server-only fails the build ...
import "server-only";
const base = process.env.WORKER_URL;
const token = process.env.WORKER_TOKEN;
if (!base || !token) return unavailable;
const res = await fetch(new URL(path, base), { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, ... });
```
Do NOT reuse `call()` (its `AbortSignal.timeout(15_000)` kills the stream; RESEARCH anti-pattern). Update the worker.ts header comment, since it will no longer be "the only web file" reading `WORKER_TOKEN`. Singleton on `globalThis` (Pitfall 11). Keep the NDJSON line splitter and ring as pure exports so `live-hub.test.ts` can test them without a network.

### `apps/web/lib/use-live.ts` (client hook)

**Analog:** `web/lib/use-status.ts` lines 1-3, 13-35 (`"use client"`, `mounted` flag, cleanup, `reload` ref):
```ts
"use client";
useEffect(() => {
  let mounted = true;
  ...
  return () => { mounted = false; clearInterval(timer); };
}, []);
```
Replace the interval with one `EventSource("/api/live" + (mint ? "?mint=" + mint : ""))`, `addEventListener` per type, `close()` in cleanup. No polling (D-04).

### `apps/web/lib/format.ts` (+ test)

**Analog:** itself. Add `mcapSol(n)` (UI-SPEC tiers), `tradeSol`, `signedPct` (U+2212), `curvePct`, `relTime` next to `compact`/`short`/`age` (lines 23-41), each with a one-line doc comment. Extend `format.test.ts` in its style (lines 33-39: fixed `now`, exact strings).

### `apps/web/app/page.tsx` (home, RSC)

**Analog:** `app/coin/[mint]/page.tsx` (server read, `dynamic`, layout wrapper) and `app/launch/page.tsx` (static `metadata`, display heading):
```tsx
export const dynamic = "force-dynamic";
...
<div className="overflow-x-clip">
  <div className="mx-auto grid w-full max-w-[1440px] gap-4 px-(--gutter) pb-12">
```
```tsx
export const metadata: Metadata = { title: "Launch a coin | BONDR" };
<h1 className="display text-[clamp(2.5rem,6vw,4.5rem)]">Launch a coin</h1>
```
`searchParams` (`sort`, `q`) is a Promise in Next 16, same as `params` here (line 35). Paused banner: one `workerGet<Status>("/status")` at render (`app/api/status/route.ts` line 8), no polling. Remove the `/` redirect in `next.config.ts` lines 69-72 in the same change.

### `apps/web/app/api/coins/route.ts`, `api/coin/[mint]/trades/route.ts`, `api/coin/[mint]/candles/route.ts`

**Analog:** `app/api/launch/[id]/route.ts` (whole file, 21 lines): validate the param by regex before any query, `NO_STORE`, try/catch logging only the driver code, 503 on DB failure:
```ts
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  try { ... } catch (e) {
    console.error("launch read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
```
Validate `interval` against an enum, keyset cursor as two integers, `q` trimmed and capped at 64. Rate limits come from `proxy.ts`, not per route.

### `apps/web/app/api/live/route.ts` (SSE)

**Analog (partial):** `app/api/status/route.ts` for `dynamic` and header style; body from RESEARCH "SSE route" code example (`ReadableStream`, `cancel()` unsubscribes, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`). Connect limit via `rateLimited(req, "live", 30, 60_000)` (`lib/guard.ts` lines 80-97) inside the route, or a separate `proxy.ts` scope.

### `apps/web/app/coin/[mint]/page.tsx` (mod)

**Analog:** itself. Keep `landed = cache(...)` (line 33) shared by `generateMetadata` and the page; extend `generateMetadata` (lines 37-40) with `description` and `twitter: { card: "summary_large_image" }`. Replace the Phase 2 note (lines 65-67) with the UI-SPEC note copy. Add coin row + first 50 trades read through `lib/coins.ts` / `lib/trades.ts` with the same cache pattern. The chart loads through `next/dynamic(..., { ssr: false })` from a client wrapper.

### `apps/web/proxy.ts` (mod)

**Analog:** itself (10 lines):
```ts
export function proxy(req: Request): Response | undefined {
  if (req.method !== "GET") return undefined;
  return rateLimited(req, "read", 300, 60_000) ?? undefined;
}
export const config = { matcher: ["/coin/:mint", "/api/launch/:id", "/api/status"] };
```
Add `"/"`, `"/api/coins"`, `"/api/coin/:path*"`, `"/api/live"`; give `/api/live` its own scope (branch on `new URL(req.url).pathname`). Update the header comment's per-minute arithmetic.

### `apps/web/next.config.ts` and `app/layout.tsx` (mod)

- `WEB_ENV` (lines 9-19): add `"SITE_URL"`; the comment says "A plan that needs a new web variable adds it here". Also add to `.env.example`.
- `redirects()` (lines 69-72): delete (its `ponytail:` comment names this phase).
- CSP (lines 34-44): unchanged; SSE, chart and video are same-origin. `media-src` falls back to `default-src 'self'`.
- Lines 59-61 comment on `remotePatterns`: UI-SPEC keeps plain `<img>`, so update the comment, add nothing.
- `layout.tsx` line 29: `metadata = { title: "BONDR" }` gains `metadataBase: new URL(process.env.SITE_URL ...)` plus the home description. Fonts (lines 10-27) already expose `--font-martian` for the chart's `fontFamily`.

### `apps/web/app/globals.css` (mod)

**Analog:** the `@theme` animation tokens, lines 58-107: declare `--animate-flash-up`, `--animate-flash-down`, `--animate-glow` with their `@keyframes` inside the same block, in the commented style:
```css
/* the live dot on the "On curve" tag */
--animate-live: live 1.6s var(--ease-out) infinite;
@keyframes live { from { ... } to { ... } }
```
The global reduced-motion override is at line 180; the flash is also skipped in JS (UI-SPEC).

### Components

**`chrome.tsx` (mod):** Header right cluster (lines 60-62) gets a quiet `Link` to `/launch` before `<WalletButton />`, using `buttonVariants({ variant: "quiet" })`. Footer (lines 78-86) gets the TradingView credit, copying the existing external link exactly:
```tsx
<a href={...} target="_blank" rel="noopener" className={link}>
  Program: pump <span className="num">{short(PUMP_PROGRAM)}</span>
  <span className="sr-only"> (opens Solscan)</span>
</a>
```

**`coin-identity.tsx` (mod) + `tag.tsx` (new):** promote the inline tag at line 32 into `Tag` with variants (mint, leaf, warn), `cva` as in `ui-button.tsx` lines 7-27:
```tsx
<span className="inline-flex items-center gap-1.5 rounded-full border border-mint/40 bg-mint-wash px-2 py-1 text-xs font-semibold tracking-[0.05em] text-mint uppercase">
  <span aria-hidden="true" className="size-[7px] animate-live rounded-full bg-current" />
  On curve
</span>
```
`CoinIdentity` takes `v: LaunchView`; add an optional venue prop rather than changing `LaunchView`. Image URL helper `imageUrl(cid)` (lines 11-14, CID regex + `ipfsUri`) is what `coin-card.tsx` and the OG card should reuse: move it to `lib/pinata.ts` instead of copying it.

**`coin-card.tsx`:** image handling from `coin-identity.tsx` lines 55-71 (bleed + avatar), but UI-SPEC now asks for `<img alt="" loading="lazy" decoding="async" onError>` (makes it a client component, or pass a tiny client `CoinImg`). Name/symbol markup from line 73-75.

**`bond-glyph.tsx`:** inline SVG with CSS variables, as `chrome.tsx` `BrandMark` lines 11-24 (`viewBox`, `aria-hidden`, `var(--leaf)` strokes). Here `role="img"` + `aria-label` instead of `aria-hidden`. Per-instance gradient id via `useId()`.

**`ui-seg.tsx`:** primitive in the `ui-button.tsx` style (lines 1-4 imports, `cn` from `@/lib/cn`, hand-port comment). Buttons are native `<button aria-pressed>`.

**`home-coins.tsx`, `home-trending.tsx` (client):** debounced, abortable fetch from `launch-buy.tsx` `useQuote` lines 50-76:
```ts
useEffect(() => {
  const abort = new AbortController();
  const timer = setTimeout(() => {
    fetch("/api/quote", { ..., signal: abort.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : Promise.reject(r.status)))
      .then((quote) => setState({ quote, loading: false }),
            () => abort.signal.aborted || setState({ quote: null, loading: false }));
  }, DEBOUNCE_MS);
  return () => { clearTimeout(timer); abort.abort(); };
}, [solIn, wallet]);
```
Use 300 ms (UI-SPEC). Error state: `Callout variant="error"` (`callout.tsx` lines 25-38) + quiet `Button`.

**`token-trades.tsx`:** Tx cell from `tx-link.tsx` (whole file); UI-SPEC wants icon-only with sr-only "Transaction {sigShort} (opens Solscan)", so add an icon-only variant or a `label` prop rather than a second link component. `net` comes from `process.env.SOLANA_NET` as in coin page line 53.

**`token-bond.tsx`, `token-stats.tsx`:** server-rendered first values, live values via `use-live`. Mono numbers use the existing `num` utility class (`globals.css` `@utility num`, line 120).

**`token-chart.tsx`:** no analog; RESEARCH "lightweight-charts 5.2.1" code example plus UI-SPEC options table. Install: `pnpm --filter @bondr/web add lightweight-charts@5.2.1 --save-exact` (web package.json pins exact versions, lines 11-24).

**`components/README.md`:** one line per new file, in the existing `- \`file.tsx\`: what it holds.` form.

---

### `scripts/devnet-trades.ts`, `scripts/capture-tx.ts`

**Analog:** `scripts/devnet-launch.ts` lines 1-36: header comment listing every flag and the run command, `parseArgs` from `node:util`, `connect`/`redact` from core/net, `loadEnv`/`ops` imported from `apps/worker/src/env.ts`, `derive(seed, "sim", net, "dev")` for the sim wallet, `OPS_FLOOR_SOL` and a per-run budget:
```ts
// Run: VANITY_THREADS=0 node --env-file=.env scripts/devnet-launch.ts --prepare-only
import { parseArgs } from "node:util";
import { connect, redact } from "@bondr/core/net";
import { fetchTx, messageSize, sendTx } from "@bondr/core/send";
import { loadEnv, ops } from "../apps/worker/src/env.ts";
export const OPS_FLOOR_SOL = 2.4;
```
Trades go through `core/trade.ts` (`buyExactIn`, `sellExactIn`, `poolBuy`, `poolSell`) and `sendTx`. `capture-tx.ts`: `fetchTx(conn, sig)` then write `{ capturedAt, net, slot, source, mint?, response }` to `packages/core/src/fixtures/` (shape of `forced-bond.json`).

### e2e: `home.e2e.ts`, `og.e2e.ts`, `coin.e2e.ts` (extend), `responsive.e2e.ts` (extend), `live.e2e.ts`

**Analog:** `e2e/coin.e2e.ts` lines 8-58 for DB fixtures: `postgres(url, { max: 1, idle_timeout: 5 })` (not `end()`), `test.skip(!sql, ...)`, fake base58 mint, negative `vanity_mints.idx`, cleanup in `afterAll`:
```ts
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");
const fakeMint = () => Array.from({ length: 44 }, () => B58[randomInt(58)]).join("");
```
Fixture coins insert `vanity_mints` -> `launches` -> `coins` -> `trades` in FK order and delete in reverse.
Screenshots and axe: `responsive.e2e.ts` lines 110-138 (per-width loop, no horizontal scroll check naming culprits, `AxeBuilder`, full-page shot). Add a Phase 3 `SHOTS` dir (`.planning/phases/03-indexer-lists-and-token-page/screenshots/`) and `test.use({ reducedMotion: "reduce" })` (line 23).
Devnet live: `launch-live.e2e.ts` lines 234-245:
```ts
test.describe("devnet", () => {
  test.skip(process.env.E2E_DEVNET !== "1", "one real launch: set E2E_DEVNET=1");
  test.describe.configure({ timeout: 180_000 });
  test.beforeAll(() => {
    execFileSync("node", ["--env-file=.env", "scripts/devnet-launch.ts", "--fund"], { cwd: root, stdio: "inherit", ... });
  });
```
`og.e2e.ts` uses `page.request.get(...)` like `coin.ts` `liveStatus` (lines 20-24) and asserts content-type, size header and `cache-control`.

## Shared Patterns

### Secret-safe logging
**Source:** `packages/core/src/net.ts` lines 10-14; used in `worker/http.ts` line 83, `main.ts` line 43, `settle.ts` line 139.
**Apply to:** stream.ts, ingest.ts, holders.ts, bondr-price.ts, events-route.ts, scripts.
```ts
console.error(`${key} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
```

### Worker auth
**Source:** `worker/http.ts` `authorized` lines 40-44 (timingSafeEqual on `Bearer ${token}`).
**Apply to:** `GET /events`. Web side reads `WORKER_URL`/`WORKER_TOKEN` only in `server-only` files (`lib/worker.ts`, `lib/live-hub.ts`).

### Server-only boundary in web
**Source:** `web/lib/db.ts` (`import "server-only"; export * from "@bondr/core/db"`), `lib/launches.ts` line 3, `lib/worker.ts` line 3.
**Apply to:** `lib/coins.ts`, `lib/trades.ts`, `lib/live-hub.ts`. Client components get data as props or through `/api/*`.

### Input validation at the route edge
**Source:** `lib/guard.ts` `BASE58_KEY` line 46; `api/launch/[id]/route.ts` regex-then-404 (line 12).
**Apply to:** every new route and the OG image (mint), plus interval enum, cursor ints, `q` length cap and LIKE escape.

### Rate limiting
**Source:** `lib/guard.ts` `rateLimited` lines 80-97 and `proxy.ts` matcher.
**Apply to:** `/`, `/api/coins`, `/api/coin/:path*`, `/api/live` (own scope).

### Neon budget comments and caches
**Source:** coin page lines 16-21 and status.ts lines 176-178 explain each cache in terms of the 500 CU-h budget, with a `ponytail:` ceiling.
**Apply to:** list/candle caches (10 s), BONDR price in memory, holders throttle. Every deliberate shortcut gets a `ponytail:` line naming the ceiling (AGENTS.md section 5).

### Constraint tests
**Source:** `core/src/db.test.ts` `pgCode()` lines 33-41 (SQLSTATE 23514 check, 23505 unique).
**Apply to:** new `coins`/`trades` checks (venue, side, burn implies null sol, PK idempotency).

### Pure core plus thin I/O shell
**Source:** `worker/settle.ts` (`nextState`, `resumeAction` pure and tested; `watch` does I/O), `status.ts` (`pauseReason`, `networkFee` pure).
**Apply to:** stream (backoff, prefilter), holders (count), hub (NDJSON split, ring, replay), trades parser.

## No Analog Found

| File | Role | Data Flow | Reason / use instead |
|---|---|---|---|
| `apps/worker/src/stream.ts` (websocket part) | service | event-driven | No websocket in repo; RESEARCH "Worker websocket" example, Node 24 global `WebSocket` |
| `apps/web/app/api/live/route.ts` (stream body) | route | streaming | No streaming route; RESEARCH "SSE route" example + Pattern 5 |
| `apps/web/lib/live-hub.ts` (fan-out, ring) | service | pub-sub | No in-process pub-sub; RESEARCH Pattern 5 |
| `apps/web/components/token-chart.tsx` | component | event-driven | New library; RESEARCH lightweight-charts example + UI-SPEC options table |
| `apps/web/app/coin/[mint]/opengraph-image.tsx` | image route | file-I/O + fetch | No `next/og` use yet; RESEARCH Pattern 10. Reuse coin page lookup, `ipfsUri`/`gatewayHost` from `lib/pinata.ts` lines 9-15, CID regex from `coin-identity.tsx` line 12 |
| `apps/web/app/opengraph-image.tsx` | image route | file-I/O | Same; reads `public/art/hero-bond-960.jpg` |
| `apps/web/assets/og/*.ttf`, `OFL.txt` | asset | n/a | One-time `uvx fonttools varLib.instancer` output (RESEARCH Supporting) |

## Metadata

**Analog search scope:** `packages/core/src`, `packages/core/migrations`, `apps/worker/src`, `apps/web/{app,lib,components,e2e}`, `scripts/`, `biome.json`, root `package.json`
**Files scanned:** about 60 read or grepped (all under 300 lines; no large-file strategy needed)
**Pattern extraction date:** 2026-10-23
