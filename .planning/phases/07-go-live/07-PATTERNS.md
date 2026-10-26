# Phase 7: Go-Live - Pattern Map

**Mapped:** 2026-10-26
**Files analyzed:** 74 (new and modified, incl. tests, scripts, docs)
**Analogs found:** 70 / 74

Paths are repo-relative. Line numbers are from the tree at commit 33c101e (branch `phase-07-go-live`). No new npm packages (RESEARCH Standard Stack). Every pattern below is a copy of code that already exists; the planner should cite these lines in plan actions.

## Line budget (300-line rule, files this phase modifies)

| File | Lines now | Phase 7 adds | Action |
|---|---|---|---|
| `packages/core/src/send.ts` | 294 | one char (0 to 1 at 151) | Fits. Nothing else goes here |
| `apps/worker/src/prepare.ts` | 293 | ticker read in `admit`, tip in balance gate, genesis branch | **Over if inlined.** Ticker query and refusal go in new `ticker.ts`; genesis prepare in new `genesis.ts`; prepare.ts gains at most ~4 lines (one `Promise.all` entry, one refusal line, `+ tip` at 255) |
| `packages/core/src/schema.ts` | 283 | `coins.createSlot`, `coins.snipedBps`, `launches_symbol_live` index (~4) | Fits (~287). If more appears, use the `schema-admin.ts` precedent (`export *` at the end) |
| `apps/worker/src/admin-evacuate.ts` | 281 | mainnet branch in `simulateEvacuate` 219 and `evacuateRefusal` 228-231 (~2) | Fits; reuse one predicate exported from `env.ts` |
| `apps/web/components/launch-sign.tsx` | 278 | 2 FAULTS entries (`ticker_locked`, `ticker_reserved`), genesis error copy (3) | Borderline (~290). Put the retryAfter-to-hours copy function in a pure lib file (e.g. `lib/ticker-copy.ts`) |
| `apps/worker/src/fee-send.ts` | 271 | `?api-key=` on SENDER_URL at call time (~2) | Fits |
| `apps/worker/src/ingest.ts` | 258 | -32015 drop, genesis-row exclusion in backfill, sniped hook in `writeParsed` (~8) | Fits only if the sniped query lives in new `sniped.ts` |
| `apps/web/components/launch-buy.tsx` | 257 | genesis hint, locked Sell card, `+ senderTipEstimate` in `needed` (~15) | Fits (~272) |
| `packages/core/src/api.ts` | 253 | `PauseReason` +2, `Status.senderTipEstimate`, 2 error codes, `ApiError.retryAfter`, genesis status fields (~8) | Fits |
| `packages/core/src/launch.ts` | 237 | `buildGenesis` (~25) | Fits (~262); if it grows, `launch-genesis.ts` |
| `apps/worker/src/status.ts` | 236 | net from env, pause priority, genesis skip of `fetchPumpQuote`, `senderTipEstimate` (~15) | Fits |
| `apps/web/components/launch-flow.tsx` | 208 | `PAUSED` becomes `{title, body}` x4, owner-genesis prop (~15) | Fits |
| `apps/worker/src/env.ts` | 122 | mainnet net, `TREASURY_PUBKEY`, optional Q, lane `production`, EVACUATE rule, `treasuryKey()` (~40) | Fits (~165) |
| `apps/worker/src/main.ts` | 106 | genesis boot branch, contract check boot + timer, route (~15) | Fits |

## File Classification

### packages/core

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/send.ts` (mod: `fetchTx` version 1, line 151) | utility | request-response (RPC) | itself 146-156 | exact |
| `packages/core/src/net.ts` (mod: mainnet `rpcUrl`/`wsUrl`/`connect`) | config | request-response | itself 21-30, 45-57 (fork guard) | exact |
| `packages/core/src/keys.ts` (mod: `Net` gains `"mainnet"`) | config | - | itself line 8 | exact |
| `packages/core/src/contract.ts` (new: program/account/flag checks, profiles, `effective`/`drift` moved in) | service | request-response (RPC, pure compare) | `packages/core/src/config.ts` `readLiveConfig` 20-46 + `scripts/spike/stages/config.ts` 9, 41-59 | exact |
| `packages/core/src/contract.test.ts` (new) | test | - | `apps/worker/src/env.test.ts` 7-15 (inline fixture objects) | role-match |
| `packages/core/src/launch.ts` (mod: `buildGenesis`) | service (builder) | transform | itself `buildLaunch` 211-237, `childAmount` 135-146, `exitIxs` burn 184-187; `scripts/spike/stages/create.ts` `standIn` 20-43 | exact |
| `packages/core/src/rules.ts` (mod: `RESERVED_TICKERS` + separate pure guard) | utility | transform | itself `checkSymbol` 31-36, `checkDevBuy` 102 | exact |
| `packages/core/src/schema.ts` (mod: 2 coin columns, partial index) | model | CRUD | itself `launches` indexes 99-101, `coins.lastSlot` 137 | exact |
| `packages/core/migrations/0008_*.sql` + `meta/_journal.json` + snapshot (new) | migration | - | `migrations/0007_admin.sql` (generated head, hand-written trigger block 49-65) | exact |
| `packages/core/src/api.ts` (mod) | model (contract) | - | itself `PauseReason` 5, `Status` 8-17, `LaunchErrorCode` 22-47, `ApiError` 50 | exact |
| `packages/core/src/api-admin.ts` (mod: `AdminHealth.contract`, `.genesis`) | model (contract) | - | itself `AdminHealth` 39-59 (`sentry` union 52-58 is the shape for `contract`) | exact |
| `packages/core/src/trades.ts` (mod: `newCoin` sets `createSlot`) | utility | transform | itself `newCoin` 190-216 | exact |
| `packages/core/src/db-admin.test.ts` (extend: TRUNCATE raises) | test | - | itself DELETE case near 169, `pgCode` 28-36, `ROLLBACK` 40 | exact |
| `packages/core/src/fixtures/v1-bondr-sell.json` (new) | fixture | - | existing `fixtures/curve-buy.json` captured by `scripts/capture-tx.ts` | exact |
| `packages/core/src/trades.test.ts` (extend: v1 fixture + derived `asV1`) | test | - | itself (fixture loader) | exact |

### apps/worker

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/worker/src/env.ts` (mod) | config | boot | itself `launchNet` 10-19, `adminWallet` 51-58, `adminEvacuate` 71-76, lane 88-89, Q 90-95, role helpers 117-122 | exact |
| `apps/worker/src/env.test.ts` (extend) | test | - | itself 7-28 | exact |
| `apps/worker/src/main.ts` (mod: genesis branch, contract check boot/timer/route) | config | boot | itself `bootIndex` 38-55, routes 65-87, `listening` 88-96 | exact |
| `apps/worker/src/contract-check.ts` (new: memory result, schedule, pause, route handler) | service | event-driven (timer) + request-response | `fee-batch.ts` `nextBatchAt` 171-174 + `scheduleBatch` 191-200; `health.ts` module memory 14-29; `status.ts` `setSwitch` audited 184-192 | role-match |
| `apps/worker/src/contract-check.test.ts` (new) | test | - | `admin-intent.test.ts` (injected `now`), `env.test.ts` | role-match |
| `apps/worker/src/switches.ts` (mod: switches-only pause sibling) | store | memory + DB | itself `pauseAll` 62-72 (minus `evacuatedAt`) | exact |
| `apps/worker/src/genesis.ts` (new: genesis prepare) | service | request-response | `prepare.ts` `admit` 132-161, `prepareOne` 252-274, `optsFor` 177-188; `admin-routes.ts` `gated` 23-29 | exact |
| `apps/worker/src/genesis.test.ts` (new) | test | - | `prepare.test.ts` (stubbed ctx) | exact |
| `apps/worker/src/ticker.ts` (new: cooldown read + pure refusal) | store (read) | CRUD read | `admin-moderate.ts` `blocked` 65-72; `launches.ts` `newTablesToday` 78-86 (raw `sql` interval) | exact |
| `apps/worker/src/ticker.test.ts` (new, DB) | test | - | `admin-moderate.test.ts` / `db-admin.test.ts` 20-40 (env load, rollback) | exact |
| `apps/worker/src/prepare.ts` (mod: ticker in `admit`, tip in gate) | service | request-response | itself `admit` 132-161, gate 255 | exact |
| `apps/worker/src/build.ts` (mod: `compileLaunch(..., tip?)`, `previewCosts` tip) | service | transform | itself `compileLaunch` 77-94, `previewCosts` 134-139 | exact |
| `apps/worker/src/submit.ts` (mod: Sender when stored message is tipped) | service | request-response | itself `send` 60-79 (broadcast at 69); `fee-send.ts` `urgentBroadcast` 136-161 | exact |
| `apps/worker/src/fee-send.ts` (mod: Sender `?api-key=`) | service | request-response | itself 150 (`post(SENDER_URL, ...)`) | exact |
| `apps/worker/src/fee-config.ts` (mod: `paceMs` 1100 everywhere, `OPS_FLOOR` per net, `launchTipLamports`) | config | - | itself `feeConfig` 33-42 | exact |
| `apps/worker/src/status.ts` (mod: net, pause priority, genesis, tip estimate) | service | request-response (cached) | itself `pauseReason` 45-48, `readLive` 147-161 (`net` hardcoded at 153) | exact |
| `apps/worker/src/ingest.ts` (mod: -32015 drop, backfill exclusion, sniped hook) | service | streaming / CRUD | itself `ingestOrKeep` 174-184, `backfillLaunches` 235-258, `writeParsed` 88-105 | exact |
| `apps/worker/src/sniped.ts` (new: one aggregate + coin write) | store | CRUD (write on change) | `ingest.ts` `applyPatch` 61-83 (guarded coin UPDATE in caller's tx); `apps/web/lib/coins.ts` `heroCounts` 114-125 (raw `sql<number>` aggregate) | role-match |
| `apps/worker/src/admin-inspect.ts` (mod: version 1 at 158, explorer by net at 168, treasury key at 177) | service | request-response (RPC) | itself 157-170; web `format.ts` `explorer` 32-33 | exact |
| `apps/worker/src/admin-intent.ts` (mod: IN-W-04 eviction) | store | in-memory TTL | itself `putIntent` 75-98 (sweep 76, drop-oldest 77) | exact |
| `apps/worker/src/admin-intent.test.ts` (extend) | test | - | itself "at most INTENT_MAX" 168-175 | exact |
| `apps/worker/src/admin-evacuate.ts` (mod: mainnet + external treasury) | service | batch | itself `simulateEvacuate` 214-224 (gate 219), `evacuateRefusal` 228-231 | exact |
| `apps/worker/src/admin-routes.ts` (mod: `POST /admin/contract-check`) | controller | request-response | itself routes 106-126 (`"POST /admin/health"` 107) | exact |
| `apps/worker/src/health.ts` (mod: `contract`, `genesis` in snapshot) | utility | memory | itself `healthSnapshot` 38-57 | exact |
| `apps/worker/src/http.ts` (mod: `STATUS` +2 codes) | controller | - | itself 22-44 | exact |
| `apps/worker/src/grind.ts` (mod: per-lane `[low, target]`) | service | batch | itself `startRefill` 78-91 (thresholds at 85) | exact |
| `apps/worker/src/vanity.ts` (mod: `Lane` gains `production`) | store | - | itself line 11 | exact |
| `apps/worker/src/fee-boot.ts`, `admin-overview.ts` (mod: `treasuryKey(env)` instead of `treasury(seed, net).publicKey`) | config | - | `fee-boot.ts` 62, `admin-inspect.ts` 177, `admin-overview.ts` 35 | exact |
| `apps/worker/src/trade-quote.ts` (mod: `TradeNet` alias of `Net`) | config | - | itself line 21 | exact |
| `apps/worker/src/submit.test.ts`, `fee-send.test.ts`, `status.test.ts`, `ingest.test.ts`, `prepare.test.ts` (extend) | test | - | themselves | exact |
| `apps/worker/src/README.md`, `apps/worker/README.md` (mod: new files, mainnet runbook D-38, Env line 72, EVACUATE 82-90, deploy 132-141) | doc | - | themselves | exact |

### apps/web

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/web/lib/worker.ts` (mod: pass `retryAfter` through) | service | request-response | itself 27-32 (rebuild at 31) | exact |
| `apps/web/components/launch-flow.tsx` (mod: per-reason `PAUSED`, owner-genesis prop) | component | display | itself `PAUSED` 120-123, banner 182-186 | exact |
| `apps/web/app/launch/page.tsx` (mod: server cookie check) | route (page) | request-response | `apps/web/app/admin/page.tsx` 14-17 (`cookies()` + `adminSession`) | exact |
| `apps/web/app/api/launch/prepare/route.ts` (mod: forward `actor` for genesis) | route | request-response | itself 13-27; `app/api/admin/[op]/route.ts` 78-86 (actor from cookie, last in spread) | exact |
| `apps/web/components/launch-buy.tsx` (mod) | component | display | itself `needed` 33-34; `ExitCard` lock look (Streamflow card) | exact |
| `apps/web/components/launch-review.tsx` (mod: genesis rows) | component | display | itself `rows()` 25-43 | exact |
| `apps/web/components/launch-receipt.tsx` (mod: Sender tip row, genesis groups) | component | display | itself `now` 54-59, `cost`/`gap` 33-40 | exact |
| `apps/web/components/launch-sign.tsx` (mod: FAULTS +2, genesis copy) | component | display | itself `FAULTS` 42-70 (`blocked` entry 64) | exact |
| `apps/web/lib/ticker-copy.ts` + test (new, pure) | utility | transform | `apps/web/lib/admin-copy-health.ts` `since` 19-22 (hours rounding); `admin-copy-health.test.ts` | role-match |
| `apps/web/app/coin/[mint]/page.tsx` (mod: Sniped line) | route (page) | display | itself `CoinIdentity`/`ProofStamp` 154-160 | exact |
| `packages/core/src/coin-row.ts` (mod: select `snipedBps`, `createSlot`) | model (read) | CRUD read | itself select list (`holders` 63) | exact |
| `apps/web/lib/coins.ts` (mod: exact-ticker oldest-first + `first`) | service (read) | CRUD read | itself `matches` 33-38, `ORDER` 41-45, `listCoins` 69-76 | exact |
| `apps/web/components/admin-health.tsx` (mod: contract cell + Run check now) | component | polling | itself `HealthCell` 26-40, `StuckLine` button 52-66, cells 92-108 | exact |
| `apps/web/lib/admin-copy-health.ts` + test (mod: `contractCopy`) | utility | transform | itself `Cell`/`Tone` 5-6, `vanityCopy` 126-130, `reconcileCopy` 134-142 | exact |
| `apps/web/components/admin-switches.tsx` (mod: mismatch + genesis callouts) | component | display | itself `Notices` 89-106 | exact |
| `apps/web/app/terms/page.tsx`, `apps/web/lib/terms.ts` (mod) | page / config | - | `SECTIONS` 01 at 14-24, 08 at 111-121; `TERMS_VERSION` line 2 | exact |
| `apps/web/proxy.ts` (mod: www to apex before rate limit) | middleware | request-response | itself 9-25 | exact |
| `apps/web/e2e/*.e2e.ts` (mod: `@smoke` tags; terms, launch-sign, admin-signin replay, paused banners) | test (e2e) | - | `terms.e2e.ts` 19-46, `admin-signin.e2e.ts` 41-45, 89; `launch-stubs.ts` 17, 42 | exact |

### CI, scripts, spike, env

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `.github/workflows/ci.yml` (new) | config | batch | none in repo; RESEARCH "CI workflow skeleton" | no analog |
| `scripts/setup.sh`, `dev.sh`, `test.sh`, `deploy.sh` (new) | utility (shell) | batch | `scripts/spike/fork.sh` 1-50 (POSIX sh, `set -eu`, until-loop wait); `scripts/check-client-bundle.sh` (exit codes) | role-match |
| `package.json` (mod: `setup`, `dev`, `verify`, `deploy` scripts) | config | - | itself scripts 9-24 | exact |
| `scripts/README.md` (mod) | doc | - | itself 5-11 | exact |
| `scripts/capture-tx.ts` (mod: version 1 at 38) | utility | request-response | itself | exact |
| `scripts/contract-check.ts` or `scripts/spike/stages/config.ts` reuse (devnet/fork run) | test (chain) | request-response | `scripts/spike/stages/config.ts` `configStage` 61-79 | exact |
| `scripts/spike/stages/genesis.ts` + `nets/fork.ts` entry (D-33) | test (fork) | batch | `scripts/spike/stages/create.ts` `standIn` 20-43; `nets/fork.ts` `stages` 18-37 | exact |
| `apps/web/e2e/fixtures.ts:145`, `scripts/spike/stages/pool-launch.ts:36` (mod: version 1) | test fixture | - | themselves | exact |
| `vitest.config.ts` (mod: `ticker.test.ts` in `DB`) | config | - | itself `DB` 5-19 | exact |
| `.env.example` (mod: `SOLANA_NET` 5, `VANITY_LANE` 22, `BONDR_QUOTE_MINT` 26, `ALLOW_MAINNET` 32, `ADMIN_EVACUATE` 44, new `TREASURY_PUBKEY`) | config | - | itself | exact |

---

## Pattern Assignments

### Mainnet switch (D-01 rows 1-4, 12-16; D-10; D-37)

#### `apps/worker/src/env.ts`

**Analog:** itself. Today:

```typescript
// env.ts 10-19
export function launchNet(env: Env): "devnet" {
  const net = env.SOLANA_NET?.trim();
  if (net === "devnet") return "devnet";
  if (net === "mainnet") {
    if (env.ALLOW_MAINNET !== "1")
      throw new Error("SOLANA_NET=mainnet refused: set ALLOW_MAINNET=1 to allow it");
    throw new Error("SOLANA_NET=mainnet refused: mainnet RPC is not wired until Phase 7");
  }
  throw new Error("SOLANA_NET must be devnet");
}
```

Change line 16 to `return "mainnet"`, return type `"devnet" | "mainnet"`, error text at 18 "must be devnet or mainnet". Keep line 14-15 verbatim (refused without the flag; the test row asserts it).

- `TREASURY_PUBKEY`: copy `adminWallet` (51-58, round-trip `new PublicKey(v).toBase58() === v`) but **throw** on mainnet when missing/invalid/off-curve (`PublicKey.isOnCurve`) or equal to `ops`/`buyback`/derived `treasury` (RESEARCH Pattern 4). Unused on devnet (derived treasury stays).
- Export one `treasuryKey(env): PublicKey` next to the role helpers (117-122) and retype them `net: Net` (not `"devnet"`). Callers: `fee-boot.ts:62`, `admin-inspect.ts:177`, `admin-overview.ts:35`.
- `adminEvacuate(raw, net)` 71-76: replace line 74's `net !== "devnet"` with a predicate `net === "devnet" || (net === "mainnet" && treasuryOk)`; evaluate the treasury first so the predicate can use it. Export the same predicate for `admin-evacuate.ts` 219/230 (no second copy).
- Lane 88-89: add `"production"` to the check and to the cast at 103; `vanity.ts:11` `Lane` must match.
- Q 90-95: optional only when `net === "mainnet"`; `quoteMint: PublicKey | null`. Devnet unset still throws (D-29: genesis mode refuses on devnet).
- Header rule line 2 applies: never log `TREASURY_PUBKEY` comparisons with values in the message.

**Test:** extend `env.test.ts` using its `base`/`load` helpers (7-15). One test per inventory row: mainnet without `ALLOW_MAINNET` throws "ALLOW_MAINNET"; with it and a valid treasury returns `"mainnet"`; missing/equal-to-ops treasury throws; `ADMIN_EVACUATE=on` mainnet refused without treasury, accepted with it (closes T-06-08-06); devnet without Q throws; mainnet without Q gives `quoteMint: null`; `VANITY_LANE=production` accepted.

#### `packages/core/src/net.ts`

**Analog:** itself. Add the mainnet URL beside the devnet one, and widen the genesis rule:

```typescript
// net.ts 21-24, 45-55
function rpcUrl(net: Net): string {
  if (net === "fork") return process.env.SPIKE_FORK_URL || "http://127.0.0.1:18899";
  return `https://devnet.helius-rpc.com/?api-key=${heliusKey()}`;
}
...
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  if (net === "fork" && !local) throw new Error(redact(`fork RPC must be 127.0.0.1 or localhost: ${url}`));
  ...
  const ok = net === "devnet" ? genesis === DEVNET_GENESIS : local && genesis === MAINNET_GENESIS;
```

Mainnet: `https://mainnet.helius-rpc.com/?api-key=` / `wss://mainnet.helius-rpc.com/?api-key=`; add `if (net === "mainnet" && local) throw` next to line 48; `ok` for mainnet is `!local && genesis === MAINNET_GENESIS` (D-03). Update the comment at 26 ("Net has no mainnet member") since it becomes false. Test in `net.test.ts` with an injected `fetch` (the `opts.fetch` seam at 45).

#### `packages/core/src/keys.ts`

Line 8: `export type Net = "devnet" | "fork" | "mainnet";`. The HMAC domain at 11 already includes `net`, so mainnet ids never collide (header 1-2). Leave `scripts/spike/keygen.ts:9` `NETS = ["devnet", "fork"]` unchanged (D-03). `trade-quote.ts:21` `TradeNet = Net | "mainnet"` collapses to `Net`.

#### `apps/worker/src/fee-config.ts`

**Analog:** itself `feeConfig` 33-42. Per-net values live here only (D-02):

```typescript
// fee-config.ts 33-41
export function feeConfig(net: TradeNet): FeeConfig {
  const devnet = net === "devnet";
  return {
    collectMinLamports: devnet ? 10_000 : 1_000_000,
    senderTipLamports: 1_000_000,
    paceMs: devnet ? 1100 : 0,
```

- `paceMs: 1100` on every net (RESEARCH Pattern 3 row 9: mainnet is 0 today, CONTEXT assumed otherwise).
- Move `OPS_FLOOR_LAMPORTS` (line 8) into `FeeConfig` as `opsFloorLamports` (mainnet 0.1 SOL per G-4 default, devnet 0.05). Readers: `build.ts:67`, `fee-send.ts:104`.
- Add `launchTipLamports` (default 1_000_000, G-6). Comment the Pitfall 10 rule (5_000 needs `?swqos_only=true`).

#### `apps/worker/src/admin-inspect.ts`

```typescript
// admin-inspect.ts 157-168
const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
...
explorer: `https://solscan.io/tx/${sig}?cluster=devnet`, // devnet only: env refuses mainnet
```

158: 0 to 1. 168: the web rule from `apps/web/lib/format.ts` 32-33 (`net === "devnet" ? "?cluster=devnet" : ""`), with `net` passed in from env; delete the stale comment. 177: `treasuryKey(env)`.

#### `apps/worker/src/status.ts`

- Line 153 `net: "devnet" as const` becomes `net: env net` (add `net` to `Ctx` at 24, set in `main.ts` 62). Web `launch-sign.tsx:267` and `launch-live.tsx` build Solscan links from it (Pattern 3 row 14).
- `pauseReason` 45-48 gains the UI-SPEC priority: `genesis`, then `contract_check`, then `awaiting_migration`, then `kill_switch`:

```typescript
// status.ts 45-48
export function pauseReason(s: { enabled: boolean; venue: Where }): PauseReason | null {
  if (!s.enabled) return "kill_switch";
  return s.venue === "awaiting" ? "awaiting_migration" : null;
}
```

  Add `genesis: boolean` and `contract: boolean` inputs (contract = memory flag from `contract-check.ts`), checked first. Keep it pure so `status.test.ts` is a table test.
- Genesis: `readChain` 123-143 calls `fetchPumpQuote(ctx.Q)` at 128 and `bondrLegBps` at 134; with `Q === null` skip both, keep `minLamports` from Global (138) and `createCost`.
- `senderTipEstimate`: `net === "mainnet" ? String(feeConfig(net).launchTipLamports) : null` in the `status` object 152-159.

### v1 ingest (D-15)

#### `packages/core/src/send.ts` `fetchTx` (line 151)

```typescript
// send.ts 146-156
export async function fetchTx(conn: Connection, sig: string) {
  for (let i = 0; i < 20; i++) {
    const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
```

0 to 1. Covers ingest, settle, trade-submit, fee-send meta, finalize (RESEARCH Pattern 1 call-site table). Also change `scripts/capture-tx.ts:38`, `apps/web/e2e/fixtures.ts:145`, `scripts/spike/stages/pool-launch.ts:36`. Do not touch `send.ts:68` `checkMessage` "not v0" (row 17: BONDR builds only v0).

#### `apps/worker/src/ingest.ts` `ingestOrKeep` (174-184)

```typescript
// ingest.ts 174-184
export async function ingestOrKeep(conn: Connection, sig: string, ingest: Ingest = ingestTx): Promise<void> {
  try {
    await ingest(conn, sig);
    failed.delete(sig);
  } catch (e) {
    const n = (failed.get(sig) ?? 0) + 1;
    logged(`ingest ${sig} (try ${n}${n < TRIES ? "" : ", giving up"})`)(e);
    if (n < TRIES) failed.set(sig, n);
    else failed.delete(sig);
  }
}
```

First line of the catch: `if (unsupported(e)) { failed.delete(sig); log once; return; }` with `unsupported` from RESEARCH Code Example (`e instanceof SolanaJSONRPCError && e.code === -32015`). The test uses the existing `ingest` injection parameter and asserts `failedSigs()` (line 172) stays empty. "Dropped cheaply" already holds: `ingestTx` returns `[]` at 126 when nothing parses.

### Sender for launches (D-34, LAUNCH-08)

#### `apps/worker/src/build.ts` `compileLaunch` (77-94)

```typescript
// build.ts 77-88
export function compileLaunch(
  o: Pick<LaunchOpts, "dev" | "mint" | "exit">,
  ixs: TransactionInstruction[],
  table: AddressLookupTableAccount,
  blockhash: string,
): VersionedMessage {
  const msg = new TransactionMessage({ payerKey: o.dev, recentBlockhash: blockhash, instructions: ixs });
  const v0 = msg.compileToV0Message([table]);
  const refused = checkMessage(v0);
  if (refused) throw buildFailed(refused);
  const bytes = messageSize(v0);
  if (bytes > PACKET_LIMIT) throw buildFailed(`${bytes} bytes`);
```

Add `tip: TransactionInstruction[] = []`, compile with `[...ixs, ...tip]`; if `messageSize > PACKET_LIMIT` and `tip.length`, recompile without the tip and `console.warn` (never fail, D-34). The tip is added here, after `unionTableKeys` (44-51) computed keys from `builds[e].ixs`, so the tip account stays static (Anti-Pattern: never put it in the table). Signer-layout and exit checks 89-92 run unchanged on whichever message is kept. Tip source: `tipIxs(net, o.dev, feeConfig(net).launchTipLamports)` (fee-send.ts 119-128 returns `[]` off mainnet; the param named `ops` is only `fromPubkey`).

`previewCosts` 134-139: subtract the tip with the fee (`burnSpent - solIn - fee - tip`), Pitfall 2. Callers: `prepare.ts` `finalMessage` 193-209 (`msgOf` at 196 passes the tip) and the balance gate 255 (`+ tip`). `finish` 243-248 `preview` may add `senderTip` if UI needs it; UI-SPEC reads it from `Status.senderTipEstimate`.

#### `apps/worker/src/submit.ts` `send` (60-79)

```typescript
// submit.ts 67-69
const lastValidBlockHeight = Number(row.lastValidBlockHeight);
const base = { sig: signature, bytes: wire.length, blockhash: row.blockhash ?? "", lastValidBlockHeight };
const r = await broadcast(ctx.conn, wire, { ...base, paceMs: SEND_PACE_MS });
```

Replace line 69 with: `tipped(VersionedMessage.deserialize(row.message))` (RESEARCH Code Example "Sender chosen at submit") then `urgentBroadcast(ctx.env.net, ctx.conn, wire, {...base, paceMs})` (fee-send.ts 136-161), else `broadcast`. On an explicit Sender error (`r?.status === "unknown"` with a `sender` err), send the same bytes once via `broadcast` (same signature, cannot double-execute). The rest of `send` (70-78: failed releases mint, else `sent` + `settleInBackground`) is unchanged; `urgentBroadcast` already returns `null` on accept like `broadcast`.

#### `apps/worker/src/fee-send.ts` (line 150)

`post(SENDER_URL, ...)` becomes `post(\`${SENDER_URL}?api-key=${key}\`, ...)` (Pitfall 11). `redact()` (net.ts 10-14) already strips `api-key=` from every error leaving `unknown()` (130-133). Read the key through one exported getter in `net.ts` (it already owns `heliusKey()` 16-19) rather than reading `process.env` here.

### Contract check (OPS-02, D-18..D-22)

#### `packages/core/src/contract.ts` (new)

**Analog:** `packages/core/src/config.ts` (whole, 46 lines: `Promise.all` of SDK fetches, JSON-safe `Facts`) plus the spike's pure compare:

```typescript
// scripts/spike/stages/config.ts 9, 41-58
const ASSUMED = { curveProtocol: 95, curveCreator: 150, ammLp: 20, ammProtocol: 5, minCurveDepth: 1 };
function effective(f: Facts, exotic: string, flat: string, field: string): number {
  const unset = ["lp", "protocol", "creator"].every((k) => !Number(f[`${exotic}.${k}`] ?? 0));
  return Number(f[`${unset ? flat : exotic}.${field}`]);
}
function drift(f: Facts): string[] {
  ...
  if (!f.creatorFeeConfigurable) out.push("creator fee not configurable, assumed 150 bps per coin");
  ...
  if (ammLp !== ASSUMED.ammLp) out.push(`AMM LP ${ammLp} bps, assumed 20`);
```

Move `effective` and `drift` here verbatim, with `ASSUMED` becoming a per-net `Profile` argument (mainnet/fork: creator configurable true, max >= 150, AMM LP 20; devnet: configurable false, max unchecked, AMM LP **25**, RESEARCH Pattern 5 table). Keep every existing string byte-for-byte (UI-SPEC surface 5 shows them). `scripts/spike/stages/config.ts` then imports `drift` back from `@bondr/core/contract` (D-18) and keeps `configStage` 61-79 unchanged.

New parts (no analog; use RESEARCH Code Example "Programdata deploy slot"): one `getMultipleAccountsInfo` of the three program ids, then programdata heads with `dataSlice {0,45}`, then one `getMultipleAccountsInfo` of the four config PDAs (owner, length, first 8 bytes vs IDL discriminator, SDK decode in try/catch). Program ids and PDAs come only from `pump.ts` (the single SDK import point, 06 precedent). Return `{ facts: string[], slots: Record<program, bigint> }`; an RPC throw propagates (the worker maps it to "Could not run"). Test both measured fact sets inline (Pitfall 6).

#### `apps/worker/src/contract-check.ts` (new)

Three borrowed shapes:

1. **Memory result** like `health.ts` 14-29 (module-level state, exported reader, ponytail header about per-process memory). States: `not_run | running | passed | redeployed | mismatch | failed` plus `at`, `facts`, `programs`; boot slots held in memory as the baseline (D-20 amber rule).
2. **Timer** copying `fee-batch.ts` 191-200 but self-owned (Pitfall 8: `scheduleBatch` is only wired when the engine runs, `fee-boot.ts:90`):

```typescript
// fee-batch.ts 171-174, 191-200
export function nextBatchAt(now: number, hour: number): number {
  const at = new Date(now).setUTCHours(hour, 0, 0, 0);
  return at > now ? at : at + DAY_MS;
}
export function scheduleBatch(d: FeeDeps, engine: BatchEngine, hour: number): void {
  wired = { d, engine };
  clearTimeout(timer);
  const fire = () => void batchNow()?.catch(logged("fee batch")).finally(() => scheduleBatch(d, engine, hour));
  timer = setTimeout(fire, nextBatchAt(Date.now(), hour) - Date.now());
  timer.unref();
}
```

   Import `nextBatchAt`; fire daily at `env.feeBatchHourUtc`, run only on a fixed UTC weekday (restart-safe). Single-flight like `batchNow` 182-188 (`running ??= ...finally(() => running = null)`), shared by boot, timer and the admin route.
3. **Pause** through a new switches-only sibling in `switches.ts` (below), audited with the same `audited()` call `status.ts` `setSwitch` uses:

```typescript
// status.ts 187-190
const params = { job: "launches", enabled: on };
await audited(audit, { actor: "runbook", action: "switch", mint: null, params }, () =>
  setJob("launches", on),
);
```

   Here: `actor: "contract_check"`, `action: "switch"`, `params: { job: "all", enabled: false, facts }` (no constraint migration needed). Sentry: `console.error` with the facts through the `failed()` helper shape (main.ts 32-33); a redeploy-only result is `console.warn`. "Could not run" pauses nothing.

Route: in `admin-routes.ts` add `"POST /admin/contract-check": () => runCheck()` next to line 107; it inherits `gated()` (23-29) because all routes are wrapped at 127. `main.ts`: start the boot run and the timer inside the `listening` handler (88-96), independent of `bootIndex` so it also runs in genesis mode.

**Test** (`contract-check.test.ts`, unit): inject a `check` function returning a wrong fact and a wrong size, and a fake switch writer; assert every switch off, no `evacuatedAt`, one audit call, state `mismatch`. Use the injected-`now` style of `admin-intent.test.ts`.

#### `apps/worker/src/switches.ts` (switches-only pause)

```typescript
// switches.ts 62-72
export async function pauseAll(): Promise<void> {
  const off = Object.fromEntries(Object.values(COLUMN).map((c) => [c, false]));
  const evacuatedAt = new Date();
  await db().update(settings).set({ ...off, evacuatedAt }).where(eq(settings.id, 1));
  writes++;
  const none = { launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false };
  state = { ...none, evacuatedAt: evacuatedAt.toISOString() };
}
```

Add `switchesOff()` that is the same without `evacuatedAt` (keep `state.evacuatedAt` as it was). Do not reuse `pauseAll` (Pitfall 7: it would make `/kill-switch` refuse at `status.ts:186` and show the EVACUATE callout). Genesis boot also calls `switchesOff()` (Pitfall 3).

#### `apps/worker/src/health.ts` + `packages/core/src/api-admin.ts`

`healthSnapshot` 38-57 returns one more field `contract: contractState()` and `genesis: env.quoteMint === null`; widen `HealthOpts.env` Pick at 32. `AdminHealth` (api-admin.ts 39-59) gains `contract` as a discriminated union in the style of `sentry` (52-58) and `genesis: boolean`. Types only, no imports in api files (api.ts header 1-2).

### Genesis mode and SOL-pair launch (OPS-05, D-28..D-33)

#### `packages/core/src/launch.ts` `buildGenesis` (new function)

**Analog:** `buildLaunch` 211-237 for the shape (budget first, create, buy, exit), with the SOL-pair create from the Phase 1 stand-in:

```typescript
// scripts/spike/stages/create.ts 24-25 (SOL pair, treasury creator, no quoteMint)
const creator = ctx.key("treasury", "main").publicKey;
const ix = await buildCreate({ ...STANDIN, mint: mint.publicKey, creator, user: dev.publicKey });

// launch.ts 184-187 (burn exit)
const devAta = getAssociatedTokenAddressSync(o.mint, o.dev, true, T22);
return [createBurnCheckedInstruction(devAta, o.mint, o.dev, big(p.amount), COIN_DECIMALS, [], T22)];
```

`buildCreate` (39-64) already omits the quote when `quoteMint` is absent (57-61) and the fee when `creatorFeeBps` is absent (62): pass neither (D-28). Amount: mirror `childAmount` 135-146 with `newBondingCurve(g)` and `pct(..., 9800)`. Buy: `buyExactOut({ global, mint, user: dev, quoteMint: NATIVE_MINT, amount, maxQuote: solIn })` (trade.ts handles a SOL quote). Unit test: no quote account in the create ix, creator = treasury, burn present, `exitPresent` true (cosign.ts burn detection is quote-agnostic).

#### `apps/worker/src/genesis.ts` (new)

**Analog:** `prepare.ts` (copy the pipeline, not the file). Reuse exported pieces instead of duplicating: `walletOf` 58-65, `parseRequest` 88-100, `prepareGuard` 112-120, `signBy`, `reserveMint` (export it; 163-174), `ensureTable` and `compileLaunch` from `build.ts`, `insertPrepared` from `launches.ts`. The admin gate copies `gated` (admin-routes.ts 23-29):

```typescript
// admin-routes.ts 23-29
export function gated(admin: string | null, h: Handler): Handler {
  return async (body) => {
    const actor = (body as { actor?: unknown } | null | undefined)?.actor;
    if (!admin || actor !== admin) throw fail({ error: "forbidden" });
    return h(body);
  };
}
```

Genesis rules (RESEARCH Pattern 6): `wallet === env.adminWallet` and `actor === env.adminWallet` (web forwards `actor` from the `bondr_admin` cookie), `exit === "burn"`, refuse once a landed genesis row exists (worker code name per UI-SPEC "already landed"), keep consent and caps. **Do not call the reserved-ticker guard** (Pitfall 22: genesis ticker is BONDR); the 24h read may run. Creator = `treasuryKey(env)`. Single-flight: route through the same `prepare` queue (prepare.ts 288-293) so the race comment there still holds. Dispatch in `main.ts` 69: `"POST /prepare"` calls genesis when `env.quoteMint === null`.

Settle: on landing in genesis mode, mark landed but skip `ingestLaunch` (it needs a seeded BONDR price, ingest.ts 140-141).

#### `apps/worker/src/main.ts` (genesis boot branch)

`bootIndex` 38-55 is skipped entirely in genesis mode (no `seedBondrPrice`, `loadCoins`, `startEngine`, backfill, `startStream`); call `loadSwitches()` then `switchesOff()` instead. Trade routes 72-76, `feeRoutes` 77 and `/quote` 68 answer `not_ready` (add the code to `LaunchErrorCode` and `STATUS`, or reuse `paused` with `paused: "genesis"`; planner's call). `Ctx.Q` becomes nullable at `status.ts:24`; narrow it once in the non-genesis branch rather than at every reader.

Leaving genesis: at boot with Q set on mainnet, read BONDR's curve and refuse unless quote is SOL and creator equals `treasuryKey(env)`.

#### `apps/worker/src/ingest.ts` `backfillLaunches` (235-258)

```typescript
// ingest.ts 241-243
.from(launches)
.leftJoin(coins, eq(coins.launchId, launches.id))
.where(and(eq(launches.state, "landed"), isNull(coins.mint)));
```

Add `ne(launches.mint, Q)` to the `and(...)` (Pitfall 4); `backfillLaunches` gains the Q argument from `bootIndex` 48.

#### `apps/worker/src/grind.ts` (per-lane refill, Pitfall 5)

```typescript
// grind.ts 82-85
const ready = await poolSize(db());
if (ready < 3) console.warn(`vanity pool low: ${ready} ready`);
if (ready < 10) await grind(env, 20 - ready, env.vanityThreads);
```

Replace the literals with a lane-keyed `const REFILL = { local: [10, 20], staging: [10, 20], production: [100, 150] } satisfies Record<Lane, [number, number]>` and a `ponytail:` comment (ceiling: fixed targets; upgrade: env-tunable if pool demand varies).

### Sniped % (D-35)

#### `packages/core/src/schema.ts` + `trades.ts` + `apps/worker/src/sniped.ts`

- Columns next to `lastSlot` (schema.ts 137, which uses the `big()` string type): `createSlot: big()`, `snipedBps: integer()`, both nullable (pre-Phase-7 coins show no line).
- `newCoin` (trades.ts 190-216): add `createSlot: String(c.slot)` in the returned object (the launch tx slot is the create slot). Check `Ctx` there carries `slot`; if not, it is on the `TradeTx` passed to `parseTx` (258).
- `sniped.ts`: one function `recomputeSniped(exec, mint)` run inside `writeParsed` (ingest.ts 88-105) only when an inserted row's slot is in the window. Write pattern copies `applyPatch` (ingest.ts 61-70): a guarded `exec.update(coins).set(...).where(...)` in the caller's transaction. The aggregate is RESEARCH Pattern 7's single query; raw `sql<number>` style as `heroCounts` (apps/web/lib/coins.ts 114-125). `ceil(sum * 10000 / SUPPLY)` with `SUPPLY` from `packages/core/src/price.ts:6`. Never on a timer (Anti-Pattern).

#### `apps/web/app/coin/[mint]/page.tsx` + `coin-row.ts`

```tsx
// page.tsx 154-160
<CoinIdentity v={v} venue={coin?.venue} stats={<TokenStats />}>
  {v.signature && (
    <ProofStamp signature={v.signature} net={net}>
      {sentence(v)}
    </ProofStamp>
  )}
</CoinIdentity>
```

Wrap stamp + `<p className="pl-4 text-xs text-muted-foreground">` in `<div className="grid max-w-[460px] gap-4">` (UI-SPEC surface 4). Render only when `coin?.createSlot != null`. Figure via `pct(bps, true)` from `lib/format.ts`. Data comes from `coinRow` (core `coin-row.ts:134`, cached by `kept(coinByMint)` at page.tsx 71): add `snipedBps`, `createSlot` to its select list (beside `holders` at 63).

### Anti-vamp ticker cooldown (D-40..D-44)

#### `apps/worker/src/ticker.ts` (new)

**Analog:** `admin-moderate.ts` `blocked` 65-72 (one indexed read, `Pick<Db, "select">`, doc comment saying admit runs it beside its other reads) and `launches.ts` 78-86 for the `sql\`... > now() - interval '...'\`` idiom:

```typescript
// launches.ts 78-86
export const newTablesToday = (exec: Exec, wallet: string): Promise<number> =>
  exec.$count(launches, and(eq(launches.newTable, true), eq(launches.wallet, wallet),
    sql`${launches.createdAt} > now() - interval '1 day'`));
```

The query body is RESEARCH Pattern 12's `select max(case ...) as until, max(landed_at) as last_landed ...` (server clock, no join to coins so hidden coins keep the lock). Export a pure `tickerRefusal({until, lastLanded}, now): ApiError | null` returning `{ error: "ticker_locked", retryAfter }` so it is unit-testable without a DB. Put `RESERVED_TICKERS` check in `rules.ts` as a separate function, not in `checkSymbol` 31-36 (it also runs in the browser and genesis). `ponytail:` comment naming the `ticker_locks` upsert upgrade if the worker is duplicated (race safety today is prepare's single-flight, prepare.ts 286-293).

#### `apps/worker/src/prepare.ts` `admit` (132-161)

```typescript
// prepare.ts 134-147
const rows = wallet
  ? Promise.all([
      consented(db(), wallet),
      newTablesLastHour(db()),
      newTablesToday(db(), wallet),
      tableFor(db(), wallet),
      blocked(db(), wallet),
    ])
  : Promise.resolve([false, 0, 0, null, false] as const);
...
if (isBlocked) throw fail({ error: "blocked" }); // D-30: before every other guard and any build
```

Add `tickerLock(db(), sym, wallet)` as a sixth entry only when `checkSymbol(body.symbol).ok` (Pitfall 23: normalized value, else skip and let `prepareGuard` say `invalid_input`); extend the fallback tuple at 142. Refuse reserved and locked right after line 147, before `prepareGuard` (so a refused ticker spends no cap) and before `getBalance`/`reserveMint`/table (D-40).

#### Contract and web plumbing

- `packages/core/src/api.ts`: `LaunchErrorCode` (22-47) gains `ticker_locked`, `ticker_reserved`; `ApiError` (50) gains `retryAfter?: number`.
- `apps/worker/src/http.ts` `STATUS` (22-44): both 409.
- **`apps/web/lib/worker.ts:31` drops every field but `error` and `paused`** (also drops `reason`):

```typescript
// worker.ts 30-31
if (PASS.has(res.status) && typeof body?.error === "string")
  return { status: res.status, body: { error: body.error, paused: body.paused } };
```

  Add `retryAfter` when it is a finite number (Pitfall 24). Keep the rebuild (no raw worker text reaches the browser).
- `apps/web/components/launch-sign.tsx` `FAULTS` (42-70): a total `Record<Code, Fault>`, so tsc lists the gap. Shape like `blocked` at 64 (`action: null`). The hours text comes from a pure helper in a new `lib/ticker-copy.ts` (keeps launch-sign under 300; test it like `admin-copy-health.test.ts`).
- `apps/web/lib/launches.ts` `CODES` (28-41) is the stored `launches.error` allowlist; admit refuses before any row is written, so it needs no change.

#### `apps/web/lib/coins.ts` (oldest-first exact matches, "First")

```typescript
// coins.ts 33-45, 69-75
const matches = (q: string) => { const e = escapeLike(q); return sql`(${launches.name} ilike ... or ${launches.symbol} ilike ...)`; };
const ORDER = {
  top: [desc(coins.mcapSol), desc(coins.launchedAt), asc(coins.mint)],
  ...
};
export const listCoins = ({ sort, page, q }) => { ... coinRows(db(), ORDER[sort], LIST_PAGE + 1, page * LIST_PAGE, where) ... };
```

When `term` is set, prepend `sql\`(${launches.symbol} = upper(${term})) desc\`` and `asc(coins.launchedAt)` (exact matches only) to `ORDER[sort]`, keeping `asc(coins.mint)` last for stable pages. `first` flag: simplest is the first exact-match row on page 0 (RESEARCH Pattern 12). `coinRows` already excludes hidden coins (coin-row.ts 140). UI copy for the marker is a UI-SPEC addendum (not in 07-UI-SPEC.md).

### Migration 0008 (IN-B-02, sniped columns, ticker index)

**Analog:** `packages/core/migrations/0007_admin.sql`: drizzle-generated statements, then a hand-written block after a comment (49-65):

```sql
-- 0007_admin.sql 49-50, 64-65
-- Hand-written: drizzle snapshots do not track functions or triggers, so later generates leave these alone.
...
CREATE TRIGGER admin_audit_guard BEFORE UPDATE OR DELETE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION admin_audit_guard();
```

Steps: edit `schema.ts` (columns + `index("launches_symbol_live").on(t.symbol, t.landedAt).where(sql\`state <> 'failed'\`)` beside the two partial indexes at 99-101; note the `launches` table callback is `() => [...]` today and must become `(t) => [...]`), run `pnpm --filter @bondr/core exec drizzle-kit generate --name go_live` (not root `db:generate`, which hardcodes `--name init`, package.json 22), then append under a `--> statement-breakpoint`:

```sql
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_guard();
--> statement-breakpoint
REVOKE TRUNCATE ON admin_audit FROM CURRENT_USER;
```

Never edit 0007 (applied on staging). Journal gets idx 8 (`meta/_journal.json`). Test in `db-admin.test.ts` next to the DELETE case (~169) using `pgCode` (28-36) inside the `ROLLBACK` transaction (40). If the guard does not reach `RAISE` for a statement trigger (A4), add `IF TG_OP = 'TRUNCATE' THEN RAISE ...` via `CREATE OR REPLACE FUNCTION` in 0008.

### Security follow-ups (D-16)

#### `apps/worker/src/admin-intent.ts` `putIntent` (75-98)

```typescript
// admin-intent.ts 75-77
export function putIntent(f: NewIntent, now = Date.now()): Intent {
  for (const [k, v] of intents) if (!live(v, now)) intents.delete(k);
  while (intents.size >= INTENT_MAX) intents.delete(intents.keys().next().value as string);
```

Replace 77: while full, delete the oldest entry with `used === true`; if none, `throw fail({ error: "rate_limited" })` (429 via `STATUS.rate_limited`) and evict nothing. Rewrite the test "the store holds at most INTENT_MAX intents, oldest dropped" (admin-intent.test.ts 168-175), whose expectation inverts.

#### `apps/web/e2e/admin-signin.e2e.ts` (T-06-03-03)

After `adminSignIn(page.request, admin)` (line 89), POST the same `{ op: "verify", wallet, nonce, signature }` body again to `/api/admin/session` and expect 401. Same skip rule as the file (needs the admin seed).

### Terms (D-17, D-43)

`apps/web/app/terms/page.tsx` `SECTIONS`: section 01 sentence at 20-21, section 08 `<p>` at 117-118, both to UI-SPEC surface 7 copy; add the 24h cooldown sentence. `apps/web/lib/terms.ts:2` `TERMS_VERSION` bumps once for all three edits (Pitfall 21: consent message embeds it, lines 8-19). `terms.e2e.ts` replaces the "@BONDR on X" assertion.

### Web launch surfaces (UI-SPEC 1-3)

- `launch-flow.tsx` `PAUSED` (120-123) becomes `Record<PauseReason, { title: string; body: string }>`; the banner at 184 reads `PAUSED[paused].title`. Keep the always-mounted `aria-live` wrapper at 182.
- `app/launch/page.tsx`: copy `app/admin/page.tsx` 14-17 (`adminWalletEnv()`, `cookies().get(ADMIN_COOKIE)`, `adminSession(...)`), make the page `async`, add `export const dynamic = "force-dynamic"` (admin page line 9), pass `ownerGenesis={!!session}` into `LaunchFlow`.
- `app/api/launch/prepare/route.ts` 24-25: when the admin cookie is valid, spread `actor: s.wallet` last, exactly as `app/api/admin/[op]/route.ts` 78-80 ("the cookie's wallet lands last, so a body actor never reaches the worker").
- `launch-receipt.tsx` `now` (54-59): insert `["Sender tip", cost(s?.senderTipEstimate)]` after "Network fee", only when `s === null || s.senderTipEstimate !== null` (absent on devnet with a loaded status).
- `launch-buy.tsx` `needed` (33-34): add `+ BigInt(s?.senderTipEstimate ?? 0)`.
- `launch-review.tsx` `rows()` (25-43): genesis variant replaces "Creator of record" (42), drops "You after bond" (43), adds "Pair".

### Admin surfaces (UI-SPEC 5-6)

- `admin-health.tsx`: one more `<HealthCell label="Pump contract check" cell={health ? contractCopy(health.contract, now) : DASH}>` after line 108, with `className` support for `md:col-span-2` (add an optional `className` prop to `HealthCell` 26-40 via `cn`). "Run check now" copies `StuckLine`'s button classes (59): `min-h-11 cursor-pointer text-left text-xs text-mint underline decoration-1 underline-offset-[3px] hover:text-foreground md:min-h-6`. The POST goes through the existing `/api/admin/[op]` forwarder (add `contract-check` to its `FORWARD` map) and the 401 path uses the existing `onUnauthorized()`.
- `admin-copy-health.ts`: `contractCopy(c, now): Cell` beside `vanityCopy` (126-130) and `reconcileCopy` (134-142); tones from `Tone` (5); times via `auditTime` (`admin-copy-audit.ts:58`). Test cases in `admin-copy-health.test.ts`, one per UI-SPEC state row.
- `admin-switches.tsx` `Notices` (89-106): two more conditionals above the fee-engine callout, same `<Callout variant=... className="mb-4">` shape (95-97), mismatch as `variant="error"`.

### www to apex (D-07)

```typescript
// proxy.ts 9-13, 15-25
export function proxy(req: Request): Response | undefined {
  if (req.method !== "GET") return undefined;
  if (new URL(req.url).pathname === "/api/live") return rateLimited(req, "live", 30, 60_000) ?? undefined;
  return rateLimited(req, "read", 300, 60_000) ?? undefined;
}
export const config = { matcher: ["/", "/api/coins", "/coin/:path*", ...] };
```

Pitfall 16: widen the matcher to all paths (excluding `_next` assets), check the host first (`www.` prefix redirects 308 to the apex for every method), then apply the old seven-path list inside the function (move the array to a `const READ_PATHS` and test membership) so the rate limit scope does not grow.

### CI and scripts (OPS-03, OPS-04)

#### `.github/workflows/ci.yml` (no analog)

Use RESEARCH "CI workflow skeleton" verbatim. Repo facts it depends on: `pnpm lint` = `biome ci .` (package.json 11), `pnpm typecheck` (12), `pnpm test` = both Vitest projects (10; DB project reads `process.env.DATABASE_URL` first, `db-admin.test.ts` 20-22), `pnpm check:bundle` needs `apps/web/.next/static` (check-client-bundle.sh 21-22, so build web first), migrations via `node packages/core/src/migrate.ts` (not `db:migrate`, which uses `--env-file=.env`, package.json 23, Pitfall 12), and `E2E_BASE_URL` skips both `webServer` entries (playwright.config.ts 88-110, Pitfall 13).

#### `@smoke` tags

No spec has a tag yet. Add `{ tag: "@smoke" }` as the second argument of `test(...)` (Playwright 1.63 details object) on the confirmed specs: `terms.e2e.ts` (19-46), `wallet.e2e.ts`, `admin-locked.e2e.ts`, `launch-form.e2e.ts` step-1 tests, `home.e2e.ts` hero (RESEARCH Pattern 8). Only specs that do not call `rootEnv()` for `DATABASE_URL` (Pitfall 14).

#### `scripts/setup.sh`, `dev.sh`, `test.sh`, `deploy.sh`

**Analog:** `scripts/spike/fork.sh` (header comment with usage, `#!/bin/sh`, `set -eu`, small functions, bounded until-loop with `sleep 1`, secrets only via env or stdin so `ps` never shows them, `ponytail:` comment on a platform limit):

```sh
# fork.sh 1-4, 42-47
#!/bin/sh
# Surfpool mainnet fork on 127.0.0.1:18899. Usage, from the repo root: sh scripts/spike/fork.sh up|down
# The Helius key is only ever an env value or piped on stdin, never a command argument, so `ps` never shows it.
set -eu
...
i=0
until answers; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then echo "fork did not answer within 60 s; see $DIR/out.log"; exit 1; fi
  sleep 1
done
```

- `setup.sh`: RESEARCH Pattern 9 list; `pnpm spike:keys` (package.json 13) creates the seed files.
- `dev.sh`: `trap 'kill 0' INT TERM EXIT`, each process piped through `sed 's/^/[worker] /'`, `wait`. The worker command is the one Playwright uses (`node --env-file=.env apps/worker/src/main.ts`, playwright.config.ts 94).
- `test.sh`: the CI steps; `--full` adds `pnpm e2e` (package.json 20). Wire as `pnpm verify`, never `test` (Pitfall 15: `test` is Vitest at package.json 10, used by CI).
- `deploy.sh <staging|production>`: commands from `apps/worker/README.md` Staging deploy 136-138 (`railway up --service ... --environment ...`, web first when a migration is new); RESEARCH Pattern 9 for `--ci`, the `deployed-<env>` tag and the production guards (clean tree, `main`, typed `production` prompt "Type production to deploy to trybondr.fun" or `--yes`).
- `scripts/README.md` 5-11: one bullet per script in the existing format.

### Fork rehearsal and contract run (D-04, D-21, D-33)

- `scripts/spike/stages/genesis.ts`: copy `standIn` (create.ts 20-43): build, `sendTx`, `ctx.record({ id, step, ...r, facts })`, throw on failure. Use `buildGenesis` from core with an external treasury key, then a child launch quoted in the new mint. Register in `scripts/spike/nets/fork.ts` `stages` (18-37) and add a row to `scripts/spike/stages/README.md`.
- Devnet/fork contract run: `configStage` (config.ts 61-79) already records `drift`; after the move it calls the core profile check, so `pnpm spike` with `SPIKE_NET=fork` is the fork evidence row. A separate `scripts/contract-check.ts` is only needed if the planner wants a non-spike runner; if so copy `scripts/capture-tx.ts`'s header-comment flag style.

---

## Shared Patterns

### Per-network values in one place
**Source:** `apps/worker/src/fee-config.ts` 33-42; `packages/core/src/math.ts`
**Apply to:** tip amount, ops floor, pace, contract profiles (profiles live in `contract.ts`, keyed by `Net`). No new `if (mainnet)` outside the D-01 rows (D-02).

### Boot refuses unknown values
**Source:** `apps/worker/src/env.ts` `feeEngine` 44-48, `adminEvacuate` 71-76
**Apply to:** `SOLANA_NET`, `VANITY_LANE`, `TREASURY_PUBKEY`, optional Q. Throw with the env name in the message, never the value (header line 2).

### Contract errors only, never raw text
**Source:** `apps/worker/src/http.ts` 11-45; `apps/web/lib/worker.ts` 27-32
**Apply to:** `ticker_locked`, `ticker_reserved`, genesis refusals, `not_ready`. New fields that must reach the browser (`retryAfter`) need an explicit line in `worker.ts:31`.

### Admin gate
**Source:** `apps/worker/src/admin-routes.ts` `gated` 23-29 and the one-place wrap at 127; web actor from cookie, `app/api/admin/[op]/route.ts` 78-86
**Apply to:** `POST /admin/contract-check`, the genesis prepare.

### Switch writes and audit
**Source:** `apps/worker/src/switches.ts` 47-72 (database first, then memory, `writes++`); `status.ts` 184-192 (`audited(...)`)
**Apply to:** contract-check pause, genesis boot switches-off. Never `pauseAll` outside EVACUATE.

### Error logging that reaches Sentry
**Source:** `apps/worker/src/main.ts` 32-33, `ingest.ts` 26-27
```typescript
const failed = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
```
**Apply to:** `contract-check.ts`, `genesis.ts`, `sniped.ts`, `ticker.ts`, Sender fallback in `submit.ts`.

### No timer reads Postgres
**Source:** `apps/worker/src/main.ts` 1-3, `switches.ts` 1-3, `health.ts` 1-4
**Apply to:** the contract check (RPC only, memory result), sniped % (written on ingest), ticker read (one per prepare).

### One-flight async work
**Source:** `apps/worker/src/fee-batch.ts` `batchNow` 182-188, `prepare.ts` 286-293
**Apply to:** contract check (boot, timer, route share one run), genesis prepare (same prepare queue).

### DB-backed tests skip without DATABASE_URL and roll back
**Source:** `packages/core/src/db-admin.test.ts` 20-40; `vitest.config.ts` `DB` 5-19
**Apply to:** `ticker.test.ts`, TRUNCATE case, sniped and backfill cases in `ingest.test.ts`. New DB suites go in the `DB` list.

### Docs and shortcuts
`ponytail:` comments on: per-lane refill targets, ticker single-flight race safety, contract check memory-only result, sniped read at page load. One README line per new worker file in `apps/worker/src/README.md`. `apps/worker/README.md`: Env line 72 (drop "devnet only", add `TREASURY_PUBKEY`, `production` lane), EVACUATE 87 (mainnet rule), the D-38 mainnet incident runbook, and a Production deploy section beside Staging deploy 132-141.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.github/workflows/ci.yml` | config | batch | No CI exists; use RESEARCH "CI workflow skeleton" (verified action versions, postgres:18.6) |
| `packages/core/src/contract.ts` (program/programdata/account-size part) | service | RPC read | No loader-layout reads exist; use RESEARCH Code Example "Programdata deploy slot" and Pattern 5. The fee-drift part does have an analog (spike `drift`) |
| `0008` TRUNCATE statement trigger | migration | - | Only row triggers exist (0007 64-65); statement-level semantics are A4, proven by the DB test |
| `@smoke` tag mechanics | test config | - | No tagged specs yet; Playwright `{ tag }` details object per RESEARCH |

## Metadata

**Analog search scope:** `apps/worker/src`, `packages/core/src`, `packages/core/migrations`, `apps/web/{app,components,lib,e2e}`, `scripts/` (incl. `spike/stages`, `spike/nets`), `playwright.config.ts`, `vitest.config.ts`, `package.json`, `.env.example`, `apps/worker/README.md`
**Files scanned:** about 55 read or grepped
**Pattern extraction date:** 2026-10-26
