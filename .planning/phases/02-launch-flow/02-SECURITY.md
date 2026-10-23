---
phase: 02
slug: launch-flow
status: verified
threats_open: 0
asvs_level: 1
created: 2026-10-23
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register: every `<threat_model>` block of 02-01..02-18 PLAN.md (81 threats: 76 mitigate, 5 accept, 0 transfer).
> Evidence is code (file:line) or a test on branch phase-02-launch-flow at 758370c. Deployment-only mitigations cite
> 02-04, 02-14, 02-16, 02-17 and 02-18 SUMMARY evidence (Railway, Neon and Sentry were not called).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser -> web API | consent, quote, pin, prepare, submit, launch/{id}, status, coin page | untrusted JSON, multipart image, URL params, signed wire |
| Phantom extension -> page | Wallet Standard objects injected into the page | wallet address, signatures |
| web -> worker | Railway private network plus bearer token | launch fields, wallet from the session, signed wire |
| web -> Pinata | JWT-authenticated upload | public image and metadata JSON |
| worker -> devnet RPC | Helius URL carries the API key; ops key signs table txs | transactions, API key in URL |
| worker / web -> Postgres (Neon) | connection strings carry credentials | public keys, launch rows, consent rows |
| web, worker, browser -> Sentry | error events leave the platform | scrubbed error text |
| root .env -> web, Playwright | local secrets file shared with the worker | seed path, API keys, tokens |
| owner Mac -> Railway, Neon, Sentry | outward account creation, variables, deploys | seed, tokens |
| npm registry -> repo | dependency installs | package code |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-02-01-01 | I | apps/web imports | mitigate | biome.json:26-57 noRestrictedImports: web limited to pure core modules (math, rules, db, schema, api, scrub, sig), no @solana/*, @pump-fun/*, bn.js; core exports only `./*` (packages/core/package.json) | closed |
| T-02-01-02 | I | local web env | mitigate | apps/web/next.config.ts:9-28 WEB_ENV allowlist copies only listed names; no loadEnvFile anywhere in apps/web | closed |
| T-02-01-03 | S | every page | mitigate | apps/web/next.config.ts:31-36,56-58 X-Frame-Options DENY and CSP frame-ancestors 'none' on /:path* | closed |
| T-02-01-04 | T | renders | mitigate | biome.json:12 noDangerouslySetInnerHtml error; no dangerouslySetInnerHTML in apps/web | closed |
| T-02-01-SC | T | pnpm installs | mitigate | Exact pins in all package.json files; pnpm-workspace.yaml:8 minimumReleaseAge 1440 (plan fallback; 14-day D-14 age checked by hand, 02-01-SUMMARY deviation 2) | closed |
| T-02-02-01 | I | Playwright webServer env | mitigate | playwright.config.ts:6-14,58 passes only WEB_ENV names; no loadEnvFile; e2e/phantom.ts:53-64 reads secrets locally, never into process.env | closed |
| T-02-02-02 | T | terms copy | accept | See Accepted Risks AR-01 | closed |
| T-02-02-SC | T | pnpm installs | mitigate | package.json: @playwright/test 1.63.0, @axe-core/playwright 4.13.0 exact | closed |
| T-02-03-01 | T | insta-sell route | mitigate | packages/core/src/launch.ts:93,200 minSolOut parameter (default 1 only when unset); worker sets it (prepare.ts:202) | closed |
| T-02-03-02 | D | launch in 6107 window | mitigate | packages/core/src/launch.ts:102,115 AwaitingMigration; apps/worker/src/build.ts:41 maps it to paused; status.ts:108-115 | closed |
| T-02-03-03 | E | fork connect | accept | See AR-02 (packages/core/src/net.ts:8,37 refuses non-local fork hosts) | closed |
| T-02-04-01 | I | .env writes | mitigate | .gitignore:1 ignores .env; git grep finds no Postgres URL, Sentry DSN or JWT in tracked files; 02-04-SUMMARY (neonctl --no-secrets, values written in-process) | closed |
| T-02-04-02 | T | launches table | mitigate | packages/core/migrations/0000_init.sql: CHECK launches_state, launches_exit, settings_single_row (id = 1), unique index launches_landed_mint; 0001 launches_inflight_mint | closed |
| T-02-04-03 | D | Neon compute hours | mitigate | packages/core/src/db.ts:17 idle_timeout 20; kill switch held in memory (apps/worker/src/status.ts:176-188); settle polls only in flight; coin page cache (app/coin/[mint]/page.tsx:16-30) | closed |
| T-02-04-04 | E | outward account creation | mitigate | 02-04-SUMMARY owner approval checkpoint (Neon); 02-14-SUMMARY owner approval to create bondr-web and bondr-worker | closed |
| T-02-04-SC | T | pnpm installs | mitigate | drizzle-orm 0.45.3, postgres 3.4.9, drizzle-kit 0.31.11 exact | closed |
| T-02-05-01 | S | POST /api/consent | mitigate | app/api/consent/route.ts:21 sameOrigin, :25 json() (content-type gate, lib/guard.ts:22-43); e2e/consent.e2e.ts:124-139 (403 cross-site) | closed |
| T-02-05-02 | T | consent body | mitigate | route.ts:6,26 16 KB cap and BASE58_KEY; row written only after verifyConsent (lib/session.ts:65-76, Phantom signMessage over a sealed nonce, added by review CR-01) | closed |
| T-02-05-03 | I | address before consent | mitigate | Implementation changed from localStorage to a session read: components/wallet.tsx:68-82 GET /api/consent carries no address; e2e/consent.e2e.ts:30-32,53 records every request and asserts no leak before Accept | closed |
| T-02-05-04 | S | non-Phantom wallets | mitigate | components/wallet.tsx:52-61 isPhantom (name, signTransaction v0, chain, connect), used at :89 | closed |
| T-02-05-05 | R | consent record | accept | See AR-03 | closed |
| T-02-06-01 | S | worker routes | mitigate | apps/worker/src/http.ts:40-44 length check plus timingSafeEqual, :76 401; env.ts:40 token >= 32 chars; 02-16-SUMMARY worker has no domain | closed |
| T-02-06-02 | D | worker body parsing | mitigate | http.ts:8,46-61 16 KB cap with 413; status.ts:211-224 solIn 1..MAX_SOL_IN | closed |
| T-02-06-03 | I | logs and errors | mitigate | http.ts:83-84 redact() and 500 body `build_failed` only; every worker console.error of an error goes through redact (net.ts:10-14); web lib/worker.ts:28-31 rebuilds error bodies | closed |
| T-02-06-04 | E | network selection | mitigate | apps/worker/src/env.ts:10-19 launchNet refuses mainnet; status.test.ts:16 | closed |
| T-02-06-05 | I | balance lookup | mitigate | status.ts:241 balance only when a wallet is passed; components/launch-buy.tsx:51-52 sends wallet only when consented | closed |
| T-02-07-01 | T | link fields | mitigate | packages/core/src/rules.ts:51-67 normalizeLink refuses non-http(s) schemes, forces https, host allowlist | closed |
| T-02-07-02 | T | image upload (client) | mitigate | components/launch-coin.tsx:77-87 checkImage (magic bytes, 4 MB) plus decode; rules.ts:74-87 (SVG never matches) | closed |
| T-02-07-03 | T | name/description render | mitigate | React text only; biome.json:12; no dangerouslySetInnerHTML in apps/web | closed |
| T-02-07-SC | T | pnpm installs | mitigate | class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, radix-ui 1.6.7 exact; no apps/web/components.json (shadcn CLI not run) | closed |
| T-02-08-01 | I | WORKER_TOKEN | mitigate | apps/web/lib/worker.ts:3,17 server-only, the only non-e2e web file reading it | closed |
| T-02-08-02 | I | wallet in quote | mitigate | components/launch-buy.tsx:51-52,62 | closed |
| T-02-08-03 | S | POST /api/quote | mitigate | app/api/quote/route.ts:9,13 sameOrigin and json() | closed |
| T-02-08-04 | D | quote spam to RPC | mitigate | launch-buy.tsx:12,58 400 ms debounce; quote/route.ts:11 rateLimited 60/min per IP | closed |
| T-02-08-05 | T | paused state | mitigate | worker enforces: prepare.ts:142 liveStatus(ctx, true), :112 paused refusal; submit.ts:86-87 | closed |
| T-02-09-01 | I | mint secrets | mitigate | vanity_mints holds idx, pubkey, reservation columns only (0000_init.sql); keys derived (vanity.ts:18-19) | closed |
| T-02-09-02 | T | reservation races | mitigate | vanity.ts:76-103 single UPDATE with scalar FOR UPDATE SKIP LOCKED subquery, per-wallet reuse; :61-69 inFlight exclusion; :106-115 release guard | closed |
| T-02-09-03 | S | lane or seed mismatch | mitigate | vanity.ts:49-59 mintKeyFor re-derives and asserts; vanity.test.ts | closed |
| T-02-09-04 | D | pool exhaustion | mitigate | grind.ts:84-85 warn below 3, refill below 10; http.ts:26 pool_empty 503; launch-sign.tsx pool_empty copy; balance checked before reserve (prepare.ts:252-255) | closed |
| T-02-10-01 | T | uploaded file | mitigate | app/api/launch/pin/route.ts:64-65 early 413 on length; :75-76 checkImage magic bytes and 4 MB | closed |
| T-02-10-02 | D | Pinata quota | mitigate | pin/route.ts:67-70 rateLimited per IP and per session wallet (5/10 min), session (signed consent) required before parse | closed |
| T-02-10-03 | S | cross-site pin | mitigate | pin/route.ts:63 sameOrigin; e2e/pin.e2e.ts:53-55 | closed |
| T-02-10-04 | I | Pinata JWT | mitigate | pin/route.ts:81 only reader; lib/pinata.ts:36-42 PinError carries status only; not in next.config env | closed |
| T-02-10-05 | T | metadata fields | mitigate | pin/route.ts:45-59 rules.ts rerun server-side, links normalized; worker reruns (prepare.ts:87-99) | closed |
| T-02-10-06 | D | /api/consent spam | mitigate | app/api/consent/route.ts:23 rateLimited("consent", 10, 10 min) | closed |
| T-02-11-01 | D | ops rent drain | mitigate | prepare.ts:111-119 guard (pause, rules, consent, TABLE_CAP 30/h, WALLET_TABLE_CAP 10/day); :252-254 balance before reserve; :259-261 table reuse; build.ts:70-71 ops floor logged to Sentry; web prepare/route.ts:17 rate limit | closed |
| T-02-11-02 | T | launch contents | mitigate | build.ts:89-96 checkMessage allowlist (core/send.ts:25,63-67), signer layout, exitPresent; exit stored (prepare.ts:208-220) and enforced at submit (submit.ts:52) | closed |
| T-02-11-03 | I | seed, ops, mint keys | mitigate | derivation only in worker (prepare.ts:178, env.ts:63-64); response is unsigned wire and public data (prepare.ts:232-246) | closed |
| T-02-11-04 | E | creator fee | mitigate | core/launch.ts:68-69,155 creatorFeeFor(live Global); optsFor (prepare.ts:174-185) never takes it from the request | closed |
| T-02-11-05 | T | insta-sell price | mitigate | prepare.ts:53,126-129 sellFloor = simulated solBack less 300 bps, used at :202 | closed |
| T-02-12-01 | T | signed message | mitigate | core/cosign.ts cosign(): raw byte compare, Ed25519 verify of slot 0, exitPresent from stored exit, slot 1 recheck; build-time allowlist build.ts:89 | closed |
| T-02-12-02 | T | submit replay or race | mitigate | launches.ts:25-38 advance WHERE state = from; submit.ts:62-66,85 returns current state; 0001 launches_inflight_mint | closed |
| T-02-12-03 | R | launch outcome | mitigate | submit.ts:37,62-76 and settle.ts:88-105 persist signature or error on every transition | closed |
| T-02-12-04 | D | resend of unknown tx | mitigate | settle.ts:40-43 resend only signed with valid blockhash; :15-16,37 three history rechecks 10 s apart, then failed; :104 unknown never resent | closed |
| T-02-12-05 | E | launch while paused | mitigate | submit.ts:86-87 liveStatus(ctx, true) before cosign; status.ts:181-188 fresh DB read, missing row fails closed | closed |
| T-02-12-06 | T | wrong mint key | mitigate | submit.ts:51 mintKeyFor; vanity.ts:56-57 | closed |
| T-02-13-01 | I | GET /api/launch/{id} | mitigate | app/api/launch/[id]/route.ts:6,12 32-hex id; lib/launches.ts:8-23 public columns only (no message, signed_tx), :49 raw error mapped to a code; launches.ts:14 randomBytes(16) | closed |
| T-02-13-02 | S | POST submit | mitigate | app/api/launch/submit/route.ts:13-22 sameOrigin, rateLimited, session, json 4 KB, ownership check; worker cosign | closed |
| T-02-13-03 | T | reload double-sign | mitigate | components/launch-sign.tsx:133-134 restored id only polls, never re-signs; worker submit.ts:85 | closed |
| T-02-13-04 | S | clickjacking sign step | mitigate | next.config.ts:31-36 (same as T-02-01-03) | closed |
| T-02-13-05 | T | coin name in copy | mitigate | React text only; biome.json:12 | closed |
| T-02-14-01 | I | Sentry events | mitigate | core/scrub.ts:9-12,25-37 scrub and dataCollection; instrumentation.ts:14-20, instrumentation-client.ts:6-12, worker sentry.ts:9-26; no tracesSampleRate or replay; 02-14-SUMMARY real events show [addr] | closed |
| T-02-14-02 | I | seed in web env | mitigate | apps/web/instrumentation.ts:9-13 forbiddenEnv then process.exit(1); scrub.ts:16-20 (*_SEED, MASTER_SEED_FILE, helius_api_key, ...) | closed |
| T-02-14-03 | I | chain code in client | mitigate | scripts/check-client-bundle.sh markers on .next/static; 02-14-SUMMARY gate exited 0; Biome allowlist | closed |
| T-02-14-04 | D | sentry-test routes | mitigate | app/api/sentry-test/route.ts:10 404 unless SENTRY_TEST_ROUTE=1; worker main.ts:33 behind bearer (http.ts:76) | closed |
| T-02-14-SC | T | pnpm installs | mitigate | @sentry/node and @sentry/nextjs 11.4.0 exact | closed |
| T-02-15-01 | T | mint param | mitigate | app/coin/[mint]/page.tsx:14,33 base58 check before query; drizzle eq() parameterized (lib/launches.ts:64-65) | closed |
| T-02-15-02 | T | user metadata render | mitigate | components/coin-identity.tsx:25 https-only filter, :43 rel noopener; React text | closed |
| T-02-15-03 | I | deployer address | accept | See AR-04 | closed |
| T-02-15-04 | S | non-BONDR mint | mitigate | lib/launches.ts:64-65 landed rows only; page.tsx:51-52 notFound() | closed |
| T-02-16-01 | I | seed and API keys | mitigate | 02-16-SUMMARY: --stdin one name per call; web key listing has no MASTER_SEED, helius_api_key or *_SEED; boot guard instrumentation.ts:9-13 | closed |
| T-02-16-02 | S | worker exposure | mitigate | 02-16-SUMMARY: worker `railway domain list` returns []; WORKER_URL uses RAILWAY_PRIVATE_DOMAIN; http.ts:40-44 | closed |
| T-02-16-03 | E | mainnet by accident | mitigate | 02-16-SUMMARY SOLANA_NET=devnet on both services; env.ts:10-19 | closed |
| T-02-16-04 | T | staging/local mint collision | mitigate | 02-16-SUMMARY VANITY_LANE=staging; vanity.ts:16-19 lane in key id; env.ts:41-42 | closed |
| T-02-16-05 | D | Sentry test route | mitigate | 02-16-SUMMARY: variable deleted, route answers 404 after redeploy e977df47 | closed |
| T-02-16-06 | R | outward actions | mitigate | 02-16-SUMMARY "Owner approval (Task 1)": four approved steps | closed |
| T-02-17-01 | D | devnet ops spend in tests | mitigate | 02-17-SUMMARY: matrix stubbed (e2e/launch-stubs.ts), one staging launch, ops 2.8478 SOL above the 2.40 run floor | closed |
| T-02-17-02 | I | screenshots committed | accept | See AR-05 | closed |
| T-02-18-01 | E | staging redeploy | mitigate | 02-18-SUMMARY Task 1 owner approval before redeploy | closed |
| T-02-18-02 | T | real Phantom byte stability | mitigate | 02-18-SUMMARY Task 3: owner's real Phantom launch 3khSgMFG... finalized with 2 signers; cosign fails closed (core/cosign.ts) | closed |
| T-02-18-03 | R | sign-off | mitigate | 02-18-SUMMARY Task 3: answer, signature and Phantom warning text recorded | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*
*Category: S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-02-02-02 | Terms copy is static, server-rendered; the owner reviewed it at sign-off (D-07, 02-18-SUMMARY Task 3) | owner (02-02 plan) | 2026-10-23 |
| AR-02 | T-02-03-03 | Spike fork connect: net.ts already refuses non-local fork hosts and non-Surfpool RPCs (packages/core/src/net.ts:8,37) | owner (02-03 plan) | 2026-10-23 |
| AR-03 | T-02-05-05 | Consent row stores time and terms version only; a hobby project needs no stronger repudiation proof (AGENTS.md legal minimum). Since review CR-01 the row is also backed by a verified Phantom signature, though the signature is not stored | owner (02-05 plan) | 2026-10-23 |
| AR-04 | T-02-15-03 | The deployer address is public on chain and shown short; it is part of the proof the coin page exists to show | owner (02-15 plan) | 2026-10-23 |
| AR-05 | T-02-17-02 | Committed screenshots show devnet test data and short public addresses only | owner (02-17 plan) | 2026-10-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

None. Every SUMMARY `## Threat Flags` section reports "none beyond the plan's threat model" and maps each claim to a registered ID (02-01, 02-02, 02-03 and 02-18 have no section).

Informational, outside the register (from 02-REVIEW-web.md and 02-REVIEW-worker-core.md, status open, not blockers here):
- Review fixes added surface after the plans: consent nonce plus signMessage, the HMAC session cookie and the pin proof (apps/web/lib/session.ts). They harden T-02-05-01/02, T-02-10-02 and T-02-11-01. The spent-nonce set is per-process memory (ponytail comment session.ts:53-54): a restart allows replay of a captured signature until its 5-minute nonce expires.
- web IN-03: the CSP sets only frame-ancestors. IN-05: public GET reads have no rate limit. IN-06: /api/sentry-test is a GET (gated by SENTRY_TEST_ROUTE, unset on staging).
- worker-core IN-02: the awaiting-migration pause fails open in submit when the chain read fails (the kill switch still fails closed). IN-07: a bad concurrent submit can fail a prepared row (no double send).
- web WR-03: closed. Verified on staging (02-16): Railway's edge overwrites a client-sent X-Real-IP; 12 requests with forged IPs got 429 from the 11th.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-23 | 81 | 81 | 0 | gsd-security-auditor (claude-opus-5-5) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-23
