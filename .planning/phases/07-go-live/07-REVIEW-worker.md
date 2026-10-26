---
phase: 07-go-live
reviewed: 2026-10-26T00:00:00Z
depth: standard (deep on env/keys/treasury, genesis, submit + Sender, contract check + switches, ticker cooldown, fee-config, v1 fetch)
files_reviewed: 29
files_reviewed_list:
  - apps/worker/src/admin-evacuate.ts
  - apps/worker/src/admin-inspect.ts
  - apps/worker/src/admin-intent.ts
  - apps/worker/src/admin-money.ts
  - apps/worker/src/admin-overview.ts
  - apps/worker/src/admin-routes.ts
  - apps/worker/src/build.ts
  - apps/worker/src/contract-check.ts
  - apps/worker/src/env.ts
  - apps/worker/src/fee-boot.ts
  - apps/worker/src/fee-config.ts
  - apps/worker/src/fee-send.ts
  - apps/worker/src/genesis-boot.ts
  - apps/worker/src/genesis.ts
  - apps/worker/src/grind.ts
  - apps/worker/src/health.ts
  - apps/worker/src/http.ts
  - apps/worker/src/ingest.ts
  - apps/worker/src/main.ts
  - apps/worker/src/prepare-rules.ts
  - apps/worker/src/prepare.ts
  - apps/worker/src/settle.ts
  - apps/worker/src/sniped.ts
  - apps/worker/src/status.ts
  - apps/worker/src/submit.ts
  - apps/worker/src/switches.ts
  - apps/worker/src/ticker.ts
  - apps/worker/src/trade-quote.ts
  - apps/worker/src/vanity.ts
findings:
  critical: 3
  warning: 3
  info: 6
  total: 12
status: issues_found
---

# Phase 7: Code Review Report (worker)

**Reviewed:** 2026-10-26
**Depth:** standard, deep on the mainnet-critical paths
**Files Reviewed:** 29 non-test files (diff `main...HEAD`), plus the core modules they call (`packages/core/src/contract.ts`, `config.ts`, `send.ts`, `net.ts`, `keys.ts`, `launch.ts` buildGenesis) and the pinned pump SDK decoders.
**Status:** issues_found

## Summary

These parts hold up when traced:
- The mainnet double flag (`launchNet`).
- The external treasury guard: it is required on mainnet, must be on curve, and must not equal ops, buyback or the derived treasury.
- The `evacuateAllowed` rule, shared by boot and the execute loop.
- The genesis owner gate: actor, wallet and ADMIN_WALLET must all match, consent is required, and the exit must be burn.
- Genesis mode writes every switch off before any route answers.
- `switchesOff` keeps `evacuated_at`.
- The Sender tip accounts match the Helius list, and the tip is paid from the dev inside the stored message.
- The ticker cooldown runs inside the single-flight queue. The genesis path skips the reserved list.
- The v1 transaction read works: web3.js 1.99 parses `MessageV1`.

Three blockers remain:
1. The new Sender-then-RPC fallback in submit can record a launch that landed as `failed`. That frees its mint and ticker, skips indexing, and lets a second BONDR genesis go through.
2. The contract check fails open on the layout breaks it exists to catch. Any decode failure in `readLiveConfig` aborts the whole check as "could not run".
3. A failed pause write after a mismatch leaves every fee-engine job running. The error is swallowed, nothing retries, and the engine reads only the in-memory switches.

## Critical Issues

### CR-W-01: Sender fallback marks a landed launch `failed`, releases its mint and opens a second genesis

**File:** `apps/worker/src/submit.ts:68-76`, `apps/worker/src/submit.ts:89-93`
**Issue:** `urgentBroadcast` returns `status: "unknown", err: "sender ..."` on any Sender problem. That includes a 10 s timeout or a dropped response after Sender already forwarded the transaction. `broadcastLaunch` then sends the same bytes through `broadcast()`, which runs preflight. If the Sender copy has already landed, preflight rejects the RPC copy with `AlreadyProcessed`, or with a simulation failure because the mint account already exists. Both carry a `logs` array, so `preflightRejected` returns true and the result is `status: "failed"`. `send()` then runs `advance(signed -> failed)` and `releaseMint(row.mint)`. Nothing ever re-checks a `failed` row: `resumeLaunches` and `settleLaunch` only handle signed, sent and unknown.

Failure scenario (genesis, mainnet):
1. The owner signs the BONDR genesis. Sender forwards it but times out on the response. The fallback preflight gets `AlreadyProcessed`.
2. The row becomes `failed` and the mint is released. `genesisLanded` (`genesis.ts:38-45`) does not count `failed`, so the next genesis prepare is admitted.
3. `reserveMint` retires the old mint (its account exists) and hands out a new one. The owner, told the launch failed, signs again, and a second BONDR token is created with the treasury as creator.

For a child launch, the landed coin gets no coin row and its trades are never indexed. The engine never manages its W, and the 24h ticker lock is released.
**Fix:** A fallback that preflight rejects proves nothing, because Sender may already have delivered. Keep the Sender "unknown" result in that case, so settle decides from the signature:
```ts
async function broadcastLaunch(ctx: SubmitCtx, row: LaunchRow, wire: Uint8Array, o: RawOpts) {
  if (!row.message || !tipped(VersionedMessage.deserialize(row.message))) return broadcast(ctx.conn, wire, o);
  const net = ctx.env.net;
  const r = await urgentBroadcast(net, ctx.conn, wire, { ...o, swqosOnly: feeConfig(net).launchTipLamports < 1_000_000 });
  if (r?.status !== "unknown" || !r.err?.startsWith("sender")) return r;
  const f = await broadcast(ctx.conn, wire, o);
  // Sender may already have delivered: a preflight rejection of the copy is not a failure of the launch.
  return f?.status === "failed" ? r : f;
}
```
As defence in depth, make `genesisLanded` also check the chain for any earlier genesis row's mint (`getMultipleAccountsInfo` over the `w = treasury` rows in any state). That way a mislabelled row can never admit a second genesis.

**Outcome (2026-10-26): fixed, commit 30997b6.** As suggested: a failed RPC copy after a Sender error returns the Sender "unknown" result, so the row goes `sent` and settle decides from the signature status (history search past expiry) before any `failed` or mint release. genesisLanded already counts sent/unknown. Tests: submit.test.ts (Sender timeout, then RPC "already processed": `prepared->signed->sent`, no release) and settle-flow.test.ts (signature found only by the history recheck lands). The on-chain defence in depth for genesisLanded was not added (the mislabel path is gone; see IN-W-02).

### CR-W-02: The contract check fails open when pump changes a layout BONDR reads

**File:** `apps/worker/src/contract-check.ts:66-72` (root cause in `packages/core/src/contract.ts:197-201`)
**Issue:** `checkContract` gathers its data with `Promise.all([programs(conn), getMultipleAccountsInfo(keys), readLiveConfig(conn)])`. `readLiveConfig` calls `fetchGlobal`, `fetchFeeConfig` and `fetchFeeConfigAccount`, and each of these decodes inside the SDK:
- `decodeGlobal` uses the Anchor coder, which throws on a discriminator mismatch.
- `decodeFeeConfig` throws on data shorter than its initialize size.
- A missing account throws `Global account not found`.

Any of these rejects the whole check. `run()` treats every rejection as an RPC failure: "could not run", `failed` unchanged, no pause. The careful per-account `observe()` and `judge()` facts ("discriminator changed", "no longer decodes", "account not owned by") are never reached for Global, FeeConfig or the AMM FeeConfig. That is exactly the "IDL layout" class of D-19.

Scenario: pump redeploys with a new Global discriminator or closes and reallocates FeeConfig. The weekly check logs "could not run" and the admin row shows a failed run with the last pass kept. Launches and every engine job keep running against a layout that BONDR can no longer decode.
**Fix:** Separate "the RPC is down" from "the data does not decode". Read the raw accounts once, and derive the config facts from the infos you already have, turning a decode throw into a fact:
```ts
const config = await readLiveConfig(conn).catch((e: unknown) =>
  isRpcError(e) ? Promise.reject(e) : { decodeError: String(e) },
);
// judge(): if (f.decodeError) out.add(`live config no longer decodes with the pinned SDK`)
```
Alternatively, have `checkContract` reject only on transport errors (fetch or JSON-RPC failures) and turn every other throw into a mismatch fact. Add a test that feeds a Global account with a wrong discriminator through `checkContract` and asserts a mismatch, not "could not run".

**Outcome (2026-10-26): fixed at the root, commit 63a82ed.** core `config.ts` now has `configFacts(infos)` (the same SDK decoders) and `readLiveConfig` is one `getMultipleAccountsInfo` plus that. `checkContract` decodes the config from the raw infos it already reads; a missing, re-owned or re-laid-out account gives `config: null`, which `judge` turns into "live config no longer decodes with the pinned SDK" next to the per-account facts. Only RPC errors reject. Tests: packages/core/src/contract-gather.test.ts (missing Global, wrong owner, wrong discriminator, short FeeConfig each a mismatch; RPC failure still rejects). The fork rerun passes `genesis.contract` with the mainnet profile.

### CR-W-03: A failed pause write after a mismatch leaves every fee-engine job running

**File:** `apps/worker/src/contract-check.ts:54-60`, `apps/worker/src/switches.ts:69-75`, `apps/worker/src/fee-boot.ts:71`
**Issue:** On a mismatch, `run()` sets `failed = true` and calls `pause()`. `pause()` runs `audited(audit, ..., switchesOff)`, which writes `insertPending` to the database first. Then `switchesOff` writes the settings row and only after that sets memory. If either write throws (a Neon cold-start timeout, a connection reset, or the quota cap), `pause()` logs the error and swallows it. In-memory switches stay as they were, and nothing retries. `contractFailed()` is read only by the launch paths (`status.ts`, `submit.ts`, `genesis.ts`). The engine's gate is `allowed: (job, coin) => switchOn(job) && !coin?.hold`, which never consults it.

Scenario: the Monday check finds a fee-schedule change and the audit insert hits a transient connection error. Launches pause, but forced bonds, sweeps, finalize and buyback burns keep sending real-money transactions under the changed fee assumptions. This lasts until the next weekly run or a manual check, which is the "mismatch not pausing" case D-20 forbids.
**Fix:** Make the in-memory pause unconditional and independent of the database, and gate the engine on it:
```ts
// fee-boot.ts
allowed: (job, coin) => switchOn(job) && !contractFailed() && !coin?.hold,
```
Also retry the persistent write, for example with the stream `backoff` until it succeeds or a later run passes. Alternatively, set memory off before the write in a contract-specific path, so a restart that loses `failed` still finds the switches off.

**Outcome (2026-10-26): fixed, commit c0e1809 (with WR-W-01).** `contractFailed()` is now `failed || pending`: a mismatch whose switches-off write has not landed stays blocking even past a later pass, and the write retries on a 5 s / 30 s / 2 min / 10 min timer until it lands (writes only, no polling read). fee-boot `allowed` adds `!contractFailed()`, so every automatic fee job (forced bond, sweeps, finalize, buyback burn) refuses. Admin manual money actions keep D-16 (owner-signed; EVACUATE must stay available during a mismatch). Tests: contract-check.test.ts (failed write, pass, retry lands) and fee-boot-gate.test.ts.

## Warnings

### WR-W-01: The contract check is fail-open at boot and forgets a mismatch on restart

**File:** `apps/worker/src/contract-check.ts:28,35`, `apps/worker/src/genesis.ts:72`, `apps/worker/src/main.ts:100-101`
**Issue:** `failed` starts `false`. It stays `false` while the boot run is in flight (`not_run`) and after a boot run that could not run.
- `genesisOne` and child prepare proceed in that state. G-5 and D-30 require a passing check before genesis and child launches, but the code only refuses after a completed mismatch.
- A mismatch found before a restart is forgotten after it. Scenario: a mismatch pauses everything, and the owner turns launches back on while waiting for a fix (the comment at `contract-check.ts:26-27` says `failed` keeps launches paused). Then the worker restarts, and the boot run hits an RPC error. `failed` is `false`, so launches open with the known mismatch still in place.

**Fix:** Start `failed = true` (or treat `not_run` as blocking) until a run passes. Then genesis and child prepare refuse with `paused: contract_check` until the boot check has positively passed. The check takes seconds at boot, so the cost is a short refusal window.

**Outcome (2026-10-26): fixed, commit c0e1809.** `CheckDeps.strict` (contractDeps sets it on mainnet): on mainnet `failed` starts true when the check is wired and only a passing run clears it, so not run and could not run both block launches, genesis and the engine; a restart after a mismatch stays blocked until the boot run passes (the switches written off also persist). main.ts now wires the check and starts the boot run before enterGenesis and before any route or job. Devnet is unchanged. Test: contract-check.test.ts (strict blocks through not run and could not run, clears on pass; non-strict does not block).

### WR-W-02: Switches flipped on during genesis carry straight into production, and the D-30 gates are runbook-only

**File:** `apps/worker/src/genesis-boot.ts:29-35,43`, `apps/worker/src/admin-routes.ts:110`, `apps/worker/src/status.ts:227-235`
**Issue:** `enterGenesis` writes every switch off, but only at boot. In genesis mode `/admin/switch` and the bearer `/kill-switch` both stay open and persist `launches=true` (or forcedBond, sweeps and the rest) to `settings`. While genesis lasts this has no visible effect, because `pauseReason` returns `genesis` first. After the owner sets `BONDR_QUOTE_MINT` and redeploys, `bootIndex` loads those values, and production starts with launches enabled.

That start happens even if:
- the vanity pool holds fewer than 100 free mints (D-11, D-30 item 3; nothing in code checks `poolSize` before launches go on),
- the boot contract check has not passed yet (see WR-W-01).

**Fix:** In genesis mode, refuse switch-on at both routes, for example by routing `/kill-switch` and `/admin/switch` with `enabled: true` to `not_ready`. On mainnet, refuse `launches=true` unless `poolSize >= 100` and `contractState().kind` is `passed` or `redeployed`. This turns D-30 from runbook discipline into a code gate.

**Outcome (2026-10-26): fixed, commit 096e647.** New `switch-gate.ts` shared by `/admin/switch` (ActDeps.gate) and the bearer `/kill-switch` (setSwitch gate, both genesis and child routes): in genesis any switch-on answers 409 `not_ready` reason `genesis`; on mainnet `launches=true` needs a passing contract check (`contract_check`) and at least 100 free vanity mints (`vanity_pool`). Turning off is never refused; refusals write no audit row. Web: worker.ts passes a known `not_ready` reason through, and the console switch alert names it instead of the generic retry line. Tests: switch-gate.test.ts, admin-act.test.ts, worker.test.ts. No Playwright shot was taken for the new alert copy.

### WR-W-03: A genesis launch still settling when the worker reboots in child mode is ingested as a BONDR child coin

**File:** `apps/worker/src/settle.ts:22-26,103-105`
**Issue:** `setGenesis(true)` is a boot-time process flag. Suppose the genesis row is still `sent` or `unknown` when the worker restarts with `BONDR_QUOTE_MINT` set: the owner copied the mint from the prepare response and redeployed quickly, or an RPC outage left the row `unknown`. Then `resumeLaunches`, then `landed()`, then `ingestLaunch` runs. The parser finds the CreateEvent, inserts a `coins` row for BONDR itself with `w` = treasury, adds it to `knownCoins` and `arm`s it for the engine. The boot backfill already excludes this row (`ingest.ts` `backfillRows`, `ne(launches.mint, Q)`), but settle does not.
**Fix:** Key the skip on the row, not on the process mode. Pass the treasury into settle, or compare against Q:
```ts
if (genesis || row.mint === bondrMint?.toBase58() || row.w === treasuryBase58) return;
```

**Outcome (2026-10-26): fixed, commit 28d01d4.** settle `setGenesis` is replaced by `setTreasury` (set once at boot in every mode); `landed` skips ingest when `row.w` equals the treasury. Test: settle-flow.test.ts.

## Info

### IN-W-01: The TREASURY_PUBKEY derivation check covers only the current lane's buyback
**File:** `apps/worker/src/env.ts:83-84`
**Issue:** It checks ops, `buyback(seed, net, lane)` and the derived treasury. It does not check the buyback keys of the other lanes, or any W or vanity mint key. W keys are per-mint, so a full check is impossible. But "any derived role" (D-10) could at least include `buyback` for every `Lane`.
**Fix:** `(["local","staging","production"] as const).map((l) => buyback(seed, net, l))` in the derived list.

**Outcome: fixed, commit 887826a.** Every lane's buyback key is in the derived list; env.test.ts covers the production lane.

### IN-W-02: genesisLanded depends on TREASURY_PUBKEY never changing
**File:** `apps/worker/src/genesis.ts:38-45`
**Issue:** The guard against a second genesis matches `launches.w = <current treasury>`. If the owner changes `TREASURY_PUBKEY` between a landed genesis and the `BONDR_QUOTE_MINT` redeploy, a second genesis is admitted.
**Fix:** Also count any landed or in-flight launch row in genesis mode regardless of `w` (on mainnet, genesis is the only launch type before BONDR exists). Alternatively, rely on the on-chain check suggested in CR-W-01.

**Outcome: skipped.** Not a one-liner without changing the GenesisDeps seam the fork stage injects; changing TREASURY_PUBKEY mid-genesis is a runbook violation, and CR-W-01 removes the mislabel path that made it dangerous.

### IN-W-03: The genesis symbol and name are not pinned
**File:** `apps/worker/src/genesis.ts:80-88`
**Issue:** The genesis path skips the reserved and cooldown checks because the ticker is meant to be BONDR (D-32, D-44), but it accepts any `symbol`. A typo becomes a permanent mint.
**Fix:** `if (req.symbol !== "BONDR") throw fail({ error: "invalid_input" })`, or make the ticker a constant.

**Outcome: fixed, commit 4f6342b.** genesisOne refuses any symbol other than BONDR with invalid_input before a mint is reserved; genesis.test.ts covers it.

### IN-W-04: The cost preview can show a Sender tip that the message no longer carries
**File:** `apps/worker/src/build.ts:103-109`, `apps/worker/src/prepare.ts:183-189`
**Issue:** When the tip would push the message past 1,232 bytes it is dropped, but `PrepareResult.preview` does not say so. The web adds `status.senderTipEstimate` unconditionally (`launch-buy.tsx:37`, `launch-receipt.tsx:62`), so the receipt overstates the cost by 0.001 SOL in that case.
**Fix:** Add `tip: String(tipped(f.msg) ? launchTip(net) : 0n)` to the preview and have the web read that value.

**Outcome: skipped.** Needs a new preview field plus web receipt and buy changes, not a one-liner; the overstatement is 0.001 SOL and only when the tip is dropped (the rehearsed genesis tx is 757 bytes tipped).

### IN-W-05: Boot resume resends a tipped launch over plain RPC
**File:** `apps/worker/src/settle.ts:165-169`
**Issue:** `resumeLaunches` resends `signed` rows with `broadcast()`, so a mainnet launch that was tipped for Sender goes out over plain RPC after a restart. This is safe, because the signature is the same, but the tip is paid without the Sender routing it bought.
**Fix:** Reuse `broadcastLaunch` from submit, once CR-W-01 is fixed.

**Outcome: skipped.** Safe as the review says (same signature); worth doing only alongside a submit refactor.

### IN-W-06: Misleading names on the new mainnet paths
**File:** `apps/worker/src/fee-send.ts:120`, `apps/worker/src/admin-evacuate.ts:233-234`, `apps/worker/src/main.ts:97`
**Issue:**
- `tipIxs(net, ops, ...)` is now called with the dev as payer, but the parameter is still named `ops`.
- The EVACUATE refusal on mainnet without an external treasury still answers `reason: "devnet_only"`.
- When TREASURY_PUBKEY equals ADMIN_WALLET (allowed, with only a warning), the boot `wallets:` line prints the admin wallet, against the header rule at `env.ts:2`.

**Fix:** Rename the parameter to `payer`. Add a `treasury_required` reason. Leave the treasury out of the wallets line when it equals the admin wallet.


**Outcome: partly fixed, commit fea9970.** `tipIxs` takes `payer`; the boot wallets line leaves the treasury out when it equals ADMIN_WALLET. The `treasury_required` reason was skipped: the web maps `devnet_only` (use-evacuate.ts), so it needs a web change too.

---

_Reviewed: 2026-10-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (deep on mainnet-critical paths)_
