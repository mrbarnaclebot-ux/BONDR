---
phase: 02-launch-flow
reviewed: 2026-10-22T00:00:00Z
depth: standard
files_reviewed: 39
files_reviewed_list:
  - apps/worker/src/build.ts
  - apps/worker/src/env.ts
  - apps/worker/src/grind.ts
  - apps/worker/src/http.ts
  - apps/worker/src/launches.ts
  - apps/worker/src/main.ts
  - apps/worker/src/prepare.ts
  - apps/worker/src/sentry.ts
  - apps/worker/src/settle.ts
  - apps/worker/src/status.ts
  - apps/worker/src/submit.ts
  - apps/worker/src/vanity.ts
  - packages/core/drizzle.config.ts
  - packages/core/migrations/0000_init.sql
  - packages/core/src/alt.ts
  - packages/core/src/api.ts
  - packages/core/src/bond.ts
  - packages/core/src/collect.ts
  - packages/core/src/config.ts
  - packages/core/src/cosign.ts
  - packages/core/src/curve.ts
  - packages/core/src/db.ts
  - packages/core/src/events.ts
  - packages/core/src/keys.ts
  - packages/core/src/launch.ts
  - packages/core/src/math.ts
  - packages/core/src/migrate.ts
  - packages/core/src/net.ts
  - packages/core/src/pump.ts
  - packages/core/src/route.ts
  - packages/core/src/rules.ts
  - packages/core/src/schema.ts
  - packages/core/src/scrub.ts
  - packages/core/src/send.ts
  - packages/core/src/sharing.ts
  - packages/core/src/trade.ts
  - scripts/check-client-bundle.sh
  - scripts/devnet-checks.ts
  - scripts/devnet-launch.ts
findings:
  critical: 1
  warning: 8
  info: 7
  total: 16
status: issues_found
---

# Phase 2: Code Review Report (worker and core)

**Reviewed:** 2026-10-22
**Depth:** standard (plus targeted cross-file reads of `apps/web/app/api/consent/route.ts` and `apps/web/app/api/launch/{prepare,submit}/route.ts` to confirm the trust boundary)
**Files Reviewed:** 39
**Status:** issues_found

## Summary

I found no way around the co-sign. `cosign()` byte-compares the wire against the message the worker stored. It verifies the dev signature at slot 0 against `row.wallet`. It checks the exit inside the stored message, which comes from the server, not from the request. After signing it checks slot 1 against the stored bytes again. `compileLaunch` pins `numRequiredSignatures === 2` and puts the mint at static key 1. Message substitution, slot reordering and exit stripping all fail. The seed never reaches a log, an error or the DB. Mint keys are re-derived and compared before any signature. State changes are guarded single-row UPDATEs, and the `inFlight` subquery stops a released mint from being handed out while a launch of it can still land.

The real exposure is the **ops-SOL and availability path**. Nothing proves the `wallet` in `/prepare` belongs to the caller: web's `/api/consent` records any address without a signature. The only gate before ops pays for a table is a balance check, and any rich third-party address passes it. That gives anyone a free ops drain and a free way to block launches (CR-01). The mint is reserved before the balance check, so the vanity pool can be emptied the same way (WR-01). Several failure paths pay for a table without recording it (WR-02). A landed mint can be marked failed or never marked used, and then gets handed out again (WR-04).

## Critical Issues

### CR-01: Anyone can make ops pay for lookup tables using a wallet they do not own, and can block every new launch

**File:** `apps/worker/src/prepare.ts:105-111, 124-142, 229-239` (with `apps/web/app/api/consent/route.ts:8-28`, `apps/web/app/api/launch/prepare/route.ts:21-31`)

**Issue:** `/prepare` takes `wallet` as a bare string. Neither web nor the worker asks for proof that the caller controls it:
- web `/api/consent` upserts any base58 address with no signature (rate limit: 10 per 10 min per IP);
- `prepareGuard` checks only `consented`, and `prepareOne` checks only `getBalance(o.dev) >= need`;
- then `ensureTable` spends ops SOL (rent of about 0.006-0.0075 SOL plus 2 tx fees) before anything that needs the dev's signature.

**Failure scenario:** An attacker picks N addresses that already hold at least 0.03 SOL on devnet, or at least about 0.27 SOL on mainnet (exchange hot wallets, top holders, anything public). They POST `/api/consent` and then `/api/launch/prepare` for each one, rotating IPs or staying within 10 per 10 min per IP. Each new wallet reserves a different mint, `tableFor` finds no prior table, and ops creates a fresh table. Results:
1. Ops loses about 0.18-0.22 SOL per hour, every hour, because `TABLE_CAP` is 30 per hour worker-wide. Nothing closes tables yet (no deactivate or close code anywhere), so the rent never comes back. The 2.9 SOL devnet ops balance is gone in about 14 hours, and the Phase 5 fee mechanic, which also needs ops, stalls.
2. Once 30 tables exist in the hour, every legitimate first-time launch gets `rate_limited` (`prepare.ts:110`). One attacker blocks every new launch indefinitely.
3. The single-flight `queue` (`prepare.ts:254-259`) runs each 10-18 s table build in series. Queued real users pass web's 30 s timeout, but their prepares still run and pay for tables nobody will sign.

**Fix:** Bind the wallet to the request before any spend. The simplest version:
```ts
// web: consent and prepare require a signed challenge from the wallet (Phantom signMessage)
// worker prepareGuard: refuse unless the request carries a fresh, verified wallet proof
if (!i.walletProven) return { error: "consent_required" };
```
For example, web issues a nonce, the browser signs `BONDR consent <nonce>` with Phantom, web verifies the signature with `node:crypto` Ed25519 (the same code as `signatureOk`) and sets a short-lived HttpOnly session tied to the wallet. Prepare and consent then use the wallet from the session, not from the body.

Also:
- add a per-wallet daily cap on new tables (count `newTable` rows by `wallet`), next to the global cap;
- refuse `ensureTable` when ops is under a hard floor, not only warn (`build.ts:68`);
- schedule the table close (deactivate, then close after about 513 slots) for failed or expired prepared rows, so rent comes back.

## Warnings

### WR-01: The mint is reserved before the balance check, so the vanity pool can be drained with zero-balance wallets

**File:** `apps/worker/src/prepare.ts:229-234`, `apps/worker/src/vanity.ts:71-98`

**Issue:** `reserveMint` runs before `getBalance(o.dev) < need`. A prepare that ends in `insufficient_balance` still holds a `bndr` mint for 10 minutes. `admit` only looks at the table cap, and that cap does not apply until a table exists.

**Failure scenario:** The pool holds at most 20 ready mints, and one thread finds a hit about every few minutes. An attacker consents 20 fresh empty keypairs (no signature needed, see CR-01) from 2 IPs and prepares once with each. Every reservation is held for 10 minutes, and each answer is `insufficient_balance`. All real users get `pool_empty`. Repeating every 10 minutes keeps the pool empty for free, and each reservation also starts `startRefill` grinding at 100% CPU.

**Fix:** Run the balance check (and the on-chain mint check from WR-04) before `reserve`, and release the reservation on any refusal that happens before a table exists:
```ts
const need = req.solIn + createCost + networkFee(ctx.priorityFee);
if (BigInt(await ctx.conn.getBalance(new PublicKey(req.wallet))) < need) throw fail({ error: "insufficient_balance" });
const mint = await reserveMint(ctx, req.wallet);
```
Also cap live reservations per IP or wallet on the web side.

### WR-02: Tables that ops paid for are not recorded on several failure paths, so the cap does not count them and their rent cannot be reclaimed

**File:** `apps/worker/src/prepare.ts:239-249`, `apps/worker/src/build.ts:69-71`, `packages/core/src/alt.ts:106-118`

**Issue:** The cap counts DB rows with `new_table = true`. A table only gets a row when `finish` succeeds, or when `finish` throws inside the try. There are three gaps:
1. `createTable` sends the create+extend tx (rent paid), then the second extend fails or `warm()` times out after 30 s. `r.table` is undefined, `ensureTable` throws `buildFailed`, and the address is never stored.
2. `prepare.ts:241` re-runs `unionTableKeys(o)` outside the `try`. An RPC 429, `AwaitingMigration` (BONDR completing in that 5 s window) or any other throw loses the table that was just created.
3. `insertFailed(...).catch(() => undefined)` (line 247) silently drops the only record of a paid table.

**Failure scenario:** On Helius free under load, 429s during warm-up or the re-price are routine. Every such prepare pays rent that is never counted against `TABLE_CAP` and is never closable from the DB, so CR-01's bound is not a bound.

**Fix:** Record the table as soon as its address is known, before any later step can throw:
```ts
const { table, created } = await ensureTable(...);       // ensureTable returns the address even on failure
if (created) await insertFailed(db(), rowOf(req, o, addr, true), "pending"); // update it to prepared on success
```
Put the re-price (`line 241`) inside the `try`. Have `ensureTable` return or record `r.address` when `r.table` is missing. Never swallow the insert error: log it through `console.error` so Sentry sees it.

### WR-03: Re-using a live reservation does not extend it, so a second wallet can get the same mint while the first wallet's prepared tx is still valid

**File:** `apps/worker/src/vanity.ts:71-83, 93`

**Issue:** The `live` branch returns the wallet's reservation without touching `reserved_until`. Only a new reservation sets `now() + 10 min`. A `prepared` row does not count as in-flight (`inFlight` covers only signed, sent, unknown and landed).

**Failure scenario:** Dev A reserves mint M at t=0 and retries prepare at t=9:50 (Try again after a Phantom rejection). The new prepared tx is valid for about 60-90 s, but the reservation ends at t=10:00. Dev B prepares at t=10:05 and is handed M. Both get co-signed txs for M. Whichever lands second fails at `create_v2`, and that dev pays the fee and sees a failed launch. B's table is wasted ops rent. The same thing happens when `refuse(..., "expired")` releases M while the same wallet still has a second prepared row for M that has not expired (for example a burn prepare followed by a sell prepare).

**Fix:** Extend the hold on every prepare and make it cover the signing window:
```ts
if (live) {
  await exec.update(vanityMints).set({ reservedUntil: sql`now() + interval '10 minutes'` })
    .where(eq(vanityMints.idx, live.idx));
  return live;
}
```
Also count `prepared` rows whose `last_valid_block_height` has not passed as in-flight in `inFlight`, or check `created_at > now() - interval '2 minutes'` for prepared.

### WR-04: A mint that already landed can be handed out again, failing every launch that gets it and paying a table each time

**File:** `apps/worker/src/settle.ts:37, 85-90, 95-97`, `apps/worker/src/vanity.ts:61-67`, `apps/worker/src/prepare.ts:229-239`

**Issue:** The mint pool trusts the DB alone, which goes wrong in two ways:
1. `nextState` turns "unseen after 3 history rechecks" into `failed: expired`, and `releaseMint` frees the mint. If the RPC's history lookup misses a tx that did land (Helius devnet history gaps, or a lagging node behind the load balancer), the mint exists on chain but is free in the DB.
2. In `landed()`, `advance(...→landed)` and `markUsed` are separate statements outside one transaction. If `markUsed` throws (Neon blip), `used_at` stays null, and the same wallet's `live` reservation branch hands the landed mint straight back.

**Failure scenario:** Case 1: the lowest free idx is now a mint that already exists. Each new wallet that reserves it gets a new ops-paid table (`ensureTable` runs before any simulation), then the create simulation fails with `build_failed`. The mint goes back to the pool after 10 minutes, and the next wallet pays again. That is a permanent ops leak and a broken launch for one user every 10 minutes.

**Fix:** Before `ensureTable`, check the chain and retire mints that already exist:
```ts
if (await ctx.conn.getAccountInfo(o.mint)) { await markUsed(db(), mint.pubkey); throw fail({ error: "build_failed" }); }
```
Also run `advance(...→landed)` and `markUsed` in one `db().transaction(...)`.

### WR-05: `unknown` launches are only re-checked when the worker restarts

**File:** `apps/worker/src/settle.ts:99-100, 128-144`, `apps/worker/src/main.ts:41`

**Issue:** An RPC outage past expiry sets `unknown`, and only `resumeLaunches` on boot ever looks at that row again. The design has no standing loop.

**Failure scenario:** A launch that actually landed shows `unknown` to the dev indefinitely. It has no facts, so the coin page's "dev holds 0" proof is missing. Its mint stays out of the pool, and `markUsed` is never called. The dev cannot tell whether to retry, and a retry gets a new mint.

**Fix:** Re-settle `unknown` rows on demand without a timer. For example, in `submit` or `GET /status`, fire `settleInBackground` for `unknown` rows older than 60 s, with a per-process guard. Alternatively, have `settleLaunch` back off and retry the history recheck (30 s, 2 min, 10 min) instead of giving up after one pass.

### WR-06: The metadata URI and `imageCid` come from the client and are never tied to what web pinned

**File:** `apps/worker/src/prepare.ts:82-94` (with `apps/web/app/api/launch/prepare/route.ts:30`)

**Issue:** Web forwards the browser's `uri` and `imageCid` to the worker unchanged. The worker only checks the shape: `https://ipfs.io/ipfs/<alnum>` and `[A-Za-z0-9]{1,100}`. The dev can point the on-chain `uri` at any IPFS JSON. Its `image`, `description` and `website` fields skip `normalizeLink`, the image magic-byte check and all moderation. They can also set `image_cid` in the DB, which BONDR's own pages show, to a different image from the one wallets and explorers show.

**Failure scenario:** A dev pins JSON by hand with `"website": "javascript:..."` or a phishing domain and an impersonating image. Phantom and Solscan show it. The BONDR coin page shows the clean pinned image, so a holder who checks on BONDR sees something different from the chain.

**Fix:** Have web's pin route record `(wallet, uri, imageCid)` server-side (a `pins` table, or an HMAC token returned to the browser). The worker then refuses a prepare whose `(wallet, uri, imageCid)` was not pinned by BONDR.

### WR-07: On any net where the creator fee is configurable, the quote and status preview use a different creator fee from the one the launch is built with

**File:** `apps/worker/src/status.ts:54-69, 201`, `apps/worker/src/prepare.ts:161`, `packages/core/src/launch.ts:162-165`

**Issue:** `prepare` passes `creatorFeeBps: 150` when `g.creatorFeeConfigurable`. `childFees` passes `undefined`, which is the network default, and so does `launchQuote(ctx.online, ctx.Q, solIn)`. Devnet is not configurable, so the two match today and every test passes.

**Failure scenario:** On mainnet (Phase 7) the status fees and the `/quote` `tokensOut` and `solBackEstimate` use the default creator fee. The real launch pays 1.5% per child leg. The form under-states the dev's fees and over-states the insta-sell return, so the fee disclosure is wrong.

**Fix:** Derive one `creatorFeeBps` from `g.creatorFeeConfigurable` in one helper and pass it to `childFees`, `launchQuote` and `optsFor`.

### WR-08: `forcedBondIxs` sets minOut to W's whole child balance, so any leftover in W makes every later forced bond revert

**File:** `packages/core/src/bond.ts:78-88`

**Issue:** `simulatedBalance` returns W's child ATA balance after the buy, which includes any balance W already had. That full number becomes `minTokensOut` for the real buy and the burn amount. The comment on lines 75-77 says a front-run sell leaves a remainder in W "for the worker to burn (Phase 5)". From then on, every simulation reports remainder plus bought, the real buy requires at least that much, and it always reverts as slippage. The forced bond is stuck for good. The comment also contradicts PROJECT.md item 5 ("Nothing remains in W"). This code is not wired into the worker yet, but it is the Phase 5 production path.

**Fix:** Size from the difference:
```ts
const pre = await readAtaAmount(conn, ata);           // 0n when missing
const bought = simOut - pre;
const ixs = [...float(o), ...(await buy(new BN(bought.toString()))), burnIx(o.w, o.mint, simOut)]; // burn everything held
```
`simOut` is the whole balance, so the burn also clears any remainder.

## Info

### IN-01: The `canRelease` guard never fires

**File:** `apps/worker/src/settle.ts:48-51`, `apps/worker/src/vanity.ts:101-106`
**Issue:** `releaseMint` always passes the literal `"failed"`, so the check that refuses a release while signed, sent or unknown can never trigger. The real protection is the `inFlight` subquery. The guard is misleading.
**Fix:** Delete `canRelease`, or have `release` check the DB for any signed, sent, unknown or landed row of the mint.

### IN-02: The submit pause check lets launches through when the chain read fails

**File:** `apps/worker/src/status.ts:44-47, 156`, `apps/worker/src/submit.ts:84-85`
**Issue:** When `readChain` fails, `venue` is null, so `paused` is null. Submit then co-signs even if BONDR is in the 6107 window, and the dev pays the fee for a tx that will fail on chain. Prepare is protected by `min === null`, but submit is not.
**Fix:** In `submit`, refuse with `build_failed` when `status.minLamports === null`. That is the chain-unavailable signal.

### IN-03: The sell `solBack` fact counts every account that went from 0 to non-zero as dev-paid rent

**File:** `apps/worker/src/settle.ts:80-82`
**Issue:** A fee recipient or creator vault that held 0 lamports before the tx and received SOL fees is added to `rent`, which inflates the `solBack` shown on the ledger.
**Fix:** Only count accounts the dev funded: the writable accounts the create or ATA instructions name. Or compute from the dev's WSOL and SOL deltas only.

### IN-04: `createCost` in the preview is under-stated on the pool venue

**File:** `apps/worker/src/build.ts:145-150`
**Issue:** On the pool venue the Q buy is exact-out with `maxQuoteIn = solIn` and spends less than `solIn`. `burnSpent - solIn - fee` then under-states the cost, and it is clamped to 0.
**Fix:** Take the create cost from the simulated post-lamports of the created accounts, not from `solIn`.

### IN-05: The HTTP error path can crash the process on a non-serializable route result

**File:** `apps/worker/src/http.ts:63-83`
**Issue:** `JSON.stringify` runs after `writeHead`. If it throws (a `bigint` in a future result), the catch calls `send` again and hits `ERR_HTTP_HEADERS_SENT`. That is an unhandled rejection from `void handle(...)`, and Sentry `mode: "strict"` then crashes the worker. No current route returns a `bigint`.
**Fix:** Serialize before `writeHead`, and check `res.headersSent` in the catch.

### IN-06: No DB constraint stops two in-flight launches of the same mint

**File:** `packages/core/migrations/0000_init.sql:55`, `packages/core/src/schema.ts:81`
**Issue:** Only `landed` is unique per mint. A wallet with burn and sell prepared rows for the same mint can have both co-signed and in flight at once. One must fail on chain at the dev's cost. AGENTS.md section 6 prefers DB constraints.
**Fix:** `CREATE UNIQUE INDEX launches_inflight_mint ON launches(mint) WHERE state IN ('signed','sent','unknown');`. `advance(prepared→signed)` then fails cleanly for the second row.

### IN-07: One bad submit fails the prepared row, and can beat a valid concurrent submit

**File:** `apps/worker/src/submit.ts:35-39, 89`
**Issue:** When co-sign is refused, `prepared` moves to `failed`. If a stale or garbage wire, for example from a double click, races a valid one, the refusal's `advance` can win, and the valid submit returns `failed` with nothing sent. A refusal costs the worker nothing, so the row does not need to change.
**Fix:** On `cosign_refused`, throw the 422 without advancing the row. The blockhash expiry already limits how long the row is usable.

---

_Reviewed: 2026-10-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
