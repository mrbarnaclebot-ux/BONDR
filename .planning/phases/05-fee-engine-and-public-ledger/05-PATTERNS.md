# Phase 5: Fee Engine and Public Ledger - Pattern Map

**Mapped:** 2026-10-25
**Files analyzed:** 52 (new and modified, incl. tests)
**Analogs found:** 49 / 52

Paths are repo-relative. Line numbers are from the tree at commit 6a1734e.

## File Classification

### packages/core (chain builders, pure math, schema, contract)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/send.ts` (mod: `signTx`) | utility | request-response (chain) | itself, `sendTx` lines 280-292 | exact (split of existing) |
| `packages/core/src/send.test.ts` (extend) | test | - | itself | exact |
| `packages/core/src/keys.ts` (mod: `buyback` Role) | config | - | itself line 7 | exact |
| `packages/core/src/bond.ts` (mod: WR-08, `poolExactInBurnIxs`) | service (ix builder) | transform | itself `forcedBondIxs` 78-88, `poolBuyBurnIxs` 125-141 | exact |
| `packages/core/src/sharing.ts` (mod: `finalizeConfigIxs`, `finalizeUpdateIxs`, `finalizeState`) | service (ix builder) | transform | itself `finalizeIxs` 44-71, `readSharing` 107-116; split proven in `scripts/spike/stages/finalize.ts` 82-107 | exact |
| `packages/core/src/curve.ts` (mod: `costFromReserves`) | utility | transform | itself `costToComplete` 21-36 | exact |
| `packages/core/src/curve.test.ts` (new) | test | - | `packages/core/src/math.test.ts`, fixtures loader in `apps/worker/src/ingest.test.ts` 16-19 | role-match |
| `packages/core/src/float.ts` (new: `wFloat`) | utility | request-response (rent reads) | `scripts/spike/stages/bond.ts` 69-75 | exact (move) |
| `packages/core/src/fees.ts` (new, pure) | utility | transform | `packages/core/src/math.ts` | exact |
| `packages/core/src/fees.test.ts` (new) | test | - | `packages/core/src/math.test.ts` | exact |
| `packages/core/src/trades.ts` (mod: `feesUnclaimed`, cost, `bondrSol` on patch) | utility (parser) | transform | itself `curveState` 141-155, `CoinPatch` 56-62 | exact |
| `packages/core/src/trades.test.ts` (extend) | test | - | itself | exact |
| `packages/core/src/schema.ts` (mod: `feeLedger`, coin fee columns) | model | CRUD | itself `launches` 55-97 (partial unique indexes), `coins` 105-145 | exact |
| `packages/core/migrations/0005_fee_ledger.sql` (new, generated) | migration | - | `packages/core/migrations/0004_coin_last_slot.sql` | exact |
| `packages/core/src/api.ts` (mod: `LedgerRow`, `CoinFees`, `LiveEvent` `fee`) | model (contract) | - | itself `CoinLive` 92-105, `LiveEvent` 135-140 | exact |
| `packages/core/src/coin-row.ts` (mod: fee columns, supply-burned) | model (read) | CRUD read | itself `COLUMNS` 19-40, `toRow` 55-67 | exact |
| `packages/core/src/db.test.ts` (extend: ledger constraints) | test | - | itself 1-45 (`pgCode`) | exact |

### apps/worker (engine, one replica)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/worker/src/fee/ledger.ts` (new: `LedgerStore` + Postgres impl) | store | CRUD | `apps/worker/src/launches.ts` (`advance`, `unsettled`, `Exec`) | exact |
| `apps/worker/src/fee/recover.ts` (new) | service | batch (boot) | `apps/worker/src/settle.ts` `resumeLaunches` 151-167, `nextState` 31-39, `observe` 54-63 | exact |
| `apps/worker/src/fee/send.ts` (new: send path, Sender, tip, ops floor) | service | request-response | `apps/worker/src/trade-prepare.ts` `priorityMicroLamports` 48-63; `core/send.ts` `broadcast` 251-259 | role-match |
| `apps/worker/src/fee/engine.ts` (new: ready flag, per-coin queue, timers, flag) | service | event-driven | `apps/worker/src/trade-store.ts` (in-memory Map, ponytail), `ingest.ts` `knownCoins`/`loadCoins` 21-42 | role-match |
| `apps/worker/src/fee/prebond.ts` (new: collect, split, sweep, forced bond) | service | event-driven | `scripts/spike/stages/prebond.ts`, `stages/bond.ts` `land` 53-67 | role-match |
| `apps/worker/src/fee/bonded.ts` (new: pool burn, pre-flight, finalize) | service | event-driven | `scripts/spike/stages/finalize.ts` `finalizeTx` 82-107; `settle.ts` `launchFacts` 67-84 (innerEvents) | role-match |
| `apps/worker/src/fee/batch.ts` (new: buyback burn, distribute, reconcile) | service | batch | `scripts/spike/stages/finalize.ts` `distribute` 121+; `apps/web/lib/trades.ts` raw `sql` read 75-93 | partial |
| `apps/worker/src/fee/routes.ts` (new: `POST /fee/release`, `POST /fee/batch`) | controller | request-response | `apps/worker/src/main.ts` route table 53-73, `http.ts` `fail` 36 | exact |
| `apps/worker/src/fee/README.md` (new) | doc | - | `apps/worker/src/README.md` | exact |
| `apps/worker/src/fee/{ledger,recover,send,engine,batch}.test.ts` (new) | test | - | `apps/worker/src/settle.test.ts`, `trade-prepare.test.ts` 84-104, `ingest.test.ts` 1-14 | exact |
| `apps/worker/src/ingest.ts` (mod: engine hook after commit) | service | event-driven | itself `arm` 148-162, `announce` 133-144 | exact |
| `apps/worker/src/main.ts` (mod: boot order, routes) | config | - | itself `bootIndex` 32-43 | exact |
| `apps/worker/src/env.ts` (mod: `FEE_ENGINE`, `FEE_WINDOW_MS`, `FEE_BATCH_HOUR_UTC`, `buyback`) | config | - | itself `count` 31-35, `ops`/`treasury` 63-64 | exact |
| `apps/worker/src/build.ts` (mod: import shared `OPS_FLOOR_LAMPORTS`) | config | - | itself line 30 | exact |
| `apps/worker/src/README.md` (mod) | doc | - | itself | exact |

### apps/web (ledger read, panel, rail)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/web/lib/ledger.ts` (new, `server-only`) | service (read) | CRUD read, keyset | `apps/web/lib/trades.ts` `parseCursor` 15-19, `tradesPage` 37-61, `kept` 97-106 | exact |
| `apps/web/lib/ledger-copy.ts` (new, pure) | utility | transform | `apps/web/lib/format.ts`; `token-trades.tsx` `SIDE` map 26-30 | role-match |
| `apps/web/lib/ledger-copy.test.ts` (new) | test | - | `apps/web/lib/format.test.ts` | exact |
| `apps/web/app/api/coin/[mint]/ledger/route.ts` (new) | route | request-response | `apps/web/app/api/coin/[mint]/trades/route.ts` | exact |
| `apps/web/lib/format.ts` (mod: `feeSol`, `burnedPct`, `ratioPct`, `windowLeft`, `utcStamp`) | utility | transform | itself `curvePct`, `age`, `tradeSol` | exact |
| `apps/web/lib/use-live.ts` (mod: `onFee`) | hook | event-driven | itself `EVENTS` 21-27, `LiveHandlers` 7-16 | exact |
| `apps/web/lib/coins.ts` (mod: next-to-bond rows, forced-bond count) | service (read) | CRUD read | itself `heroCounts`, `trending`, `kept` | exact |
| `apps/web/components/coin-live.tsx` (mod: fee events, fee subscribe) | provider | event-driven | itself `onTrade`/`onBond` 43-52 | exact |
| `apps/web/components/home-live.tsx` (mod: `onFee`, forced count) | provider | event-driven | itself `useHomeStream` | exact |
| `apps/web/components/token-bond.tsx` (mod: shell + `@container`) | component | event-driven | itself | exact |
| `apps/web/components/bond-budget.tsx` (new) | component | event-driven | `token-bond.tsx` `Gauge` 58-76 | exact |
| `apps/web/components/bond-after.tsx` (new) | component | event-driven | `token-bond.tsx` `Prose` 38-53 | exact |
| `apps/web/components/ready-bar.tsx` (new) | component | - | `apps/web/components/bond-glyph.tsx` (`role="img"` + label) | role-match |
| `apps/web/components/token-ledger.tsx` (new) | component | event-driven + paging | `apps/web/components/token-trades.tsx` | exact |
| `apps/web/components/home-next.tsx` (new) | component | event-driven | `apps/web/components/home-trending.tsx` 146-190 | exact |
| `apps/web/components/home-hero.tsx` (mod: pulse wording, CTA, rail slot) | component | - | itself `Pulse`, `Ctas` | exact |
| `apps/web/components/token-stats.tsx` (mod: Supply burned) | component | - | itself `Stat` | exact |
| `apps/web/components/trade-quote.tsx` (mod: creator sub-row copy) | component | - | itself `subRows` 57-63 | exact |
| `apps/web/components/tag.tsx` (mod: `tone: "plain"`) | component | - | itself `tagVariants` 5-17 | exact |
| `apps/web/app/coin/[mint]/page.tsx` (mod: ledger panel, first ledger page, note removed) | route (page) | CRUD read | itself `firstPage` 55-58, `Panels` 76-100 | exact |
| `apps/web/app/page.tsx` (mod: rail read) | route (page) | CRUD read | itself `Promise.all` block | exact |
| `apps/web/next.config.ts` (mod: `FEE_WINDOW_MS` in `WEB_ENV`) | config | - | itself 9-20 | exact |
| `apps/web/components/README.md`, `apps/web/lib/README.md` (mod) | doc | - | themselves | exact |

### scripts, e2e, env

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `scripts/spike/stages/engine.ts` (new: fork rows through `apps/worker/src/fee/*`) | test (fork) | batch | `scripts/spike/stages/finalize.ts`; import precedent `scripts/devnet-launch.ts` 29-30 | exact |
| `scripts/spike/nets/fork.ts` (mod: add `engineStage` after `finalizeStage`) | config | - | itself 15-35 | exact |
| `apps/web/e2e/fixtures.ts` (extend: seed `fee_ledger` rows + coin fee columns) | test fixture | - | itself `seedCoin` | exact |
| `apps/web/e2e/fee-ledger.e2e.ts` (new) | test (e2e) | - | `apps/web/e2e/coin.e2e.ts` | role-match |
| `apps/web/e2e/responsive-fee.e2e.ts` (new) | test (e2e, axe) | - | `apps/web/e2e/responsive-trade.e2e.ts` 1-30 | exact |
| `apps/web/e2e/fee-devnet.e2e.ts` (new, `E2E_DEVNET=1`) | test (e2e, chain) | - | none in e2e; drive like `scripts/devnet-trades.ts` | partial |
| `.env.example` (mod) | config | - | itself | exact |

---

## Pattern Assignments

### `packages/core/src/send.ts` — add `signTx` (utility)

**Analog:** itself, `sendTx` lines 280-292. Cut the first half out, keep `sendTx` as `signTx` + `sendRaw`, so every existing caller is unchanged.

```typescript
// lines 280-292 (today)
export async function sendTx(o: SendOpts): Promise<SendResult> {
  const bh: BlockhashInfo = await o.conn.getLatestBlockhash();
  const msg = compile(o.payer.publicKey, o.ixs, o.tables ?? [], bh.blockhash);
  const bytes = messageSize(msg);
  const refused = checkMessage(msg);
  if (refused) return result("failed", { bytes, err: `refused to sign: ${refused}` });
  if (bytes > PACKET_LIMIT)
    return result("failed", { bytes, err: `too large: ${bytes} > ${PACKET_LIMIT} bytes` });
  const tx = new VersionedTransaction(msg);
  tx.sign([o.payer, ...(o.signers ?? [])]);
  const sig = bs58.encode(tx.signatures[0]);
  return sendRaw(o.conn, tx.serialize(), { ...bh, sig, bytes, paceMs: o.paceMs, expectFail: o.expectFail });
}
```

Keep using: `broadcast` (251-259, returns `null` when accepted), `settle` (204-220), `RawOpts` (240-247), `pace` (119-124). `BlockhashInfo` (line 239) is private today: export it for `signTx`'s `bh` arg. The "never resend unknown" rule is documented at lines 37-41: copy it into `fee/recover.ts`'s header.

---

### `packages/core/src/keys.ts` — `buyback` role (config)

Line 7: `export type Role = "w" | "treasury" | "ops" | "sim" | "mint";` → add `"buyback"`. The HMAC domain at line 10-11 keeps roles separated without any other change. Add the worker accessor beside `apps/worker/src/env.ts` 63-64:

```typescript
export const ops = (seed: Buffer, net: "devnet") => derive(seed, "ops", net, "main");
export const treasury = (seed: Buffer, net: "devnet") => derive(seed, "treasury", net, "main");
```

W is `derive(seed, "w", net, <coin id>)`, as `scripts/spike/stages/bond.ts` uses `run.ctx.key("w", mint.publicKey.toBase58())`. Check `launches.w` matches before signing.

---

### `packages/core/src/bond.ts` — WR-08 fix and exact-quote-in pool burn (service, transform)

**Analog:** itself.

Core pattern to fix (lines 78-88): `simOut` is W's *post* balance and is used as `minOut`:
```typescript
const simOut = await simulatedBalance(o.conn, o.ops, [...float(o), ...(await buy(new BN(1)))], ata);
const burnAmount = new BN(simOut.toString());
const ixs = [...float(o), ...(await buy(burnAmount)), burnIx(o.w, o.mint, simOut)];
```
Fix: read W's child ATA balance `pre` first (one `getTokenAccountBalance`, 0 when missing), `minOut = simOut - pre`, burn `simOut`. Put the subtraction in a pure helper in `fees.ts` so it is unit-checked.

Reuse unchanged: `float` (28-31), `burnIx` (33-42), `simulatedBalance` (48-70, the `accounts` option and its error text). The new `poolExactInBurnIxs` copies `poolBuyBurnIxs` (125-141) and swaps line 134 for `PUMP_AMM_SDK.buyExactQuoteInV2Instructions(state, budget, minBaseOut)`, keeping `buybackAtaIx(o.ops, o.quoteMint, buyback)` before the buy.

---

### `packages/core/src/sharing.ts` — resumable finalize (service, transform)

**Analog:** `finalizeIxs` (44-71) plus the proven split in `scripts/spike/stages/finalize.ts` 82-107:

```typescript
// finalize.ts 86-107
const wFloatLamports = (await k.ctx.conn.getMinimumBalanceForRentExemption(SHARING_CONFIG_SIZE)) + W_BUFFER;
const fund = SystemProgram.transfer({ fromPubkey: k.ops.publicKey, toPubkey: k.W.publicKey, lamports: wFloatLamports });
...
const ixs = [fund, ...(await finalizeIxs({ ...base, ...who }))]; // [fund, sweeps x2, config, vault ATA, update]
await land(k, { ...tx, id: "finalize.config", step, ixs: ixs.slice(0, -2) }, async () => facts);
const resweep = await configSweeps(base);
const updateTx = { ...tx, id: "finalize.update", step: update, ixs: [...resweep, ...ixs.slice(-2)] };
```

`finalizeConfigIxs` = `[...sweeps(o), createFeeSharingConfig]` (lines 55-56). `finalizeUpdateIxs` = `[...configSweeps(o), vaultAta(...), updateFeeSharesV2(...)]` (lines 57-69 plus 77-80). `finalizeState` decodes `feeSharingConfigPda(mint)` like `readSharing` (107-116) but returns `"none"` when the account is missing instead of throwing, and `adminRevoked` gives `"revoked"`. It replaces the caller-supplied `bondingCurveComplete` boolean (line 22 comment) with a `getMultipleAccountsInfo` read. Keep `FINAL_SHARES` (line 12) as the only 8000/2000 source.

---

### `packages/core/src/curve.ts` — `costFromReserves` (utility, no RPC)

**Analog:** `costToComplete` lines 21-36. Same SDK call, with the curve built from indexed reserves instead of `fetchBuyState`:

```typescript
return getBuyV3QuoteAmountFromTokenAmount({
  global, feeConfig,
  mintSupply: s.bondingCurve.tokenTotalSupply,
  bondingCurve: s.bondingCurve,
  amount: s.bondingCurve.realTokenReserves,
  curveBaseTokenBalance: s.curveBaseTokenBalance,
});
```

Header comment (lines 1-2) bans a hand-rolled curve: keep it. `SUPPLY` comes from `packages/core/src/price.ts` line 6. Only `core/pump.ts` imports the SDK (`BN`, `getBuyV3QuoteAmountFromTokenAmount`), so import from `./pump.ts`.

**Test** (`curve.test.ts`): load fixtures the way `apps/worker/src/ingest.test.ts` 16-19 does:
```typescript
const fixture = (name: string): TradeTx =>
  JSON.parse(readFileSync(new URL(`../../../packages/core/src/fixtures/${name}.json`, import.meta.url), "utf8")).response;
```
(from core use `new URL("./fixtures/${name}.json", import.meta.url)`).

---

### `packages/core/src/float.ts` — `wFloat` (utility, moved)

**Analog:** `scripts/spike/stages/bond.ts` 69-75, verbatim except the `run.ctx.conn` arg becomes `conn: Connection`:

```typescript
// Pitfall 3: W must stay rent-exempt and pays rent for its child ATA, a buyback Q ATA and the volume
// accumulator (137 bytes). Any excess stays in W as its gas float (PROJECT.md item 9).
export async function wFloat(run: { ctx: Ctx }, W: PublicKey, bytes = [0, 170, 170, 137]): Promise<number> {
  const rents = await Promise.all(bytes.map((b) => run.ctx.conn.getMinimumBalanceForRentExemption(b)));
  const need = rents.reduce((a, b) => a + b, 0) - (await run.ctx.conn.getBalance(W));
  return Math.max(0, need);
}
```
The spike then imports it from `@bondr/core/float` (one copy only).

---

### `packages/core/src/fees.ts` + `fees.test.ts` — pure fee rules (utility, transform)

**Analog:** `packages/core/src/math.ts` (whole file, 33 lines). Copy its shape: header "Pure bigint amount math. No SDK import", one comment per rule naming its PROJECT.md item, bigint in and out, throw on bad input like `applyBps` (4-8).

Reuse, do not redefine: `split90_10` (14-17; the sweep's 90/10 is the same floor), `trigger105` (23), `applyBps` (4-8). New functions: `windowOf(launchedAt, now, windowMs)`, `nextWindowEnd`, `budgetOf(feeBudget, feesUnclaimed)` = `feeBudget + applyBps(feesUnclaimed, 9000)`, `deployerOk({deployer, wallet, treasury, w, onCurve})`, `minOutAfter(pre, simOut)` (WR-08), `distributeMin`, and the per-kind totals map (RESEARCH Pattern 8).

Tests copy `math.test.ts` style (plain `test`/`expect`, no fixtures).

---

### `packages/core/src/trades.ts` — `feesUnclaimed` on the patch (utility, parser)

**Analog:** `curveState` lines 141-155:

```typescript
function curveState(c: Ctx, mint: string, d: Record<string, unknown>, b: number | null): CoinPatch {
  const [vQ, vT] = [big(d.virtualQuoteReserves), big(d.virtualTokenReserves)];
  const [realT, realQ] = [big(d.realTokenReserves), big(d.realQuoteReserves)];
  const atBond = bondrAtBond(vQ, vT, realT, realQ);
  return {
    mint,
    realTokenReserves: String(realT),
    ...
    ...(b !== null && { mcapSol: mcapSol(curvePrice(vQ, vT), b), bondSol: sol(toSol(atBond, b)) }),
    progress: progress(realT, c.init.get(mint) ?? 0n),
    bondrAtBond: String(atBond),
  };
}
```
Add `feesUnclaimed: String(big(d.creatorFeeUnclaimed))` (decimal string, like every other amount) and `bondrSol: b` to the return, and the fields to `CoinPatch` (56-62). `parseTx` stays pure (header lines 1-4). `applyPatch` in `ingest.ts` 64-73 spreads `...state` into `coins`, so new patch keys need matching `coins` columns and nothing else in ingest.

---

### `packages/core/src/schema.ts` — `feeLedger` and coin columns (model)

**Analog:** `launches` (55-97) for state checks and partial unique indexes, `coins` (105-145) for `big()`/`dbl()`/`tstz()`:

```typescript
// lines 89-96
() => [
  check("launches_state", sql`state in ('prepared','signed','sent','landed','failed','unknown')`),
  check("launches_exit", sql`exit in ('burn','sell')`),
  // A mint can be retried after a failure, but only one launch of it may ever land.
  uniqueIndex("launches_landed_mint").on(sql`mint`).where(sql`state = 'landed'`),
  // And only one may be in flight: a second co-signed launch of it could only fail on chain at the dev's cost.
  uniqueIndex("launches_inflight_mint").on(sql`mint`).where(sql`state in ('signed','sent','unknown')`),
],
```
```typescript
// lines 99-101, 137-144
const big = customType<{ data: string; driverData: string }>({ dataType: () => "bigint" });
const dbl = () => doublePrecision();
...
check("coins_venue", sql`venue in ('curve','complete','pool')`),
index("coins_launched_at").on(t.launchedAt.desc()),
```
Use RESEARCH "Ledger schema" as the body (it already follows these conventions). Pitfall 1: never rely on a nullable column in a unique index; use the per-kind partial indexes. Note `big()` is declared after `launches` (line 100): define `feeLedger` after `coins`. `tstz` is line 22. Every amount column is `big()` (string in, string out).

**Migration:** `pnpm --filter @bondr/core exec drizzle-kit generate --name fee_ledger` (config `packages/core/drizzle.config.ts`, `casing: "snake_case"`, out `./migrations`). Do not use root `db:generate` (hardcodes `--name init`).

---

### `packages/core/src/api.ts` — contract types (model)

**Analog:** lines 92-105 and 135-140. Types only, no imports (header lines 1-2). Amounts are decimal strings; SOL display values are numbers.

```typescript
export type LiveEvent = { id: string } & (
  | { type: "trade"; data: { trade: TradeRow & { mint: string }; coin: CoinLive } }
  | { type: "launch"; data: CoinRow }
  | { type: "bond"; data: { mint: string; venue: Venue; bondSig: string | null; bondedAt: string | null } }
  | { type: "holders"; data: { mint: string; holders: number } }
);
```
Add `| { type: "fee"; data: { mint: string; rows: LedgerRow[]; coin: CoinFees } }`. `data.mint` keeps `apps/web/lib/live-hub.ts` line 60 `mintOf` working with no change (non-trade events read `e.data.mint`). Add the panel fields to `CoinLive` so trade events carry them (UI-SPEC "Trade events already carry the coin's live fields, which gain the budget fields").

---

### `packages/core/src/coin-row.ts` — fee columns (model read)

**Analog:** itself. Add columns to `COLUMNS` (19-40) and convert in `toRow` (55-67), same as `bondedAt: iso(r.bondedAt)`. Both web and worker read this, so the worker's `fee` publish and the page agree (header lines 1-4). Forced-bond and finalize signatures for the panel can be correlated subselects shaped like `mcap1hAgo` (15-17):

```typescript
const mcap1hAgo = sql<number | null>`(select t.mcap_sol from trades t
  where t.mint = ${coins.mint} and t.side <> 'burn' and t.at <= now() - interval '1 hour'
  order by t.slot desc, t.seq desc limit 1)`;
```

---

### `apps/worker/src/fee/ledger.ts` — `LedgerStore` (store, CRUD)

**Analog:** `apps/worker/src/launches.ts`. Every state move is one guarded UPDATE that returns the row or null:

```typescript
// launches.ts 8-9, 26-39
export type Exec = Pick<Db, "select" | "update" | "insert" | "$count">;
...
export async function advance(exec: Exec, id: string, from: LaunchState, to: LaunchState, set: Partial<NewLaunch> = {}) {
  const [row] = await exec
    .update(launches)
    .set({ ...set, state: to, updatedAt: sql`now()` })
    .where(and(eq(launches.id, id), eq(launches.state, from)))
    .returning();
  return row ?? null;
}
// 89-93
export const unsettled = (exec: Exec): Promise<LaunchRow[]> =>
  exec.select().from(launches).where(inArray(launches.state, ["signed", "sent", "unknown"]));
```
`insertPending` relies on the partial unique index to refuse a second intent: catch SQLSTATE `23505` (see `pgCode` in `packages/core/src/db.test.ts` 33-41 for how drizzle wraps it in `cause.code`) and treat it as "already done". Landing plus the coin totals run in one `db().transaction`, as `settle.ts` `landed` does (86-92):

```typescript
const moved = await db().transaction(async (tx) => {
  const r = await advance(tx, row.id, row.state as LaunchState, "landed", { landedAt: new Date() });
  if (r) await markUsed(tx, row.mint);
  return r;
});
```
The in-memory `LedgerStore` (units and the fork stage) mirrors `trade-store.ts`'s plain `Map` (line 28).

---

### `apps/worker/src/fee/recover.ts` — boot settle (service, batch)

**Analog:** `apps/worker/src/settle.ts`. Reuse `nextState` (31-39) as the decision function; do not write a new state machine. Copy `observe` (54-63) for the status read and `resumeLaunches` (151-167) for the loop. Difference: fee rows never resend (no stored wire), so `resumeAction` is not used; an unseen row past `lastValidBlockHeight` after the rechecks becomes `expired`.

```typescript
// settle.ts 31-39
export function nextState(o: Obs): Next {
  if (o.seen?.confirmed)
    return o.seen.err === null ? { to: "landed" } : { to: "failed", error: `onchain ${JSON.stringify(o.seen.err)}` };
  if (o.height <= o.lastValid) return { to: "poll" };
  if (o.rpcError) return { to: "unknown" };
  return o.rechecks >= RECHECKS ? { to: "failed", error: "expired" } : { to: "recheck" };
}
```
Map `{to:"failed", error:"expired"}` to ledger state `expired`. Use `getSignatureStatuses(sigs)` with all pending sigs in one call (up to 256), not one call per row. Boot `logged` helper shape: settle.ts 142-143.

**Test:** copy `apps/worker/src/settle.test.ts` 5-23 (pure table of observations, no RPC).

---

### `apps/worker/src/fee/send.ts` — devnet RPC or mainnet Sender (service)

**Analog:** `apps/worker/src/trade-prepare.ts` 48-63, the mainnet-only injected-dependency pattern:

```typescript
// Helius devnet answers getPriorityFeeEstimate with Method not found (Pitfall 2), so only mainnet asks.
export async function priorityMicroLamports(net: TradeNet, estimate: () => Promise<number>, fallback: number, cuLimit: number) {
  let price = fallback;
  if (net === "mainnet")
    price = await estimate().catch((e: unknown) => {
      console.error(`priority estimate failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      return fallback;
    });
  return capFor(cuLimit, Number.isFinite(price) ? price : fallback);
}
```
`TradeNet` is `apps/worker/src/trade-quote.ts` line 21 (`Net | "mainnet"`): reuse it. The raw `fetch` JSON-RPC body copies `heliusEstimate` (trade-prepare.ts 65-77). Devnet path is `broadcast` from core `send.ts` 251-259. RESEARCH Pattern 7 has the full body.

**Ops floor:** move `OPS_FLOOR_LAMPORTS` from `apps/worker/src/build.ts` line 30 to one shared place (this file or `env.ts`) and import it back into `build.ts`. Keep the exact log text `ops below floor`, which `sentry.ts` line 20 relies on through `captureConsoleIntegration`:
```typescript
if (balance < OPS_FLOOR_LAMPORTS) throw buildFailed(`ops below floor: ${balance / LAMPORTS_PER_SOL} SOL`);
```
For the engine, read `meta.postBalances[0]` (ops is fee payer, index 0) instead of `getBalance`.

**Test:** copy `apps/worker/src/trade-prepare.test.ts` 84-104 (`describe("priorityMicroLamports (D-08, Pitfall 2)")`): devnet never calls the injected function; mainnet calls it once.

---

### `apps/worker/src/fee/engine.ts` — hooks, queue, timers, flag (service, event-driven)

**Analogs:** `apps/worker/src/trade-store.ts` (module-level `Map`, ponytail header for one replica, lines 1-4, 28) and `apps/worker/src/ingest.ts` `knownCoins` / `loadCoins` (21-42, one read at boot).

```typescript
// trade-store.ts 1-4
// ponytail: per-process memory while the worker runs one replica (D-07); move entries to a shared store if
// the worker scales out.
```
```typescript
// ingest.ts 32-42
export async function loadCoins(exec: Exec): Promise<void> {
  const rows = await exec.select({ mint: coins.mint, ... }).from(coins);
  for (const r of rows) knownCoins.set(r.mint, r);
}
```
Per-coin serial queue is a `Map<mint, Promise<void>>` chained with `.then(job).catch(logged)`. Errors go through the `logged` helper shape in `ingest.ts` 29-30 (`console.error` + `redact`), so Sentry gets them. The `FEE_ENGINE` flag is read in `env.ts` like `lane` (lines 41-42: refuse anything other than the listed values). Timers use plain `setTimeout`, never a DB read (`main.ts` header lines 1-3).

---

### `apps/worker/src/fee/prebond.ts`, `bonded.ts` — money jobs (service, event-driven)

**Analog:** `scripts/spike/stages/bond.ts` `land` (53-67) for send, fetch meta, compute facts:

```typescript
const ixs = [...budget(cuLimit), ...tx.ixs];
const r = await sendTx({ conn: run.ctx.conn, payer: tx.payer, signers: tx.signers, ixs });
const got = r.ok && r.sig ? await fetchTx(run.ctx.conn, r.sig) : undefined;
const f = got ? await facts({ r, tx: got, meta: got.meta }) : {};
```
In the engine, swap `sendTx` for `signTx` → `insertPending` → broadcast → `settle` (RESEARCH Pattern 1). Amounts come from meta: `tokenDelta(meta, Q, W)` (`packages/core/src/trade.ts` line 135), as `finalize.ts` `poolTrades` does (`const qDelta = tokenDelta(meta, k.Q, k.trader.publicKey)`). Builders: `collectIxs`/`splitIxs` (`collect.ts` 16-54, ops is payer, W signs only the split), `forcedBondIxs`, `poolExactInBurnIxs`, `finalizeConfigIxs`/`finalizeUpdateIxs`. `budget(cuLimit, microLamports)` from `send.ts` 60-63.

**Deployer pre-flight** (`bonded.ts`): copy `launchFacts` (`settle.ts` 71-73) to find the event in the launch tx:
```typescript
const buy = innerEvents(tx).find((e) => e.name === "TradeEvent" && e.data.mint === row.mint && e.data.isBuy);
```
Use `e.name === "CreateEvent"` and `String(e.data.user)`. `fetchTx` from `core/send.ts` 160-170.

---

### `apps/worker/src/fee/batch.ts` — daily batch (service, batch)

**Analogs:** distribute row in `scripts/spike/stages/finalize.ts` from line 121 (`distributeIxs({ online, mint, quoteMint, payer: ops })`, balances read around the tx); a grouped raw SQL read like `apps/web/lib/trades.ts` 75-93 (`db().execute<Row>(sql\`...\`)`), with the reconciliation SQL in RESEARCH "Reconciliation SQL". Burn uses `createBurnCheckedInstruction` exactly as `bond.ts` `burnIx` (33-42) with the buyback ATA and BONDR decimals 6. The pure diff function goes in `fees.ts` (unit-tested); `batch.ts` only reads and writes.

---

### `apps/worker/src/fee/routes.ts` — bearer routes (controller)

**Analog:** `apps/worker/src/main.ts` 53-73 route table and `apps/worker/src/http.ts`. Routes are `"METHOD /path": (body) => Promise<unknown>`; the bearer check and JSON parse are already in `handle` (http.ts 76-97). Bad input throws `fail({ error: "invalid_input" })` (http.ts 36). Validate the release body with base58 + `PublicKey.isOnCurve`.

```typescript
// main.ts 53-58
const server = start(
  {
    "GET /status": () => liveStatus(ctx),
    "POST /quote": (body) => quote(ctx, body),
    ...
```
Export a `feeRoutes(ctx)` object and spread it into this table.

---

### `apps/worker/src/ingest.ts` — engine hook (modify)

**Analog:** itself, `arm` 148-162. The hook goes after the commit, next to `announce`, and runs for both live and gap-fill calls (the engine ignores jobs until `ready`, Pitfall 10):

```typescript
async function arm(conn, inserted, bonded, launched?, live = true) {
  for (const mint of new Set(inserted.map((t) => t.mint))) {
    const coin = knownCoins.get(mint);
    if (coin) touch(conn, coin);
  }
  if (live) await announce(inserted, bonded, launched).catch(logged("publish"));
  else if (inserted.length || bonded.size) skipId();
  return inserted;
}
```
The `fee` publish copies `announce` (133-144): `if (!listening()) return;` then one `coinRow(db(), mint)` read and `publish({ type: "fee", data: ... })`. `bonded` is the set of mints whose venue moved (writeParsed 91-108); the migration hook fires when the venue reached `pool` (Pitfall 6).

---

### `apps/worker/src/main.ts` — boot order (modify)

**Analog:** `bootIndex` 32-43. Insert `engine.load` and `engine.recover` after `loadCoins` and before `startStream`, inside the same try, so a failure retries with the same backoff:

```typescript
try {
  await seedBondrPrice(ctx);
  await loadCoins(db());
  console.log(`backfilled ${await backfillLaunches(ctx.conn)} launches`);
} catch (e) {
  failed("index boot")(e);
  setTimeout(() => void bootIndex(ctx, net, attempt + 1), backoff(attempt));
  return;
}
startStream(ctx, net);
```

---

### `apps/worker/src/env.ts` — fee config (modify)

**Analog:** itself. Integers through `count` (31-35); enum values refused like `VANITY_LANE` (41-42):
```typescript
const lane = env.VANITY_LANE?.trim();
if (lane !== "local" && lane !== "staging") throw new Error("VANITY_LANE must be local or staging");
```
`FEE_ENGINE` defaults to `off` when unset (unlike lane, which is required). Header rule (line 2): never log the seed, token or RPC URL.

---

### `apps/web/lib/ledger.ts` — ledger page read (service, keyset)

**Analog:** `apps/web/lib/trades.ts` (whole file pattern). `import "server-only"` (line 3), `PAGE` const, a strict cursor parser, `limit(PAGE + 1)` for `more`, `kept` 10 s cache:

```typescript
// trades.ts 15-19
export function parseCursor(s: string): Cursor | null {
  if (!/^\d{1,19}\.\d{1,19}$/.test(s)) return null;
  const [slot, seq] = s.split(".").map(BigInt);
  return slot > INT8_MAX || seq > INT8_MAX ? null : { slot, seq };
}
// 40-50
const older = before ? sql`(${trades.slot}, ${trades.seq}) < (${String(before.slot)}::bigint, ${String(before.seq)}::bigint)` : undefined;
const rows = await db().select(COLUMNS).from(trades).where(and(eq(trades.mint, mint), older))
  .orderBy(desc(trades.slot), desc(trades.seq)).limit(PAGE + 1);
```
Ledger keyset is `(landed_at, id)` matching index `fee_ledger_public`. The `where` must include `state = 'landed'` and an explicit public-kinds `inArray` (never `held`, `reconcile_diff`, `buyback_burn`; Security: info disclosure). `PAGE = 20`.

---

### `apps/web/app/api/coin/[mint]/ledger/route.ts` (route)

**Analog:** `apps/web/app/api/coin/[mint]/trades/route.ts`, copy whole: `dynamic = "force-dynamic"`, `NO_STORE`, `BASE58_KEY.test(mint)` → 404, `parseCursor` null → 400, try/catch → 503 with `console.error("... read failed", cause?.code)`.

```typescript
const { mint } = await params;
if (!BASE58_KEY.test(mint)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
const raw = new URL(req.url).searchParams.get("before");
const before = raw === null ? undefined : parseCursor(raw);
if (before === null) return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
```

---

### `apps/web/lib/ledger-copy.ts` + test (utility, pure)

**Analog:** the `SIDE` lookup in `apps/web/components/token-trades.tsx` 26-30 (`as const` record of label and tone), and the pure helpers in `lib/format.ts` (header line 1: "Pure, so the unit test can load them"). Use a `Record<PublicKind, {tag, tone, text(row, symbol)}>` with the UI-SPEC row copy table. Formatting goes through `format.ts` (`thousands`, `compact`, `short`), not new helpers. Test copies `apps/web/lib/format.test.ts` style; the one check is that every public kind maps and `held`/`buyback_burn`/`reconcile_diff` do not.

---

### `apps/web/lib/format.ts` — new formatters (modify)

**Analog:** itself. `ratioPct` copies `curvePct` (floored to 1 decimal, epsilon guard):
```typescript
export const curvePct = (f: number): string =>
  f >= 1 ? "100%" : `${(Math.floor(Math.max(0, f) * 1000 + 1e-9) / 10).toFixed(1)}%`;
```
but takes base-unit bigints (budget, cost) and computes `budget * 1000n / cost` so the ratio is never from floats. `windowLeft` copies `age` (lines 37-42) shape. `feeSol` copies `tradeSol` (<0.001 rule). `utcStamp` uses `toISOString().slice(0,16).replace("T"," ")`.

---

### `apps/web/lib/use-live.ts` — `onFee` (modify)

**Analog:** itself, lines 7-27. Add `onFee?(d: Data<"fee">): void;` to `LiveHandlers` and `fee: "onFee"` to `EVENTS`. Nothing else changes (`listen` is generic). Also add the `fee` type to the SSE `frame` in `apps/web/app/api/live/route.ts` if it filters types (it does not today: it writes any non-resync `e.type`).

---

### `apps/web/components/coin-live.tsx` and `home-live.tsx` — fee events (modify)

**Analog:** `coin-live.tsx` 43-52:
```typescript
onBond: ({ venue, bondSig, bondedAt }) => setCoin((p) => p && { ...p, venue, bondSig, bondedAt }),
onHolders: ({ holders }) => setCoin((p) => p && { ...p, holders }),
```
Add `onFee: ({ rows, coin }) => { setCoin((p) => p && { ...p, ...coin }); emitFee(rows); }` with a second subscriber set copied from `subs`/`subscribe` (lines 38-41, 67-70) so `token-ledger.tsx` gets rows without touching the trade feed. On resync, the ledger refetches its own first page once (UI-SPEC Live), not inside the trades refetch. `home-live.tsx` `useHomeStream` `onBond` (`setCounts`) is the pattern for incrementing the forced-bond count on a `forced_bond` row.

---

### `apps/web/components/token-ledger.tsx` — Fee ledger panel (component)

**Analog:** `apps/web/components/token-trades.tsx`, copy the structure:
- `useOlder` (68-86): `fetch(\`/api/coin/${mint}/ledger?before=...\`)`, state `idle|loading|error`.
- `useLiveRows` (89-111): batch rows per animation frame with `requestAnimationFrame`, cancel on unmount.
- `useClock` (155-164): `local` flips on after mount for the `title`; change the interval to 60 s per UI-SPEC.
- `LoadMore` (195-217): copy verbatim, change copy to "Load 20 older entries" / "That is every fee movement since launch." / "Could not load older entries. Try again.".
- Section shell (223-226): same panel classes; add `@container`. Use `<ol>` + `<li>` instead of a table (UI-SPEC).
- `TxLink` with `label` for icon-only links (`tx-link.tsx`).

The sr-only `aria-live="polite"` burst announcement: see `LiveIndicator` (114-127) for the polite span, and `apps/web/lib/use-announce.ts` for the existing announce hook.

---

### `apps/web/components/token-bond.tsx`, `bond-budget.tsx`, `bond-after.tsx`, `ready-bar.tsx` (components)

**Analog:** `token-bond.tsx`. Keep `BondPanel` (92-122) as the shell and venue switch; move the new parts into the two new files to stay under 300 lines.

```typescript
// token-bond.tsx 18-21
const Num = ({ children }: { children: ReactNode }) => <span className="num text-foreground">{children}</span>;
const bondr = (base: string) => thousands(Math.floor(Number(base) / 1e6));
```
`Gauge` (58-76) is the head-row + big mono 28px value pattern for the budget gauge and the post-bond gauges. `Prose` (38-53) is the venue-branching prose with an inline `TxLink`. `BondCoin` (13-16) is a `Pick<CoinRow, ...>`: extend the pick with the fee fields. `CURVE_START` (78-86) needs defaults for the new fields. `ready-bar.tsx` follows `bond-glyph.tsx` for `role="img"` with a passed `label`.

---

### `apps/web/components/home-next.tsx` — Next to bond rail (component)

**Analog:** `apps/web/components/home-trending.tsx` 146-150 (hidden when empty) and the `hold` spread (line 170) so the 60 s re-rank waits on hover/focus:
```typescript
export function HomeTrending() {
  const { trend } = useHome();
  return trend?.coins.length ? <Scroller {...trend} /> : null;
}
```
Re-sort on the existing `useReRank` tick in `home-live.tsx`; do not add a second interval. Server read in `apps/web/lib/coins.ts` copies `trending` (`kept("trending", ...)` + `coinRows(db(), ORDER, 4, 0, where)`), with `where venue = 'curve' and fee_budget > 0`.

---

### `apps/web/components/home-hero.tsx` — pulse and CTA (modify)

**Analog:** itself `Pulse` and `Ctas`. Keep the `<b className="num font-normal text-foreground">` style for numbers. `Ctas` second link swaps `href="#all-coins"` for `/coin/{mint}` with the same `buttonVariants({ variant: "quiet", size: "lg" })`. The `heroCounts` read in `lib/coins.ts` gains a forced-bond count using the same `count(*) filter (where ...)` shape.

---

### `apps/web/components/tag.tsx`, `token-stats.tsx`, `trade-quote.tsx` (small modifies)

- `tag.tsx` 8-12: add `plain: "border-line-strong text-foreground"` to `tone` variants.
- `token-stats.tsx`: add a fifth `<Stat label="Supply burned" tone={...}>` (Stat at lines 17-28); leaf above zero, `MUTED` at zero.
- `trade-quote.tsx` 57-63 `subRows`: line 60 `Creator ${pct(...)}, to the ${symbol} fee wallet` becomes the per-venue copy from UI-SPEC; pass venue and finalized shares in.

---

### `apps/web/app/coin/[mint]/page.tsx` (modify)

**Analog:** itself. Add a `kept` first ledger page like `firstPage` (55-58) and pass it to `FeeLedger` placed right after `<BondPanel>` in the right column (line 85), per UI-SPEC DOM order. Delete the note `<p>` at 136-138.

---

### `scripts/spike/stages/engine.ts` + `nets/fork.ts` (fork rows)

**Analog:** `scripts/spike/stages/finalize.ts` (stage shape, `land`, `Rule`/`Stage` from `../results.ts`, `newRun` from `./bond.ts`). Import the engine's own code from `../../../apps/worker/src/fee/*.ts` (precedent: `scripts/devnet-launch.ts` 29-30 imports `../apps/worker/src/build.ts` and `env.ts`). Register in `nets/fork.ts` stages array right after `finalizeStage` (line 22).

---

### E2E: `fee-ledger.e2e.ts`, `responsive-fee.e2e.ts`, `fee-devnet.e2e.ts`, `fixtures.ts`

**Analog:** `apps/web/e2e/responsive-trade.e2e.ts` 1-30: `postgres(url, { max: 1, idle_timeout: 5 })`, `test.skip(!STAGING && !sql, ...)`, `reducedMotion: "reduce"`, `gate`/shots from `./shoot.ts`, 390/768/1440 matrix with axe. Seed rows by extending `apps/web/e2e/fixtures.ts` `seedCoin` (SQL column names, `fakeSig()`), and its `dropCoin` must delete `fee_ledger` rows first (FK to `coins`). `fee-devnet.e2e.ts` gates on `E2E_DEVNET=1` and prints ops before/after like `scripts/devnet-trades.ts` (refuse below floor, lines 174 and 249).

---

## Shared Patterns

### Error logging that reaches Sentry
**Source:** `apps/worker/src/ingest.ts` 29-30, `apps/worker/src/sentry.ts` 20
**Apply to:** every worker fee file
```typescript
const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);
```
`console.warn`/`console.error` are captured by Sentry; `redact` from `@bondr/core/net`. Held finalize and reconcile diffs are `console.error` lines.

### Intent and state through DB constraints
**Source:** `packages/core/src/schema.ts` 89-96 (partial unique indexes), `apps/worker/src/launches.ts` 26-39 (guarded UPDATE)
**Apply to:** `fee/ledger.ts`, `fee/recover.ts`, schema. The DB refuses a second pending or landed row; the app never checks first.

### Settle and no-resend
**Source:** `packages/core/src/send.ts` 37-41 and 188-220; `apps/worker/src/settle.ts` 31-39
**Apply to:** every engine send and boot recovery.

### Pacing
**Source:** `packages/core/src/send.ts` `pace` 119-124; `settle.ts` `SEND_PACE_MS = 1100` (line 20)
**Apply to:** all engine broadcasts on devnet (`paceMs: 1100`).

### Program allowlist
**Source:** `packages/core/src/send.ts` 25-35, `checkMessage` 66-73
**Apply to:** `signTx`; the Sender tip is a System transfer, already allowed. No new program IDs.

### Publish after commit, read only if someone listens
**Source:** `apps/worker/src/ingest.ts` `announce` 133-144, `events-route.ts` `listening`/`publish` 18-23
**Apply to:** fee landing publish.

### Web reads: kept 10 s, server-only, strict parsing
**Source:** `apps/web/lib/trades.ts` 1-19, 97-106; `apps/web/lib/coins.ts` `kept`; `BASE58_KEY` from `@/lib/guard`
**Apply to:** `lib/ledger.ts`, rail read, ledger route.

### Live state through one provider
**Source:** `apps/web/components/coin-live.tsx` (one `useLive` per page, context, subscribe set)
**Apply to:** ledger panel, budget gauge, Supply burned stat, rail.

### Shortcuts and docs
`ponytail:` comment for every shortcut (examples: `trade-store.ts` 3-4, `ingest.ts` 5-6, 205-206). One README line per new file (`apps/worker/src/README.md`, `apps/web/components/README.md`, `apps/web/lib/README.md`); `apps/worker/src/fee/` gets its own README (more than 5 files).

### DB-backed tests skip without DATABASE_URL
**Source:** `packages/core/src/db.test.ts` 8-10, `apps/worker/src/ingest.test.ts` 13-14
```typescript
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
```

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Helius Sender branch in `apps/worker/src/fee/send.ts` | service | request-response | No Sender call exists (send.ts header line 1 says it was deferred). Use RESEARCH Pattern 7; the injected-fetch shape still comes from `priorityMicroLamports`. |
| Window and daily-batch timers in `apps/worker/src/fee/engine.ts` | service | event-driven (scheduled) | No in-process scheduler exists (the worker has no standing loop by design, `main.ts` 1-3). Use plain `setTimeout` per RESEARCH Pattern 3. |
| `apps/web/e2e/fee-devnet.e2e.ts` | e2e | chain | No e2e drives real devnet sends; borrow the ops-floor and printout logic from `scripts/devnet-trades.ts`. |

## Metadata

**Analog search scope:** `packages/core/src`, `apps/worker/src`, `apps/web/{app,components,lib,e2e}`, `scripts/spike/{stages,nets}`, `scripts/*.ts`
**Files scanned:** about 45 read or grepped
**Pattern extraction date:** 2026-10-25
