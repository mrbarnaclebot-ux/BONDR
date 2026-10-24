---
phase: 04-trading
reviewed: 2026-10-25T00:00:00Z
depth: standard
diff_base: accd6cc21bf79fc6d84bc38ace190c02ed166231
files_reviewed: 61
status: issues_found
findings:
  critical: 3
  warning: 15
  info: 13
  total: 31
---

# Phase 4 Code Review

Two reviewers split the 61 changed source files. Finding ids are prefixed S- (server half: core, worker, API routes, spike rows) and C- (client half: panel, sheet, hooks, e2e).

# Server half

# Phase 4: Code Review Report (server half)

**Reviewed:** 2026-10-24T19:27:01Z
**Depth:** standard (diff `accd6cc..HEAD`)
**Files Reviewed:** 33
**Status:** issues_found

## Summary

I traced the money path end to end: web route, worker parse, devnet cap, route, simulation, compile, store, submit, broadcast, settle. The core safety properties hold:

- **Wallet from the session.** Every `/api/trade/*` route takes the wallet from `sessionWallet(req)`. The prepare route copies only `FIELDS` from the body, so a `wallet` in the body is dropped. The submit, balance and view routes pass the session wallet.
- **Message check.** Submit compares the raw bytes with `sameMessage(stored, wire, 1)`: an exact length, a signature count of one, and a byte-equal message. It then runs `signatureOk` on slot 0 against the stored wallet. Nothing is re-serialized.
- **Double send.** `submitTrade` re-reads the entry after its only await (`getBlockHeight`). Between that re-read and `updateTrade({state:"signed"})` in `send()` the code is synchronous, so a concurrent submit can only read. An "unknown" result is never resent.
- **Slippage floor.** `route.ts:23` throws on a zero floor. Slippage is bounded to 10..5000 bps (`trade-quote.ts:44`). The final simulation runs with the real `minAmountOut`.
- **Devnet cap.** `capDevnetBuy` runs before `routeFor` and enforces `maxSolIn` at prepare (`trade-prepare.ts:85-90,140`).
- **Neon budget (D-04).** No trade path touches Postgres. Quote state is per-mint, single-flight and cached for 2 s. Configs are cached for 60 s and read on demand, never on a timer.
- **Helius key.** `heliusEstimate` posts to `conn.rpcEndpoint`. Its error text never contains the URL, and `refuse`/`redact` scrub both `api-key=` and the raw key. No leak found. This path is also unreachable today (IN-01).
- **Quote math.** The math matches pump. I decoded `fixtures/multihop-sell.json`: the BONDR leg is quote 9,848,426 minus fee 93,561, which gives 9,754,865. That equals both the fixture's lamport delta and `curveHop`'s output. The fork rows `bonded.`, `migrated.` and `pooled.multihop.sell` match `pureQuote` to the base unit. `curveRates` uses the fixed 1B supply exactly as the SDK's `v3Rates` does for non-mayhem curves.
- **File size.** Every file is under 300 lines.

Defects: the confirmed "Sold for" bug (CR-01). Error-code mapping that ignores which program raised the code, which now also leaks into launches (WR-01). A lossy preflight mapping (WR-02). No runtime check that the trade message carries only the route (WR-03). No devnet guard against a buy completing the coin's own curve (WR-04). No test for the double-submit race (WR-05).

## Narrative Findings (AI reviewer)

## Critical Issues

### S-CR-01: "Sold for" reports the wallet's SOL delta, which counts rent refunds and rent paid as proceeds

**File:** `apps/worker/src/trade-submit.ts:63-69`, `packages/core/src/trade.ts:143-145`
**Issue:** Confirmed. A landed sell sets `amountOut = lamportDelta(meta)`, which is `postBalances[0] - preBalances[0] + fee`. Any account the transaction closes refunds its rent to the payer and inflates the number. Examples are the coin ATA on a 100% sell, a pre-existing WSOL ATA, and the intermediate BONDR ATA. Any ATA the transaction creates makes the number too low. The staging run showed "Sold for 0.0305 SOL" against 0.028 in the feed (04-10-SUMMARY:123, 04-13-SUMMARY:68).

The spike fork rows agree only because their trader reused existing ATAs that were never closed. That is not a first-time user. The user sees a wrong money figure for every sell that closes or opens an account.

**Fix:** Read the BONDR to SOL leg's own event, which the indexer already decodes (`events.ts` `innerEvents`). On a curve, the net amount is `quoteAmount - fee - creatorFee`; the buyback fee is already inside `fee`. Verified on `multihop-sell.json`: 9,848,426 - 93,561 - 0 = 9,754,865. On a pool it is `SellEvent.userQuoteAmountOut`. Keep `lamportDelta` only as a fallback.

```ts
// packages/core/src/trade.ts
import { type EventTx, innerEvents } from "./events.ts";

/** SOL the sell paid out, from the BONDR->SOL leg's event: never counts rent refunds or ATA creation. */
export function soldLamports(tx: EventTx, bondrMint: string, bondrPool: string, user: string): bigint | undefined {
  const leg = innerEvents(tx).findLast(
    (e) =>
      String(e.data.user) === user &&
      ((e.name === "TradeEvent" && e.data.mint === bondrMint && String(e.data.isBuy) === "false") ||
        (e.name === "SellEvent" && e.data.pool === bondrPool)),
  );
  if (!leg) return undefined;
  const n = (k: string) => BigInt(String(leg.data[k]));
  return leg.name === "SellEvent" ? n("userQuoteAmountOut") : n("quoteAmount") - n("fee") - n("creatorFee");
}
```

```ts
// apps/worker/src/trade-submit.ts settleTrade: fetchTx instead of fetchMeta, and the Q mint and its pool from ctx
const tx = await fetchTx(conn, sig);
const out = tx && (e.side === "buy"
  ? tokenDelta(tx.meta, new PublicKey(e.mint), new PublicKey(e.wallet))
  : soldLamports(tx, ctx.Q.toBase58(), canonicalPumpPoolPdaWithQuote(ctx.Q, NATIVE_MINT).toBase58(), e.wallet)
    ?? lamportDelta(tx.meta));
```

Add one assertion to `trade-submit.test.ts` (or a core test): `soldLamports(multihop-sell fixture) === 9_754_865n`. Change the `multihop.ts:113` `outAmount` the same way, so the fork rule keeps proving the figure the panel shows.

## Warnings

### S-WR-01: Custom error codes are mapped without checking which program raised them, and the shared map changed launch errors

**File:** `packages/core/src/trade-error.ts:6-14`, `apps/worker/src/trade-submit.ts:18,62`, `apps/worker/src/build.ts:104`
**Issue:** `customCode(err)` returns only the number, and the same number means different things in the two programs. I checked against the pinned IDLs:
- AMM 6004 is ExceededSlippage, but pump 6004 is MintDoesNotMatchBondingCurve.
- Pump 6005 is BondingCurveComplete, but AMM 6005 is InvalidAdmin.
- Pump 6002 TooMuchSolRequired, pump 6003 TooLittleSolReceived and AMM 6040 BuySlippageBelowMinBaseAmountOut are not mapped to `slippage` at all.

An inner-CPI failure surfaces as `InstructionError [ix, {Custom}]` under the top-level multi_hop_swap, so the err object cannot tell the programs apart. `build.ts` now re-exports `tradeError` as `simError` for launches. A launch's exact-out dev buy that moves (pump 6002) is still `build_failed`, a pump 6004 becomes "slippage", and pump 6005 becomes "paused". Those are codes the launch flow did not return before, and its UI may not handle them.
**Fix:** Take the program from the last `Program <id> failed: custom program error: 0x...` log line and key the map by program and code:

```ts
const failing = (logs ?? []).findLast((l) => /Program \w+ failed: custom program error/.test(l))?.split(" ")[1];
const key = `${failing}:${code}`;
const SLIPPAGE = new Set([`${AMM}:6004`, `${AMM}:6040`, `${PUMP}:6002`, `${PUMP}:6003`]);
const AWAITING = new Set([`${PUMP}:6107`, `${PUMP}:6005`]);
```

Pass `meta.logMessages` into the settle mapping instead of comparing `r.code === 6004`. Keep the launch map at its old codes, or confirm the launch UI handles `slippage`.

### S-WR-02: Preflight rejection is mapped from a 400-character redacted message instead of the structured code and logs

**File:** `apps/worker/src/trade-submit.ts:79`, `packages/core/src/send.ts:224-231`
**Issue:** `finish(e, textError(r.err ?? "").error)` re-parses `r.err`, which is `redact(\`${name}: ${message}\`).slice(0, 400)`. `broadcast` already has `r.code` (from `transactionError.logs`). Losing the logs breaks the mapping:
- An insufficient-SOL preflight says "Attempt to debit an account but found no record of a prior credit". `AccountNotFound` appears only in the err JSON, so the regex misses it and the user gets `build_failed` instead of "Not enough SOL".
- The `Logs:` part, with "insufficient lamports", is usually past the 400-character cut.
**Fix:** Return the preflight `logs` and the err JSON from `thrown()` in a field, unsliced and kept off the wire. Then map with `tradeError(errJson, logs)`, so prepare and submit share one path. At minimum, use `r.code` when it is set: `r.code !== undefined ? tradeError({ InstructionError: [0, { Custom: r.code }] }, null) : textError(r.err ?? "")`.

### S-WR-03: Nothing enforces "only the route and the compute budget" in the signed trade

**File:** `apps/worker/src/trade-prepare.ts:151-154`
**Issue:** The "platform fee 0, no extra transfers" guarantee (TRADE-04) rests on two things. One is the pinned SDK's `multiHopSwapInstructions` output. The other is `checkMessage`, a program allowlist that admits the System Program, so a `SystemProgram.transfer` to any address passes. A test checks the instruction order only with a mocked route (`trade-prepare.test.ts:157`). At runtime nothing checks that each System transfer goes to the user's own WSOL ATA, or that there is exactly one multi_hop_swap. An SDK bump (D-01 pins it, but Phase 7 will move it) could add a fee transfer that ships silently.
**Fix:** Add a structural check after compile and refuse with `build_failed` on any mismatch:

```ts
const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, user).toBase58();
for (const ix of msg.compiledInstructions) {
  const p = msg.staticAccountKeys[ix.programIdIndex].toBase58();
  if (p === SYSTEM && (ix.data.readUInt32LE(0) !== 2 || msg.staticAccountKeys[ix.accountKeyIndexes[1]].toBase58() !== wsol))
    throw refuse({ error: "build_failed" }, "system ix is not the WSOL wrap");
}
if (msg.compiledInstructions.filter((ix) => isMultiHop(msg, ix)).length !== 1) throw refuse(...);
```

`MULTI_HOP_SWAP` and its tag check already exist in `cosign.ts:21,57-63`; reuse them.

### S-WR-04: The devnet cap protects BONDR's curve but not the coin's own curve

**File:** `apps/worker/src/trade-prepare.ts:85-90`, `apps/worker/src/trade-quote.ts:51-62`
**Issue:** `maxSolIn` caps only buys that would complete BONDR. A devnet buy that completes the child's curve leaves the child complete and unmigratable: devnet cannot bond a child (Phase 3 A8, CONTEXT D-19). After that, every holder's sell of that coin fails with "paused" for good. Devnet curves are about 100x cheaper (`multihop.ts:138`), so a 1 SOL preset buy can plausibly complete a young child. `curveHop` caps the preview at `realTokens`, but prepare does not refuse the trade.
**Fix:** On devnet, when the coin is on its curve, refuse a buy whose quoted coin out (`routeQuote(...).amountOut`) reaches 90% or more of `coin.curve.realTokenReserves`. The 90% matches the BONDR rule. Alternatively, include the coin's cost-to-complete (in BONDR, converted through the BONDR hop) in `maxSolIn` and take the smaller of the two caps. The state is already cached in `mintState`, so this needs no new reads.

### S-WR-05: No test covers the double-submit race on the money path

**File:** `apps/worker/src/trade-submit.test.ts:122-131`, `apps/worker/src/trade-submit.ts:86-101`
**Issue:** Today the second `owned(req)` re-read after `await getBlockHeight()` is the only thing that stops two concurrent submits from both broadcasting. The existing test "a repeat submit is a read" is sequential. A refactor that drops the re-read, or adds an await before `updateTrade({state:"signed"})`, would still pass every test.
**Fix:** Add one test. Fire two `submitTrade` calls with `Promise.all` while `getBlockHeight` is a deferred promise, resolve it, then assert `m.broadcast` was called once and that one result is a read of state `signed` or `sent`.

## Info

### S-IN-01: The Helius priority-fee path is unreachable

**File:** `apps/worker/src/trade-prepare.ts:46`, `apps/worker/src/main.ts:52`
**Issue:** `env.net` is a `Net` (`"devnet" | "fork"`), so `net === "mainnet"` is never true. `heliusEstimate` runs only in unit tests, and its first real call will be on mainnet in Phase 7. The key handling is safe: `redact` covers `api-key=` and the raw key.
**Fix:** Add a `ponytail:` note that Phase 7 adds `"mainnet"` to `Net`, and add a live check (like `TRADE_LIVE`) when it does.

### S-IN-02: The D-08 priority cap is defined twice

**File:** `apps/worker/src/trade-quote.ts:27`, `apps/worker/src/trade-prepare.ts:29`
**Issue:** `NETWORK_MAX = String(5_000 + 500_000)` repeats `MAX_PRIORITY_LAMPORTS` by hand, so changing one makes the quote's network fee line wrong.
**Fix:** Export `MAX_PRIORITY_LAMPORTS` from one module and derive `NETWORK_MAX` from it.

### S-IN-03: A dust amount answers `build_failed` instead of `invalid_input`

**File:** `packages/core/src/route.ts:23`, `apps/worker/src/trade-prepare.ts:104-106`
**Issue:** "no floor above 0" goes through `textError` and comes out as `build_failed`, so the user gets a generic failure for an amount that is simply too small.
**Fix:** Map that message (or a typed error) to `invalid_input` in `routeFor`.

### S-IN-04: The fee breakdown rounds down where pump rounds up

**File:** `packages/core/src/quote.ts:176-179`
**Issue:** `hopFee` uses floor division, while pump charges `ceilFee` per component. The displayed fees can be 1 to 2 lamports low per hop. This is display only.
**Fix:** Sum the per-component `ceilFee` values, as `curveHop` does, or leave it with a comment.

### S-IN-05: `routeQuote` is over the 40-line function limit (AGENTS.md section 5)

**File:** `packages/core/src/quote.ts:189-230`
**Issue:** The function is 42 lines.
**Fix:** Move the `fees` object into a `feesFor(a, bondrRates, coinRates, mid, out)` helper.

### S-IN-06: The quote-state cache key ignores the quote mint

**File:** `apps/worker/src/trade-state.ts:29-30`
**Issue:** `mintState` keys on the base mint only, while `readMintState` depends on `quoteMint`. It is safe today, because BONDR is always read with SOL and every coin with BONDR. The first caller that reads a mint under another quote would get the wrong venue for up to 2 s.
**Fix:** Key on `${mint}:${quoteMint}`.

### S-IN-07: Results are lost on a worker restart and when the web submit times out

**File:** `apps/worker/src/trade-store.ts:3-4`, `apps/web/app/api/trade/submit/route.ts:9`
**Issue:** The store is per-process (a documented ponytail). After a restart, a trade that already landed answers `not_found`. Separately, `pace()` is shared with launch sends, so a queue of more than about 18 sends makes the 20 s web timeout return `worker_unavailable` while the worker still broadcasts. In both cases the browser must not show "failed".
**Fix:** In the client, treat `not_found` and `worker_unavailable` after a submit as "unknown, check Solscan" and link the signature the browser already knows from slot 0. This is the client reviewer's side; noting it here because of the server cause.


_Reviewed: 2026-10-24T19:27:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

# Client half

# Phase 4: Code Review Report (client half)

**Reviewed:** 2026-10-25
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

This review covers the client half of Phase 4: the trade panel, sheet and bar, the quote, balance, announce and run hooks, the button state table, the callouts and the e2e specs. The D-17 and UI-SPEC copy matches word for word. Double submit is guarded well: the `busy` ref, an `action` gate on both `onSubmit` and `onClick`, and the in-flight `fieldset disabled`. The same holds for the debounce and abort handling in `useRouteQuote`.

There are two blockers:

1. The button and the D-13 "anyway" gate trust a quote that may be for a different amount.
2. The trade run has no deadline and no abort, so a worker outage freezes the panel and locks the sheet.

Most warnings are about what happens when the sheet closes or the account changes during a trade, about failure copy that says "nothing was sent" after a signed transaction was posted, about live-region spam, and about the AGENTS.md 40-line function limit.

## Narrative Findings (AI reviewer)

## Critical Issues

### C-CR-01: A quote for an older amount drives the ready label, the over-15% gate and the shown minimum

**File:** `apps/web/components/trade-panel.tsx:42`, `apps/web/lib/trade-button.ts:102-123`, `apps/web/components/trade-quote.tsx:189`, `apps/web/components/trade-result.tsx:124`
**Issue:** The quote passed to the button is filtered only by `side` (`t.quote?.side === t.side`). While a new amount is in its 400 ms debounce, `useRouteQuote` keeps the old quote (`loading: true`), and `idleState` never looks at `loading` once `q` exists. So after typing `0.5` (quote 1.23%) and then `5`, the button reads "Buy GRUB with 5.00 SOL", which is ready, and Enter submits at once. The gate checks `q.impact > 0.15` against the 0.5 SOL quote, so the D-13 "Buy anyway, X% price impact" confirmation is skipped for a trade that may be far over 15%.

The same thing happens:
- right after a failed trade, when the pre-trade quote is still shown and the refresh was stopped for the whole run;
- after a slippage change, when "Minimum received" is shown for the old slippage.

Prepare sets `minAmountOut` from a fresh simulation, so funds stay bounded by slippage. But the confirmation required by D-13 can be bypassed.
**Fix:** Treat a quote as current only when it matches the request being shown. Check this in one place, the provider, so the button, the quote list and the callouts all agree:
```ts
// use-trade.ts, in TradeProvider
const current = q.quote && q.quote.side === side && q.quote.amountIn === String(units) ? q.quote : null;
// expose `quote: current` (keep the raw quote only for the dimmed display, if wanted)
```
In `idleState`, also return `off("Getting quote…")` when `i.loading` is true, or keep the last good label but with `action: null`. Then neither Enter nor a click can submit on a quote that is being replaced.

### C-CR-02: The trade poll never ends while the worker is unreachable, and nothing aborts it

**File:** `apps/web/lib/trade-run.ts:57-72`, `apps/web/lib/trade-run.ts:85-105`, `apps/web/lib/use-trade.ts:196-216`
**Issue:** `poll` loops `for (;;)`. `getView` returns `null` on any network error or non-404 status (502, 503, 500), and `null` matches no exit branch. `PREPARED_MS` only applies while the row reads `prepared`. While the worker is down or the proxy returns 5xx, the loop runs forever at 1 req/s:
- `phase` stays `"confirming"`;
- the button is stuck on "Confirming…";
- the sheet cannot close, because `busy` blocks the close button, Escape and the backdrop;
- the user gets no "sent but not confirmed" warning.

Unlike `launch-run.ts` (`while (!run.signal.aborted)`, with a signal on every call), `runTrade` takes no `AbortSignal`. Leaving the page or unmounting the provider leaves the loop polling, and `setPhase` and `setResult` are called on an unmounted tree. These are the "abandoned poll" and "sheet locked" cases from the brief.
**Fix:** Add an overall deadline and a signal, mirroring launch-run:
```ts
const CONFIRM_MS = 120_000; // the worker keeps rows 2 min (D-07)
async function poll(id: string, signed: string, signal: AbortSignal, sig?: string): Promise<TradeView> {
  const start = Date.now();
  while (!signal.aborted) {
    if (Date.now() - start > CONFIRM_MS) return sig ? { state: "unknown", signature: sig } : Promise.reject(new Stop("expired"));
    // ...existing body
  }
  throw new Stop("worker_unavailable");
}
```
In `useRun`, create an `AbortController` per run, abort it in an unmount effect, and pass `signal` to `call`, `getView` and `poll`. When the deadline passes after a submit was posted without a signature, use the "unknown" path described in WR-05.

## Warnings

### C-WR-01: The sheet can close mid-trade, and reopening it wipes the result and changes the side during the flight

**File:** `apps/web/components/trade-sheet.tsx:57-62`, `apps/web/components/trade-sheet.tsx:77`, `apps/web/lib/use-trade.ts:251-256`
**Issue:** The busy guard only covers `onCancel` and the backdrop. Chrome's close-watcher rules let a second Escape or Android back press close a modal dialog without a cancelable `cancel` event, and `onClose={() => setOpen(false)}` then accepts it. The comment on line 76 admits this. The `matchMedia` handler also closes the sheet while busy. Below 1100px the column panel is `display:none`, so the result lands where nobody can see it.

Reopening from the bar calls `show()`, then `setSide(side)`, then `input(0)`, then `run.clearResult()`. This erases the result, including a `kind: "unknown"` "Check Solscan before you trade again" warning. If the trade is still in flight, it also flips the side and clears the amount while the run continues. The user can lose the only signal that a trade may have landed and trade again.
**Fix:** In `onClose`, if `busy`, call `dialog.current?.showModal()` again (and ignore the close) rather than `setOpen(false)`. In `show()`, skip `setSide` when `t.phase !== "idle"`, and do not clear an `unknown` result on open. Only let input inside the panel clear it.

### C-WR-02: Over the devnet cap the field shows an error, but the button stays ready and the trade fails with the generic copy

**File:** `apps/web/lib/trade-button.ts:95-124`, `apps/web/components/trade-amount.tsx:90-92`
**Issue:** `errorText` shows "On devnet, buys stay under {max} SOL…" when `units > maxSolIn`. But `buttonState` has no cap row, so the button reads "Buy GRUB with 0.80 SOL" and submits. The worker refuses with `invalid_input` (`trade-prepare.ts` `capDevnetBuy`), which falls back to "Could not build your trade. Nothing was sent. Try again." The UI-SPEC row "No amount, zero, or invalid → Enter an amount, disabled; invalid also shows the field error" is not honored for this error.
**Fix:** Add `cap: bigint | null` to `ButtonInput` (from `quote.maxSolIn`) and return `off("Enter an amount")` when `side === "buy" && cap !== null && units > cap`, before the balance row. Add a row to `trade-button.test.ts`.

### C-WR-03: The impact callouts re-announce on every 2 s refresh, and the quote-failed callout flaps

**File:** `apps/web/components/trade-result.tsx:83-100`, `apps/web/components/trade-result.tsx:123-126`, `apps/web/components/callout.tsx` (roles)
**Issue:**
- The impact callout's body includes the live `{p}` percentage, and `Callout` is `role="status"` (warn) or `role="alert"` (error). A text change inside a live region is announced, so every refresh that moves the impact even 0.01% re-reads the whole callout, and the error band does it assertively. UI-SPEC says "the 2s refresh does not re-announce them".
- The `key="warn"` / `key="error"` props on the returned element do nothing; the comment implies a guarantee that does not exist.
- One failed refresh sets `quote: null`, which swaps the slot to "Could not get a quote. Trying again." (role=status). The next good quote swaps back and remounts `Impact`, so each flap announces twice.

**Fix:** Freeze the announced text per band. Keep the live role on a wrapper with constant content (title and a band-level sentence), and render the changing percentage outside the live region, or under `aria-live="off"`. Keep the last good quote on a refresh failure (set only `quoteError`, not `quote: null`), so one failed refresh does not unmount the impact callout. With CR-01's `current` filter, that stale quote can still never be traded.

### C-WR-04: `useRouteQuote` can write a stale "failed" state after its request was aborted

**File:** `apps/web/lib/use-route-quote.ts:43-51`
**Issue:** If the effect cleanup aborts while `r.json()` is still reading, `json()` rejects. The inner `.catch(() => null)` turns that into `body = null`, and the `else` branch runs `setS({ quote: null, loading: false, quoteError: "failed" })`. The abort check exists only on the outer `.catch`. The stale write wipes the quote, shows "No quote yet" and the quote-failed callout (announced), and clears `loading` for the newer request until it lands.
**Fix:** Start the `.then` with `if (abort.signal.aborted) return;`, and check again after the `await r.json()`.

### C-WR-05: Failure copy says "Nothing was sent" or "failed on-chain" when the outcome is actually unknown

**File:** `apps/web/lib/trade-run.ts:62-65`, `apps/web/lib/use-trade.ts:181-186`, `apps/web/components/trade-result.tsx:50-51`
**Issue:**
- `submit()` swallows `worker_unavailable` and returns `null`, and `out?.signature` is then undefined. If the worker restarted (404) before any view returned a signature, `poll` throws `Stop("not_found")`. That maps to the fallback "Could not build your trade. Nothing was sent. Try again." But the signed transaction was posted and may have been sent and landed.
- `toResult` maps `state: "unknown"` without a signature to `kind: "failed", code: "onchain"`, which reads "Your trade failed on-chain. Only the network fee left your wallet." That outcome was never observed.

Both invite a second trade.
**Fix:** Track `posted = true` once `submit` has been called. After that point, a `not_found` or a signature-less `unknown` should produce a warn result: "Your trade was sent but is not confirmed yet. Check Solscan before you trade again." With no signature there is no link, so point the user to their wallet history instead. Never use "Nothing was sent" after a signed wire has left the browser.

### C-WR-06: An account switch during signing reports "Signature declined", not "Phantom switched accounts"

**File:** `apps/web/lib/trade-run.ts:36`, `apps/web/lib/trade-run.ts:96-97`
**Issue:** `useRun` passes a `wallet` snapshot from the press-time render, so `signTransaction` still holds the old `account`. If the user switches accounts during prepare or while Phantom is open, signing usually throws ("Phantom is not connected" or a Phantom account error). `signWithin` maps every throw to `Stop("rejected")`, and the `switched` check on line 97 is never reached. The user sees "Signature declined." instead of the UI-SPEC copy. A disconnect mid-trade (address becomes null) never fires `onAccountChange` at all, so it is not treated as a switch either.
**Fix:** Wrap the call: `try { signed = await signWithin(...) } catch (e) { if (switched) throw new Stop("switched"); throw e; }`. In `runTrade`, also treat `wallet.address` going null as switched, for example by passing a `getAddress()` that reads a ref.

### C-WR-07: The submit button loses keyboard focus on the Enter path and after a landed trade

**File:** `apps/web/components/trade-panel.tsx:75-81`, `apps/web/components/trade-panel.tsx:130`, `apps/web/lib/trade-button.ts:53`
**Issue:**
- When a trade starts with Enter in the amount input, focus is inside the `<fieldset disabled>`. The input becomes disabled and focus falls to `<body>`, and inside the modal sheet the user loses their place.
- After a landed trade, the amount is cleared and the button becomes "Enter an amount" with native `disabled`, so focus drops to `<body>` there too.

UI-SPEC says "The submit button keeps focus through the whole flow". `trade-run.e2e.ts` only covers the click path.
**Fix:** In `onSubmit`, call `buttonRef.current?.focus()` before `run()`. For the post-result states, render the button with `aria-disabled` rather than `disabled` (the `off()` helper sets `ariaDisabled: true, disabled: false`). The `action: null` guard in `run` already makes that safe. Alternatively, move focus to the result line after a landed trade.

### C-WR-08: The sell error tells users to type "1,000", but the parser rejects commas

**File:** `apps/web/lib/use-trade.ts:118`, `apps/web/components/trade-amount.tsx:88`
**Issue:** `toUnits("sell", …)` matches `^(\d+)(?:\.(\d{1,6}))?$`, so "1,000" is invalid, and the error it shows is "Enter an amount of GRUB, like 1,000." Following the instruction keeps the field in error. A leading-dot ".5" also fails on both sides (`parseSol` uses the same `\d+` head).
**Fix:** Strip thousands separators before parsing: `text.trim().replace(/,/g, "")`, for both sides. Optionally accept `^\d*\.\d+` by treating an empty integer part as `0`.

### C-WR-09: e2e flakiness: the devnet sell depends on a single post-buy balance read, and a timer-absence check uses real time

**File:** `apps/web/e2e/trade.e2e.ts:281-287`, `apps/web/lib/use-trade.ts:214`, `apps/web/e2e/trade.e2e.ts:171-177`
**Issue:**
- The balance is refetched exactly once, in `useRun`'s `finally`, right after the worker reports landed. If the worker's balance read lags the confirmation (a different RPC node or commitment), `tokens` stays at the pre-buy value. The "100%" chip then fills "0", the button stays "Enter an amount", and the 30 s `toHaveText(ready)` times out. This is also a real UX bug: Sell 100% right after a buy can be wrong until the tab is refocused.
- The "loop stops for good" check uses `page.waitForTimeout(200)` of real time to show no quote fired. It passes vacuously if a request is slow, and it adds about 600 ms.

**Fix:**
- After a landed trade, refetch the balance a second time about 2 s later. That is one bounded retry, not a timer loop, so it stays within D-16. In the spec, wait for `Balance … GRUB` to show a non-zero value before pressing "100%".
- Replace the sleeps with `expect.poll(() => calls.quote.length, { timeout: 1000 }).toBe(stopped)` after each `runFor`, or flush with `runFor(1)` and assert at once.

### C-WR-10: Nine functions exceed the AGENTS.md 40-line limit

**File:** see the list below
**Issue:** AGENTS.md section 5 says "Functions under 40 lines".
- `TradeSheet`: `apps/web/components/trade-sheet.tsx:25-84`, 60 lines
- `TradePanel`: `apps/web/components/trade-panel.tsx:98-155`, 58 lines
- `TradeProvider`: `apps/web/lib/use-trade.ts:224-271`, 48 lines
- `Fees`: `apps/web/components/trade-quote.tsx:92-139`, 48 lines
- `TradeAmount`: `apps/web/components/trade-amount.tsx:97-142`, 46 lines
- `useRouteQuote`: `apps/web/lib/use-route-quote.ts:16-61`, 46 lines
- `Bar`: `apps/web/components/trade-sheet.tsx:110-153`, 44 lines
- `CustomSlippage`: `apps/web/components/trade-quote.tsx:142-184`, 43 lines
- `TradeQuote`: `apps/web/components/trade-quote.tsx:187-228`, 42 lines

All files except `globals.css` are under 300 lines; `use-trade.ts` is at 271 and close to the limit.
**Fix:**
- `TradeSheet`: move the open effect and the `matchMedia` effect into a `useSheet(open)` hook.
- `TradePanel`: move the live region and the fine print into a `PanelFooter`.
- `TradeProvider`: build the setters in a `useTradeInputs(loop, run)` helper.
- `useRouteQuote`: extract `fetchQuote(body, signal): Promise<QuoteState>`.
- `Fees`: move the `<summary>` into a `FeesSummary`.
- The rest: split the label row and the input row into small components.

## Info

### C-IN-01: `globals.css` is 406 lines

**File:** `apps/web/app/globals.css:1-406`
**Issue:** It was over the 300-line limit before Phase 4, which added 10 lines (lines 181-190). Noted so that it gets split later, for example the token page rules into `token.css`.
**Fix:** Split by surface when it is next touched.

### C-IN-02: The custom slippage error and the applied value disagree at the edges

**File:** `apps/web/components/trade-quote.tsx:146-153`
**Issue:** `valid` checks the raw number (`n >= 0.1 && n <= 50`), but the apply path checks the rounded bps. So "0.095" shows "Enter a slippage from 0.1% to 50%." and still applies 10 bps, and "50.004" shows the error and applies 5000 bps.
**Fix:** Derive both from one value: `const bps = Math.round(n * 100); const valid = text.trim() !== "" && bps >= 10 && bps <= 5000;`.

### C-IN-03: A landed row without a signature renders a broken Solscan link

**File:** `apps/web/lib/use-trade.ts:183`
**Issue:** `signature: v.signature ?? ""` makes `TxLink` point to `https://solscan.io/tx/?cluster=devnet`.
**Fix:** Make `signature` optional on the landed result and render `TxLink` only when it is set.

### C-IN-04: The 2 s tick can fire a debounced quote early

**File:** `apps/web/lib/use-route-quote.ts:27,53`, `apps/web/lib/use-trade.ts:161-168`
**Issue:** The interval keeps running while the user types, because `run` stays true across keystrokes. A tick that lands inside the 400 ms window re-runs the effect with `refresh = true` and quotes at once, for a half-typed amount.
**Fix:** In `useQuoteLoop`, skip `setTick` when `Date.now() - lastInput.current < DEBOUNCE_MS`.

### C-IN-05: The 0.01 SOL reserve is defined twice

**File:** `apps/web/components/trade-amount.tsx:9`, `apps/web/lib/trade-button.ts:10`
**Issue:** If one copy changes and the other does not, Max and the "Not enough SOL" check drift apart.
**Fix:** Export `RESERVE` from `trade-button.ts` (or `format.ts`) and import it in `trade-amount.tsx`.

### C-IN-06: Route step keys collide when the coin's symbol is "BONDR"

**File:** `apps/web/components/trade-quote.tsx:33`
**Issue:** `key={s}`: "BONDR curve" appears twice for a coin named BONDR on its curve, which triggers React's duplicate-key warning and can drop a step.
**Fix:** Use `key={i}`. The list is fixed-order and has three items.


_Reviewed: 2026-10-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
