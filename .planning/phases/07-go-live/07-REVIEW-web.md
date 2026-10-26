---
phase: 07-go-live
reviewed: 2026-10-26T20:40:00Z
depth: standard (deep on genesis /launch variant, prepare actor, worker.ts pass-through, proxy.ts, migration 0008 + schema, core contract.ts / send.ts / net.ts)
files_reviewed: 55
files_reviewed_list:
  - .env.example
  - apps/web/app/api/admin/[op]/route.ts
  - apps/web/app/api/launch/prepare/route.ts
  - apps/web/app/coin/[mint]/page.tsx
  - apps/web/app/launch/page.tsx
  - apps/web/app/page.tsx
  - apps/web/app/terms/page.tsx
  - apps/web/components/admin-health.tsx
  - apps/web/components/admin-switches.tsx
  - apps/web/components/coin-card.tsx
  - apps/web/components/launch-buy.tsx
  - apps/web/components/launch-coin.tsx
  - apps/web/components/launch-flow.tsx
  - apps/web/components/launch-receipt.tsx
  - apps/web/components/launch-review.tsx
  - apps/web/components/launch-sign.tsx
  - apps/web/components/wallet.tsx
  - apps/web/lib/admin-copy-health.test.ts
  - apps/web/lib/admin-copy-health.ts
  - apps/web/lib/coins.test.ts
  - apps/web/lib/coins.ts
  - apps/web/lib/launch-faults.ts
  - apps/web/lib/launch-run.ts
  - apps/web/lib/live-list.test.ts
  - apps/web/lib/terms.ts
  - apps/web/lib/ticker-copy.test.ts
  - apps/web/lib/ticker-copy.ts
  - apps/web/lib/worker.test.ts
  - apps/web/lib/worker.ts
  - apps/web/proxy.test.ts
  - apps/web/proxy.ts
  - package.json
  - packages/core/migrations/0008_go_live.sql
  - packages/core/migrations/meta/0008_snapshot.json
  - packages/core/migrations/meta/_journal.json
  - packages/core/src/api-admin.ts
  - packages/core/src/api.ts
  - packages/core/src/coin-row.ts
  - packages/core/src/contract.test.ts
  - packages/core/src/contract.ts
  - packages/core/src/db-admin.test.ts
  - packages/core/src/keys.test.ts
  - packages/core/src/keys.ts
  - packages/core/src/launch-genesis.test.ts
  - packages/core/src/launch.ts
  - packages/core/src/net.test.ts
  - packages/core/src/net.ts
  - packages/core/src/rules.test.ts
  - packages/core/src/rules.ts
  - packages/core/src/schema.ts
  - packages/core/src/send.ts
  - packages/core/src/trades.test.ts
  - packages/core/src/trades.ts
  - playwright.config.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: fixed # fixes applied 2026-10-26; IN-B-03 skipped (UI copy)
---

# Phase 7: Code Review Report (web + core slice)

**Reviewed:** 2026-10-26T20:40:00Z
**Depth:** standard, deep on the areas named in the config
**Files Reviewed:** 55 (only the parts changed against `main`)
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

I checked every Critical concern in the brief against the code and against what the callees actually do:

- **Forging the genesis actor:** not possible. `prepare/route.ts:27-28` builds the forward body only from `FIELDS`, which never names `actor`. It adds `actor` last, and only from `adminSession()`. That needs an HMAC-sealed, `admin`-tagged, live cookie naming `ADMIN_WALLET`, sent `SameSite=Strict` past `sameOrigin`. The worker checks again: `genesis.ts:61-68` requires `actor === wallet === ADMIN_WALLET`. No other web route posts to `/prepare`. The child path (`parseRequest`) ignores `actor`.
- **Owner variant leaking:** no leak. `launch/page.tsx` sends only a boolean and server-rendered copy, and it only does so when the cookie is valid. `useLaunchStatus` also needs `status.paused === "genesis"`. Nothing secret is in the client bundle: web never imports `@bondr/core/net`, `keys` or `contract`, and `WEB_ENV` has no Helius key.
- **worker.ts pass-through:** safe. It keeps `retryAfter` only when finite and `lock` only when it is one of two literals. No raw worker text comes through.
- **TRUNCATE guard:** works for its stated purpose. The statement trigger reuses `admin_audit_guard()`, which raises for any `TG_OP` other than its one allowed UPDATE. See IN-B-06 for a wrong claim in the comment.
- **Mainnet RPC from local/dev:** not reachable. `connect("mainnet")` throws on a local host. Every script caller refuses anything but devnet or fork, and the worker gate (`ALLOW_MAINNET`) is the only way to reach `"mainnet"`.
- **XSS and header injection:** none found. Copy that contains worker or pump strings goes through React text nodes. The `Location` header comes from a `URL` object, so it is percent-encoded.

I ran the targeted unit tests (7 files, 64 passed) and `pnpm typecheck` (clean). There are no Critical findings. One Warning is a real open-redirect primitive in `proxy.ts`. The deployed Next 16 server blocks it today. The other Warning is the Sniped line stating "0%" before the 3-slot window has been ingested.

## Warnings

### WR-B-01: www-to-apex redirect lets a `//host` path escape SITE_URL (open redirect primitive)

**File:** `apps/web/proxy.ts:25-26`
**Issue:** `new URL(pathname + search, site)` resolves the path as a relative reference. A pathname that starts with `//` (or `/\`) is protocol-relative, so the origin comes from the request and not from `SITE_URL`. I checked this by calling `proxy()` directly with `http://internal:8080//evil.example/x?y=1` and `x-forwarded-host: www.trybondr.fun`. It returned `308 Location: https://evil.example/x?y=1`. The comment on line 15 ("never steer the redirect") is wrong for this function.

Today the attack is blocked by something outside this code. In Next 16.3.8, `router-utils/resolve-routes.js:105` answers any URL containing `//` or `\` with its own 308 to the normalized path, and that runs before the proxy. So the safety depends on undocumented framework behaviour that `proxy.test.ts` does not test. A Next upgrade, a custom server, or a different adapter would make `www.trybondr.fun//evil.example` a working open redirect from the brand domain, which is useful for phishing the admin sign-in.
**Fix:** Build the target from the origin by string, so no part of the request can change the authority. Then add the case to `proxy.test.ts`.
```ts
const to = new URL(site.origin);
to.pathname = pathname;
to.search = search;
return Response.redirect(to, 308);
// proxy.test.ts
expect(proxy(req("http://internal//evil.example/x", { fwd: "www.trybondr.fun" }))?.headers.get("location"))
  .toBe("https://trybondr.fun//evil.example/x");
```

**Outcome:** Fixed (ad49ad4). The Location is `new URL(site.origin)` with `pathname` and `search` set as fields. proxy.test.ts checks that `//evil.example/x?y=1` and `/\evil.example/x?y=1` both answer `https://trybondr.fun//evil.example/x?y=1`.

### WR-B-02: Sniped line reads "0% of supply" before the 3-slot window has been ingested

**File:** `packages/core/src/trades.ts:217-218`, `apps/web/app/coin/[mint]/page.tsx:170`
**Issue:** `newCoin` writes `snipedBps: 0` together with `createSlot` as soon as the launch tx is ingested. The page then shows `Sniped {snipedBps ?? 0}` whenever `createSlot != null`. `recomputeSniped` only runs when a buy inside the window is inserted. Two failure scenarios:

1. A viewer who opens the token page (the share link) seconds after launch is told "Sniped 0% of supply" while slots `create+1` and `create+2` are still open or not yet ingested. The page is server-rendered and does not refresh this line.
2. If a window trade fails to ingest (stream drop, a parse that is kept for retry), the figure stays an understated "0%" with nothing to show it is incomplete.

UI-SPEC row 188 does define "bps 0 shows 0%". The problem is the timing: "0%" is shown as a fact before the data exists. On a page whose disclosure is the anti-snipe honesty line, that comes close to the "UI implying not sniped" concern.
**Fix:** Write `snipedBps: null` in `newCoin`. Have the worker set the number once the window is closed, for example on the first ingested trade with `slot > createSlot + 2`, or in the same `recomputeSniped` call extended to that trigger. On the page, render the line only when `snipedBps !== null`, or show "Sniped figure pending" while it is null.

**Outcome:** Fixed (5d8d102), no migration needed: 0008 already makes `sniped_bps` nullable. `newCoin` no longer writes 0, so new coins start null. `recomputeSniped` writes only when a trade past `createSlot+2` exists. `windowMints` triggers on a window buy, or on a trade past the window while the in-memory `windowClosed` flag is false. `closeWindows` sets that flag after the ingest transaction commits, and `loadCoins` restores it from `sniped_bps is not null`. The page renders Sniped only when `snipedBps != null`. ingest.test.ts (DB) checks: null after launch, still null after window buys, the figure on the first trade past the window, and no count for buys after the window. coin-sniped.e2e.ts checks that a create slot with a null figure shows no Sniped text. Known edge case: if a window buy and the closing trade are ingested at the same time, each in its own uncommitted transaction, the figure can miss that buy until the next window-buy ingest.

## Info

### IN-B-01: www with a port or a forwarded list is served without the redirect

**File:** `apps/web/proxy.ts:22-23`
**Issue:** The check is a strict equality on `x-forwarded-host ?? host`. A value like `www.trybondr.fun:443`, or a comma list such as `www.trybondr.fun, edge`, is not redirected. Checked: `www.trybondr.fun:443` returns `undefined`. Admin sign-in on www then fails, because `adminOrigin` does not match.
**Fix:** Normalize first: `host?.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "")`.

**Outcome:** Fixed (ee8f2e1). The host is normalized to the first forwarded entry, lowercased, port stripped, and compared with `www.` plus SITE_URL's hostname. Tests cover `:443`, mixed case and a comma list.

### IN-B-02: Sender tip row shows "Unavailable" on devnet when the status read fails

**File:** `apps/web/components/launch-receipt.tsx:62-64`
**Issue:** The condition `s === null || ...` shows the row whenever status is null. That includes devnet after a failed read. UI-SPEC says the row is absent off mainnet.
**Fix:** Pass the network from the server (`SOLANA_NET` is already a layout prop). Show the row only when `net === "mainnet"`.

**Outcome:** Fixed (21635b8). WalletApi carries `net` from the server's SOLANA_NET. The tip row follows a loaded status as before; with no status, it shows only when the server net is mainnet. New launch-tip e2e case: a 503 status on devnet shows no tip row. It fails on the old code (checked).

### IN-B-03: "Could not run" copy blames the RPC for any throw

**File:** `apps/web/lib/admin-copy-health.ts:172`, `packages/core/src/contract.ts:178-181`
**Issue:** `checkContract` can throw for reasons that are not about the RPC, for example `readBigUInt64LE(4)` on a ProgramData slice shorter than 12 bytes, or a `readLiveConfig` decode error. The owner is still told "The RPC did not answer", which points the debugging the wrong way.
**Fix:** Use neutral copy ("The check did not finish.") or have the worker report a short cause.

**Outcome:** Skipped. The "RPC did not answer" copy is UI-SPEC copy asserted in admin-copy-health tests and admin-contract e2e. Changing it is a Designer copy decision, not a one-liner.

### IN-B-04: Run check now uses the 15 s default worker timeout

**File:** `apps/web/app/api/admin/[op]/route.ts:39-43`
**Issue:** `contract-check` makes about 4 RPC reads. Slow RPC can go past 15 s. The web then returns `worker_unavailable` and the button shows "Could not run the check" while the single-flight run is still going, and its result appears on a later poll.
**Fix:** Add `if (op === "contract-check") return 30_000;` to `timeoutOf`.

**Outcome:** Fixed (3c9f690). `timeoutOf` gives contract-check 30 s.

### IN-B-05: Launch tx link falls back to the devnet explorer on mainnet

**File:** `apps/web/components/launch-sign.tsx:154`
**Issue:** `net?.net ?? "devnet"` is not a new line, but it sits in the changed `Outcome` and matters now that the site is live. If the first status read fails on mainnet, the "Launch tx" link opens devnet Solscan.
**Fix:** Pass the server `SOLANA_NET` down, as `coin/[mint]/page.tsx:154` already does.

**Outcome:** Fixed (21635b8). The Launch tx link falls back to the server's net (`useWallet().net`) instead of devnet.

### IN-B-06: Migration comment overstates the trigger's protection

**File:** `packages/core/migrations/0008_go_live.sql:11-12`
**Issue:** The comment says the trigger "still fires" after a re-grant. The app connects as the table owner (`CURRENT_USER` here, per the 07-24 e2e README note), and the owner can run `ALTER TABLE admin_audit DISABLE TRIGGER admin_audit_no_truncate` or drop it, then TRUNCATE. So append-only holds against accidental statements, not against a compromised app role. 0007's row triggers have the same limit.
**Fix:** Correct the comment. If tamper resistance matters, run migrations as a separate owner role and give the app role only `INSERT, SELECT, UPDATE` on `admin_audit`.

**Outcome:** Fixed (deb572d). The comment only. The drizzle migrator tracks applied migrations by timestamp, not file hash, so the comment edit does not touch applied databases. Separate owner and app roles remain a possible later hardening.

---

_Reviewed: 2026-10-26T20:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (deep on configured areas)_
