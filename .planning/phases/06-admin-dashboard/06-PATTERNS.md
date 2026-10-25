# Phase 6: Admin Dashboard - Pattern Map

**Mapped:** 2026-10-25
**Files analyzed:** 78 (new and modified, incl. tests)
**Analogs found:** 74 / 78

Paths are repo-relative. Line numbers are from the tree at commit f7bd8bb.

## Line budget (files this phase modifies, 300-line rule)

| File | Lines now | Phase 6 adds | Action |
|---|---|---|---|
| `apps/worker/src/fee-engine.ts` | 299 | failures map, `idle(mints)`, `allowed` in deps, hold flag | **Split first:** move `loadRows`, `feeDeps`, `startEngine`, `withCost` (lines 224-299) to new `fee-boot.ts` |
| `apps/worker/src/fee-ledger.ts` | 297 | `keysOf` mint in sig key, new kinds | **Split first:** move `memoryLedger` + `keysOf`/`refused`/`pendingOf`/`blank` (lines 49-134) to new `fee-ledger-memory.ts` |
| `apps/worker/src/prepare.ts` | 290 | `blocked()` read + refusal (~6 lines) | Fits if `blocked` lives in `admin-moderate.ts` and `prepareGuard` gains one field; do not add more here |
| `apps/worker/src/fee-send.ts` | 259 | `FeeDeps.allowed`, `withSol` skip, group-by-mint publish (~12) | Fits (~271); no other growth |
| `packages/core/src/schema.ts` | 259 | settings x5 cols, coins hidden/held x4, `blocked_deployers`, `admin_audit`, kind check, sig_kind swap (~50) | **Over 300.** Put the two new tables in `packages/core/src/schema-admin.ts` and `export * from "./schema-admin.ts"` at the end of `schema.ts` (drizzle config points at `./src/schema.ts` only; `db.ts` line 3 imports `* as schema`) |
| `apps/worker/src/ingest.ts` | 258 | none expected (stream mark goes in `stream.ts`) | — |
| `apps/web/components/token-trades.tsx` | 252 | none (LoadMore reused via `copy` prop) | — |
| `apps/worker/src/status.ts` | 243 | shrinks: launches switch moves to `switches.ts` | Keep `liveStatus` API; delegate `setSwitch`/`readSwitch` |
| `packages/core/src/api.ts` | 240 | admin error codes, `AdminAction`, `AdminJob`, payload types, 2 kinds (~45) | Borderline (~285). If over, put admin payload types in `packages/core/src/api-admin.ts` (types only, same header rule) |
| `apps/web/e2e/phantom.ts` | 230 | `adminAccount()`, `adminSignIn()` (~20) | Fits |
| `apps/web/components/consent-dialog.tsx` | 180 | none (copy `DIALOG` string into `admin-sim.tsx`, do not import) | — |
| `apps/worker/src/fee-batch.ts` | 184 | `anyAmount` on `distributeJob`, gate | Fits |
| `apps/worker/src/settle.ts` | 167 | export `landed`, `observe` | Fits |
| `apps/worker/src/fee-finalize.ts` | 164 | leftover burn in `checkEmpty`, gate | Fits |
| `apps/worker/src/fee-recover.ts` | 161 | group by mint in `landed` | Fits |
| `apps/web/lib/session.ts` | 88 | admin message, cookie, session (~30) | Fits |

## File Classification

### packages/core

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/schema.ts` (mod: settings cols, coins `hidden_at`/`hidden_reason`/`held_at`/`held_reason`, kind check, sig_kind index) | model | CRUD | itself `settings` 38-45, `coins` checks 154-168, `feeLedger` 194-225 | exact |
| `packages/core/src/schema-admin.ts` (new: `blockedDeployers`, `adminAudit`) | model | CRUD | `schema.ts` `launches` 55-97 (state check + timestamps), `feeLedger` 175-226 | exact |
| `packages/core/migrations/0007_admin.sql` (new, generated + optional custom trigger) | migration | - | `migrations/0006_reconcile_platform.sql` (drop/add CHECK) | exact |
| `packages/core/src/api.ts` (mod: error codes, kinds, admin types) | model (contract) | - | itself `LaunchErrorCode` 22-37, `LedgerKind` 109-121 | exact |
| `packages/core/src/fees.ts` (mod: `PUBLIC_KINDS`, `totalsFor` for `leftover_burn`, `evacuate`) | utility | transform | itself 8-18, 105-129 | exact |
| `packages/core/src/coin-row.ts` (mod: `coinRows` hidden filter) | model (read) | CRUD read | itself `coinRows` 140-153 | exact |
| `packages/core/src/net.ts` (mod: `connect(net, {fetch})`) | config | request-response | itself `connect` 44-56 | exact |
| `packages/core/src/pump.ts` (mod: re-export `getPumpProgram`, `getPumpFeeProgram`, `getPumpAmmProgram`) | config | - | itself (only SDK import point) | exact |
| `packages/core/src/scrub.ts` (mod: `SENTRY_READ_TOKEN` in `forbiddenEnv`) | utility | - | itself line 18 | exact |
| `packages/core/src/db.test.ts`, `fees.test.ts` (extend) | test | - | themselves | exact |

### apps/worker

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/worker/src/admin-routes.ts` (new) | controller | request-response | `fee-routes.ts` (whole, 35 lines) + `http.ts` `fail` 36 | exact |
| `apps/worker/src/admin-intent.ts` (new) | store | in-memory TTL | `trade-store.ts` (whole, 55 lines) + `@bondr/core/sig` `signatureOk` | exact |
| `apps/worker/src/admin-actions.ts` (new) | service (registry) | request-response | `fee-engine.ts` `release` 157-165, `force` 177-184 (enqueue a job) | role-match |
| `apps/worker/src/admin-sim.ts` (new) | service | request-response (RPC) | `packages/core/src/bond.ts` `simulatedBalance` 48-70; `fee-send.ts` `dry` 201-207 | exact |
| `apps/worker/src/admin-dest.ts` (new, pure) | utility | transform | `packages/core/src/send.ts` `checkMessage` 67-74 (per-ix allowlist) | role-match |
| `apps/worker/src/admin-audit.ts` (new) | store | CRUD | `launches.ts` `insertPrepared` 16-18, `advance` 25-38 | exact |
| `apps/worker/src/admin-leftover.ts` (new) | service | request-response (chain) | `fee-batch.ts` `buybackBurnJob` 55-63; `core/bond.ts` `burnIx` 33-42 | exact |
| `apps/worker/src/admin-evacuate.ts` (new) | service | batch | `fee-recover.ts` `settleAll` 83-111 (loop + pace); `core/send.ts` `wireSize` 110 + `PACKET_LIMIT` 22 | role-match |
| `apps/worker/src/admin-inspect.ts` (new) | service | request-response (RPC) | `core/trade-error.ts` (`customCode` 14, `fromLogs` 6, `tradeError` 47); `fee-send.ts` `metaOf` 211-217 | partial |
| `apps/worker/src/admin-moderate.ts` (new) | store | CRUD | `status.ts` `setSwitch` 196-201; `launches.ts` `consented` 40-41 | exact |
| `apps/worker/src/switches.ts` (new) | store | memory + DB | `status.ts` `readSwitch`/`parseSwitch`/`setSwitch` 176-201 | exact |
| `apps/worker/src/health.ts` (new) | utility | memory | `fee-send.ts` `opsLow`/`noteOps` 94-104 (module flag) | role-match |
| `apps/worker/src/rpc-stats.ts` (new) | utility | streaming (ring) | none; RESEARCH Code Example 4 | partial |
| `apps/worker/src/sentry-count.ts` (new) | service | request-response (cached) | `status.ts` `live()` 163-174 (one shared promise per window) | exact |
| `apps/worker/src/fee-boot.ts` (new, split) | config | boot | `fee-engine.ts` 224-299 (move verbatim) | exact |
| `apps/worker/src/fee-ledger-memory.ts` (new, split) | store | in-memory | `fee-ledger.ts` 49-134 (move verbatim) | exact |
| `apps/worker/src/main.ts` (mod: spread `adminRoutes`, timed fetch) | config | - | itself 55-76 | exact |
| `apps/worker/src/http.ts` (mod: `STATUS` for admin codes) | controller | - | itself 22-35 | exact |
| `apps/worker/src/env.ts` (mod: `ADMIN_WALLET`, `SENTRY_READ_TOKEN`, `ADMIN_EVACUATE`) | config | - | itself `feeEngine` 44-48, `quoteMint` 62-67 | exact |
| `apps/worker/src/fee-engine.ts` (mod: failures map, `idle`, hold) | service | event-driven | itself `enqueue` 118-124 | exact |
| `apps/worker/src/fee-send.ts` (mod: `FeeDeps.allowed`, `withSol`, `landed` grouping) | service | request-response | itself 52-67, 161-170, 219-230 | exact |
| `apps/worker/src/fee-guard.ts`, `fee-burns.ts`, `fee-finalize.ts`, `fee-batch.ts` (mod: switch gate at top of job) | service | event-driven | `fee-burns.ts` `forcedJob` 63-67 (early `return [DONE]`) | exact |
| `apps/worker/src/fee-recover.ts` (mod: group rows by mint) | service | batch | itself `bySig` 113 (`Map.groupBy`) | exact |
| `apps/worker/src/fee-reconcile.ts` (mod: `evacuate` in `OUT`, SQL list) | service | batch | itself 22-23 | exact |
| `apps/worker/src/settle.ts` (mod: export `landed`, `observe`) | service | request-response | itself 54-99 | exact |
| `apps/worker/src/prepare.ts` (mod: blocked refusal) | service | request-response | itself `admit` 131-158, `prepareGuard` 111-119 | exact |
| `apps/worker/src/stream.ts` (mod: `mark("stream")`) | service | streaming | itself `ws.onmessage` 139-142 | exact |
| `apps/worker/src/admin-*.test.ts`, `switches.test.ts`, `health.test.ts`, `rpc-stats.test.ts`, `sentry-count.test.ts` (new) | test | - | `trade-store.test.ts` (injected `now`), `status.test.ts`, `http.test.ts` | exact |
| `apps/worker/src/README.md`, `apps/worker/README.md` (mod) | doc | - | themselves | exact |

### apps/web

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/web/lib/session.ts` (mod: `adminMessage`, `adminCookie`, `adminSession`, `adminWalletEnv`) | utility (auth) | request-response | itself `issueNonce` 48-51, `sessionCookie` 70-74, `sessionWallet` 77-84 | exact |
| `apps/web/lib/session.test.ts` (extend) | test | - | itself | exact |
| `apps/web/app/api/admin/session/route.ts` (new: POST nonce, POST verify, sign out) | route | request-response | `apps/web/app/api/consent/route.ts` (whole) | exact |
| `apps/web/app/api/admin/[op]/route.ts` (new: catch-all, POST only) | route | request-response | `apps/web/app/api/trade/prepare/route.ts`; `[id]` param shape from `app/api/trade/[id]/route.ts` | exact |
| `apps/web/lib/admin-data.ts` (new, `server-only`) | service (read) | CRUD read, keyset | `apps/web/lib/trades.ts` `tradesPage` 37-60; `lib/coins.ts` `BUDGET` 96 | exact |
| `apps/web/lib/admin-run.ts` (new, client) | service (client flow) | request-response + poll | `apps/web/lib/trade-run.ts` (whole); `consent-dialog.tsx` `saveConsent` 146-163 | exact |
| `apps/web/lib/admin-copy.ts` + `.test.ts` (new, pure) | utility | transform | `apps/web/lib/ledger-copy.ts` `COPY` 24+, `Tone` 6; `components/launch-sign.tsx` code-to-copy map 44-60 | exact |
| `apps/web/lib/use-health.ts` (new, client hook) | hook | polling (visibility) | RESEARCH Code Example 7; `token-trades.tsx` `useClock` 155 | partial |
| `apps/web/app/admin/page.tsx` (new, server) | route (page) | CRUD read | `apps/web/app/coin/[mint]/page.tsx` 1-40 (`dynamic`, metadata, server reads) | exact |
| `apps/web/components/admin-signin.tsx` | component | request-response | `consent-dialog.tsx` `ConsentPrompt` + `Fault` 36-88, 165-180 | exact |
| `apps/web/components/admin-console.tsx` | component | state shell | `apps/web/app/coin/[mint]/page.tsx` panels; `token-trades.tsx` section shell 232-250 | role-match |
| `apps/web/components/admin-wallets.tsx` | component | display | `token-trades.tsx` section shell 232-235 | role-match |
| `apps/web/components/admin-switches.tsx` | component | request-response | `trade-amount.tsx` `Chips` 15-43 (aria-pressed buttons) | role-match |
| `apps/web/components/admin-health.tsx` | component | polling | `token-trades.tsx` `LiveIndicator` (polite span) | role-match |
| `apps/web/components/admin-wtable.tsx` | component | display + client filter | `token-trades.tsx` `FeedTable` + `Chips` | exact |
| `apps/web/components/admin-timeline.tsx` | component | display | `token-ledger.tsx` (`<ol>` rows with `TxLink`) | role-match |
| `apps/web/components/admin-sim.tsx` | component (dialog) | request-response | `consent-dialog.tsx` `DIALOG` 17-21, `<dialog>` 59-86 | exact |
| `apps/web/components/admin-inspect.tsx` | component | request-response | `trade-amount.tsx` (`Input`, `Label`, `FieldError` from `ui-field`) | role-match |
| `apps/web/components/admin-moderation.tsx` | component | CRUD | same as inspect + `ui-field` | role-match |
| `apps/web/components/admin-audit.tsx` | component | paging | `token-trades.tsx` `useOlder` 68-86, `LoadMore` 207-226 | exact |
| `apps/web/components/admin-evacuate.tsx` | component | request-response | `consent-dialog.tsx` accept flow 51-56 + `admin-run.ts` | role-match |
| `apps/web/components/tag.tsx` (mod: `danger` tone) | component | - | itself 9-14 | exact |
| `apps/web/components/trade-amount.tsx` (mod: `Chips` `wrap` prop) | component | - | itself 15-43 (`size` prop pattern) | exact |
| `apps/web/lib/ledger-copy.ts` + test (mod: two kinds) | utility | transform | itself `COPY` 24+ | exact |
| `apps/web/lib/launches.ts` `CODES`, `components/launch-sign.tsx` copy (mod: `blocked`) | utility | - | themselves 28-40, 44-60 | exact |
| `apps/web/next.config.ts` (mod: `ADMIN_WALLET` in `WEB_ENV`) | config | - | itself line 9 | exact |
| `apps/web/components/README.md`, `apps/web/lib/README.md` (mod) | doc | - | themselves | exact |

### e2e, scripts, env

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/web/e2e/admin-signin.e2e.ts`, `admin-console.e2e.ts`, `admin-moderation.e2e.ts`, `admin-responsive.e2e.ts` | test (e2e) | - | `consent.e2e.ts`, `responsive-fee.e2e.ts` | exact |
| `apps/web/e2e/admin-switch.e2e.ts` (serial project) | test (e2e) | - | `paused.e2e.ts` 1-40 | exact |
| `apps/web/e2e/admin-stubs.ts` | test fixture | - | `trade-stubs.ts` `stubTrade` 92-115 | exact |
| `apps/web/e2e/phantom.ts` (mod: `adminAccount`, `adminSignIn`) | test fixture | - | itself `seedAccount` 35, `signIn` 97-106 | exact |
| `apps/web/e2e/shoot.ts` (mod: `PHASE6_SHOTS`) | test fixture | - | itself lines 9-10 | exact |
| `playwright.config.ts` (mod: serial admin project, `ADMIN_WALLET` env) | config | - | itself `projects` 32-39, `webServer` env 51, 58 | exact |
| `apps/web/e2e/admin-devnet.e2e.ts` (or a `scripts/` runner) | test (chain) | - | `apps/web/e2e/fee-devnet.e2e.ts` | exact |
| `scripts/spike/stages/admin.ts` + `nets/fork.ts` entry | test (fork) | batch | `scripts/spike/stages/engine-bond.ts` 1-40 (imports worker modules, `feeDeps(run)`) | exact |
| `.env.example` (mod) | config | - | itself | exact |

---

## Pattern Assignments

### Worker

#### `apps/worker/src/admin-routes.ts` (controller)

**Analog:** `apps/worker/src/fee-routes.ts`. Same shape: a function returning `Routes`, the engine read lazily, `fail({error})` for bad input, a local `key()` validator.

```typescript
// fee-routes.ts 8-17, 30-35
const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function key(v: unknown): PublicKey {
  if (typeof v !== "string" || !BASE58_KEY.test(v)) throw fail({ error: "invalid_input" });
  try { return new PublicKey(v); } catch { throw fail({ error: "invalid_input" }); }
}
// The engine starts after the server listens, so routes read it when called.
export const feeRoutes = (engine: () => Pick<Engine, "release"> | null): Routes => ({
  "POST /fee/release": (body) => release(engine(), body),
  "POST /fee/batch": () => batchNow() ?? Promise.reject(fail({ error: "paused" })),
});
```

Add one gate wrapper applied to every admin handler (D-08): `ADMIN_WALLET` unset/invalid or `body.actor !== ADMIN_WALLET` throws `new Fail(403, { error: "forbidden" })` (use `Fail` directly, http.ts 11-19, or add `forbidden: 403` to `STATUS` 22-35). Every route is `POST` (Pitfall 8). Export `key()` from one place instead of copying it a third time (it already exists in `fee-routes.ts` and web `guard.ts` 46). Wire in `main.ts` next to line 67: `...adminRoutes(feeEngine, ctx, env),`.

#### `apps/worker/src/admin-intent.ts` (store, in-memory TTL)

**Analog:** `apps/worker/src/trade-store.ts` (copy the whole file shape: ponytail header 3-4, `TTL`, `MAX`, sweep-on-insert, `randomBytes(16).toString("hex")`).

```typescript
// trade-store.ts 26-39
export const TRADE_TTL_MS = 120_000;
export const TRADE_MAX = 5_000;
const trades = new Map<string, TradeEntry>();
const live = (e: TradeEntry, now: number) => now - e.at < TRADE_TTL_MS;
export function putTrade(t: NewTrade, now = Date.now()): TradeEntry {
  for (const [k, v] of trades) if (!live(v, now)) trades.delete(k);
  while (trades.size >= TRADE_MAX) trades.delete(trades.keys().next().value as string);
  const e: TradeEntry = { ...t, id: randomBytes(16).toString("hex"), state: "prepared", at: now };
  trades.set(e.id, e);
  return e;
}
```

Differences: TTL 2 min until executed, then keep about 10 min for the browser poll (state, sigs); a much smaller cap (simulate is rate-limited). `take()` is RESEARCH Code Example 2 verbatim: verify with `signatureOk(Buffer.from(e.message, "utf8"), sig, admin)` from `@bondr/core/sig` (sig.ts lines 9-20), then `e.used = true` with no `await` in between. Every function takes `now = Date.now()` so the test copies `trade-store.test.ts` 13-33.

#### `apps/worker/src/admin-actions.ts` (registry)

**Analog:** `Engine.release` and `Engine.force` (fee-engine.ts 157-165, 177-184): build a job closure, run it on the coin's queue.

```typescript
// fee-engine.ts 157-165
release(mint: string, deployer: PublicKey): boolean {
  const [coin, deps] = [this.coins.get(mint), this.o.deps];
  if (!this.ready || !deps || coin?.finalize !== "held") return false;
  const job = async () =>
    console.log(`fee finalize ${mint}: ${summary(await finalizeJob(deps, coin, deployer))}`);
  void this.enqueue(mint, job, `fee finalize ${mint}`);
  return true;
}
```

Pitfall 9: `enqueue` (118-124) swallows errors and returns `void`, resolves immediately with mode `off`, and the engine is `null` with `FEE_ENGINE=off`. Capture the result in a closure (`let out; await engine.enqueue(mint, async () => { out = await run(d, coin); })`) and call `run` directly when there is no engine. Job entry points: `windowJob` (fee-guard.ts 45), `forcedJob` (fee-burns.ts 63), `finalizeJob(d, coin, coin.wallet)` (fee-finalize.ts 149; `coin.wallet` is `launches.wallet`, D-15), `distributeJob` (fee-batch.ts 94), `buybackBurnJob` (fee-batch.ts 55, queue key `"platform"`), `settleRows` (fee-recover.ts 117). Copy `coinFrom` (fee-engine.ts 63-78) to build a `FeeCoin` when the engine is off; pass `{...coin}` to simulations (Pitfall: jobs mutate `coin.open`, `coin.finalize`).

#### `apps/worker/src/admin-sim.ts` (simulate with balances)

**Analog:** `packages/core/src/bond.ts` `simulatedBalance` 48-70 (the proven `accounts` option) and `fee-send.ts` `dry` 201-207 (dry mode returns `{state: "dry"}`, which `settled()` accepts).

```typescript
// bond.ts 56-66
const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
const { blockhash } = await conn.getLatestBlockhash();
const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [limit, ...ixs] });
const sim = await conn.simulateTransaction(new VersionedTransaction(msg.compileToV0Message()), {
  sigVerify: false,
  replaceRecentBlockhash: true,
  accounts: { addresses: [ata.toBase58()], encoding: "base64" },
});
if (sim.value.err) throw new Error(`burn simulation failed: ${JSON.stringify(sim.value.err)}`);
```

The capture deps are `{...base, mode: "dry", publish: () => {}, land: (job) => record(job)}` (RESEARCH Pattern 2). `FeeDeps` is fee-send.ts 52-67; `Job` is 34-42. Decode token balances with `AccountLayout.decode` as bond.ts 70 does. Fee estimate per RESEARCH Code Example 3. In dry mode `guard` never settles (fee-guard.ts 20: `d.mode === "on"` check), so simulation writes no ledger rows.

#### `apps/worker/src/admin-dest.ts` (pure destination check)

**Analog:** `packages/core/src/send.ts` `checkMessage` 67-74: walk every top-level instruction, return a refusal string or `null`.

```typescript
// send.ts 67-74
export function checkMessage(msg: VersionedMessage): string | null {
  if (msg.version !== 0) return "not v0";
  for (const ix of msg.compiledInstructions) {
    const p = msg.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? "missing";
    if (!ALLOWED_PROGRAMS.has(p)) return `program not allowed: ${p}`;
  }
  return null;
}
```

Input is `job.ixs` (before `budget()` is prepended in `land`, fee-send.ts 245), so decode `TransactionInstruction` with `SystemInstruction.decodeInstructionType` and spl-token `decodeInstruction(ix, ix.programId)` in try/catch, per RESEARCH Pattern 5. Allowed ATAs via `getAssociatedTokenAddressSync(mint, owner, true, T22)` as `buybackBurnJob` does (fee-batch.ts 59). Keep it pure (no RPC) so `admin-dest.test.ts` is a plain table test.

#### `apps/worker/src/admin-audit.ts` (store, intent-first)

**Analog:** `apps/worker/src/launches.ts`: one insert, then one guarded UPDATE that returns the row or null.

```typescript
// launches.ts 25-38
export async function advance(exec: Exec, id: string, from: LaunchState, to: LaunchState, set: Partial<NewLaunch> = {}) {
  const [row] = await exec
    .update(launches)
    .set({ ...set, state: to, updatedAt: sql`now()` })
    .where(and(eq(launches.id, id), eq(launches.state, from)))
    .returning();
  return row ?? null;
}
```

`settle(exec, id, result, set)` is `.where(and(eq(adminAudit.id, id), eq(adminAudit.result, "pending")))`. `Exec` type from launches.ts line 10. Non-transaction actions insert one `landed` row. Log write failures with the code only, never the params (consent route: `console.error("consent write failed", cause?.code)`).

#### `apps/worker/src/admin-leftover.ts` (W child burn, close accounts)

**Analog:** `fee-batch.ts` `buybackBurnJob` 55-63 (read balance, `DONE` on zero, one BurnChecked, one row through `d.land`):

```typescript
export async function buybackBurnJob(d: FeeDeps): Promise<Landed> {
  const owner = d.buyback.publicKey;
  const amount = await tokenBalance(d, owner);
  if (amount === 0n) return DONE;
  const ata = getAssociatedTokenAddressSync(d.Q, owner, true, T22);
  const ix = createBurnCheckedInstruction(ata, d.Q, owner, amount, DECIMALS, [], T22);
  const row = { kind: "buyback_burn" as const, mint: null, amount, burned: amount };
  return d.land({ rows: [row], ixs: [ix], signers: [d.buyback] });
}
```

For W: `wBondr(d, coin, coin.mint)` (fee-prebond.ts 57) for the child balance, child decimals `COIN_DECIMALS` as `core/bond.ts` `burnIx` 33-42, `signers: [coin.w]`, row `{kind: "leftover_burn", mint, burned: amount}`. `fee-finalize.ts` `checkEmpty` (124-135) calls this instead of only logging a non-zero child. CloseAccount uses `createCloseAccountInstruction(ata, d.treasury, w, [], T22)`.

#### `apps/worker/src/admin-evacuate.ts` (batch)

**Analog:** `fee-recover.ts` `settleAll` 83-111 (a loop over grouped rows with an injected `sleep`) for the execute loop; packing is RESEARCH Code Example 5 over `wireSize` (core send.ts 110) and `PACKET_LIMIT` (send.ts 22). Pace with `feeConfig(d.net).paceMs` (fee-send.ts 254). Execute order (D-35): `switches.setAll(false)` + `settings.evacuated_at` first, then `engine.idle(mints)` per batch, then `d.land`. Ledger rows carry their own `sol` (Pitfall 4). Mode from new env `ADMIN_EVACUATE` (`simulate` default).

#### `apps/worker/src/admin-inspect.ts` (RPC decode)

**Partial analog.** Error mapping reuses `packages/core/src/trade-error.ts` exports exactly (`fromLogs` line 6, `customCode` line 14, `tradeError` line 47). The fetch shape copies `fee-send.ts` `metaOf` 211-217 but with `conn.getTransaction(sig, {maxSupportedTransactionVersion: 0, commitment: "confirmed"})`. Anchor decoding through the SDK programs (RESEARCH Pattern 10); add the getters to `core/pump.ts` (the only SDK import point). Program labels stay in the worker (`scripts/check-client-bundle.sh`). Test with `packages/core/src/fixtures/*.json`, loaded as in `apps/worker/src/ingest.test.ts` 16-19.

#### `apps/worker/src/switches.ts` (memory + DB)

**Analog:** `status.ts` 176-201. Generalize the one boolean to a record of five.

```typescript
// status.ts 179-201
let switchOn: boolean | undefined;
async function readSwitch(): Promise<boolean> {
  const rows = await db().select({ enabled: settings.launchesEnabled }).from(settings).where(eq(settings.id, 1));
  switchOn = rows[0]?.enabled === true; // fail closed: a missing settings row counts as switched off
  return switchOn;
}
export async function setSwitch(body: unknown): Promise<{ enabled: boolean }> {
  const on = parseSwitch(body);
  await db().update(settings).set({ launchesEnabled: on }).where(eq(settings.id, 1));
  switchOn = on;
  return { enabled: on };
}
```

Keep `liveStatus(ctx, fresh)` (status.ts 204-210) re-reading launches at prepare and submit. `POST /kill-switch` (main.ts 61) stays and calls the same setter (RESEARCH State of the Art). Load once at boot inside `bootIndex` (main.ts 33-45), next to `loadCoins`. Copy the fail-closed comment.

#### `apps/worker/src/sentry-count.ts` (cached on-demand fetch)

**Analog:** `status.ts` `live()` 163-174, one shared promise per window, a failure not cached:

```typescript
let cached: { at: number; live: Promise<Live> } | undefined;
function live(ctx: Ctx): Promise<Live> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.live;
  const entry = { at: Date.now(), live: readLive(ctx) };
  cached = entry;
  entry.live.catch(() => { if (cached === entry) cached = undefined; });
  return entry.live;
}
```

`CACHE_MS = 60_000`. No token returns `{configured: false}` without a fetch. Inject `fetch` for the test.

#### `apps/worker/src/health.ts`, `rpc-stats.ts` (memory)

**Analog:** `fee-send.ts` 94-104 (module-level flag with an exported reader, `opsLow`/`noteOps`). `mark(name)` goes in `stream.ts` `ws.onmessage` 139-142 (next to `l.seen = Date.now()`), in `Engine.enqueue` (fee-engine.ts 118), and at the top of each job. `rpc-stats.ts` is RESEARCH Code Example 4; `core/net.ts` `connect` (44-56) gains an optional `{ fetch }` passed to `new Connection(url, { commitment: "confirmed", fetch })` at line 48.

#### `apps/worker/src/fee-boot.ts`, `fee-ledger-memory.ts` (splits, do first)

Move verbatim; no behaviour change. `fee-boot.ts` takes fee-engine.ts 224-299 (`engine` singleton, `feeEngine`, `onIngest`, `loadRows`, `feeDeps`, `startEngine`, `withCost`); re-export from `fee-engine.ts` or update imports in `main.ts` (line 12), `announce.ts` and `ingest.ts`. `fee-ledger-memory.ts` takes fee-ledger.ts 49-134; `scripts/spike/stages/engine-bond.ts` line 12 imports `memoryLedger` from `fee-ledger.ts`, so update that import too.

#### Engine changes: `fee-send.ts`, `fee-engine.ts`, job gates

- `FeeDeps` (fee-send.ts 52-67) gains `allowed(job: AdminJob, coin: FeeCoin | null): boolean`. Gate at the top of each job, shaped like `forcedJob`'s early return (fee-burns.ts 64: `if (...) return [DONE];`), returning `{state: "skipped"}`.
- `FeeCoin` (fee-send.ts 70-85) gains `hold?: string` (from `coins.held_at`/`held_reason`, Pitfall 13), loaded by `loadRows` (fee-engine.ts 232-240).
- `withSol` (161-170): `if (out[r.kind]?.sol !== undefined) continue;` style skip when the row carries its own `sol` (Pitfall 4).
- `landed` (219-230) line 228 and `fee-recover.ts` line 65: publish per mint with `Map.groupBy(rows, (r) => r.mint)`, the same helper as `bySig` (fee-recover.ts 113).
- `Engine` gains `failures: Map<mint, {step, attempts, code, at}>` updated in the `enqueue` rejection handler (118-124) and `idle(mints)` awaiting `this.queue.get(m)`.
- `fee-ledger` `keysOf` (fee-ledger.ts 56-64): `sig:${signature}:${kind}:${mint ?? ""}` to mirror the new index (Pitfall 3).
- `fee-reconcile.ts` line 23: add `"evacuate"` to `OUT` and to the `pgImplied` SQL kind list.

#### `apps/worker/src/prepare.ts` (blocked deployer)

**Analog:** itself. Add `blocked(db(), wallet)` to the `Promise.all` in `admit` (131-140) and a `blocked: boolean` field to `GuardInput` (101-109), refused in `prepareGuard` (111-119) right after `consent_required` as `{ error: "blocked" }`. Put the `blocked()` query in `admin-moderate.ts` next to hide/block, shaped like `consented` (launches.ts 40-41):

```typescript
export const consented = async (exec: Exec, wallet: string): Promise<boolean> =>
  (await exec.$count(wallets, eq(wallets.address, wallet))) > 0;
```

#### `apps/worker/src/settle.ts` (Re-check launch)

Export `observe` (54-64) and `landed` (86-99) as they are. The admin action does one `observe(conn, sig, true, null)` and calls `landed` only on `seen?.confirmed && seen.err === null` (the rule in `nextState` 31-39). Nothing else changes.

#### `apps/worker/src/env.ts` (config)

Copy `feeEngine` (44-48) for `ADMIN_EVACUATE` (`simulate|on`, default `simulate`, refuse others). `ADMIN_WALLET` copies the `quoteMint` parse (62-67) but does not throw: invalid or unset yields `null` (fail closed, D-08). `SENTRY_READ_TOKEN` is an optional trimmed string. Header rule (line 2): never log any of these.

---

### packages/core

#### `packages/core/src/schema.ts` + `schema-admin.ts` (model)

**Analog:** `settings` (38-45) for new boolean columns; `launches` checks (89-96) and `feeLedger` (175-226) for the audit table.

```typescript
// schema.ts 38-45
export const settings = pgTable("settings", {
  id: integer().primaryKey(),
  launchesEnabled: boolean().notNull().default(true),
}, () => [check("settings_single_row", sql`id = 1`)]);
```

New switch columns are `boolean().notNull().default(true)` (staging engine keeps running, RESEARCH staging guidance) plus `evacuatedAt: tstz()`. `coins` checks (154-168) gain `check("coins_hidden", sql`(hidden_at is null) = (hidden_reason is null)`)` and the same for `held`. Swap line 223 for `uniqueIndex("fee_ledger_sig_kind").on(t.signature, t.kind, sql`coalesce(mint, '')`)` and widen the kind check (196-199). `tstz` is line 22; `big()` is defined after `launches`, so `schema-admin.ts` imports what it needs from `schema.ts`. `admin_audit` body: RESEARCH Pattern 11.

**Migration:** `pnpm --filter @bondr/core exec drizzle-kit generate --name admin` (config `packages/core/drizzle.config.ts`, `out ./migrations`). Do not use root `db:generate` (package.json line 22 hardcodes `--name init`). The kind-check change is drop/add, as 0006:

```sql
ALTER TABLE "fee_ledger" DROP CONSTRAINT "fee_ledger_platform";--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_platform" CHECK (...);
```

The optional audit immutability trigger needs `drizzle-kit generate --custom`.

#### `packages/core/src/api.ts` (contract)

Types only, no imports (header 1-2). Extend `LaunchErrorCode` (22-37) with `forbidden`, `blocked`, `intent_expired`, `intent_used`, `bad_intent_signature`, `not_applicable`, `simulation_failed`; add each to `http.ts` `STATUS` (22-35) and, where it must pass through, to web `worker.ts` `PASS` (line 10; already includes 403, 409, 410, 422). `LedgerKind` (109-121) gains `leftover_burn`, `evacuate`; both are public, so `PublicKind` (123) needs no change. Destination refusal is a 200 simulation result with `destinations.ok = false` (Pitfall 14: `worker.ts` 30-31 rebuilds error bodies from `error` and `paused` only).

#### `packages/core/src/fees.ts`

Add both kinds to `PUBLIC_KINDS` (8-18) and two `case`s in `totalsFor` (105-129): `leftover_burn` adds `bond_burned`-style supply-burned total (UI-SPEC: counts in Supply burned), `evacuate` copies the `sweep_treasury` case (`fee_budget: -amount, to_treasury: amount, to_treasury_sol: sol`).

#### `packages/core/src/coin-row.ts` (`coinRows` hidden filter)

`coinRows` (140-153) passes `where` straight through. Change to `.where(and(isNull(coins.hiddenAt), where))`; `coinRow` (134-137) stays unfiltered (D-29: token page and `announce.ts` keep working).

---

### apps/web

#### `apps/web/lib/session.ts` (admin helpers)

**Analog:** itself. Reuse private `seal`/`unseal`/`mac` (13-32); add the three functions from RESEARCH Code Example 1 beside `sessionCookie` (70-74) and `sessionWallet` (77-84):

```typescript
// session.ts 70-84
export function sessionCookie(wallet: string, now = Date.now()): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = seal(`${wallet}-${now + SESSION_MS}`);
  return `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secure}`;
}
export function sessionWallet(req: Request, now = Date.now()): string | null {
  const pair = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const [wallet, exp] = unseal(pair?.slice(COOKIE.length + 1) ?? "")?.split("-") ?? [];
  return wallet && Number(exp) > now ? wallet : null;
}
```

The admin value is tagged `admin-<wallet>-<exp>` (Pitfall 1). `verifyAdmin` copies `verifyConsent` (57-67) with `adminMessage` instead of `consentMessage`. Tests extend `session.test.ts` (setup 16-26: `vi.mock("server-only")`, `vi.stubEnv("SESSION_SECRET", ...)`, the `account()` keypair helper); the key check is "a public `sessionCookie` value under `bondr_admin` is refused".

#### `apps/web/app/api/admin/session/route.ts`

**Analog:** `apps/web/app/api/consent/route.ts` (whole). Same order: `sameOrigin` -> `rateLimited` before the body -> `json(req, MAX_BODY)` -> `BASE58_KEY` -> verify signature -> spend the nonce in `consentNonces` with `onConflictDoNothing().returning()` -> cookie. The nonce must be issued by a POST (not GET) for the admin route (Pitfall 8, every admin call is POST). Error log copies `console.error("consent write failed", cause?.code ?? "unknown")`. Wallet-not-admin answers without a cookie (403, UI copy "This wallet is not the admin wallet").

#### `apps/web/app/api/admin/[op]/route.ts` (catch-all forwarder)

**Analog:** `apps/web/app/api/trade/prepare/route.ts` (guard order and worker forward) and `app/api/trade/[id]/route.ts` (the `{ params }: { params: Promise<{ id: string }> }` signature):

```typescript
// trade/prepare/route.ts 11-27
if (!sameOrigin(req)) return new Response(null, { status: 403 });
const wallet = sessionWallet(req);
const limited = rateLimited(req, "trade-prepare", 30, 10 * 60_000, wallet ?? undefined);
if (limited) return limited;
if (!wallet) return consentRequired();
const body = (await json(req, MAX_BODY)) as Record<string, unknown> | null;
if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
const { status, body: out } = await workerPost<TradePrepareResult>("/trade/prepare", { ...fields, wallet }, 15_000);
return Response.json(out, { status, headers: { "cache-control": "no-store" } });
```

Body is RESEARCH Code Example 6. `actor` always comes from the cookie, never the body (same rule as `wallet` here, comment line 7). Unknown `op` is 404. Local ops (`overview`, `coin`, `audit`) call `lib/admin-data.ts`. Add `export const dynamic = "force-dynamic"`.

#### `apps/web/lib/admin-data.ts` (Postgres reads)

**Analog:** `apps/web/lib/trades.ts` (`import "server-only"` line 3, `PAGE` const, strict cursor parser 15-19, `limit(PAGE + 1)` for `more` 37-60). Audit keyset is `(at, id)` descending, cursor `"<iso>.<id>"` parsed strictly like `parseCursor`. Do not use `kept` (10 s cache) for admin reads: they must reflect an action that just settled. The W table budget expression already exists: `lib/coins.ts` line 96 `BUDGET`. Vanity count uses the `ready` predicate behind `vanity.ts poolSize` (line 121); export `ready` from a web-importable place or repeat the predicate with a comment pointing at it.

#### `apps/web/lib/admin-run.ts` (client flow)

**Analog:** `apps/web/lib/trade-run.ts` (whole). Copy `Stop` (16-22), `call` (24-30), the poll loop shape (76-91, 1 s, deadline). Signing is `signMessage` over the worker's returned text bytes, as `saveConsent` (consent-dialog.tsx 146-163):

```typescript
const message = new TextEncoder().encode(consentMessage(address, n.nonce, n.expires));
const signature = await signMessage(message).catch((e: unknown) => (rejected(e) ? "rejected" : "failed"));
...
body: JSON.stringify({ wallet: address, nonce: n.nonce, signature: btoa(String.fromCharCode(...signature)) }),
```

Here the message is `new TextEncoder().encode(sim.message)` (never rebuilt client-side). No Solana library (header line 2-3 rule). A 401 anywhere throws `Stop("unauthorized")`, which the console turns into the expired sign-in card.

#### `apps/web/lib/admin-copy.ts` + test (pure maps)

**Analog:** `apps/web/lib/ledger-copy.ts` (`Tone` type line 6, `Record<Kind, Entry>` 24+, a `known()` guard 80) and the code-to-copy map in `components/launch-sign.tsx` 44-60. One `Record<AdminAction, {label, tx, reason, callout?}>`, one `Record<ErrorCode, string>` (UI-SPEC error table), state-to-tag/chip, next-step copy. Test copies `ledger-copy.test.ts`: every action has a reason, every state maps to a chip or All.

#### `apps/web/lib/use-health.ts` (visibility poll)

No existing visibility-aware poll. Use RESEARCH Code Example 7 verbatim (setTimeout chain after the response, cleared on hidden). Shape the hook like `useClock` (token-trades.tsx 155-164) for cleanup.

#### `apps/web/app/admin/page.tsx` (server page)

**Analog:** `apps/web/app/coin/[mint]/page.tsx` 1-40: `export const dynamic = "force-dynamic"`, typed `Metadata`, server-side reads before render. Static metadata: `{ title: "BONDR owner console", robots: { index: false, follow: false } }` (simple form as `app/terms/page.tsx` line 5). Read the cookie through `next/headers` `cookies()` and pass to `adminSession`; `ADMIN_WALLET` unset renders the not-configured card with no DB read.

#### `apps/web/components/admin-sim.tsx` (dialog)

**Analog:** `consent-dialog.tsx` 17-21 and 57-86. Copy the `DIALOG` class string, dropping the leaf radial (UI-SPEC: "no leaf top glow") and widening to `md:w-[min(640px,calc(100%-32px))]`.

```tsx
// consent-dialog.tsx 42-46, 59-69
useEffect(() => {
  if (!dialog.current?.open) dialog.current?.showModal();
  box.current?.focus();
}, []);
<dialog ref={dialog} aria-labelledby="consent-heading" className={DIALOG}
  onCancel={(e) => { e.preventDefault(); decline(); }}
  onClick={(e) => e.target === e.currentTarget && decline()}>
```

Initial focus goes to Cancel (UI-SPEC), and `onCancel` is ignored while signing or sending. Error lines reuse the `Fault` look (consent-dialog.tsx 165-180).

#### `apps/web/components/admin-signin.tsx`

**Analog:** `ConsentPrompt` (consent-dialog.tsx 36-88) for wallet state, `signMessage`, and `Fault` for the error states; it is an inline card, not a dialog. `useWallet()` from `wallet.tsx` 235 (`signMessage` at 38).

#### `apps/web/components/admin-audit.tsx`

**Analog:** `token-trades.tsx` `useOlder` 68-86 and `LoadMore` 207-226 (import `LoadMore` and pass a `copy` object; its prop type is `typeof TRADE_COPY`, `{more, end, error}`). `useOlder` fetches GET; the admin version must POST to `/api/admin/audit` with `{before}`.

#### `apps/web/components/admin-wtable.tsx`

**Analog:** `token-trades.tsx` `FeedTable` and section shell 232-235 (panel classes), plus `Chips` (trade-amount.tsx 15-43) with the new `wrap` prop. Filtering and "Show all" are client-side over the one loaded list.

#### `apps/web/components/admin-switches.tsx`

Native `<button role="switch" aria-checked>` (UI-SPEC, not a shared component). The pressed-state styling idiom is `aria-pressed:` in `Chips` (trade-amount.tsx 34); use `aria-checked:` the same way.

#### Other new panels (`admin-console`, `admin-wallets`, `admin-health`, `admin-timeline`, `admin-inspect`, `admin-moderation`, `admin-evacuate`)

Section shell from `token-trades.tsx` 232-239 (`<section aria-labelledby>`, panel gradient classes, `display text-[28px]` h2). Form fields from `ui-field` (`Input`, `Label`, `FieldError`, used in `trade-amount.tsx` line 7). Timeline `<ol>` with `TxLink` follows `token-ledger.tsx`. Callouts from `callout.tsx`.

#### `apps/web/components/tag.tsx` (mod)

Add one variant at line 13: `danger: "border-destructive/45 bg-danger-wash text-destructive",` (same opacity pattern as `warn`).

#### `apps/web/components/trade-amount.tsx` `Chips` (mod)

Add `wrap?: boolean` next to `size?: "sheet"` (line 20); with `wrap`, the fieldset gets `flex-wrap` and chips drop `flex-1`, `px-3`, `min-h-11 md:min-h-8`. Pattern: the existing `cn(..., props.size === "sheet" ? ... : ...)` at 33-36.

#### `apps/web/lib/ledger-copy.ts` (mod)

Two `COPY` entries (24+), shaped like `collect` (25-29): `leftover_burn` `{tag: "Leftover burn", tone: "leaf"}`, `evacuate` `{tag: "Emergency", tone: "warn"}`, text per UI-SPEC "Public copy additions".

#### Launch `blocked` copy

Add `"blocked"` to `CODES` in `apps/web/lib/launches.ts` (28-40) and an entry to the copy map in `components/launch-sign.tsx` (44-60): `blocked: { text: "This wallet cannot launch coins on BONDR.", action: null }`.

---

### e2e and fork

#### `apps/web/e2e/admin-switch.e2e.ts` (+ hide/block, serial)

**Analog:** `paused.e2e.ts` 1-40: `rootEnv()` for worker URL/token, `test.describe.configure({ mode: "default" })`, `test.skip(!WORKER_URL ...)`, restore in `afterAll`. Register a serial project in `playwright.config.ts` 32-39 like `paused` (`testMatch`, `dependencies: ["chromium"]`) and add its files to the chromium `testIgnore`.

#### `apps/web/e2e/phantom.ts` (mod)

`adminAccount = () => seedAccount("admin:devnet:e2e")` next to `simDevAccount` (line 42). `adminSignIn(request, account)` copies `signIn` (97-106) with the admin nonce POST and `adminMessage`. `injectPhantom` (112-125) already records every signed message in `messages`, so the intent text assertion is free.

#### `apps/web/e2e/admin-stubs.ts`

**Analog:** `trade-stubs.ts` `stubTrade` 92-115 (`page.route("**/api/trade/...")`). Stub `/api/admin/simulate`, `/execute`, `/intent` so no UI spec spends devnet SOL (Pitfall 11).

#### `apps/web/e2e/shoot.ts`, `playwright.config.ts`

Add `export const PHASE6_SHOTS = shots("06-admin-dashboard");` after line 10. Add `ADMIN_WALLET` to the worker env (line 51) and `webEnv` (line 58).

#### `scripts/spike/stages/admin.ts`

**Analog:** `scripts/spike/stages/engine-bond.ts` 1-40: imports worker modules by relative path (`../../../apps/worker/src/fee-burns.ts`), builds `FeeDeps` with `memoryLedger`, returns `Row`s. Register in `scripts/spike/nets/fork.ts` after `engineFinalStage` (line 26) and add a row to `scripts/spike/stages/README.md`.

---

## Shared Patterns

### Contract errors only, never raw text
**Source:** `apps/worker/src/http.ts` 11-36, 92-96; `apps/web/lib/worker.ts` 27-32
**Apply to:** every admin route (worker and web). Throw `fail({error})`; unexpected errors log through `redact` and answer `build_failed`. Web rebuilds error bodies from `error` and `paused` only, so anything the dialog needs (destination account names) must ride a 200 body.

### Request guards on every web admin route
**Source:** `apps/web/lib/guard.ts` `sameOrigin` 7-16, `json` 22-43, `rateLimited` 80-97, `BASE58_KEY` 46
**Apply to:** `api/admin/session`, `api/admin/[op]`. All POST (Pitfall 8). Order: `sameOrigin`, cookie, `rateLimited`, then the body.

### Error logging that reaches Sentry
**Source:** `apps/worker/src/main.ts` 27-28 (same in `fee-engine.ts` 57-58)
```typescript
const failed = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
```
**Apply to:** every new worker module. Never log `ADMIN_WALLET` values, intent text, `SENTRY_READ_TOKEN` or audit params.

### Intent-first rows, guarded UPDATE, DB checks
**Source:** `apps/worker/src/launches.ts` 25-38; `packages/core/src/schema.ts` 89-96, 194-225
**Apply to:** `admin_audit`, `blocked_deployers`, `coins` hidden/held columns, the switch columns.

### In-memory stores for one replica
**Source:** `apps/worker/src/trade-store.ts` 1-4 (ponytail header), 26-39
**Apply to:** `admin-intent.ts`, `health.ts`, `rpc-stats.ts`, `switches.ts`, `Engine.failures`.

### No timer reads Postgres
**Source:** `apps/worker/src/main.ts` 1-3, `status.ts` 176-178
**Apply to:** `/admin/health` (memory only), `use-health.ts` (only the health poll is on a timer).

### Send path is `d.land` only
**Source:** `apps/worker/src/fee-send.ts` `land` 240-259 (ops floor, `signTx` program allowlist, intent-first ledger insert, broadcast, settle)
**Apply to:** every admin money action, EVACUATE, Run migrate. The admin `land` wraps it with the destination check; never call `broadcast` or `sendTx` directly.

### DB-backed tests skip without DATABASE_URL
**Source:** `packages/core/src/db.test.ts` 8-10
**Apply to:** `admin-audit.test.ts`, moderation tests, extended `db.test.ts`.

### Docs and shortcuts
`ponytail:` comments (examples `trade-store.ts` 3-4, `guard.ts` 48, `lib/coins.ts` 65-66). One README line per new file in `apps/worker/src/README.md` (40 lines), `apps/web/components/README.md` (50), `apps/web/lib/README.md` (36). Runbook note in `apps/worker/README.md` that `/kill-switch` and `/fee/release` stay bearer-only and unaudited.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/worker/src/rpc-stats.ts` | utility | streaming ring | No request timing exists; use RESEARCH Code Example 4 and the web3.js `ConnectionConfig.fetch` option |
| `apps/worker/src/admin-inspect.ts` (decoder part) | service | transform | No instruction decoder exists; use RESEARCH Pattern 10 (SDK `program.coder.instruction.decode/format`). Error mapping does have an analog (`trade-error.ts`) |
| `apps/web/lib/use-health.ts` | hook | visibility poll | Existing polls are not visibility-aware; use RESEARCH Code Example 7 |
| Optional audit immutability trigger in `0007_admin.sql` | migration | - | No custom SQL migration exists yet; `drizzle-kit generate --custom` |

## Metadata

**Analog search scope:** `apps/worker/src`, `packages/core/src`, `packages/core/migrations`, `apps/web/{app,components,lib,e2e}`, `scripts/spike/{stages,nets}`, `playwright.config.ts`
**Files scanned:** about 50 read or grepped
**Pattern extraction date:** 2026-10-25
