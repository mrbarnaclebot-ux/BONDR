---
phase: 06-admin-dashboard
slice: web (apps/web non-e2e, packages/core, root config)
reviewed: 2026-10-26T00:00:00Z
depth: standard (deep on auth)
files_reviewed: 74
files_reviewed_list:
  - .env.example
  - apps/web/app/admin/page.tsx
  - apps/web/app/api/admin/[op]/route.ts
  - apps/web/app/api/admin/session/route.ts
  - apps/web/components/admin-action-grid.tsx
  - apps/web/components/admin-audit.tsx
  - apps/web/components/admin-console.tsx
  - apps/web/components/admin-evacuate.tsx
  - apps/web/components/admin-health.tsx
  - apps/web/components/admin-inspect.tsx
  - apps/web/components/admin-moderation.tsx
  - apps/web/components/admin-panel.tsx
  - apps/web/components/admin-signin.tsx
  - apps/web/components/admin-sim-foot.tsx
  - apps/web/components/admin-sim.tsx
  - apps/web/components/admin-switches.tsx
  - apps/web/components/admin-timeline-boxes.tsx
  - apps/web/components/admin-timeline.tsx
  - apps/web/components/admin-topbar.tsx
  - apps/web/components/admin-wallets.tsx
  - apps/web/components/admin-wtable.tsx
  - apps/web/components/launch-sign.tsx
  - apps/web/components/tag.tsx
  - apps/web/components/token-bond.tsx
  - apps/web/components/token-ledger.tsx
  - apps/web/components/trade-amount.tsx
  - apps/web/lib/admin-applies.test.ts
  - apps/web/lib/admin-applies.ts
  - apps/web/lib/admin-audit-page.ts
  - apps/web/lib/admin-copy-actions.test.ts
  - apps/web/lib/admin-copy-actions.ts
  - apps/web/lib/admin-copy-audit.test.ts
  - apps/web/lib/admin-copy-audit.ts
  - apps/web/lib/admin-copy-evac.test.ts
  - apps/web/lib/admin-copy-evac.ts
  - apps/web/lib/admin-copy-health.test.ts
  - apps/web/lib/admin-copy-health.ts
  - apps/web/lib/admin-copy-mod.test.ts
  - apps/web/lib/admin-copy-mod.ts
  - apps/web/lib/admin-copy-sim.test.ts
  - apps/web/lib/admin-copy-sim.ts
  - apps/web/lib/admin-data.ts
  - apps/web/lib/admin-run.ts
  - apps/web/lib/admin-state.test.ts
  - apps/web/lib/admin-state.ts
  - apps/web/lib/admin-timeline-data.ts
  - apps/web/lib/admin-timeline.test.ts
  - apps/web/lib/admin-timeline.ts
  - apps/web/lib/format.ts
  - apps/web/lib/ledger-copy.test.ts
  - apps/web/lib/ledger-copy.ts
  - apps/web/lib/session.test.ts
  - apps/web/lib/session.ts
  - apps/web/lib/use-console.ts
  - apps/web/lib/use-evacuate.ts
  - apps/web/lib/use-health.ts
  - apps/web/lib/use-sim.ts
  - apps/web/next.config.ts
  - packages/core/migrations/0007_admin.sql
  - packages/core/src/api-admin.ts
  - packages/core/src/api.ts
  - packages/core/src/coin-row.ts
  - packages/core/src/db-admin.test.ts
  - packages/core/src/db.test.ts
  - packages/core/src/fees.test.ts
  - packages/core/src/fees.ts
  - packages/core/src/net.ts
  - packages/core/src/pump.ts
  - packages/core/src/schema-admin.ts
  - packages/core/src/schema.ts
  - packages/core/src/scrub.test.ts
  - packages/core/src/scrub.ts
  - playwright.config.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 8
  info: 8
  total: 16
status: issues_found
fix_status: criticals and warnings fixed (WR-B-03 worker half in fdaf1a1); IN-B-01, 02, 07, 08 skipped
---

# Phase 6: Code Review Report (slice B: web, core, root config)

**Reviewed:** 2026-10-26
**Depth:** standard, deep on the auth path
**Files Reviewed:** 74
**Status:** issues_found

## Summary

I traced the auth core end to end, through `session.ts`, the session route, the `[op]` forwarder, the page gate and the worker-side `gated`/`take` it relies on. I found no way to get an admin cookie without an ADMIN_WALLET signature, and no way to forge or extend one:

- The `admin-` tag keeps public session values, nonces and pin proofs from parsing as an admin session.
- `e - now <= ADMIN_MS` caps the lifetime at 30 minutes.
- The nonce is spent once in `consent_nonces` only after the signature checks, and the primary key decides any race.

The actor is always `s.wallet`, spread last in `{ ...body, actor }`. The worker re-checks it against ADMIN_WALLET. CSRF is closed by `sameOrigin` plus SameSite=Strict plus the application/json requirement. Held reasons, `reconcile_diff` rows and moderation reasons reach only the cookie-gated page and ops. Public reads still go through `PUBLIC_KINDS` and `coinRows`, which now filters `hidden_at`. I found no XSS sink: every worker string renders as React text, and the inspector's `explorer` href is built by the worker from a validated signature.

The bytes Phantom signs are exactly `intent.message` from the worker. The browser never builds or edits them.

The findings are about the money dialog's honesty and robustness:

- Session expiry in the middle of a send loses the outcome and reopens a fresh "nothing sent yet" dialog for the same action.
- The "unknown" copy says "Sent" when execute itself never reached the worker.
- The dialog describes the Phantom message wrongly and never shows it.
- The stuck box claims a pre-flight check that it never runs.

Known accepted items were not re-reported (workerPost dropping the 409 reason, the "Simulated, then sent" eyebrow).

## Narrative Findings (AI reviewer)

## Warnings

### WR-B-01: When the session ends during a send, the outcome is lost and a fresh dialog for the same action opens

**Outcome:** Fixed in 9b94f9d. A session end now drops the dialog (`con.endSim`), so it never reopens as a fresh simulation, and reloads the overview on sign-in. When a send was out (the dialog or EVACUATE, tracked by `con.sending`), the sign-in card says "Your admin session ended during a send..." and tells the owner to check the audit log. The poll is not resumed after sign-in: that stays a deliberate shortcut. New check in admin-sim.e2e.ts (a 401 on the intent poll). Requires human verification: logic change.

**File:** `apps/web/components/admin-console.tsx:42-44`, `apps/web/lib/use-console.ts:63-71`, `apps/web/lib/use-sim.ts:61-65,111,121`, `apps/web/components/admin-topbar.tsx:38-40`

**Issue:** Any 401 sets `gate`, and so does the TopBar countdown reaching 0. That makes `AdminConsole` return `<AdminSignIn>` and unmounts `Grid` with the open `SimDialog`. The dialog's `locked` guard does not stop this. `useSim`'s cleanup aborts the poll, so the owner never sees the outcome. `closeSim` is never called, so `con.sim` stays set and no overview reload runs.

After "Sign in again", `resume` clears the gate and `Grid` remounts. `SimDialog` then mounts from the stale `con.sim`, and `useSim`'s effect immediately simulates the same action again. The dialog shows "Simulated, nothing sent yet" and "Sign with owner wallet and send".

Concrete case: the owner signs in at T, opens Distribute now at T+29m, signs, and the worker starts sending. At T+30m `left <= 0` fires `onEnd`. After signing in again, the owner sees a ready dialog for Distribute now with no trace of the first run. While the first run is still pending on the coin queue, chain balances have not moved yet, so the re-simulation looks identical and invites a second signature. The same unmount drops EVACUATE mid-run back to "Disarmed".

**Fix:** Do not unmount money flows on unauthorized. Clear the dialog, and remember whether anything was sent:
```ts
// use-console.ts: expose a reset used by AdminConsole on gate
const endSim = useCallback(() => setSim(null), []);
// admin-console.tsx
const onUnauthorized = useCallback(() => { con.endSim(); setGate("ended"); }, [con.endSim]);
const resume = useCallback((s) => { setSession(s); setGate(null); void con.reload(); }, [con.reload]);
```
Better still, keep `Grid` mounted and render the sign-in card above it while `phase` is signing or sending, so the poll keeps its outcome. Polling `/api/admin/intent` with an expired cookie returns 401, so persist the intent id and resume `pollIntent` after re-sign-in.

### WR-B-02: The "unknown" outcome says "Sent" when execute never reached the worker

**Outcome:** Fixed in 489132c. The unknown outcome now reads "No confirmation from the worker. It may or may not have sent..." and the EVACUATE lost line reads "Transfers may still be running on the worker." The distinct `unreached` result was skipped.

**File:** `apps/web/lib/use-sim.ts:114-122`, `apps/web/lib/admin-run.ts:51-63`, `apps/web/components/admin-sim-foot.tsx:17-18`, `apps/web/lib/use-evacuate.ts:127-136`, `apps/web/lib/admin-copy-evac.ts:19`

**Issue:** `worker.ts` maps every non-PASS outcome to `worker_unavailable` 503. That covers WORKER_URL or WORKER_TOKEN unset, a worker 401 after a token mismatch, a 502 from the Railway edge when the worker is down, and a connection refusal.

`useSend` treats that code as "may have been sent" and starts `pollIntent`. That is correct for the 30 s timeout case. But when the worker is down, every intent poll is also a 503. The loop then runs its full 90 s and ends in `unknown`. The dialog shows "Sent, not confirmed yet. Nothing is resent automatically.", and EVACUATE shows "Lost contact with the worker. Transfers continue on the worker." In this case nothing was sent and no transfers are running. The UI asserts a send it has no evidence of.

**Fix:** Word the unknown state as unknown, not as sent:
```ts
const UNKNOWN =
  "No confirmation from the worker. It may or may not have sent. Nothing is resent automatically. Refresh in a minute and check the audit log.";
// admin-copy-evac.ts
lost: "Lost contact with the worker. Transfers may still be running on the worker. Refresh to see the audit log.",
```
Optionally, have `pollIntent` return a distinct `unreached` result when it never got a single 200 or 404 answer.

### WR-B-03: The admin sign-in message has no domain line, so a phishing page can obtain a real admin cookie

**Outcome:** Fixed in 27c2c78 (web half). The admin sign-in message is now SIWS-shaped: "{host} wants you to sign in with your Solana account:", then `URI: {origin}`, `Nonce:` and `Expiration Time:`. The origin comes from SITE_URL and must equal the request Origin on nonce and on verify. It fails closed (403 not_configured) when SITE_URL is unset, and /admin shows the not-configured card. playwright.config.ts sets web SITE_URL to baseURL when unset. Worker half fixed in fdaf1a1. `intentMessage` now starts with the same SIWS-style domain line and the admin wallet, then the statement "BONDR admin action. ...", `URI: {origin}`, the action fields and `Expiration Time:`. The origin is `WorkerEnv.siteUrl`, taken from SITE_URL the same way as the web's `adminSite`. When SITE_URL is unset or invalid, `/admin/simulate` and `/admin/execute` answer 403 `forbidden` before any deps are built. SITE_URL moved to the shared block of .env.example, and playwright.config.ts passes the web's SITE_URL to the worker. The separation test now compares against the web sign-in text with the same site, nonce and expiry, so only the statement line differs. The dialog shows the worker's text verbatim, so it still matches. The e2e stubs use the new shape via `intentText()`, and the Phase 6 shots were refreshed (2c16a1c). Staging and production workers need SITE_URL set before admin money actions work.

**File:** `apps/web/lib/session.ts:98-107`, `apps/web/app/api/admin/session/route.ts:32-37,43-68`

**Issue:** `adminMessage` contains only the title, wallet, nonce and expiry. A lookalike site can work server to server:

1. Its backend POSTs `{op:"nonce", wallet: ADMIN_WALLET}` to BONDR. `sameOrigin` only checks that Origin matches Host, and a non-browser client can set both freely.
2. The page asks the owner's Phantom to `signMessage` the returned text, byte for byte.
3. The backend POSTs `verify` and receives a valid `bondr_admin` cookie.

With that cookie, the attacker can call every session-only op from their server with forged Origin and Host headers for 30 minutes: kill switches, hide and block, hold and release, re-check launch. They can also fetch intent texts for money actions to phish next. The intent message (worker `admin-intent.ts:41-58`, other slice) has the same gap.

The text gives the owner no domain to compare against the page they are on. Phantom's SIWS domain mismatch warning only applies to messages that carry a domain.

**Fix:** Bind the origin in SIWS form and check it on verify:
```ts
export const adminMessage: MessageOf = (wallet, nonce, expires) => [
  `${new URL(process.env.SITE_URL!).host} wants you to sign in to the BONDR owner console with your Solana account:`,
  wallet, "", `URI: ${process.env.SITE_URL}`, `Nonce: ${nonce}`, `Expiration Time: ${expires}`,
].join("\n");
```
Fail closed when SITE_URL is unset. Add the same `Domain:` line to `intentMessage` in the worker.

### WR-B-04: The stuck box claims a finalize pre-flight check that it never performs

**Outcome:** Fixed in d2a2405. Dropped the pre-flight sentence and the `deployer` prop. A live pre-flight verdict from the worker (`AdminCoinMemory.stuck.preflight`) was not added.

**File:** `apps/web/components/admin-timeline-boxes.tsx:65-68`, `apps/web/components/admin-timeline.tsx:169`

**Issue:** `deployer` is `data.timeline.launch?.wallet`, which is the launch signer. The copy says "Pre-flight: deployer X matches the launch signer.", so it compares that value with itself and always reads as passed. It shows on every stuck finalize, right next to the button for the one permanent `update_fee_shares_v2`. The engine's real pre-flight compares `launches.wallet` with on-chain state, and that check is exactly what holds a finalize. The console reports it as passing without ever reading its result.

**Fix:** Drop the sentence. Or render it only from a worker field that carries the real pre-flight verdict, for example `AdminCoinMemory.stuck.preflight: "passed" | "failed"`:
```tsx
const preflight = ""; // the live pre-flight verdict is the worker's; do not restate launches.wallet against itself
```

### WR-B-05: The money dialog describes the Phantom message wrongly and never shows it

**Outcome:** Fixed in 722fab2. The dialog shows `intent.message` verbatim in a `pre`, with the corrected sentence: Phantom shows exactly this message, so check the action, mint and destination addresses. admin-sim.e2e.ts checks the `pre` equals MESSAGE. Dialog shots refreshed.

**File:** `apps/web/components/admin-sim.tsx:115-118`, `apps/web/components/admin-sim.tsx:178-192`

**Issue:** The dialog says Phantom's message "names this action, {symbol} and the destinations". The signed text (`intentMessage`) names the action as a snake_case code, the coin as a mint address, and the destinations as `Treasury <address>` / `Deployer <address>`. The symbol is not in it. The dialog itself shows only the prose lines "treasury matches config, deployer matches the launch signer". It never shows `intent.message` or any address. The owner therefore cannot check the Phantom popup against the dialog, which is the point of a fresh signature over a human-readable intent.

**Fix:** Render the exact signed text in the dialog and correct the sentence:
```tsx
{s.sim?.intent && (
  <pre className="num whitespace-pre-wrap text-xs">{s.sim.intent.message}</pre>
)}
<p className="text-xs text-muted-foreground">
  Phantom shows exactly this message. Check that the action, mint and destination addresses match before you sign.
</p>
```

### WR-B-06: "Hold for review" is enabled for an unconfirmed launch, and clicking it reports a worker outage

**Outcome:** Fixed in 784c5ba. `hold` and `release_hold` now need `coin`. Both got a not-applicable reason, and `actResultCopy("not_found")` reads "This coin has no indexed row yet. Nothing changed." No worker change was needed.

**File:** `apps/web/lib/admin-applies.ts:55`, `apps/web/lib/admin-copy-actions.ts:63-69`

**Issue:** `hold: !held` has no `coin` guard, unlike the other coin actions. For a row with `launch: "unconfirmed"` (no `coins` row yet), the grid offers "Hold for review". The worker's `hold` calls `finalizeOf`, which throws `not_found`, so the response is 404. `actResultCopy("not_found")` then renders "The worker did not answer. Nothing changed. Try again in a moment." That is wrong: the worker answered, and retrying can never succeed.

**Fix:**
```ts
hold: coin && !held,
release_hold: coin && held,
```
Also map `not_found` in `actResultCopy` to "This coin has no indexed row yet."

### WR-B-07: A health poll that is already in flight can revert a kill switch the owner just flipped

**Outcome:** Fixed in 9142e84. `lastOk` is now the poll's request start. Requires human verification: logic change.

**File:** `apps/web/components/admin-switches.tsx:38`, `apps/web/lib/use-health.ts:20-36`

**Issue:** `known` prefers the flip's answer only when `answer.at > poll.lastOk`. But `lastOk` is set when the poll response arrives, not when it was requested. Sequence: a health poll leaves at t0, the owner flips Finalize at t1, the flip answers at t1', and the poll answers at t2 > t1'. The poll carries switches the worker read before the flip. Because `lastOk = t2 > t1'`, the stale value wins, and the switch shows the old state for up to 10 s. The health snapshot can also wait on the 60 s-cached Sentry call, which widens the window. On a kill switch, showing "Running" right after a pause is the misleading direction.

**Fix:** Stamp the poll with its request start, and compare the flip against that:
```ts
const started = Date.now();
const r = await fetch("/api/admin/health", ...);
setPoll((p) => body ? { health: body, failedAt: null, lastOk: started } : { ...p, failedAt: Date.now() });
```

### WR-B-08: The inspector rejects valid signatures shorter than 87 characters

**Outcome:** Fixed in 7f2d45e. The regex is now `{64,88}`, and admin-inspect.e2e.ts sends an 86-character value.

**File:** `apps/web/components/admin-inspect.tsx:16,86-89`

**Issue:** The client accepts `^[1-9A-HJ-NP-Za-km-z]{87,88}$`. A 64-byte value below 58^86 (about 10^151.7 out of 2^512, about 10^154.1) encodes to 86 characters or fewer. That is roughly 1 in 300 real signatures, and more with leading zero bytes. The worker's `sigOf` correctly accepts 64 to 88 characters and decodes to exactly 64 bytes. For those signatures the console says "That is not a transaction signature." and sends no request at all.

**Fix:** Match the worker:
```ts
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/; // the worker checks the decoded length is exactly 64
```

## Info

### IN-B-01: An admin session cannot be revoked server-side

**Outcome:** Skipped. Accepted for one owner, as the review says. A revocation list or ADMIN_EPOCH is a design change, not a one-line fix.

**File:** `apps/web/lib/session.ts:125-138`

**Issue:** Sign out only clears the cookie in that browser. A copied `bondr_admin` value stays valid for its full 30 minutes, from any client: a server-side caller can set Origin and Host, so `sameOrigin` blocks only browsers. The only kill switches are rotating SESSION_SECRET, which also logs out every public session, or changing ADMIN_WALLET.

**Fix:** Acceptable for one owner. If needed, spend a per-cookie id in Postgres on sign-out, or add an `ADMIN_EPOCH` env value to the sealed text.

### IN-B-02: The admin_audit guard does not cover TRUNCATE

**Outcome:** Skipped. It needs a new migration with a TRUNCATE trigger and a grant change. Not a one-line fix. Left for the security phase.

**File:** `packages/core/migrations/0007_admin.sql:64-65`

**Issue:** The trigger is `BEFORE UPDATE OR DELETE ... FOR EACH ROW`. Row triggers do not fire on TRUNCATE, so `TRUNCATE admin_audit` empties the append-only log.

**Fix:** `CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_guard();`. The function needs a `TG_OP = 'TRUNCATE'` branch that raises. Also revoke TRUNCATE from the app role.

### IN-B-03: The EVACUATE intro miscounts wallets

**Outcome:** Fixed in 248da0e. The intro names the count only from `s.sim.totals.wallets`, and the unused `overview` prop is removed.

**File:** `apps/web/components/admin-evacuate.tsx:158`

**Issue:** `wallets={overview.rows.length}` counts every row. That includes unconfirmed launches, which have no coin row, and W wallets that are already empty. So "Every W balance moves to the treasury, N wallets" overstates the count before the simulation runs.

**Fix:** Say "every W" without a number until `s.sim?.totals.wallets` is known.

### IN-B-04: The stuck box says "after send" for errors that happen before any send

**Outcome:** Fixed in d2a2405. "after send" now shows only for `send_failed` and `blockhash_expired`.

**File:** `apps/web/components/admin-timeline-boxes.tsx:73`

**Issue:** `stuckErrorCopy` includes `simulation_failed`, and the line always appends "after send". A step that failed in simulation never sent anything.

**Fix:** Drop "after send", or add it only for `send_failed` and `blockhash_expired`.

### IN-B-05: Sign out shares the sign-in rate bucket and fails silently

**Outcome:** Fixed in 05ad541. Sign out is handled before `rateLimited`.

**File:** `apps/web/app/api/admin/session/route.ts:26-30`, `apps/web/components/admin-signin.tsx:152-160`

**Issue:** `signout` counts toward the 10-per-10-minutes `admin-session` limit. A 429 makes `SignOut` do nothing and show nothing, and the console stays open.

**Fix:** Handle `signout` before `rateLimited`, or show "Could not sign out. Try again." when the response is not ok.

### IN-B-06: Sign-in failures are all reported as a connection problem

**Outcome:** Fixed in 05ad541. `bad_signature` now reads "That signature expired or was already used. Sign in again."

**File:** `apps/web/components/admin-signin.tsx:35-36`

**Issue:** A 401 `bad_signature`, for example a replayed or expired nonce after a slow Phantom prompt, and a 503 from the DB write both show "Check your connection and try again."

**Fix:** Map `bad_signature` to "That signature expired or was already used. Sign in again."

### IN-B-07: Re-arming EVACUATE stacks worker simulations

**Outcome:** Skipped. Debouncing, or passing the abort signal through `workerPost`, is not a one-line fix.

**File:** `apps/web/lib/use-evacuate.ts:73-78`, `apps/web/app/api/admin/[op]/route.ts:79-81`

**Issue:** Each exact phrase match starts a simulation of every W, with a 90 s timeout. Editing away aborts only the browser fetch. `forward` does not pass `req.signal` into `workerPost`, so the web keeps waiting and the worker keeps simulating. Typing the phrase on and off repeatedly multiplies RPC simulations.

**Fix:** Debounce the arm, for example 500 ms after the last keystroke, or pass the request's abort signal through `workerPost`.

### IN-B-08: The new admin SQL has no DB-backed test

**Outcome:** Skipped. A new DB-backed test file (seeding and two audit pages) is not a one-line fix.

**File:** `apps/web/lib/admin-data.ts:56-207`, `apps/web/lib/admin-audit-page.ts:38-66`, `vitest.config.ts:5-19`

**Issue:** None of these has a test that runs against Postgres:
- the overview queries: the `lastCollectAt` and `bondSent` subqueries, `DISTINCT ON` in reconcile, and the copied `VANITY_FREE` predicate
- the audit keyset cursor, including `date_trunc` and the bigint id comparison

The copy and state helpers are unit-tested, but this SQL is exercised only by Playwright.

**Fix:** Add one `apps/web/lib/admin-data.test.ts` that seeds a coin, a pending `forced_bond` and two `reconcile_diff` rows, and checks `overviewData` and two `auditPage` pages. Add it to the `DB` list.

---

_Reviewed: 2026-10-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (deep on auth)_
