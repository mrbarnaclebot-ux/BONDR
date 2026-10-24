# Phase 4: Trading - Pattern Map

**Mapped:** 2026-10-24
**Files analyzed:** 30 (new and modified)
**Analogs found:** 28 / 30

Most of this phase reuses existing code. The analogs are the Phase 2 launch path (worker `prepare.ts` and `submit.ts`, core `cosign.ts` and `send.ts`, web `launch-run.ts` and the `api/launch/*` routes) and the Phase 3 token page (`coin-live.tsx`, `page.tsx`). Only one piece of new math has no analog: the masked curve hop in `quote.ts`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/quote.ts` (new) | utility (pure math) | transform | `apps/worker/src/status.ts` `childFees`/`bondrLegBps` (fee reads) + RESEARCH Pattern 1 | partial (math is new) |
| `packages/core/src/quote.test.ts` (new) | test | transform | `packages/core/src/cosign.test.ts` (fixture-driven) | role-match |
| `packages/core/src/trade-error.ts` (new, moves `simError`) | utility | transform | `apps/worker/src/build.ts` lines 105-118 `simError` | exact (move and extend) |
| `packages/core/src/trade-error.test.ts` (new) | test | transform | `apps/worker/src/build.ts` simError tests | exact |
| `packages/core/src/api.ts` (mod) | model (types) | — | itself: `Quote`, `PrepareResult`, `SubmitResult`, `LaunchErrorCode` | exact |
| `packages/core/src/send.ts` (mod: export `settle`) | service | request-response | itself, lines 201-211 | exact |
| `packages/core/src/route.ts` (reuse, maybe return `hops`) | service | request-response | itself | exact |
| `packages/core/src/trade.ts` or new core file for `tokenDelta`/`lamportDelta` | utility | transform | `scripts/spike/stages/multihop.ts` lines 22-33 | exact (move) |
| `apps/worker/src/trade-state.ts` (new) | service (cache) | request-response | `apps/worker/src/status.ts` lines 163-174 `live()` | exact |
| `apps/worker/src/trade-quote.ts` (new) | controller | request-response | `apps/worker/src/status.ts` lines 211-243 `parseQuote`/`quote` | exact |
| `apps/worker/src/trade-prepare.ts` (new) | controller | request-response | `apps/worker/src/prepare.ts` (`walletOf`, `signBy`, `finish`) | exact |
| `apps/worker/src/trade-submit.ts` (new) | controller | request-response | `apps/worker/src/submit.ts` | exact |
| `apps/worker/src/trade-store.ts` (new) | store (memory) | CRUD | `apps/web/lib/guard.ts` lines 48-65 (bounded Map with sweep) | role-match |
| `apps/worker/src/trade-*.test.ts` (new) | test | — | `apps/worker/src/submit.test.ts`, `prepare.test.ts` | exact |
| `apps/worker/src/http.ts` (mod: STATUS codes) | config | — | itself, lines 22-34 | exact |
| `apps/worker/src/main.ts` (mod: routes) | config | — | itself, lines 49-64 | exact |
| `apps/web/app/api/trade/quote/route.ts` (new) | route | request-response | `apps/web/app/api/quote/route.ts` | exact |
| `apps/web/app/api/trade/balance/route.ts` (new) | route | request-response | `apps/web/app/api/quote/route.ts` + session from `launch/prepare` | exact |
| `apps/web/app/api/trade/prepare/route.ts` (new) | route | request-response | `apps/web/app/api/launch/prepare/route.ts` | exact |
| `apps/web/app/api/trade/submit/route.ts` (new) | route | request-response | `apps/web/app/api/launch/submit/route.ts` | exact |
| `apps/web/app/api/trade/[id]/route.ts` (new, GET to worker `POST /trade/view`) | route | request-response (poll) | `apps/web/app/api/launch/[id]/route.ts` | exact (source differs: worker, not DB) |
| `apps/web/lib/trade-run.ts` (new) | service (browser) | request-response | `apps/web/lib/launch-run.ts` | exact |
| `apps/web/lib/use-trade.ts` (new) | hook | event-driven (debounce, 2 s loop) | `apps/web/components/launch-buy.tsx` lines 49-77 `useQuote` + `lib/use-status.ts` | exact |
| `apps/web/components/trade-panel.tsx` (new) | component | — | `apps/web/components/launch-buy.tsx` `LaunchBuy` (form, button states) | role-match |
| `apps/web/components/trade-amount.tsx` (new) | component | — | `apps/web/components/launch-buy.tsx` `BuyField`, `Presets` | exact |
| `apps/web/components/trade-quote.tsx` (new) | component | — | `apps/web/components/token-bond.tsx` (dl rows, `Num`) | role-match |
| `apps/web/components/trade-sheet.tsx` (new, bar + dialog) | component | — | `apps/web/components/consent-dialog.tsx` lines 16-88 | exact |
| `apps/web/components/ui-seg.tsx` (mod: `tone`) | component | — | itself, line 24 | exact |
| `apps/web/app/coin/[mint]/page.tsx` (mod: grid) | route (page) | — | itself, lines 66-85 `Panels` | exact |
| `apps/web/e2e/trade-stubs.ts`, `trade.e2e.ts`, `responsive-trade.e2e.ts` (new) | test | — | `apps/web/e2e/launch-stubs.ts`, `launch-live.e2e.ts`, `responsive.e2e.ts` + `shoot.ts gate` | exact |
| `scripts/spike/nets/fork.ts` (mod: `bonded.`/`pooled.` multihop rows) | test (spike) | — | `scripts/spike/stages/multihop.ts` | exact |

---

## Pattern Assignments

### `packages/core/src/quote.ts` (utility, transform)

**Analog for fee reads:** `apps/worker/src/status.ts` lines 77-106 (`bondrLegBps`). This is the only place that already calls `computeFeesBps` (pump) and `computeAmmFeesBps` (pump-swap) with live state:
```typescript
const f = computeFeesBps({
  global: g,
  feeConfig: fc,
  mintSupply: c.tokenTotalSupply,
  virtualQuoteReserves: c.virtualQuoteReserves,
  virtualTokenReserves: c.virtualTokenReserves,
  quoteMint: c.quoteMint,
  creatorFeeBps: c.creatorFeeBps,
});
...
const f = computeAmmFeesBps({
  globalConfig: s.globalConfig, feeConfig: s.feeConfig, creator: s.pool.creator,
  baseMintSupply: new BN(s.baseMintAccount.supply.toString()), baseMint: s.pool.baseMint,
  baseReserve: s.poolBaseAmount, quoteReserve: s.poolQuoteAmount, quoteMint: s.pool.quoteMint,
  isMayhemMode: s.pool.isMayhemMode, creatorFeeBps: s.pool.creatorFeeBps,
});
```
Use `mintSupply: SUPPLY` from `core/price.ts` (RESEARCH: `ONE_BILLION_SUPPLY` is undefined at runtime). Import SDK symbols only through `./pump.ts` (`import { BN, ... } from "./pump.ts"`, as `route.ts` line 5 does); never import the nested pump-swap 1.20.0. The masked `curveHop` and the `multiHopSwapQuote` composition come straight from RESEARCH Pattern 1. Apply the floor with `applyBps` from `./math.ts`, like `route.ts` line 21:
```typescript
const minAmountOut = new BN(applyBps(BigInt(expectedOut.toString()), 10_000 - o.slippageBps).toString());
```
**File header style** (`route.ts` lines 1-2): two lines saying why the file exists and what the SDK owns compared with BONDR.

**Worker-only:** it imports `pump.ts`, so web must never import it. Only `api.ts` types cross to web. `pnpm check:bundle` enforces this.

---

### `packages/core/src/trade-error.ts` (utility, transform; moved from worker `build.ts`)

**Analog:** `apps/worker/src/build.ts` lines 105-118:
```typescript
function customCode(err: unknown): number | undefined {
  const ie = (err as { InstructionError?: [number, { Custom?: number }] } | null)?.InstructionError;
  return typeof ie?.[1]?.Custom === "number" ? ie[1].Custom : undefined;
}

// Pure, so the mapping is unit tested. Token program custom 1 is its InsufficientFunds.
export function simError(err: unknown, logs: readonly string[] | null): ApiError {
  const code = customCode(err);
  if (code === AWAITING_CODE) return { error: "paused", paused: "awaiting_migration" };
  const text = `${JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  if (/insufficient (lamports|funds)|InsufficientFunds|AccountNotFound/i.test(text) || code === 1)
    return { error: "insufficient_balance" };
  return { error: "build_failed" };
}
```
Add 6004 mapped to `slippage` and 6005 mapped to the paused code. Also accept the SDK's text-only error from `simulateMultiHopSwap` (run the same regex over the message). Leave `build.ts` re-exporting it or importing from core, so launch tests stay green. `send.ts` lines 124-136 has a second `customCode` and the `fromLogs` hex and "Error Number" parser; reuse `fromLogs` for preflight and on-chain codes rather than writing a third parser.

---

### `packages/core/src/api.ts` (types, modified)

**Analog:** itself. Keep the header rule, line 1: "Types only, no imports and no runtime code, so web may import it". Amounts are decimal strings (line 2). Mirror these existing shapes:
```typescript
export type Quote = { tokensOut: string; solBackEstimate: string; balance?: string };
export type PrepareResult = { launchId: string; tx: string; mint: string; bytes: number; signBy: number; preview: {...} };
export type SubmitResult = { state: LaunchState; signature?: string };
export type ApiError = { error: LaunchErrorCode; paused?: PauseReason };
```
Add `TradeQuote`, `TradePrepare` (`{ tradeId, tx, signBy, expectedOut, minAmountOut }`), `TradeView` (`{ state, signature?, amountOut?, code? }`) and `TradeErrorCode`. You can extend `LaunchErrorCode` with `slippage | message_changed | onchain`, or widen `ApiError.error` to a union. `apps/worker/src/http.ts` `STATUS` is typed `Partial<Record<LaunchErrorCode, number>>`, so the new codes must be in that type.

---

### `apps/worker/src/trade-state.ts` (cache, request-response)

**Analog:** `apps/worker/src/status.ts` lines 163-174. Copy it as is, keyed by mint:
```typescript
let cached: { at: number; live: Promise<Live> } | undefined;

// One shared promise per 5 s window, so concurrent polls cost one read; a failed read is not cached.
function live(ctx: Ctx): Promise<Live> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.live;
  const entry = { at: Date.now(), live: readLive(ctx) };
  cached = entry;
  entry.live.catch(() => {
    if (cached === entry) cached = undefined;
  });
  return entry.live;
}
```
The `Ctx` type comes from `status.ts` line 24 (`{ conn, online, Q, priorityFee }`). Bound the map by `knownCoins` (`apps/worker/src/ingest.ts` line 21, `export const knownCoins = new Map<string, KnownCoin>()`). The venue rule (curve, pool or awaiting) mirrors `status.ts` `venueOf` lines 108-115 and the `AwaitingMigration` catch.

---

### `apps/worker/src/trade-quote.ts` (controller, request-response)

**Analog:** `apps/worker/src/status.ts` lines 211-243:
```typescript
function parseQuote(body: unknown): { solIn: bigint; wallet?: PublicKey } {
  const b = (body ?? {}) as { solIn?: unknown; wallet?: unknown };
  const bad = new Fail(400, { error: "invalid_input" });
  if (typeof b.solIn !== "string" || !/^\d{1,20}$/.test(b.solIn)) throw bad;
  const solIn = BigInt(b.solIn);
  if (solIn < 1n || solIn > MAX_SOL_IN) throw bad;
  ...
}
export async function quote(ctx: Ctx, body: unknown): Promise<Quote> {
  ...
  const q = await launchQuote(ctx.online, ctx.Q, new BN(solIn.toString())).catch((e: unknown) => {
    if (e instanceof AwaitingMigration)
      throw new Fail(409, { error: "paused", paused: "awaiting_migration" });
    throw e;
  });
```
Reuse `MAX_SOL_IN` (status.ts line 29). Use the side, amount, slippage and mint parsing from RESEARCH "Request parsing at the worker". The mint must be in `knownCoins` (404 otherwise), and the BONDR mint is refused. Balance: one `getMultipleAccountsInfo([wallet, coinAta])`. Derive the ATA with `getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID)`, as `cosign.ts` line 47 does.

---

### `apps/worker/src/trade-prepare.ts` (controller, request-response)

**Analog:** `apps/worker/src/prepare.ts`.

**Wallet parsing** (lines 57-64): copy, or export `walletOf` and import it.
```typescript
function walletOf(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 44) return null;
  try { return new PublicKey(raw).toBase58() === raw ? raw : null; } catch { return null; }
}
```
**signBy** (lines 121-123): import it, do not copy it.
```typescript
export const signBy = (lastValidBlockHeight: number, height: number): number =>
  Math.min(60, Math.max(0, Math.floor((lastValidBlockHeight - height) * 0.4)));
```
**Final message, store and return** (lines 223-247, `finish`). Store the exact `msg.serialize()` bytes and return the wire built from the same `msg` (Pitfall 3):
```typescript
const bh = await ctx.conn.getLatestBlockhash();
...
const stored = { message: Buffer.from(f.msg.serialize()), blockhash: bh.blockhash, lastValidBlockHeight };
const wire = new VersionedTransaction(f.msg).serialize();
const height = await ctx.conn.getBlockHeight();
return { launchId: id, tx: Buffer.from(wire).toString("base64"), ..., signBy: signBy(bh.lastValidBlockHeight, height) };
```
**Simulation with error mapping** (`build.ts` lines 121-144, `simulateLaunch`): `conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: ... })`. On `err !== null`, map through `simError` and `throw fail(out)`. Read `sim.value.unitsConsumed` for the CU limit.

**Compute budget and checks** (`core/send.ts`): use `budget(cuLimit, microLamports)` (line 57), `checkMessage(msg)` (line 63), and `messageSize(msg) <= PACKET_LIMIT` (lines 21, 86). `sendTx` lines 270-276 shows the order:
```typescript
const msg = compile(o.payer.publicKey, o.ixs, o.tables ?? [], bh.blockhash);
const bytes = messageSize(msg);
const refused = checkMessage(msg);
if (refused) return result("failed", { bytes, err: `refused to sign: ${refused}` });
if (bytes > PACKET_LIMIT) ...
```
`compile` is private in `send.ts`. Either export it or inline `new TransactionMessage({ payerKey, recentBlockhash, instructions }).compileToV0Message()`. There is no lookup table for trades.

**Route:** `routeBuy`/`routeSell` from `core/route.ts` (`RouteOpts`: `online`, `path` `[SOL, Q, C]` or `[C, Q, SOL]`, `user`, `amountIn: BN`, `slippageBps`).

**Priority fee:** `ctx.priorityFee` comes from `env.ts` line 54 (`PRIORITY_FEE_MICROLAMPORTS`, default 1000) and `ctx.env.net` from `launchNet`. Do NOT reuse the launch `prepare()` single-flight queue (lines 283-290); RESEARCH lists it under anti-patterns.

**Id:** `newId` from `apps/worker/src/launches.ts` line 14 (`randomBytes(16).toString("hex")`).

---

### `apps/worker/src/trade-store.ts` (memory store, CRUD)

**Analog:** the bounded Map with an expiry sweep in `apps/web/lib/guard.ts` lines 48-65:
```typescript
// ponytail: per-instance memory while web runs one replica; move to a Postgres counter if web scales out.
const hits = new Map<string, { end: number; n: number }>();
const MAX_KEYS = 10_000;
...
if (hits.size >= MAX_KEYS) for (const [k, v] of hits) if (now >= v.end) hits.delete(k);
if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string);
```
Sweep on insert with a 120 s TTL, and add a `ponytail:` single-replica comment (D-07). The entry holds `{ id, wallet, mint, side, message: Buffer, blockhash, lastValidBlockHeight, state, signature?, amountOut?, code? }`. The state machine mirrors `LaunchState` (`api.ts` line 63) without Postgres.

---

### `apps/worker/src/trade-submit.ts` (controller, request-response)

**Analog:** `apps/worker/src/submit.ts`.

**Parse** (lines 16-26): copy it with `tradeId` in place of `launchId`.
```typescript
const SEND_PACE_MS = 1100;
const ID = /^[0-9a-f]{32}$/;
const MAX_WIRE = 1232;
function parse(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const ok = typeof b.launchId === "string" && ID.test(b.launchId) && typeof b.signed === "string";
  const wire = ok ? Buffer.from(b.signed as string, "base64") : Buffer.alloc(0);
  if (!wire.length || wire.length > MAX_WIRE) throw fail({ error: "invalid_input" });
  ...
}
```
**Gate order** (lines 81-95): if the entry is not found, throw `not_found`. If the state is not `prepared`, return the current view (a repeat submit is only a read). If the block height is past `lastValidBlockHeight`, answer `expired`; then verify the bytes, then send:
```typescript
if (row.state !== "prepared") return current(row);
...
if ((await ctx.conn.getBlockHeight()) > Number(row.lastValidBlockHeight))
  return refuse(row, { error: "expired" });
```
**Byte check:** the trade has one signer, so call `sameMessage(stored, wire, 1)` and `signatureOk(stored, slot(wire, 0), wallet)` from `core/cosign.ts` (lines 28-36), the same checks `cosign()` runs at lines 79-80 with `2`.

**Send** (lines 60-79): call `signatureOf(wire)` and then `broadcast(...)`. If `r?.status === "failed"`, the transaction never went out, so mark it failed. Otherwise mark it `sent` and settle it in the background:
```typescript
const r = await broadcast(ctx.conn, wire, { ...base, paceMs: SEND_PACE_MS });
if (r?.status === "failed") { ...; return { state: "failed", signature }; }
// Accepted, or a throw after which it may have gone out: both are settled by status, never resent (D-16).
settleInBackground(ctx.conn, sent ?? signed);
```
**Background settle:** `apps/worker/src/settle.ts` lines 142-147 shows the logged `void` pattern:
```typescript
const logged = (id: string) => (e: unknown) =>
  console.error(`settle ${id} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
export function settleInBackground(conn: Connection, row: Row): void {
  void settleLaunch(conn, row).catch(logged(row.id));
}
```
For trades, export `settle` from `core/send.ts` (lines 201-211, now private) so the worker does not re-implement confirm or the history lookup. Then set landed amounts from `fetchTx` meta with `tokenDelta` or `lamportDelta`.

---

### `apps/worker/src/http.ts` and `main.ts` (config, modified)

**http.ts lines 22-34:** add the new codes to `STATUS` (for example `slippage: 409` or 422, and `message_changed: 422`). `apps/web/lib/worker.ts` line 9 already passes 400, 402, 403, 404, 409, 410, 413, 422, 429, 500 and 503 through.

**main.ts lines 49-55:** routes are exact `"METHOD /path"` keys, with no path params (http.ts line 37):
```typescript
"POST /quote": (body) => quote(ctx, body),
"POST /prepare": (body) => prepare(pctx, body),
"POST /submit": (body) => submit(pctx, body),
```
Add `"POST /trade/quote"`, `"POST /trade/balance"`, `"POST /trade/prepare"`, `"POST /trade/submit"` and `"POST /trade/view"`.

---

### `apps/web/app/api/trade/quote/route.ts` and `balance/route.ts` (route, request-response)

**Analog:** `apps/web/app/api/quote/route.ts` (the whole file, 17 lines):
```typescript
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { workerPost } from "@/lib/worker";
const MAX_BODY = 1024;
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const limited = rateLimited(req, "quote", 60, 60_000);
  if (limited) return limited;
  const body = (await json(req, MAX_BODY)) as { solIn?: unknown; wallet?: unknown } | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
  const { status, body: out } = await workerPost<Quote>("/quote", { solIn: body.solIn, wallet: body.wallet });
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
```
Quote: `rateLimited(req, "trade-quote", 120, 60_000)`, no wallet. Balance: the wallet comes from `sessionWallet(req)`, with `consentRequired()` if absent and `rateLimited(req, "trade-balance", 30, 60_000, wallet)`. Forward only the whitelisted fields.

### `apps/web/app/api/trade/prepare/route.ts` (route, request-response)

**Analog:** `apps/web/app/api/launch/prepare/route.ts`:
```typescript
const wallet = sessionWallet(req);
const limited = rateLimited(req, "prepare", 10, 10 * 60_000, wallet ?? undefined);
if (limited) return limited;
if (!wallet) return consentRequired();
const body = (await json(req, MAX_BODY)) as Record<string, unknown> | null;
// No wallet: it comes from the session, never the body (CR-01).
const fields = Object.fromEntries(FIELDS.map((k) => [k, body[k]]));
const { status, body: out } = await workerPost("/prepare", { ...fields, wallet }, PREPARE_TIMEOUT_MS);
```
Use `FIELDS = ["side", "mint", "amount", "slippageBps"]`, the scope `"trade-prepare"` at 30 per 10 minutes, and a timeout of about 15 s (two simulations, with no lookup table).

### `apps/web/app/api/trade/submit/route.ts` (route, request-response)

**Analog:** `apps/web/app/api/launch/submit/route.ts`: `MAX_BODY = 4 * 1024`, check that `tradeId` and `signed` are strings, and call `workerPost("/trade/submit", { tradeId, signed, wallet })`. The trade owner check moves into the worker (entry wallet against session wallet), replacing the DB `owns()` lookup.

### `apps/web/app/api/trade/[id]/route.ts` (route, poll)

**Analog:** `apps/web/app/api/launch/[id]/route.ts`:
```typescript
export const dynamic = "force-dynamic";
const ID = /^[0-9a-f]{32}$/;
const NO_STORE = { "cache-control": "no-store" };
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
```
Instead of `launchView` (Postgres), call `workerPost("/trade/view", { tradeId: id, wallet: sessionWallet(req) })` (D-04: no DB) with `rateLimited(req, "trade-view", 240, 60_000)`.

---

### `apps/web/lib/trade-run.ts` (browser service, request-response)

**Analog:** `apps/web/lib/launch-run.ts`. Reuse it nearly line for line.
- The `Stop` class and `Code` union (lines 22, 51-57): `Code = TradeErrorCode | "rejected" | "switched" | "onchain"`.
- `call<T>()` (lines 59-68): JSON POST that throws `new Stop(out?.error ?? "worker_unavailable")`.
- `signWithin` (lines 104-116): race the `signBy` timer against `wallet.signTransaction`, and use atob and btoa with no Solana library:
```typescript
const tx = Uint8Array.from(atob(prep.tx), (c) => c.charCodeAt(0));
const expiry = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Stop("expired")), prep.signBy * 1000); });
const signing = run.wallet.signTransaction(tx).catch(() => Promise.reject(new Stop("rejected")));
return btoa(String.fromCharCode(...(await Promise.race([signing, expiry]))));
```
- `submit()` (lines 120-124): `worker_unavailable` returns null, and the poll decides.
- `poll()` (lines 126-141): `POLL_MS = 1000`, loop until landed, failed or unknown. The trade version reads `/api/trade/{id}`.
- Check `run.wallet.address` before starting (line 144) and throw `switched`.

---

### `apps/web/lib/use-trade.ts` (hook, event-driven)

**Debounce analog:** `apps/web/components/launch-buy.tsx` lines 49-77 (`useQuote`):
```typescript
const DEBOUNCE_MS = 400;
useEffect(() => {
  setState({ quote: null, loading: solIn !== null });
  if (solIn === null) return;
  const abort = new AbortController();
  const timer = setTimeout(() => {
    fetch("/api/quote", { method: "POST", headers: { "content-type": "application/json" }, body: ..., signal: abort.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Quote>) : Promise.reject(r.status)))
      .then((quote) => setState({ quote, loading: false }), () => abort.signal.aborted || setState({ quote: null, loading: false }));
  }, DEBOUNCE_MS);
  return () => { clearTimeout(timer); abort.abort(); };
}, [solIn, wallet]);
```
Change from the analog: keep the previous quote while loading (the UI-SPEC dims it to 60%) instead of clearing it to null.

**Interval and mounted-guard analog:** `apps/web/lib/use-status.ts` (`setInterval`, the `mounted` flag, the `reload` ref for "tap to refresh"). Add `document.visibilityState` and an IntersectionObserver gate, plus the 60 s idle stop. Read the wallet from `useWallet()` (`address`, `consented`, `status`, `signTransaction`, `forgetConsent`; `components/wallet.tsx` lines 26-43). Read the coin venue from `useCoinLive()?.coin?.venue` (`coin-live.tsx` line 23). For slippage, read and write localStorage `bondr:slippage` inside a try/catch, falling back to 1%.

---

### `apps/web/components/trade-amount.tsx` (component)

**Analog:** `launch-buy.tsx` lines 127-181 (`BuyField`, `Presets`):
```tsx
<Label htmlFor="buy">Dev buy</Label>
<div className="relative max-w-80">
  <Input id="buy" inputMode="decimal" autoComplete="off" className="num min-h-14 pr-15 text-lg" ...
    aria-invalid={error ? true : undefined} aria-describedby={error ? "buy-hint buy-error" : "buy-hint"} />
  <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-bold text-muted-foreground">SOL</span>
</div>
...
<fieldset className="m-0 flex max-w-80 gap-1.5 border-0 p-0">
  <legend className="sr-only">Presets</legend>
  <button type="button" className="num min-h-11 flex-1 cursor-pointer rounded-md border border-line text-xs transition-colors duration-(--dur) hover:border-leaf hover:text-leaf md:min-h-10" ...>
```
UI-SPEC changes: gap 8px (`gap-2`), `aria-pressed`, mint (not leaf) for the hover and pressed state, the legend "Amount presets", and font-semibold rather than bold on the suffix. Parse SOL with `parseSol` from `@bondr/core/rules` (launch-buy line 3) and render errors with `FieldError` from `ui-field.tsx`.

### `apps/web/components/trade-quote.tsx` (component)

**Analog:** `apps/web/components/token-bond.tsx` lines 17-19 (the `Num` helper) and its formats from `@/lib/format` (`sol`, `thousands`, `pct`):
```tsx
const Num = ({ children }: { children: ReactNode }) => <span className="num text-foreground">{children}</span>;
```
Fees use a native `<details>`. Every rate comes from the quote; the web holds no rate constants.

### `apps/web/components/trade-panel.tsx` (component)

**Analog:** `launch-buy.tsx` `LaunchBuy` lines 79-117. It is a `<form noValidate>` with `onSubmit` and `e.preventDefault()`, and a `Button variant="primary" size="lg"` whose label is derived from state. The UI-SPEC adds `aria-disabled` (not `disabled`) while in flight, and `<fieldset disabled>` around the inputs. For callouts, use `components/callout.tsx` (`variant` info, warn or error; error is `role="alert"`). Use `TxLink` from `tx-link.tsx` for Solscan links. Button variants are `primary`, `danger` and `quiet` (`ui-button.tsx` lines 11-22).

### `apps/web/components/trade-sheet.tsx` (component, dialog)

**Analog:** `apps/web/components/consent-dialog.tsx` lines 16-21 and 38-88:
```tsx
const DIALOG =
  "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[calc(100dvh-24px)] w-full max-w-none overflow-y-auto rounded-t-[24px] border-t border-line-strong text-foreground animate-sheet " +
  "bg-[radial-gradient(90%_50%_at_50%_0%,color-mix(in_oklch,var(--leaf)_12%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] " + ...
useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); box.current?.focus(); ... }, []);
// biome-ignore lint/a11y/useKeyWithClickEvents: the click is the backdrop; Escape (onCancel) is its keyboard twin
<dialog ref={dialog} aria-labelledby="consent-heading" className={DIALOG}
  onCancel={(e) => { e.preventDefault(); decline(); }}
  onClick={(e) => e.target === e.currentTarget && decline()}>
```
Changes from the analog: the sheet stays a bottom sheet from 768px up (`md:w-[min(560px,100%)] md:mx-auto`, with no centered card). Ignore cancel and backdrop clicks while a trade is in flight, and return focus to the bar button that opened the sheet.

### `apps/web/components/ui-seg.tsx` (modified)

The indicator gradient is at line 24 (`bg-[linear-gradient(180deg,color-mix(in_oklch,var(--mint),var(--foreground)_18%),var(--mint))]`). Add `tone?: "mint" | "danger"` and swap `--mint` for `--destructive` when the tone is `danger`. Existing callers keep the default.

### `apps/web/app/coin/[mint]/page.tsx` (modified)

**`Panels`, lines 66-85:** the grid `min-[1100px]:grid-cols-[minmax(0,1fr)_380px] min-[1100px]:gap-8` already exists. Move `McapChart` (lines 106-111) into the grid as column 1, row 1. The right-column wrapper (now `sticky`, line 71) becomes non-sticky, spans `row-span-2`, and holds `TradePanel` (`max-[1099px]:hidden`) above `BondPanel`. Trades go in column 1, row 2. Render the bar and sheet (`min-[1100px]:hidden`) inside `CoinLiveProvider`. Change the note on line 114 to the UI-SPEC copy, and set bottom padding to 80px plus the safe area below 1100px.

---

### Tests

- **Worker unit tests:** `apps/worker/src/submit.test.ts` lines 1-20, `vi.hoisted` mocks with `vi.mock("./x.ts", async (orig) => ({ ...(await orig()), fn: m.fn }))` and `{} as PrepareCtx` for the context. Trade tests mock `trade-store` and a stub `Connection` the same way.
- **Core fixture tests:** `packages/core/src/cosign.test.ts` (Keypair-built messages, `readFileSync` fixtures). `quote.test.ts` reads `fixtures/multihop-buy.json` and `multihop-sell.json` and decodes them with `core/events.ts innerEvents`.
- **E2E stubs:** `apps/web/e2e/launch-stubs.ts`, which has `Reply`, `Stubs` and `Calls` types, `fulfill(route, r)` with `delayMs`, a fake `TX` base64, `ID = "a".repeat(32)`, and `page.route` per endpoint. The fake Phantom is `injectPhantom(page, account, { reject?: true })`, `signIn` and `simDevAccount` from `e2e/phantom.ts`. The screenshot and axe gate is `gate(page, name, width)` from `e2e/shoot.ts`. The devnet group skips unless `E2E_DEVNET=1` (RESEARCH Code Examples).
- **Fork rows:** `scripts/spike/stages/multihop.ts`. After `tokenDelta`/`lamportDelta` move to core (lines 22-33), the spike imports them back.

---

## Shared Patterns

### Worker contract errors
**Source:** `apps/worker/src/http.ts` lines 10-34
**Apply to:** every `trade-*.ts` worker handler
```typescript
export const fail = (body: ApiError): Fail => new Fail(STATUS[body.error] ?? 500, body);
// handlers: throw fail({ error: "invalid_input" }); a non-Fail throw becomes 500 build_failed, logged through redact
```

### Session wallet, never the body wallet (CR-01)
**Source:** `apps/web/lib/session.ts` (`sessionWallet` line 77, `consentRequired` line 87) and `api/launch/prepare/route.ts`
**Apply to:** the trade balance, prepare, submit and view routes

### Web route guard order
**Source:** `apps/web/app/api/quote/route.ts` and `launch/prepare/route.ts`
**Apply to:** all `app/api/trade/*`
Order: `sameOrigin` gives 403; then `rateLimited` (per IP, plus the wallet when known); then the session (`consentRequired`); then `json(req, MAX_BODY)` giving 400; then `workerPost` with whitelisted fields. Every response gets the `cache-control: no-store` header.

### Single-flight cache with failure eviction
**Source:** `apps/worker/src/status.ts` lines 163-174
**Apply to:** `trade-state.ts` (2 s per mint, 60 s configs)

### Logging
**Source:** `redact` from `@bondr/core/net`, for example `main.ts` lines 23-24 and `settle.ts` lines 142-143
**Apply to:** every worker catch path (T9)

### ponytail comments
**Source:** `prepare.ts` lines 283-284, `guard.ts` line 48, `page.tsx` line 35
**Apply to:** the trade store (single replica), the state cache (per process, stream-fed upgrade), and the devnet `maxSolIn` guard

### Directory READMEs
**Source:** `apps/web/lib/README.md` (one line per file: name, what it exports)
**Apply to:** `apps/web/lib`, `apps/web/components`, `apps/worker/src` (no README yet, and it has more than five files: add one), `packages/core/src`

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/src/quote.ts` `curveHop` and the price-impact math | utility | transform | No masked multi-hop arithmetic exists yet. Use RESEARCH Pattern 1, Pattern 2 and "Price impact" exactly; the fee-read half has an analog (status.ts) |
| Priority fee estimate call (mainnet path in `trade-prepare.ts`) | service | request-response | No Helius `getPriorityFeeEstimate` call exists. Devnet uses `ctx.priorityFee` (env.ts line 54), per RESEARCH Pitfall 2 |

## Metadata

**Analog search scope:** `apps/worker/src`, `packages/core/src`, `apps/web/{app/api,lib,components,e2e}`, `scripts/spike/stages`
**Files scanned:** 28
**Pattern extraction date:** 2026-10-24
