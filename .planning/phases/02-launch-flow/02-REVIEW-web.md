---
phase: 02-launch-flow
reviewed: 2026-10-22T00:00:00Z
depth: standard
files_reviewed: 51
files_reviewed_list:
  - apps/web/app/api/consent/route.ts
  - apps/web/app/api/health/route.ts
  - apps/web/app/api/launch/[id]/route.ts
  - apps/web/app/api/launch/pin/route.ts
  - apps/web/app/api/launch/prepare/route.ts
  - apps/web/app/api/launch/submit/route.ts
  - apps/web/app/api/quote/route.ts
  - apps/web/app/api/sentry-test/route.ts
  - apps/web/app/api/status/route.ts
  - apps/web/app/coin/[mint]/not-found.tsx
  - apps/web/app/coin/[mint]/page.tsx
  - apps/web/app/globals.css
  - apps/web/app/launch/page.tsx
  - apps/web/app/layout.tsx
  - apps/web/app/terms/page.tsx
  - apps/web/app/tokens.css
  - apps/web/components/ca-row.tsx
  - apps/web/components/callout.tsx
  - apps/web/components/chrome.tsx
  - apps/web/components/coin-identity.tsx
  - apps/web/components/consent-dialog.tsx
  - apps/web/components/copy-chip.tsx
  - apps/web/components/launch-buy.tsx
  - apps/web/components/launch-coin.tsx
  - apps/web/components/launch-drop.tsx
  - apps/web/components/launch-flow.tsx
  - apps/web/components/launch-live.tsx
  - apps/web/components/launch-receipt.tsx
  - apps/web/components/launch-review.tsx
  - apps/web/components/launch-sign.tsx
  - apps/web/components/launch-stepper.tsx
  - apps/web/components/proof-stamp.tsx
  - apps/web/components/tx-link.tsx
  - apps/web/components/ui-button.tsx
  - apps/web/components/ui-field.tsx
  - apps/web/components/wallet-button.tsx
  - apps/web/components/wallet.tsx
  - apps/web/instrumentation-client.ts
  - apps/web/instrumentation.ts
  - apps/web/lib/cn.ts
  - apps/web/lib/db.ts
  - apps/web/lib/format.ts
  - apps/web/lib/guard.ts
  - apps/web/lib/launch-run.ts
  - apps/web/lib/launches.ts
  - apps/web/lib/pinata.ts
  - apps/web/lib/terms.ts
  - apps/web/lib/use-status.ts
  - apps/web/lib/worker.ts
  - apps/web/next.config.ts
  - apps/web/postcss.config.mjs
findings:
  critical: 0
  warning: 7
  info: 7
  total: 14
status: issues_found
---

# Phase 02: Code Review Report (apps/web)

**Reviewed:** 2026-10-22
**Depth:** standard
**Files Reviewed:** 51
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

Reviewed the web app's API routes, guards, the step 4 sign/submit/poll machine, the token page and the wallet layer. Checked worker `submit.ts`, `http.ts` and `prepare.ts` where the web contract depends on them.

The following checks came back clean:

- **Secrets in the client bundle:** no `"use client"` file reads `process.env` or imports `db`, `worker`, `launches` or `pinata`. `server-only` guards the server modules. `next.config.ts` `env` exposes only the Sentry environment name.
- **CSRF:** every POST checks Origin, and a null or opaque Origin fails closed.
- **Error leaks:** worker errors are rebuilt from `error` and `paused` only. DB errors log only `cause.code`.
- **XSS:** coin name, symbol and description render as React text. Links are filtered to `https://`, and the image CID is checked against `[A-Za-z0-9]+` before it goes into a CSS `url()`.
- **SSRF:** the server fetches only `WORKER_URL` and a fixed Pinata URL.

The defects that remain are:

- **Rate limiter:** it can be made to grow without bound, it can be spoofed, and the wallet key lets anyone lock out someone else's wallet.
- **Step 4 recovery:** three state bugs can make the UI forget or misreport a launch that is still in flight. The usual result is a second launch with a second dev buy.

## Warnings

### WR-01: Rate-limit map grows without bound, and an over-limit IP still adds new wallet keys

**Status:** fixed (2026-10-22) in a13a862. `rateLimited` charges the IP bucket first and the wallet bucket only when the IP passes. `take` caps the map at 10,000 keys and drops the oldest when a sweep frees nothing.

**File:** `apps/web/lib/guard.ts:53-62`, `apps/web/lib/guard.ts:79-81`
**Issue:** `rateLimited` calls `take()` on every key before looking at any result, so a request whose IP is already over the limit still inserts its `scope:wallet:<x>` entry. The wallet comes from the request body, so the attacker chooses it.
**Failure scenario:** one IP loops `POST /api/launch/prepare` with a new random base58 wallet each time.
- Every request gets a 429, but every request also adds a map entry with a 10-minute window.
- Past 10,000 entries the sweep runs on every new key, walks the whole map, and deletes nothing, because no entry has expired yet.
- Memory grows linearly and each request costs O(n) CPU, until the single web replica slows down or runs out of memory.

The same works on `/api/launch/pin`, which only needs a small multipart body.
**Fix:** check the IP key first and return the 429 before touching the wallet key. Also put a hard cap on the map.
```ts
const ipWait = ip ? take(`${scope}:ip:${ip}`, now, limit, windowMs) : null;
if (ipWait !== null) return tooMany(ipWait);
const walletWait = wallet ? take(`${scope}:wallet:${wallet}`, now, limit, windowMs) : null;
// in take(): if (hits.size >= 10_000) { sweep expired; if still >= 10_000, delete the oldest (Map keeps insertion order) }
```

### WR-02: Wallet-keyed limits and consent trust an unauthenticated wallet string, so anyone can lock out a victim's wallet

**Status:** fixed (2026-10-22) in 2e7bc81, the proper fix, the same as worker-core CR-01. Consent now needs a Phantom `signMessage` over a server nonce plus `TERMS_VERSION`, verified server-side before `wallets` is written. Pin, prepare and submit read the wallet from the resulting session cookie, never from the body. So only the owner's browser can charge a wallet bucket or write a consent row.

**File:** `apps/web/app/api/launch/pin/route.ts:79`, `apps/web/app/api/launch/prepare/route.ts:28`, `apps/web/app/api/consent/route.ts:13-21`
**Issue:** the `wallet` in pin, prepare and consent is a bare string, with no signature showing the caller owns it. The per-wallet bucket is charged before the consent check (pin) or before the worker is called at all (prepare).
**Failure scenario:**
- An attacker sends 10 prepare requests (or 5 pins) a window naming the victim's public address, which is on-chain on every coin page. The victim then gets "Too many launch attempts from this wallet" for 10 minutes, renewable for as long as the attacker keeps going.
- Anyone can also `POST /api/consent` for any address. That writes a consent row (PLAT-02 record) for a wallet whose owner never accepted, and lets the worker reserve vanity mints and spend the global `TABLE_CAP` on wallets the caller does not control.
**Fix:**
- Short term, charge the wallet bucket only after the IP passes (WR-01), and only for requests that pass the consent check.
- Proper fix: have Phantom `signMessage` a nonce plus TERMS_VERSION at consent, and verify it server-side before writing `wallets`. Then a consent row proves ownership, and wallet buckets can only be charged by the owner.

### WR-03: The client IP comes from a spoofable header, and a missing IP turns off limiting

**Status:** fixed (2026-10-22) in ae676c8. A request with no client address now shares one `unknown` bucket instead of going unlimited. X-Real-IP stays first: Railway's docs (public networking, specs and limits) list it as the client IP the edge sets, and the existing `clientIp` test pins the order. Not verified live that the edge overwrites a client-sent X-Real-IP; one curl against staging would confirm it.

**File:** `apps/web/lib/guard.ts:65-68`, `apps/web/lib/guard.ts:78-79`
**Issue:** `X-Real-IP` is trusted first and not checked. If Railway's edge passes a client-supplied `X-Real-IP` through instead of overwriting it, every request can claim a fresh IP. When neither header is present, `keys` is empty and `consent`, `quote` and `submit` (which have no wallet key) are not limited at all.
**Failure scenario:** `curl -H 'X-Real-IP: 1.2.3.<n>'` gets around the IP limits on consent, quote (one worker RPC read each) and submit. Any deploy path that drops the proxy headers (local, preview, a future proxy change) runs with no limits.
**Fix:** confirm Railway's behavior and pin it with a test. Prefer the rightmost `X-Forwarded-For` hop only. When no IP can be found, fall back to a shared bucket rather than none.
```ts
const ip = clientIp(req) ?? "unknown"; // one shared bucket, never unlimited
```

### WR-04: A reload during submit drops a launch that is still in flight, which leads to a second launch

**Status:** fixed (2026-10-22) in f490c4c, test follow-up 81807e8. Restore now keeps a prepared row younger than 10 minutes and polls it. `poll` ends a row that is still prepared 150 s after polling began as `expired` (Build again), because by then it can no longer land.

**File:** `apps/web/components/launch-flow.tsx:138-145`
**Issue:** `posted()` stores the id just before `/api/launch/submit`. The worker keeps the row `prepared` while it runs the pause, block-height and cosign checks (`apps/worker/src/submit.ts:83-90`), which take several RPC round trips. It only moves the row to `signed` after that. On reload, `useRestore` treats `prepared` like `failed` and clears the stored id.
**Failure scenario:**
1. The user signs, and the submit is in flight.
2. The user reloads within those seconds. The web route's worker call keeps running, because it does not use `req.signal`.
3. Restore reads `prepared`, clears storage and shows an empty step 1.
4. The first launch lands. The user sees nothing, launches again, and pays a second dev buy.
**Fix:** restore `prepared` rows too, and poll them until they leave `prepared` or `createdAt + signBy` has passed. Only clear the stored id when the row is `failed`, `not_found`, or still `prepared` after the expiry.

### WR-05: An error on a resend is treated as final: the restore key is cleared and the UI says "Nothing was sent"

**Status:** fixed (2026-10-22) in 2af0aa5. A resend's error is swallowed, so the row decides. In the worker, `refuse()` answers the row's current state when its `advance()` lost the race, instead of throwing.

**File:** `apps/web/lib/launch-run.ts:116-120`, `apps/web/lib/launch-run.ts:129`, `apps/web/components/launch-sign.tsx:54-57`, `apps/web/components/launch-sign.tsx:98-106`
**Issue:** when the first submit is lost (`null`), `poll` resends the wire once a second while the row reads `prepared`. Any error from a resend other than `worker_unavailable` is thrown out of `poll`. `fail()` then runs `stored.set(null)` and shows a "Nothing was sent" message, even though the first submit may still be inside the worker.
**Failure scenario:**
- The first submit hits the 20 s web timeout while the worker is slow on RPC. Resends then use up the submit IP limit (20 per 10 min) within about 20 seconds, and the next resend gets a web 429 `rate_limited`.
- The UI shows "Too many launch attempts... Nothing was sent", forgets the launch, and offers no Back or Try again button, because `action: null` and the row is 5. That is a dead end.
- Separately, the worker's `refuse()` throws `paused` or `expired` even when its `advance()` lost the race to a concurrent `signed`. In that case the UI says "Nothing was sent" for a launch that was in fact sent.
**Fix:** a resend should never end the poll. Swallow its errors and let the row state decide.
```ts
if (v?.state === "prepared") await resend?.().catch(() => null);
```
Also, in the worker, only throw from `refuse()` when `advance()` returned a row. Otherwise return `current(row)`.

### WR-06: "Launch another" can jump back to the old coin's step 5

**Status:** fixed (2026-10-22) in 8decc7b. `useFacts` ignores a read that resolves after cleanup.

**File:** `apps/web/components/launch-live.tsx:17-28`
**Issue:** the async `setInterval` callback awaits `getView` and then calls `dispatch` without checking whether the effect has been cleaned up. `clearInterval` stops new ticks, but a request already in flight still resolves.
**Failure scenario:**
1. On step 5, before the facts are written, the user clicks "Launch another", which resets to step 1.
2. A `getView` that was already in flight comes back with `facts`.
3. `dispatch({ type: "live" })` sets `step: 5` and, because `fields.name` is empty, `withView` puts the old name, symbol, exit and dev buy back into the form.

The user is sent back to the old coin.
**Fix:**
```ts
let live = true;
const timer = setInterval(async () => {
  if (++n >= FACT_POLLS) clearInterval(timer);
  const next = await getView(v.id);
  if (live && next && next !== "not_found" && next.facts) dispatch({ type: "live", view: next });
}, 1000);
return () => { live = false; clearInterval(timer); };
```

### WR-07: `images.remotePatterns` turns `/_next/image` into a public IPFS proxy, and nothing uses it

**Status:** fixed (2026-10-22) in a341162. `images.remotePatterns` is removed; an e2e test checks that `/_next/image` refuses an IPFS URL with 400.

**File:** `apps/web/next.config.ts:37-47`
**Issue:** `remotePatterns` allows `https://ipfs.io/ipfs/**` and the owner's dedicated Pinata gateway. No component sends a remote image through the optimizer: `CoinIdentity` uses a CSS background and `LaunchLive` uses `unoptimized`.
**Failure scenario:** anyone can request `/_next/image?url=https://<PINATA_GATEWAY>/ipfs/<any CID>&w=3840&q=100`. The web server then fetches, resizes and caches arbitrary IPFS content. That uses the owner's dedicated-gateway bandwidth quota, plus web CPU and disk, with no rate limit.
**Fix:** delete `images.remotePatterns` until Phase 3 actually routes coin images through `next/image`. At that point, limit it to the dedicated gateway and set `images.maximumResponseBody` or `minimumCacheTTL`.

## Info

### IN-01: `e.code in FAULTS` matches prototype keys

**Status:** fixed (2026-10-22) in 11c13a4 (`Object.hasOwn`).

**File:** `apps/web/components/launch-sign.tsx:100`
**Issue:** a passed-through error such as `"toString"` or `"constructor"` passes the `in` check. `FAULTS[code]` is then a function, so the error callout renders empty with no action.
**Fix:** `Object.hasOwn(FAULTS, e.code)`.

### IN-02: The pin route reads the whole 4 MB multipart body before the IP limit

**Status:** no_change_needed. Since 2e7bc81 the pin route runs `rateLimited` before `parse()`, so an IP over the limit is refused before the body is read.

**File:** `apps/web/app/api/launch/pin/route.ts:75-80`
**Issue:** `parse()` (`req.formData()` plus `JSON.parse`) runs before `rateLimited`, so an IP that is over the limit still costs a 4 MB upload and parse each time.
**Fix:** check the IP bucket before `parse()`, and the wallet bucket after it (see WR-01).

### IN-03: The CSP only sets `frame-ancestors`

**Status:** open.

**File:** `apps/web/next.config.ts:30-35`
**Issue:** there is no `script-src`, `object-src` or `base-uri`, and no HSTS. React escaping is currently the only XSS barrier on a page that hands a transaction to Phantom.
**Fix:** add `default-src 'self'; object-src 'none'; base-uri 'none'; img-src 'self' blob: https://ipfs.io https://<gateway>`, plus `Strict-Transport-Security`. Add a nonce-based `script-src` when it becomes practical.

### IN-04: Picking images quickly can race, and blob URLs are never revoked on reset

**Status:** open.

**File:** `apps/web/components/launch-coin.tsx:116-122`, `apps/web/components/launch-flow.tsx:106-107`
**Issue:** two quick picks each `await readImage`. If the first decode finishes last, it overwrites the newer pick, and `prev` is revoked twice. `reset` drops `state.image` without calling `URL.revokeObjectURL`.
**Fix:** keep a pick counter in a ref and ignore stale results. Revoke `state.image.url` in "Launch another" and in the `reset` paths.

### IN-05: Public GET reads have no rate limit

**Status:** open.

**File:** `apps/web/app/api/launch/[id]/route.ts:10-21`, `apps/web/app/coin/[mint]/page.tsx:17`, `apps/web/app/api/status/route.ts:7-10`
**Issue:** each request makes a Neon query or a worker call. Ids and mints that are well-formed but random still reach the DB.
**Fix:** a generous IP limit (for example 120 a minute), or a short `s-maxage` on `/coin/[mint]` once it has landed.

### IN-06: `/api/sentry-test` is a GET with side effects

**Status:** open.

**File:** `apps/web/app/api/sentry-test/route.ts:9-13`
**Issue:** when `SENTRY_TEST_ROUTE=1`, anyone, including a cross-site `<img>`, can trigger worker and web Sentry events with no limit.
**Fix:** make it POST with `sameOrigin` plus `rateLimited`, or confirm in the deploy checklist that the variable is unset in production.

### IN-07: Accessibility gaps in step 4 rows and the copy chip

**Status:** open.

**File:** `apps/web/components/launch-sign.tsx:161-183`, `apps/web/components/copy-chip.tsx:16-21`
**Issue:**
- A failed row is shown only by a red `X` icon marked `aria-hidden`, so screen readers get no "failed" state for the row.
- `CopyChip`'s fixed `aria-label` hides the visible "Press Cmd+C" fallback from screen readers.
**Fix:** add `<span className="sr-only">failed</span>` (and "done" / "in progress") in `SignRow`. Drop the fixed `aria-label` when `shown === "manual"`, or announce the hint in the existing live region.

---

_Reviewed: 2026-10-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
