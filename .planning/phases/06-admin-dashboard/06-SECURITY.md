---
phase: 06
slug: admin-dashboard
status: verified
threats_total: 126
threats_closed: 126
threats_open: 0
asvs_level: 1
block_on: open
register_authored_at_plan_time: true
created: 2026-10-26
---

# Phase 06 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

This audit checked each mitigation against the code at `db5bcc1` on `phase-06-admin-dashboard`. That commit includes the review fixes in 06-REVIEW-worker.md, 06-REVIEW-web.md and 06-REVIEW-e2e.md. Nothing in the summaries was taken on trust. File:line references point at the current tree. Where a review fix changed how a mitigation works (WR-B-03, CR-W-01, WR-W-03, WR-W-04, WR-W-06, WR-W-07, WR-W-08, WR-E-05), the evidence cites the code after the fix. Unless a path is given, files are under `apps/worker/src/`, `apps/web/` or `packages/core/`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser -> /api/admin/session | Untrusted nonce requests and signatures for the owner sign-in | wallet, nonce, ed25519 signature |
| browser -> /api/admin/{op} | Gated by the admin cookie. The body is untrusted | action inputs, mint, cursor, intent signature |
| web -> worker /admin/* | Bearer token plus the actor the web takes from the cookie. Not enough on its own to move funds | actor, action inputs |
| owner Phantom -> worker | The intent signature is the only authority for a send | base64 ed25519 signature over worker-written text |
| worker -> chain | Real transactions signed with derived W, ops and buyback keys | signed transactions (devnet SOL and tokens) |
| worker -> Postgres | Audit, hold, hide, block, switch and ledger writes. The database is the last guard | admin_audit, coins, settings, fee_ledger rows |
| worker -> web (errors) | Contract codes only. Raw RPC or DB text must never reach the browser | error codes |
| Postgres -> public pages | New public kinds (evacuate, leftover_burn). Moderation reasons must stay internal | ledger rows, coin lists |
| e2e runner -> root .env, devnet, staging | Test admin key derivation, devnet spend, shared dev DB state | public address only, devnet SOL |

---

## Threat Register

Status: all 126 closed. Disposition counts: 118 mitigate, 8 accept, 0 transfer.

| Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-----------|----------|-----------|-------------|------------|--------|----------|
| T-06-01-01 | Repudiation | admin_audit rows edited or deleted | mitigate | admin_audit_guard trigger: no DELETE, only pending to final with identity unchanged | closed | `packages/core/migrations/0007_admin.sql:52-65`; P0001 cases `packages/core/src/db-admin.test.ts:161-181`. TRUNCATE is not covered (see Informational, IN-B-02) |
| T-06-01-02 | Tampering | hold or hide flags half set | mitigate | coins_hidden, coins_held, coins_reasons CHECKs | closed | `0007_admin.sql:42-45`; 23514 cases `db-admin.test.ts:110-119` |
| T-06-01-03 | Denial of service | EVACUATE insert refused by the old sig_kind index | mitigate | fee_ledger_sig_kind widened to (signature, kind, coalesce(mint,'')) | closed | `0007_admin.sql:30,41`; `db-admin.test.ts:185-200` |
| T-06-01-04 | Information disclosure | MASTER_SEED_FILE or seed reaching the dev server env | mitigate | keys.ts derives only the public address; the config never copies rootEnv into process.env | closed | `playwright.config.ts:4-7,17-25`; `apps/web/e2e/keys.ts:9,28-31` (KeyObject stays in Node) |
| T-06-01-05 | Elevation of privilege | settings defaults pausing staging | mitigate | Every new switch column defaults to true | closed | `0007_admin.sql:35-38`; `db-admin.test.ts:99`; staging boot log every switch on (06-26-SUMMARY line 60) |
| T-06-01-06 | Denial of service | migration on the shared dev branch | accept | Additive columns, two tables, a widened check and an index swap | closed | Accepted risk AR-06-01 |
| T-06-02-01 | Information disclosure | SENTRY_READ_TOKEN in the web process | mitigate | forbiddenEnv refuses web boot with it | closed | `packages/core/src/scrub.ts:21-24`; `apps/web/instrumentation.ts:9`; `scrub.test.ts:29-48` |
| T-06-02-02 | Information disclosure | admin error details reaching the browser | mitigate | PASS set; body rebuilt from error and paused only | closed | `apps/web/lib/worker.ts:10,29-32`; `apps/web/lib/worker.test.ts:1-29`; worker errors are codes `http.ts:22-45,113-116` |
| T-06-02-03 | Repudiation | public ledger hiding an emergency move | mitigate | evacuate is a public kind with copy naming the treasury | closed | `packages/core/src/fees.ts:19,126`; `apps/web/lib/ledger-copy.ts:82`; `ledger-copy.test.ts:75-81` |
| T-06-02-04 | Tampering | type drift between DB action check and code | mitigate | AdminAuditAction lists the same 18 names | closed | `packages/core/src/api-admin.ts:11-34` (10 + 3 + 5); `schema-admin.ts:43-48`; `0007_admin.sql:17-19`; unknown action 23514 `db-admin.test.ts:156` |
| T-06-03-01 | Elevation of privilege | public bondr_session replayed as bondr_admin | mitigate | Tagged sealed value `admin-` plus 30-minute cap | closed | `apps/web/lib/session.ts:139-163`; `session.test.ts:127-152` |
| T-06-03-02 | Spoofing | consent signature replayed as admin sign-in | mitigate | Distinct admin text (after WR-B-03: SIWS domain line, statement "BONDR admin sign-in", URI) | closed | `session.ts:115-136`; consent and other-domain signatures refused `session.test.ts:104-116` |
| T-06-03-03 | Spoofing | nonce replay | mitigate | Nonce spent once with onConflictDoNothing().returning(); replay 401 | closed | `apps/web/app/api/admin/session/route.ts:56-62`; PK `packages/core/migrations/0002_consent_nonces.sql:2`. No automated replay test (Informational) |
| T-06-03-04 | Tampering | CSRF on admin POSTs | mitigate | sameOrigin first, SameSite=Strict, POST only, application/json | closed | `session/route.ts:26`; `app/api/admin/[op]/route.ts:85`; `session.ts:145`; `lib/guard.ts:7-12,23`; e2e 403 cross-origin `e2e/admin-signin.e2e.ts:81-86` |
| T-06-03-05 | Information disclosure | console probing | mitigate | noindex, unlinked, 401 before data, rate limits per IP and wallet | closed | `app/admin/page.tsx:12,17-29`; `[op]/route.ts:86-90`; `guard.ts:80-91`; `admin-signin.e2e.ts:55-59,83` |
| T-06-03-06 | Elevation of privilege | admin enabled by accident | mitigate | ADMIN_WALLET (and, after WR-B-03, SITE_URL) unset or invalid fails closed | closed | `session.ts:92-104`; `session/route.ts:35-36,49-50`; `session.test.ts:90-102,118-125`; staging `e2e/admin-locked.e2e.ts:46-50` |
| T-06-03-07 | Denial of service | sign-in spam | mitigate | rateLimited 10 per 10 minutes before verify and DB writes | closed | `session/route.ts:31-32`. The body (capped at 16 KiB, `guard.ts:22-41`) is now read before the limit so sign-out skips it (IN-B-05). Nothing costly runs first |
| T-06-04-01 | Denial of service | multi-mint insert refused | mitigate | keysOf mirrors the widened index | closed | `fee-ledger-memory.ts:16-17`; `fee-ledger.test.ts:80-87,216-222` |
| T-06-04-02 | Tampering | wrong SOL per W | mitigate | withSol skips rows with their own sol | closed | `fee-send.ts:167-175`; `fee-send-mint.test.ts:48-66` |
| T-06-04-03 | Information disclosure | one coin's rows published on another's page | mitigate | publishByMint groups by mint | closed | `fee-send.ts:227-228,240`; `fee-recover.ts:65,70`; `fee-send-mint.test.ts:54-68` |
| T-06-04-04 | Repudiation | false reconcile alarms | mitigate | evacuate counted in OUT and pgImplied | closed | `fee-reconcile.ts:23-30,52`; `fee-reconcile.test.ts:41-67` |
| T-06-05-01 | Elevation of privilege | leaked WORKER_TOKEN executes a money action | mitigate | take verifies the owner signature over the stored text against ADMIN_WALLET | closed | `admin-intent.ts:102-111`; `admin-money.ts:127-128`; `admin-intent.test.ts:103`; `admin-money.test.ts:172` |
| T-06-05-02 | Tampering | intent text altered or replayed | mitigate | Message binds site, wallet, action, coin, id, destinations, expiry; single use set synchronously | closed | `admin-intent.ts:51-72,100-110`; `admin-intent.test.ts:48,96,111` |
| T-06-05-03 | Spoofing | consent or sign-in signature reused as an intent | mitigate | Distinct statement line "BONDR admin action" (after WR-B-03 the first line is the shared SIWS domain line) | closed | `admin-intent.ts:60-72`; `admin-intent.test.ts:128` compares against the web sign-in text with the same site, nonce and expiry |
| T-06-05-04 | Denial of service | attacker burns the intent with bad signatures | mitigate | Invalid signature checked before `used = true` | closed | `admin-intent.ts:106-107`; `admin-intent.test.ts:103` |
| T-06-05-05 | Elevation of privilege | funds sent to an attacker address | mitigate | refusedDestination over transfers and CloseAccount; deny by default for other token ixs, other System ixs (WR-W-04) and RecoverNested | closed | `admin-dest.ts:58-108`; table `admin-dest.test.ts:129`; CPI ceiling `ponytail:` at `admin-dest.ts:3-5` |
| T-06-05-06 | Denial of service | memory growth from simulate spam | mitigate | INTENT_MAX cap, oldest dropped; web rate limit | closed | `admin-intent.ts:42,74-77`; `admin-intent.test.ts:168`; `[op]/route.ts:89`. Eviction side effect: IN-W-04 (Informational) |
| T-06-06-01 | Tampering | admin send racing an automatic send | mitigate | exclusive chains on the same per-mint queue | closed | `fee-engine.ts:117-127`; `fee-engine-admin.test.ts:116` |
| T-06-06-02 | Denial of service | admin error poisoning the queue | mitigate | exclusive rethrows to the caller; stored tail swallows | closed | `fee-engine.ts:124-127,159-176`; `fee-engine-admin.test.ts:116` |
| T-06-06-03 | Information disclosure | raw RPC text in stuck codes | mitigate | Fixed code table; UI maps codes | closed | `fee-stuck.ts:10-21`; `apps/web/lib/admin-copy-actions.ts:94-98`; `admin-copy-actions.test.ts:74-81` |
| T-06-06-04 | Tampering | manual hold overwriting a finalized coin | mitigate | hold is its own field and column; reset only from held | closed | `fee-engine.ts:137-143`; `0007_admin.sql:33-34`; `fee-engine-admin.test.ts:172` |
| T-06-07-01 | Elevation of privilege | paused job still sending | mitigate | Gate at the top of each job | closed | `fee-guard.ts:48`; `fee-burns.ts:67,98,123`; `fee-finalize.ts:164`; `fee-batch.ts:58,104`; `fee-boot.ts:71`; `fee-gate.test.ts:123-160` |
| T-06-07-02 | Denial of service | switches failing open after a lost row | mitigate | Missing row and pre-load state read as off | closed | `switches.ts:20-30,37-38`; `switches.test.ts:65` |
| T-06-07-03 | Denial of service | Neon kept awake by switch reads | mitigate | One boot read, writes on flip, no timer | closed | `switches.ts` (no setInterval/setTimeout); boot read `main.ts:42` |
| T-06-07-04 | Tampering | forced bond's urgent collect paused by sweeps | mitigate | Gating per job, not per ledger kind | closed | `fee-gate.test.ts:143` |
| T-06-07-05 | Repudiation | switch state unknown after deploy | mitigate | Boot log lists every switch | closed | `main.ts:42-46`; staging log 06-26-SUMMARY line 60 |
| T-06-08-01 | Elevation of privilege | admin route without ADMIN_WALLET or with another actor | mitigate | gated wrapper applied in one place | closed | `admin-routes.ts:23-29,127`; `admin-routes.test.ts:94-127` |
| T-06-08-02 | Tampering | leaked WORKER_TOKEN reading health or flipping state | accept | Private network; state changes need the actor and are audited; money needs the owner signature | closed | Accepted risk AR-06-02 |
| T-06-08-03 | Information disclosure | SENTRY_READ_TOKEN in logs or errors | mitigate | Never in a message; web forbids the name | closed | `sentry-count.ts:4,17-22`; `sentry-count.test.ts:57`; `scrub.ts:21` |
| T-06-08-04 | Denial of service | 10 s poll waking Neon | mitigate | healthSnapshot is memory only | closed | `health.ts:38-57`; db mocked to throw `health.test.ts:7-12,31` |
| T-06-08-05 | Denial of service | Sentry slowness blocking health | mitigate | 60 s cache, one shared promise, 5 s timeout, failure state | closed | `sentry-count.ts:11-12,33-45`; `sentry-count.test.ts:45,57` |
| T-06-08-06 | Elevation of privilege | EVACUATE execution enabled by a typo | mitigate | ADMIN_EVACUATE enum, default simulate, boot refuses other values and non-devnet on | closed | `env.ts:70-75`; `env.test.ts:24-28` (non-devnet branch untested: mainnet is refused first at `env.ts:13-16`) |
| T-06-09-01 | Elevation of privilege | close rent or leftovers outside the allowlist | mitigate | CloseAccount to d.treasury only; built ixs run through refusedDestination | closed | `admin-leftover.ts:35-45`; `admin-dest.ts:84-87`; `admin-leftover.test.ts:110,136,161` |
| T-06-09-02 | Tampering | child supply held by W | mitigate | Leftovers burned, never moved; finalize burns automatically | closed | `admin-leftover.ts:23-31`; `fee-finalize.ts:126-146,177`; `admin-leftover.test.ts:97` |
| T-06-09-03 | Tampering | double sweep in one window | mitigate | Lowest free window plus fee_ledger_sweep unique index | closed | `admin-leftover.ts:50-55`; `packages/core/migrations/0005_fee_ledger.sql:45`; `admin-leftover.test.ts:152` |
| T-06-09-04 | Repudiation | a burn without a public record | mitigate | leftover_burn row through land | closed | `admin-leftover.ts:29-30`; `admin-leftover.test.ts:97` |
| T-06-10-01 | Repudiation | console action with no record | mitigate | Every state change goes through the one writer (pending then settled, WR-W-07); legacy kill-switch audited as runbook (WR-W-08) | closed | `admin-audit.ts:58-68`; `admin-act.ts:40,58,70,82-83`; `admin-moderate.ts:129,138-148`; `status.ts:184-191`; `admin-act.test.ts:45-65`; `switches.test.ts:83` |
| T-06-10-02 | Tampering | leaked WORKER_TOKEN flips switches or holds coins | accept | D-13 session-only actions; private network, actor, audited, reversible | closed | Accepted risk AR-06-03 |
| T-06-10-03 | Information disclosure | secrets in audit params or logs | mitigate | Callers pass action inputs; write failures log SQLSTATE only | closed | `admin-audit.ts:5-6,24-33`; console.error spy `admin-audit.test.ts:34-38` |
| T-06-10-04 | Tampering | release hold skipping finalize pre-flight | mitigate | Release on finalize-held sets finalize none | closed | `admin-act.ts:65-75`; `admin-act.test.ts:144` |
| T-06-10-05 | Denial of service | long re-check holding the web request | mitigate | One status read (observe once) | closed | `admin-act.ts:77-95` |
| T-06-10-06 | Denial of service | overview reading 500 W | mitigate | W table from coins.fee_budget; only the selected coin read live | closed | `admin-overview.ts:1-2,33-46,57-70`; `admin-overview.test.ts:55,97` |
| T-06-11-01 | Tampering | simulation sending or writing ledger rows | mitigate | captureDeps: mode dry, read-only ledger, no publish, land simulates | closed | `admin-sim.ts:52-61,93-112`; `admin-sim.test.ts:111` |
| T-06-11-02 | Elevation of privilege | finalize locking 80% to a wrong deployer | mitigate | Deployer is coin.wallet only; non-held coins run the automatic launch-signer preflight (WR-W-03) | closed | `admin-actions.ts:143-168`; `admin-actions.test.ts:158,280`. The allowlist also names the buyback for the closing sweep (BONDR-derived key) |
| T-06-11-03 | Tampering | simulation corrupting live coin state | mitigate | Shallow coin copy | closed | `admin-money.ts:73-74`; `admin-sim.test.ts:144` |
| T-06-11-04 | Repudiation | misleading preview for multi-step actions | mitigate | Later steps marked estimated; dialog says so | closed | `admin-sim.ts:147`; `apps/web/lib/admin-copy-sim.ts` estimatedNote; `admin-sim.test.ts:198` |
| T-06-11-05 | Tampering | action applied in the wrong state | mitigate | applies() at simulate and execute | closed | `admin-money.ts:69-70,105-109`; `admin-money.test.ts:133,208` |
| T-06-12-01 | Spoofing | body-supplied actor | mitigate | Body spread first, actor from the cookie last | closed | `app/api/admin/[op]/route.ts:71,78-81` |
| T-06-12-02 | Tampering | cross-site request to admin ops | mitigate | POST only, sameOrigin 403 before the cookie, SameSite=Strict | closed | `[op]/route.ts:84-87` (only POST exported); `session.ts:145`; `admin-locked.e2e.ts:38-42` |
| T-06-12-03 | Denial of service | console keeping Neon awake | mitigate | Only timer is /admin/health (memory), paused while hidden | closed | `apps/web/lib/use-health.ts:1-4,20-48`; `use-console.ts:2-3`; `e2e/admin-console.e2e.ts:68`; Neon `e2e/admin-neon.e2e.ts:19` |
| T-06-12-04 | Information disclosure | worker internals reaching the browser | mitigate | Only PASS codes; else worker_unavailable | closed | `lib/worker.ts:10,28-35`; local reads log code only `[op]/route.ts:45-52` |
| T-06-12-05 | Elevation of privilege | unforwarded worker route reachable from web | accept | Only FORWARD names reach the worker; unknown ops 404 | closed | Accepted risk AR-06-04 |
| T-06-13-01 | Spoofing | leaked WORKER_TOKEN replaying execute | mitigate | Signature against ADMIN_WALLET; single use; 2-minute expiry | closed | `admin-intent.ts:40,102-111`; `admin-money.test.ts:172` (403 stranger, 410, 409, no audit row) |
| T-06-13-02 | Elevation of privilege | funds to an attacker via a crafted action | mitigate | Allowlist from the coin's records; checked at simulate and in gated land before each send | closed | `admin-money.ts:71,75-81,158-160`; `admin-send.ts:15-26`; only send path is land `fee-send.ts:253-269`; `admin-money.test.ts:153,219` |
| T-06-13-03 | Repudiation | send with no record | mitigate | Pending audit row before the first send; one guarded settle; boot settles stale rows (WR-W-06) | closed | `admin-money.ts:97-111,171`; `admin-audit.ts:43-52,73-82`; `main.ts:93-95`; `admin-money.test.ts:187` |
| T-06-13-04 | Information disclosure | secrets in audit params or logs | mitigate | params hold `{ intent }` only; no signature or message logged | closed | `admin-money.ts:102,119`; the only admin logs are `admin-audit.ts:30` and `admin-send.ts:40` (redacted) |
| T-06-13-05 | Tampering | state drift between simulate and execute | mitigate | applies() re-checked; RPC preflight on every send; estimated steps | closed | `admin-money.ts:105-109`; `admin-money.test.ts:208` |
| T-06-13-06 | Denial of service | duplicate sends after an unknown result | mitigate | Never resent; unknown settles failed "unconfirmed" | closed | `admin-send.ts:50-53`; `admin-money.test.ts:236` |
| T-06-14-01 | Tampering | forged switch flips | mitigate | Cookie, sameOrigin, rate limit; worker gated() | closed | `[op]/route.ts:85-90`; `admin-routes.ts:108,127` |
| T-06-14-02 | Repudiation | unrecorded flip | mitigate | One audit row per flip; spec asserts it | closed | `admin-act.ts:36-41`; `e2e/admin-switch.e2e.ts:73,87` |
| T-06-14-03 | Information disclosure | audit params leaking to the browser | mitigate | Server-side params allowlist (job, enabled, wallet, wallets); sim trimmed to ok and cu | closed | `apps/web/lib/admin-audit-page.ts:16-30,60-61` |
| T-06-14-04 | Denial of service | shared switch state breaking parallel specs | mitigate | admin-serial project, workers 1, afterAll restore | closed | `playwright.config.ts:74-80`; `admin-switch.e2e.ts:17-30` |
| T-06-14-05 | Tampering | malformed audit cursor | mitigate | parseAuditCursor null, 400 | closed | `[op]/route.ts:58-61`; `admin-audit-page.ts:14`; `admin-switch.e2e.ts:133` |
| T-06-15-01 | Tampering | fork stage sending to mainnet | mitigate | Fork connection is the spike ctx.conn | closed | `scripts/spike/stages/engine-bond.ts:28-30` (`conn: run.ctx.conn`); used by `scripts/spike/stages/admin-steps.ts:54` |
| T-06-15-02 | Information disclosure | fork admin key | accept | Dev seed, fork only; never a deployed ADMIN_WALLET | closed | Accepted risk AR-06-05 |
| T-06-15-03 | Elevation of privilege | admin action to a non-allowlisted destination on fork | mitigate | Stage drives executeAction, so gatedDeps checks real txs; rules fail on non-landed audit | closed | `scripts/spike/stages/admin-steps.ts:88-115`; `scripts/spike/stages/admin.ts:133-137`; fork gate 99 ok after fixes (1a10d19) |
| T-06-16-01 | Information disclosure | W addresses and budgets | accept | Public on chain and on the token page | closed | Accepted risk AR-06-06 |
| T-06-16-02 | Denial of service | 500 rows rendered at once | mitigate | First 50 rows, Show all on click | closed | `apps/web/components/admin-wtable.tsx:27,184,221` |
| T-06-16-03 | Tampering | coin names with markup | mitigate | React text only | closed | No `dangerouslySetInnerHTML` anywhere in `apps/web/{app,components,lib}` (rg, zero matches) |
| T-06-17-01 | Tampering | forged hold or release | mitigate | Cookie, sameOrigin, rate limit; gated actor; audited | closed | `[op]/route.ts:85-90`; `admin-act.ts:56-75`; `admin-act.test.ts:126` |
| T-06-17-02 | Information disclosure | raw error text in the stuck box | mitigate | stuckErrorCopy maps codes with a generic fallback | closed | `admin-copy-actions.ts:94-98`; `components/admin-timeline-boxes.tsx:72`; `admin-copy-actions.test.ts:74-81` |
| T-06-17-03 | Tampering | malformed mint in the coin op | mitigate | BASE58_KEY 400 before any read | closed | `[op]/route.ts:65-67` |
| T-06-17-04 | Elevation of privilege | client applicability deciding what runs | accept | Client only greys buttons; worker re-checks applies() | closed | Accepted risk AR-06-07 |
| T-06-18-01 | Spoofing | client-built message tricking the owner | mitigate | Signs intent.message verbatim and shows it (WR-B-05); worker verifies stored text | closed | `apps/web/lib/use-sim.ts:106`; `components/admin-sim.tsx:116`; `e2e/admin-sim.e2e.ts:89` |
| T-06-18-02 | Tampering | send after a refused destination | mitigate | No send button unless ready with an intent; worker creates no intent | closed | `components/admin-sim-foot.tsx:86,91-110`; `admin-money.ts:81`; `admin-sim.e2e.ts:111` |
| T-06-18-03 | Repudiation | owner unsure what was sent | mitigate | TxLink per signature; DB panels reload after close | closed | `admin-sim-foot.tsx:13,26,34`; `apps/web/lib/use-console.ts:20-21,66` |
| T-06-18-04 | Denial of service | accidental devnet spend from specs | mitigate | stubSim catches every simulate, execute and intent call | closed | `apps/web/e2e/admin-stubs.ts:69-78`. It answers with fixtures instead of failing (Informational). Every spec that injects Phantom on an admin page registers it first (`admin-sim.e2e.ts:31-34`, `admin-evacuate.e2e.ts:57-64`) |
| T-06-18-05 | Information disclosure | raw RPC errors in the dialog | mitigate | adminErrorCopy maps codes; unknown falls back | closed | `apps/web/lib/admin-copy-sim.ts:47-53`; `admin-copy-sim.test.ts:18-28`; worker side `admin-send.ts:29-36` |
| T-06-19-01 | Tampering | hiding the wrong coin by a shared symbol | mitigate | Ambiguous symbols refuse with a count | closed | `admin-moderate.ts:115-126`; `admin-moderate.test.ts:46` |
| T-06-19-02 | Elevation of privilege | blocked deployer launching | mitigate | prepare admit checks blocked_deployers before any build | closed | `prepare.ts:132-147`; `admin-moderate.ts:66-73`; DB test `prepare.test.ts:173` |
| T-06-19-03 | Repudiation | unrecorded moderation | mitigate | One audit row per change | closed | `admin-moderate.ts:129,138-148`; `admin-moderate.test.ts:33,71,83` |
| T-06-19-04 | Denial of service | oversized reasons or queries | mitigate | Route length checks; DB CHECK 120 | closed | `admin-moderate.ts:101-105,155-160`; `admin-routes.ts:121-125`; `0007_admin.sql:26,44-45`; `admin-routes.test.ts:170` |
| T-06-20-01 | Tampering | forged moderation from another site | mitigate | Cookie, sameOrigin, rate limit; gated actor | closed | `[op]/route.ts:85-90`; `admin-routes.ts:121,127` |
| T-06-20-02 | Information disclosure | moderation reasons leaking publicly | mitigate | Reasons only in the console; public launch copy has no reason | closed | `components/launch-sign.tsx:64`; no hidden/held/blocked reason read outside `lib/admin-*` (rg) |
| T-06-20-03 | Repudiation | unrecorded moderation | mitigate | Spec asserts the audit row | closed | `e2e/admin-moderation.e2e.ts:49,80` |
| T-06-20-04 | Denial of service | shared moderation state in parallel specs | mitigate | admin-serial project; afterAll restores and fails on sign-in failure | closed | `playwright.config.ts:74-80`; `admin-moderation.e2e.ts:18-23` |
| T-06-21-01 | Tampering | malformed signature input | mitigate | base58 length check in the console and the worker route (400) | closed | `components/admin-inspect.tsx:17,88-90`; `admin-routes.ts:58-64,116`; `admin-routes.test.ts:184`. The web forwarder does not re-check, so the worker's 400 passes through |
| T-06-21-02 | Information disclosure | program ids or raw logs in the client bundle | mitigate | Worker returns labelled strings; bundle check script | closed | `admin-inspect.ts:1-3,114-137`; `scripts/check-client-bundle.sh:5`; `admin-inspect.test.ts:60` |
| T-06-21-03 | Denial of service | inspector spamming the RPC | mitigate | 60 per minute per wallet; one call per click | closed | `[op]/route.ts:89` |
| T-06-21-04 | Tampering | crafted tx data crashing the decoder | mitigate | Each decode wrapped | closed | `admin-inspect.ts:113-123`; `admin-inspect.test.ts:80,86` |
| T-06-22-01 | Elevation of privilege | funds moved anywhere but the treasury | mitigate | buildBatch pays only treasury and burns; gated land checks the signed allowlist (treasury, BONDR only) | closed | `admin-evacuate.ts:80-100,145-157,252-257`; `admin-evacuate.test.ts:148`; `admin-evacuate-exec.test.ts:158` |
| T-06-22-02 | Tampering | engine jobs racing the evacuation | mitigate | pauseAll first, engine.idle per batch, fresh balances | closed | `admin-evacuate.ts:236-247,260`; `switches.ts:62-72`; `admin-evacuate-exec.test.ts:105` |
| T-06-22-03 | Tampering | ledger rows dropped by sig-kind index | mitigate | 0007 index and memory mirror | closed | `0007_admin.sql:41`; `fee-ledger-memory.ts:17`; `admin-evacuate.test.ts:206` |
| T-06-22-04 | Repudiation | partial evacuation unrecorded | mitigate | Pending audit before first send; per-W ledger rows; intent counts; boot settle | closed | `admin-money.ts:115-122,131`; `admin-evacuate.ts:139-153,233-280`; `admin-evacuate-exec.test.ts:130,140` |
| T-06-22-05 | Denial of service | accidental EVACUATE on staging or mainnet | mitigate | Default simulate gives no intent; execute refused off devnet at boot and in the loop | closed | `env.ts:70-75`; `admin-evacuate.ts:219,228-231,253`; `admin-evacuate-exec.test.ts:166`; `admin-money.test.ts:273,292` |
| T-06-22-06 | Spoofing | leaked WORKER_TOKEN triggering EVACUATE | mitigate | Same take signature check | closed | `admin-money.ts:127-132`; `admin-intent.ts:102-111` |
| T-06-22-07 | Denial of service | EVACUATE simulate timing out | mitigate | 8 simulations at a time; 90 s forwarder timeout | closed | `admin-evacuate.ts:52-54,164-173`; `[op]/route.ts:38-42`; `admin-evacuate.test.ts:262` |
| T-06-23-01 | Tampering | accidental arm by autocorrect or Enter | mitigate | Exact match; autocorrect, autocomplete, spellcheck off; Enter prevented | closed | `apps/web/lib/admin-copy-evac.ts:7-10`; `components/admin-evacuate.tsx:173-177`; `e2e/admin-evacuate.e2e.ts:79,87` |
| T-06-23-02 | Spoofing | client-built EVACUATE message | mitigate | Signs intent.message verbatim; spec compares bytes | closed | `apps/web/lib/use-evacuate.ts:121`; `admin-evacuate.e2e.ts:104` |
| T-06-23-03 | Denial of service | spec pausing real switches | mitigate | All EVACUATE calls stubbed | closed | `admin-evacuate.e2e.ts:2,64`; `admin-stubs.ts:69-78` (answers, does not fail; Informational) |
| T-06-23-04 | Elevation of privilege | executing on a simulate-only deploy | mitigate | Button disabled without "on" and an intent; worker gives no intent in simulate mode | closed | `admin-evacuate.tsx:112,158`; `admin-evacuate.ts:219`; `admin-evacuate.e2e.ts:131` |
| T-06-24-01 | Tampering | EVACUATE moving staging W funds | mitigate | Mint overlap check; fails closed unless the only funded W is the seeded one (WR-E-05) | closed | `e2e/admin-devnet.e2e.ts:185-193,204`; `e2e/admin-devnet-steps.ts:84-101` |
| T-06-24-02 | Denial of service | switches left paused or evacuated_at set | mitigate | afterAll restores the snapshot through the route, then the DB, and asserts it | closed | `admin-devnet.e2e.ts:91-106`; `admin-devnet-steps.ts:147-170` |
| T-06-24-03 | Denial of service | devnet spend over budget | mitigate | Run cap 0.05 SOL asserted; phase total recorded | closed | `apps/web/e2e/devnet.ts:9`; `admin-devnet.e2e.ts:82-88`; phase total 0.004855 SOL (06-24-SUMMARY lines 115, 132). The cap is checked after spending (IN-E-04) |
| T-06-24-04 | Information disclosure | printing env values or keys | mitigate | Logs show SOL, mints, signatures, states only | closed | `admin-devnet.e2e.ts:77-86,111,119,150,187-209`; `admin-devnet-steps.ts:166` (settings booleans and timestamp) |
| T-06-24-05 | Spoofing | mainnet | mitigate | ADMIN_EVACUATE=on refused off devnet at boot and in the loop | closed | `env.ts:13-16,74`; `admin-evacuate.ts:230` |
| T-06-24-06 | Denial of service | Neon kept awake | mitigate | Console-open suspend check | closed | `e2e/admin-neon.e2e.ts:19`; 06-24-SUMMARY line 43 (idle with 49 health answers) |
| T-06-25-01 | Denial of service | specs spending devnet SOL | mitigate | simulate, execute, intent and inspect stubbed in the matrix | closed | `e2e/admin-responsive.e2e.ts:7,180,208,231`; `admin-stubs.ts:69-78` |
| T-06-25-02 | Tampering | seeded ledger rows left in the dev DB | mitigate | dropCoin in afterAll | closed | `admin-responsive.e2e.ts:285-287` |
| T-06-25-03 | Information disclosure | screenshots with secrets | accept | Stubbed fixtures and public devnet addresses | closed | Accepted risk AR-06-08 |
| T-06-26-01 | Elevation of privilege | staging admin open by default | mitigate | ADMIN_WALLET unset; locked spec proves 401, 403, not_configured | closed | `admin-locked.e2e.ts:38-50`; 06-26-SUMMARY lines 49, 71-72 (5 passed on staging) |
| T-06-26-02 | Information disclosure | variable values in logs or files | mitigate | Names only | closed | Procedural: 06-26-SUMMARY line 49; `.env.example:8,12,42,44` names without secrets |
| T-06-26-03 | Denial of service | staging engine paused by new switches | mitigate | Columns default true; boot log line | closed | `0007_admin.sql:35-38`; 06-26-SUMMARY line 60 |
| T-06-26-04 | Tampering | EVACUATE executable on staging | mitigate | ADMIN_EVACUATE unset (simulate); no admin configured | closed | `env.ts:71-72`; `admin-routes.ts:26`; 06-26-SUMMARY line 49 |
| T-06-26-05 | Denial of service | Neon budget | mitigate | Idle check after deploy; no timer reads | closed | Procedural: 06-26-SUMMARY lines 80-89 (both endpoints suspended) |
| T-06-26-06 | Spoofing | mainnet | mitigate | Staging on devnet; env.ts refuses mainnet | closed | `env.ts:13-16`; 06-26-SUMMARY line 59 (`worker listening on devnet`) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-06-01 | T-06-01-06 | Migration 0007 adds columns with defaults and two new tables, widens one CHECK and swaps one index for a wider one. The Phase 5 worker kept running on it. Staging applied it in web's pre-deploy in 06-26, and the old worker booted cleanly afterward. | Plan 06-01 threat model (owner-approved roadmap) | 2026-10-26 |
| AR-06-02 | T-06-08-02 | The worker has no public domain and is reachable only over Railway private networking. Health is non-sensitive memory. Each state change needs the actor (ADMIN_WALLET, a public key) and writes an audit row. Since WR-W-08, the legacy `/kill-switch` is audited as `runbook` and cannot re-enable launches after EVACUATE. Money still needs the owner's fresh signature. IN-W-04 (intent eviction by simulate spam) falls inside this accepted scope. | Plan 06-08 threat model | 2026-10-26 |
| AR-06-03 | T-06-10-02 | D-13 makes non-transaction actions session-only. A token holder could flip switches or hold and hide coins. Every change is audited and reversible, and nothing moves funds. | Plan 06-10 threat model (RESEARCH Security Domain) | 2026-10-26 |
| AR-06-04 | T-06-12-05 | Only the nine FORWARD names reach the worker (`[op]/route.ts:24-34,93`). Unknown ops answer 404, and `Object.hasOwn` blocks prototype keys. | Plan 06-12 threat model | 2026-10-26 |
| AR-06-05 | T-06-15-02 | The fork admin key (`sim:admin`) is derived from the dev master seed for the local Surfpool fork only. The e2e admin key is `admin:devnet:e2e`, and staging ships with ADMIN_WALLET unset. | Plan 06-15 threat model | 2026-10-26 |
| AR-06-06 | T-06-16-01 | W addresses and fee budgets are already public on chain and on the token page. The console is behind the admin cookie. | Plan 06-16 threat model | 2026-10-26 |
| AR-06-07 | T-06-17-04 | The client only greys buttons. The worker re-checks applies() at simulate and again at execute (`admin-money.ts:69,105`). | Plan 06-17 threat model | 2026-10-26 |
| AR-06-08 | T-06-25-03 | Responsive screenshots use stubbed fixtures and public devnet addresses only. | Plan 06-25 threat model | 2026-10-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

None. The SUMMARY `## Threat Flags` sections in 06-09, 06-11, 06-15, 06-16, 06-17, 06-24 and 06-26 all say "None", and each maps the items it mentions to existing threat IDs. 06-06, 06-13, 06-22 and 06-23 instead have a `## Threat mitigations` section mapped to their own IDs. The other summaries have no threat section. Several post-plan review fixes added attack surface or hardening, all inside existing threats:
- WR-B-03 domain line: T-06-03-02, T-06-05-03.
- WR-W-04 System deny-by-default: T-06-05-05.
- WR-W-08 audited legacy kill-switch: T-06-10-01, AR-06-02.
- WR-W-06 boot settle: T-06-13-03.
- CR-W-01 urgent EVACUATE: T-06-22-01/05. It also restores the break-glass path below the ops floor.

## Informational (not blockers; outside or beside the declared mitigations)

- **IN-B-02: TRUNCATE empties admin_audit.** The guard is a row trigger on UPDATE and DELETE. T-06-01-01 as declared holds. Smallest fix: a migration adding `CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_guard();`, which already raises for any TG_OP but the allowed UPDATE. Also revoke TRUNCATE from the app role.
- **IN-W-04: simulate spam can evict a live intent.** The T-06-05-06 cap drops the oldest entry whatever its state. This needs WORKER_TOKEN or the admin cookie and cannot move funds. Fix: evict expired, then executed entries, and refuse a new simulate with 429 instead of evicting a live unused intent (`admin-intent.ts:77`).
- **IN-B-01: an admin cookie cannot be revoked server-side.** It lasts 30 minutes from any client. Accepted for one owner in the review.
- **T-06-03-07 ordering.** The sign-in route now reads the body (capped at 16 KiB) before the rate limit, so sign-out bypasses the bucket. Signature checks and DB writes still sit behind the limit.
- **T-06-03-03 has no automated replay test.** Single use is enforced by the `consent_nonces` primary key and `returning()`. It would be cheap to add a DB-backed case or an e2e that verifies the same signature twice.
- **The stubs answer instead of failing.** The plan text for T-06-18-04, T-06-23-03 and T-06-25-01 says stubSim "fails on unstubbed calls". It actually answers every simulate, execute and intent call with fixtures (catch-all regex), so no call reaches the worker. The effect is the same. Only the mechanism differs from the plan.
- **Code changed after the last devnet run and staging deploy.** The devnet money spec ran in 06-24 and the staging deploy happened in 06-26, both before the review fixes (CR-E-01/02, WR-E-01..05, WR-B-03, CR-W-01 and others). The fixed devnet spec was not re-run, because that spends SOL. Staging and production workers need SITE_URL set before admin money actions work (they fail closed with 403 until then).
- **IN-E-04.** The 0.05 SOL run cap is checked after the spend, not before each spending step.
- **IN-B-07.** Re-arming EVACUATE stacks worker simulations, because the web does not pass the abort signal to the worker. This is admin-only RPC load.
- **IN-E-02.** The fork stage's `entryOf` searches all settled entries, not only the current action's. It is harmless in the current fork.json.

## Verification Run

`pnpm exec vitest run --project unit` on 31 non-database files passed: 31 files, 236 tests, run 2026-10-26. The files:
- Worker: admin-intent, admin-dest, admin-sim, admin-money, admin-evacuate, admin-evacuate-exec, admin-actions, admin-routes, admin-inspect, admin-leftover, admin-overview, health, sentry-count, env, switches, fee-engine-admin, fee-gate, fee-send-mint, fee-reconcile, fee-recover, http.
- Web: session, worker, admin-copy-actions/sim/evac/mod/audit, admin-applies, ledger-copy.
- Core: scrub.

The database-backed suites were not re-run, to keep Neon asleep: db-admin, admin-act, admin-audit, admin-moderate, fee-ledger, prepare. Their P0001, 23514 and 23505 cases and blocked-deployer case were read in source. No e2e, fork, devnet or staging run was made. No source file was changed, nothing was deployed and no SOL was spent.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-26 | 126 | 126 | 0 | gsd-security-auditor (Claude) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-26
