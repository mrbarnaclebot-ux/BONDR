---
phase: 07
slug: go-live
status: secured
threats_total: 131
threats_closed: 131
threats_open: 0
asvs_level: 1
block_on: open
register_authored_at_plan_time: true
created: 2026-10-26
---

# Phase 07 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

This audit checked each mitigation against the code at `f1769cb` on `phase-07-go-live`. That commit includes every review fix listed in 07-REVIEW-worker.md, 07-REVIEW-web.md and 07-REVIEW-ops.md. Nothing in the summaries was taken on trust. File:line references point at the current tree. Where a review fix changed how a mitigation works, the evidence cites the code after the fix: CR-W-01, CR-W-02, CR-W-03, WR-W-01, WR-W-02, WR-W-03, WR-B-01, WR-B-02, IN-B-01, CR-O-01..05, WR-O-01..04 and IN-O-06. Unless a path is given, files are under `apps/worker/src/`, `apps/web/`, `packages/core/` or `scripts/`.

Owner-gate plans 07-26..07-36 have not run yet, and production does not exist. Their threats are marked **closed (documented, owner-executed)** when three things hold:
- the runbook (`apps/worker/PRODUCTION.md`) and the gate plan both state the step;
- where a script or the boot code can enforce the step, it does;
- no runbook step contradicts the mitigation.

Plan 07-25 (the merge and the evidence map) has not run either: there is no 07-25-SUMMARY.md and no PR.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| chain -> worker ingest | Any wallet can send a transaction mentioning BONDR, including v1 and later versions | transactions, logs |
| internet -> web proxy | Host, x-forwarded-host and path are attacker-controlled | headers, path |
| deploy config -> worker boot | Env decides the network, the treasury, EVACUATE, the lane and genesis mode | public keys, flags, seed |
| worker -> RPC and Helius Sender | URLs carry the Helius key. Error text comes back | api key (secret), signed tx bytes |
| pump programs -> BONDR | Pump can redeploy. BONDR builds against its layouts and fees | account data, fee config |
| creator -> worker prepare | The symbol and fields are attacker-chosen | ticker, metadata, wallet |
| web cookie -> worker actor | The genesis and admin actor comes only from a sealed admin cookie | admin wallet (public) |
| worker -> web forwarder -> browser | Only contract fields may cross | error codes, retryAfter, lock, reason |
| operator shell -> Railway CLI | deploy.sh and env-diff run with the operator's Railway login | variable values (must never print) |
| GitHub Actions -> repo | CI runs repo code with no secrets | none |
| owner -> Railway, Phantom, billing | Seed, treasury, real SOL, plan changes | seed (owner only), public keys, SOL |

---

## Threat Register

Status: 130 closed, 1 open. Disposition counts: 122 mitigate, 9 accept, 0 transfer.

### Plans 07-01 to 07-25 (code and autonomous steps)

| Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-----------|----------|-----------|-------------|------------|--------|----------|
| T-07-01-01 | Denial of service | ingestOrKeep retry loop | mitigate | -32015 dropped after one call | closed | `ingest.ts:185-186,193`; `ingest-retry.test.ts:9-16` (failedSigs stays empty; a flaky error is still kept, :25) |
| T-07-01-02 | Tampering | fetched v1 messages | mitigate | v1 is read only. checkMessage refuses non-v0 for every BONDR build | closed | `send.ts:67-68,275`; `send.test.ts:39-55`. Nothing in src serializes a fetched message |
| T-07-01-03 | Information disclosure | capture-tx output | mitigate | Writes only the tx JSON; fixture holds no api-key | closed | `capture-tx.ts:47-57` (`wx` flag, response only); a grep for `api-key` over `packages/core/src/fixtures/` finds nothing |
| T-07-01-04 | Repudiation | v1 coin trades missing | mitigate | version 1 at the shared fetchTx; v1 fixture equals the v0 parse | closed | `send.ts:145-152`; `admin-inspect.ts:159`; `trades.test.ts:213,237` |
| T-07-02-01 | Repudiation | admin_audit wiped by TRUNCATE | mitigate | Statement trigger plus REVOKE | closed | `migrations/0008_go_live.sql:8-14`; `db-admin.test.ts:186-194` (42501, then P0001 after a re-grant). Limit: IN-B-06 (Informational) |
| T-07-02-02 | Tampering | sniped_bps out of range | mitigate | CHECK 0..10000 | closed | `0008_go_live.sql:4`; `db-admin.test.ts:196-205` (23514) |
| T-07-02-03 | Denial of service | intent eviction by simulate spam | mitigate | Sweep expired, evict used, else 429 | closed | `admin-intent.ts:74-82`; `admin-intent.test.ts:173,180,190` |
| T-07-02-04 | Spoofing | replayed admin sign-in | mitigate | Single-use nonce; e2e replay gets 401 | closed | `e2e/admin-signin.e2e.ts:91-110`; nonce PK from Phase 6. The e2e was not run here |
| T-07-02-05 | Denial of service | migration on the shared dev branch | accept | Additive nullable columns, a partial index, a trigger | closed | AR-07-01 |
| T-07-03-01 | Spoofing | open redirect through Host or x-forwarded-host | mitigate | Exact `www.` match; Location built from SITE_URL origin fields | closed | `proxy.ts:16-32` (after WR-B-01 and IN-B-01); `proxy.test.ts:17-45` (forged hosts, `//evil.example`, `/\evil.example`) |
| T-07-03-02 | Denial of service | rate limit widened by the new matcher | mitigate | READ_PATHS keeps the seven paths | closed | `proxy.ts:10,40`; `proxy.test.ts:48-58` (/launch never limited) |
| T-07-03-03 | Repudiation | consent to outdated terms | mitigate | One TERMS_VERSION bump, named in the consent text | closed | `lib/terms.ts:2,12`; bump commit 34ccc90 |
| T-07-03-04 | Information disclosure | contact address | accept | Public forwarding address (D-17) | closed | AR-07-02 |
| T-07-04-01 | Elevation of privilege | mainnet reached from a dev box or tunnel | mitigate | connect refuses a local host or wrong genesis for mainnet; fork must be local plus Surfpool | closed | `net.ts:22-26,46-62`; `net.test.ts:71-96`. The local-host-mainnet branch has no direct test (Informational) |
| T-07-04-02 | Tampering | seed leak drains to a derivable treasury | mitigate | TREASURY_PUBKEY required, on curve, not any derived role | closed | `env.ts:75-91` (every lane's buyback, IN-W-01); `env.test.ts:54-84` |
| T-07-04-03 | Elevation of privilege | EVACUATE executable on the wrong net | mitigate | evacuateAllowed shared by boot and the loop | closed | `env.ts:95-105,149`; `admin-evacuate.ts:220,233`; `env.test.ts:95-102`; `admin-evacuate.test.ts:264-272`; `admin-evacuate-exec.test.ts:175-176` |
| T-07-04-04 | Information disclosure | treasury values in boot errors | mitigate | Errors name the variable only | closed | `env.ts:78-87`; `env.test.ts:61-82` (`not.toContain(v)`) |
| T-07-04-05 | Spoofing | mainnet ids colliding with devnet ids | mitigate | Net in the HMAC domain | closed | `keys.ts:10-11`; `keys.test.ts:23-27` |
| T-07-05-01 | Information disclosure | Helius key in the Sender URL | mitigate | URL built per call; errors redacted | closed | `fee-send.ts:131-139,163-165`; `fee-send.test.ts:164-169` |
| T-07-05-02 | Denial of service | keyless Sender 1/s per IP | mitigate | api-key on every Sender POST | closed | `fee-send.ts:138-139`; `fee-send.test.ts:149,159` |
| T-07-05-03 | Denial of service | Helius 429s with paceMs 0 | mitigate | paceMs 1100 on every net | closed | `fee-config.ts:39`; `fee-config.test.ts:5-14` |
| T-07-05-04 | Tampering | ops drained below recovery needs | mitigate | Mainnet floor 0.1 SOL pauses non-urgent sends and new tables | closed | `fee-config.ts:40`; `fee-send.ts:101-106`; `fee-batch.ts:164`; `build.ts:76`; `fee-send.test.ts:214` |
| T-07-06-01 | Spoofing | users told devnet while on mainnet | mitigate | /status reports env.net; mainnet web build shows no badge | closed | `main.ts:78`; `status.ts:195`; `status.test.ts:81`; `components/chrome.tsx:8,59,71`; `instrumentation.ts:14-18` (exact SOLANA_NET, WR-O-03); mainnet build probe 07-06-SUMMARY:38,52-54 |
| T-07-06-02 | Denial of service | empty production pool | mitigate | production REFILL 100/150 | closed | `grind.ts:75-83`; `grind.test.ts:5-7` |
| T-07-06-03 | Tampering | lane typo reusing mint ids | mitigate | VANITY_LANE takes three values only | closed | `env.ts:128-130`; `env.test.ts:104-106` |
| T-07-06-04 | Denial of service | Neon woken by refill | accept | Refill runs at boot and after a reservation only | closed | AR-07-03 |
| T-07-07-01 | Spoofing | copy implying snipe protection | mitigate | Verbatim D-36 copy; forbidden phrases rejected | closed | `app/coin/[mint]/page.tsx:141-145,170`; `e2e/coin-sniped.e2e.ts:13-15,39` |
| T-07-07-02 | Tampering | dev or W buys counted as sniping | mitigate | Query excludes launches.wallet and launches.w | closed | `sniped.ts:48-53`; `ingest.test.ts:198-205` (dev and W buys give 1 bps from one sniper unit only) |
| T-07-07-03 | Denial of service | Neon woken by recomputes | mitigate | Recompute only inside ingest, triggered by window trades; no timer | closed | `sniped.ts:18-26,42-63`; `ingest.ts:107`. After WR-B-02 a trade past the window also triggers it once |
| T-07-07-04 | Repudiation | figure rounded down to 0% | mitigate | ceil to whole bps | closed | `sniped.ts:36-40`; `ingest.test.ts:205` (1 base unit gives 1 bps). WR-B-02: null until the window closes, so no early 0% (`e2e/coin-sniped.e2e.ts:48-53`) |
| T-07-08-01 | Tampering | pump layout or fee change | mitigate | Sizes, owners, discriminators, decode and fee facts judged per profile | closed | `contract.ts:53,71-138`; `contract.test.ts:52-104`; CR-W-02 decode failures are facts: `contract-gather.test.ts:47-71` |
| T-07-08-02 | Denial of service | devnet profile pausing staging | mitigate | Measured devnet profile passes | closed | `contract.test.ts:52-55`; live devnet run 07-08-SUMMARY:49-53; staging log 07-24-SUMMARY:57 |
| T-07-08-03 | Spoofing | malicious RPC returning fake accounts | accept | Same trust as every read; authenticated Helius behind the genesis guard | closed | AR-07-04 |
| T-07-08-04 | Information disclosure | runner output | mitigate | Prints facts and slots only; errors redacted | closed | `scripts/contract-check.ts:19,24`; 07-08-SUMMARY:53 (no `api-key`) |
| T-07-09-01 | Tampering | tip moved or added after signing | mitigate | Tip compiled at prepare; cosign byte compare | closed | `prepare.ts:133-137`; `build.ts:87-106`; `cosign.ts:30`; `submit.ts:51-60,119-120` |
| T-07-09-02 | Denial of service | oversized tipped launch | mitigate | Tip dropped over PACKET_LIMIT; sent over RPC | closed | `build.ts:103-108`; `build.test.ts:77`; `submit.ts:72` |
| T-07-09-03 | Denial of service | Sender rejection leaves a launch hanging | mitigate | One RPC send of the same bytes | closed | `submit.ts:71-80`; `submit.test.ts:115`. CR-W-01: a rejected RPC copy keeps Sender's unknown (`submit.test.ts:126`; `settle-flow.test.ts:46`) |
| T-07-09-04 | Tampering | double execution from the fallback | mitigate | Identical bytes share one signature | closed | `submit.ts:78` sends the same `wire`; `submit.test.ts:115-125` |
| T-07-09-05 | Information disclosure | undisclosed creator cost | mitigate | Sender tip row and balance check | closed | `components/launch-receipt.tsx:62-66`; `components/launch-buy.tsx:32-37`; `prepare.ts:196`; `e2e/launch-tip.e2e.ts:24-54`. Edge: IN-W-04 (Informational) |
| T-07-10-01 | Tampering | jobs keep sending after a pump change | mitigate | Mismatch turns every switch off; engine gated on contractFailed | closed | `contract-check.ts:80-107`; `fee-boot.ts:73`; `contract-check.test.ts:58`; `fee-boot-gate.test.ts:13`; retried write `contract-check.ts:61-77`, test :134 |
| T-07-10-02 | Denial of service | mismatch marking the platform evacuated | mitigate | switchesOff writes no evacuated_at | closed | `switches.ts:67-75`; `switches.test.ts:143-160` |
| T-07-10-03 | Repudiation | automatic pause without a trace | mitigate | One admin_audit row with the facts plus a Sentry error | closed | `contract-check.ts:67-69,81`; `sentry.ts:21` (captureConsole warn and error); `contract-check.test.ts:58-75` |
| T-07-10-04 | Elevation of privilege | anyone triggering checks | mitigate | Route inside gated() | closed | `admin-routes.ts:25-29,111`; `admin-routes.test.ts:105-111` (403 for another actor) |
| T-07-10-05 | Denial of service | check never runs in genesis or engine-off mode | mitigate | Own timer, separate from scheduleBatch | closed | `contract-check.ts:134-142`; `main.ts:81-84`. WR-W-01 moved the wiring before enterGenesis and any route: stricter than the plan's "listening handler" |
| T-07-10-06 | Denial of service | flaky RPC pausing everything | mitigate | An RPC throw is "could not run" | closed | `contract-check.ts:90-96`; `contract-check.test.ts:116`; RPC errors still reject `contract-gather.test.ts:71`. On mainnet "could not run" blocks launches and the engine (WR-W-01, `contract-check.ts:136`, test :151) but writes no switch |
| T-07-11-01 | Elevation of privilege | Run check now from a non-admin | mitigate | Same-origin, cookie, actor spread last; worker gated() | closed | `app/api/admin/[op]/route.ts:24-26,80-98`; `admin-routes.ts:25-29` |
| T-07-11-02 | Spoofing | status by color alone | mitigate | Every state is a word; dot aria-hidden | closed | `lib/admin-copy-health.ts:157-173`; `components/admin-health.tsx:47` |
| T-07-11-03 | Denial of service | Neon woken by an open admin tab | mitigate | Cell reads the memory-backed health poll | closed | `health.ts:7,56` (contractState from memory); `components/admin-health.tsx:109-111` |
| T-07-11-04 | Information disclosure | facts in the browser | accept | Public chain data | closed | AR-07-05 |
| T-07-12-01 | Information disclosure | raw worker fields reaching the browser | mitigate | Rebuilt body: finite retryAfter, two-value lock, three known reasons | closed | `lib/worker.ts:14-25,40-45`; `lib/worker.test.ts:34-58` |
| T-07-12-02 | Tampering | malformed retryAfter | mitigate | Non-finite dropped; copy falls back | closed | `lib/worker.ts:22`; `lib/ticker-copy.ts:28`; `lib/worker.test.ts:51-58`; `lib/ticker-copy.test.ts:30` |
| T-07-12-03 | Spoofing | retrying a refused ticker in a loop | mitigate | action null on both ticker faults | closed | `lib/launch-faults.ts:75-76`; `lib/ticker-copy.ts:28-29` names the wait |
| T-07-13-01 | Spoofing | vamp coin reusing a fresh ticker | mitigate | 24h lock from landing, by normalized symbol | closed | `ticker.ts:15-43`; `prepare.ts:62,71,81-82`; `ticker.test.ts:75,127` (DB, read in source) |
| T-07-13-02 | Spoofing | case, $, whitespace, homoglyphs | mitigate | checkSymbol A-Z0-9 uppercase before the read | closed | `rules.ts:31-36`; `prepare.ts:62,71` |
| T-07-13-03 | Tampering | two prepares racing for one ticker | mitigate | Single-flight queue; ponytail names the upsert | closed | `prepare.ts:227-237`; `ticker.ts:20-21` |
| T-07-13-04 | Denial of service | refused prepares spending tables or reservations | mitigate | Refusals before caps, balance, reservation, table | closed | `prepare.ts:78-82` (before prepareGuard and reserveMint); `prepare.test.ts:225-264` (no reservation) |
| T-07-13-05 | Denial of service | squatting with prepared rows | mitigate | Prepared rows hold others 3 minutes, never the same wallet | closed | `ticker.ts:37-38`; `ticker.test.ts:109` |
| T-07-13-06 | Spoofing | impersonating BONDR or stablecoins | mitigate | Reserved list for children; genesis has its own path | closed | `rules.ts:40-44`; `prepare.ts:80`; `genesis.ts:82` pins BONDR (IN-W-03); `prepare.test.ts:225` |
| T-07-13-07 | Tampering | stale in-flight row freeing the ticker | mitigate | Any holding row refuses; retryAfter clamped at 0 | closed | `ticker.ts:36,49-56`; `ticker.test.ts:96-104` (10-minute unknown row) |
| T-07-14-01 | Tampering | SQL injection through q | mitigate | Only drizzle sql parameters | closed | `lib/coins.ts:34-36,64-66,88-90` (bound values, no concatenation) |
| T-07-14-02 | Spoofing | vamp ranked above the original | mitigate | Exact matches oldest first with First; hidden excluded | closed | `lib/coins.ts:63-76`; `packages/core/src/coin-row.ts:151`; `e2e/search-first.e2e.ts:32,49` |
| T-07-14-03 | Spoofing | marker read as endorsement | mitigate | Plain "First" plus "launched with this ticker" | closed | `components/coin-card.tsx:190-194` |
| T-07-14-04 | Denial of service | extra count query per list read | mitigate | No count query | closed | `lib/coins.ts:85-94` (one read, LIST_PAGE + 1) |
| T-07-15-01 | Tampering | genesis dev buy kept | mitigate | Burn in the same tx equal to the buy | closed | `launch.ts:181-190`; `launch-genesis.test.ts:90-99`, exitPresent :101 |
| T-07-15-02 | Tampering | genesis creator not the treasury | mitigate | creator = treasury; boot re-checks | closed | `launch-genesis.test.ts:59-70`; `genesis-boot.ts:53-58` |
| T-07-15-03 | Information disclosure | treasury on the public status | accept | Public key by design | closed | AR-07-06 |
| T-07-15-04 | Denial of service | status crash on null quote mint | mitigate | Q-null branch skips fetchPumpQuote | closed | `status.ts:164`; `status.test.ts:101-110` |
| T-07-16-01 | Elevation of privilege | stranger making the genesis launch | mitigate | actor = wallet = ADMIN_WALLET; web sets actor from the cookie | closed | `genesis.ts:62-67`; `genesis.test.ts:57,63`; `app/api/launch/prepare/route.ts:10,24-28` |
| T-07-16-02 | Tampering | a second genesis | mitigate | genesis_landed read before building (in-flight states count) | closed | `genesis.ts:38-45,70`; `genesis.test.ts:93`. Limit: IN-W-02 (Informational) |
| T-07-16-03 | Tampering | dev buy kept | mitigate | burn only | closed | `genesis.ts:69,95`; `genesis.test.ts:87` |
| T-07-16-04 | Elevation of privilege | genesis bypassing a failed contract check | mitigate | contractFailed in prepare and submit | closed | `genesis.ts:72`; `submit.ts:112`; `submit.test.ts:161` |
| T-07-16-05 | Spoofing | genesis tx without consent records | mitigate | consented checked before any build | closed | `genesis.ts:68`; `genesis.test.ts:73` |
| T-07-17-01 | Spoofing | wrong or copycat BONDR_QUOTE_MINT | mitigate | verifyQuoteMint: SOL quote, creator = treasury | closed | `genesis-boot.ts:53-58`; `main.ts:88`; `genesis-boot.test.ts:56` |
| T-07-17-02 | Elevation of privilege | jobs in or right after genesis mode | mitigate | enterGenesis writes switches off with an audit row; no engine; trade and fee routes not_ready | closed | `genesis-boot.ts:18-46`; `main.ts:87,107`; `genesis-boot.test.ts:32,83` (DB). WR-W-02: no switch-on in genesis `switch-gate.ts:27`, `switch-gate.test.ts:25,49` |
| T-07-17-03 | Tampering | devnet without a quote mint | mitigate | devnet requires the variable | closed | `env.ts:113-122`; `env.test.ts:109-114` |
| T-07-17-04 | Denial of service | BONDR coin ingested as a child | mitigate | settle skip and backfill exclusion | closed | `settle.ts:25-27,105` (keyed on the row after WR-W-03); `ingest.ts:255-263`; `settle-flow.test.ts:61`; `ingest.test.ts:230` |
| T-07-18-01 | Spoofing | actor forged in the body | mitigate | FIELDS excludes actor; actor spread last from adminSession | closed | `app/api/launch/prepare/route.ts:10,24-28`. No web unit test; the worker check is tested (`genesis.test.ts:63`) |
| T-07-18-02 | Elevation of privilege | owner variant shown to a stranger | mitigate | Server-side adminSession; worker refuses others | closed | `app/launch/page.tsx:12,26`; `genesis.ts:67` |
| T-07-18-03 | Information disclosure | admin wallet in the page | mitigate | Only a boolean crosses | closed | `app/launch/page.tsx:12,26` (`ownerGenesis={owner}`) |
| T-07-18-04 | Tampering | owner skipping the reserved check for a child | accept | UI-only bypass in genesis; worker refuses reserved tickers for every child prepare | closed | AR-07-07 |
| T-07-19-01 | Information disclosure | secrets in CI | mitigate | No secrets block; throwaway Postgres | closed | `.github/workflows/ci.yml:1-62` (no `secrets.` reference; `permissions: contents: read`; `persist-credentials: false` after IN-O-06) |
| T-07-19-02 | Tampering | third-party actions | mitigate | Official actions by major version; official postgres image | closed | `ci.yml:20,29,32,33,56`. SHA pinning skipped (IN-O-06, Informational) |
| T-07-19-03 | Denial of service | CI waking Neon | mitigate | Postgres container only | closed | `ci.yml:18-27,40-43` |
| T-07-19-04 | Repudiation | a red main branch | mitigate | CI on push and pull_request; green CI before G-1 | closed | `ci.yml:7-9`; `deploy.sh:49-51` refuses production without a green ci.yml run for the exact SHA (CR-O-05). CI has never executed (WR-O-05, GitHub billing): see Informational |
| T-07-20-01 | Information disclosure | env-diff printing secrets | mitigate | Values never reach node (stronger than the planned hashing) | closed | `env-diff.ts:9-15,37-62`; `env-diff.test.ts:115,124,152,168` |
| T-07-20-02 | Tampering | accidental production deploy | mitigate | main only, clean tree, typed prompt or --yes, dry run | closed | `deploy.sh:36-52,77-89` (also project pin, origin/main and CI, CR-O-04/05) |
| T-07-20-03 | Denial of service | worker before a migration | mitigate | Web first when migrations changed or no tag | closed | `deploy.sh:55-66` (`--only worker` refused, WR-O-01) |
| T-07-20-04 | Repudiation | unknown production revision | mitigate | Tag moved only after full success | closed | `deploy.sh:69-72,121` (tags the start SHA, WR-O-02) |
| T-07-21-01 | Tampering | rehearsal diverging from production | mitigate | Stage calls production functions; only DB and reservation injected | closed | `scripts/spike/stages/genesis.ts:8-9,25-29,69-90,108,118,170,183` |
| T-07-21-02 | Information disclosure | Helius key in fork logs or results | mitigate | redact on messages and on the results file | closed | `scripts/spike/run.ts:20`; `scripts/spike/results.ts:56-61` |
| T-07-21-03 | Spoofing | treasury derived in rehearsal | mitigate | Fresh in-memory keypair | closed | `scripts/spike/stages/genesis.ts:231-236` |
| T-07-22-01 | Information disclosure | secrets in docs | mitigate | Names only | closed | `PRODUCTION.md:3,20-60`; a grep of PRODUCTION.md, the READMEs, `.env.example` and the phase docs for keys, JWTs and DSN passwords finds none |
| T-07-22-02 | Repudiation | incident handled ad hoc | mitigate | D-38 runbook | closed | `PRODUCTION.md:167-175` |
| T-07-22-03 | Elevation of privilege | seed handled by Claude | mitigate | Owner generates and sets MASTER_SEED | closed | `PRODUCTION.md:58,122,173` (on the phone, never the Mac, CR-O-02) |
| T-07-23-01 | Information disclosure | screenshots with real addresses | mitigate | Stubs, test keys, synthetic mints | closed | `e2e/fixtures.ts:66` (fakeMint); `e2e/golive-responsive.e2e.ts:17,172` |
| T-07-23-02 | Denial of service | admin health rate limit flaking the matrix | mitigate | Per-test IP and the admin project | closed | `e2e/golive-responsive.e2e.ts:30`; `playwright.config.ts:28-33` |
| T-07-24-01 | Information disclosure | variables in logs or summaries | mitigate | Booleans and known log lines only | closed | Procedural: 07-24-SUMMARY:36-38,55-60 (booleans only, no value) |
| T-07-24-02 | Denial of service | Neon quota spent by regression runs | mitigate | One run per matrix; idle check | closed | Procedural: 07-24-SUMMARY:80-83 (both endpoints suspended) |
| T-07-24-03 | Tampering | staging on mainnet | mitigate | SOLANA_NET=devnet, no ALLOW_MAINNET; log names the net | closed | 07-24-SUMMARY:38,56; `env.ts:12-21` |
| T-07-25-01 | Tampering | broken code reaching main | mitigate | Merge only after test.sh --full and CI green | closed | Documented, not yet executed: `07-25-PLAN.md` Task 2 action and verify (`gh run list ... conclusion == success`). No branch protection is available (private repo, free plan: the API answers 403). Nothing auto-deploys from main, and `deploy.sh:43-51` refuses any production SHA without green CI, so a red main cannot reach mainnet |
| T-07-25-02 | Repudiation | a decision with no proof | mitigate | Evidence map row per decision | closed | `07-25-SUMMARY.md` "Evidence map: decisions" maps D-01..D-44 to evidence, alongside the ROADMAP criteria and requirements maps |

### Plans 07-26 to 07-36 (owner gates)

| Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-----------|----------|-----------|-------------|------------|--------|----------|
| T-07-26-01 | Information disclosure | staging secrets in production | mitigate | Empty env, explicit variables; env-diff fails on an equal must-differ secret | closed (documented, owner-executed) | `PRODUCTION.md:13,22`; `env-diff.ts:70,100`; `env-diff.test.ts:52,61`; `07-26-PLAN.md:119,122` |
| T-07-26-02 | Elevation of privilege | copied worker with staging's seed | mitigate | No --duplicate; no MASTER_SEED; worker deployment list empty | closed (documented, owner-executed) | `PRODUCTION.md:13,112`; env-diff g1 needs MASTER_SEED absent `env-diff.ts:89`; `07-26-PLAN.md:122` (deployment list length 0) |
| T-07-26-03 | Information disclosure | secrets in the transcript | mitigate | stdin pipes; owner pastes pinata_jwt; env-diff facts only | closed (documented, owner-executed) | `PRODUCTION.md:15,22-34,45,61`; `env-diff.ts:9-15` |
| T-07-26-04 | Tampering | staging rows in production | mitigate | Fresh database, never --schema-only | closed (documented, owner-executed) | `PRODUCTION.md:72` |
| T-07-26-05 | Spoofing | www as a second origin | mitigate | 308 to the apex; curl at G-1 | closed (documented, owner-executed) | `proxy.ts:16-32`; `PRODUCTION.md:8,113` |
| T-07-26-06 | Tampering | merge to main auto-deploying | mitigate | No repo source; checked through railway status; deploy.sh only | closed (documented, owner-executed) | `PRODUCTION.md:14,16,17`; `07-26-PLAN.md:122` |
| T-07-26-07 | Information disclosure | Helius key on the web service | mitigate | Worker only | closed (documented, owner-executed) | `PRODUCTION.md:51`; web refuses to boot with it `scrub.ts:16-26`, `instrumentation.ts:9`; `env-diff.ts:80`, `env-diff.test.ts:85` |
| T-07-27-01 | Spoofing | mistyped or attacker treasury | mitigate | Owner supplies; parse; boot refuses derived collisions | closed (documented, owner-executed) | `PRODUCTION.md:116-119`; env-diff g2 `env-diff.ts:88,101-102`, `env-diff.test.ts:91`; `env.ts:75-91` |
| T-07-27-02 | Information disclosure | treasury phrase shared | mitigate | Gate asks for the public key only | closed (documented, owner-executed) | `07-27-PLAN.md:66-69`; `PRODUCTION.md:117` |
| T-07-28-01 | Information disclosure | seed reaching Claude or logs | mitigate | Phone-generated, set in the dashboard there; presence-only env-diff; grep for fixed log lines | closed (documented, owner-executed) | `PRODUCTION.md:87,122`; `07-28-PLAN.md:67-72,87`; `env-diff.ts:56` (MASTER_SEED never compared); `env.ts:2` and `main.ts:101-106` print public keys only. Residual: CR-O-02 (Informational) |
| T-07-28-02 | Elevation of privilege | jobs at first boot | mitigate | Genesis forces switches off; FEE_ENGINE=dry; ADMIN_EVACUATE=simulate | closed (documented, owner-executed) | `genesis-boot.ts:29-34`; `main.ts:87,107` (no engine in genesis); `switch-gate.ts:27`; `PRODUCTION.md:55-56,87-90`; env defaults `env.ts:46-50,99-105` |
| T-07-28-03 | Tampering | pump changed since the rehearsal | mitigate | Mainnet check at boot pauses on mismatch | closed (documented, owner-executed) | `main.ts:81-84`; `contract-check.ts:43-49,136` (strict on mainnet); `PRODUCTION.md:91` |
| T-07-29-01 | Elevation of privilege | EVACUATE by an attacker | mitigate | Admin session plus a signed intent; funds only to the external treasury | closed (documented, owner-executed) | Phase 6 intent (06-SECURITY T-06-05-01..05); `env.ts:95-96`; `admin-evacuate.ts:220,233`; `PRODUCTION.md:139-140,172` |
| T-07-29-02 | Tampering | EVACUATE to a seed-derived treasury | mitigate | Mainnet needs TREASURY_PUBKEY passing D-10 | closed (documented, owner-executed) | `env.ts:75-91,102-103`; `env.test.ts:61-84` |
| T-07-30-01 | Spoofing | funds to a wrong address | mitigate | Address from the worker log; owner checks first and last four | closed (documented, owner-executed) | `main.ts:101-106`; `PRODUCTION.md:123,127`; `07-30-PLAN.md:64,79` |
| T-07-30-02 | Elevation of privilege | ops spending before launches open | accept | Switches off and FEE_ENGINE=dry; only the genesis table spends | closed | AR-07-08 |
| T-07-31-01 | Spoofing | wrong mint as BONDR_QUOTE_MINT | mitigate | Mint from the owner's signature; verifyQuoteMint | closed (documented, owner-executed) | `PRODUCTION.md:99-102`; `genesis-boot.ts:53-58`; `main.ts:88` |
| T-07-31-02 | Tampering | dev buy kept | mitigate | On-chain dev balance 0 check | closed (documented, owner-executed) | `PRODUCTION.md:100`; `07-31-PLAN.md:17`; burn built in code `launch.ts:181-190` |
| T-07-31-03 | Elevation of privilege | child launches opening by accident | mitigate | Switches off until G-9; status checked | closed (documented, owner-executed) | `PRODUCTION.md:102-103,147`; code gate `switch-gate.ts:20-31` (genesis refuses switch-on; on mainnet launches needs a pass and 100 mints), `switch-gate.test.ts:25-49` |
| T-07-31-04 | Denial of service | sniping the genesis buy | accept | Sender tip narrows the window; sniped % is public | closed | AR-07-09 |
| T-07-32-01 | Elevation of privilege | engine without owner consent | mitigate | Owner gate plus owner-only audited switch flips | closed (documented, owner-executed) | `PRODUCTION.md:142-144`; `admin-routes.ts:25-29,112`; audit from Phase 6 (06-SECURITY T-06-10-*) |
| T-07-32-02 | Denial of service | ops drained by engine fees | mitigate | 0.1 SOL floor and the low-ops alert | closed (documented, owner-executed) | `fee-config.ts:40`; `fee-send.ts:102-106` (console.error to Sentry); `health.ts:54`; `PRODUCTION.md:127` |
| T-07-33-01 | Tampering | tip shown differs from tip charged | mitigate | Status and the build read the same constant | closed (documented, owner-executed) | `fee-config.ts:42,49-50`; `status.ts:193`; `prepare.ts:133,137,196`; `build.test.ts:58`; `e2e/launch-tip.e2e.ts:24` |
| T-07-33-02 | Repudiation | tip changed without consent | mitigate | Changed only at the gate, by a PR with green CI | closed (documented, owner-executed) | `PRODUCTION.md:134-136`; `deploy.sh:43-51` |
| T-07-34-01 | Denial of service | RPC throttling at launch | mitigate | Measured decision before G-9; paceMs 1100 | closed (documented, owner-executed) | `PRODUCTION.md:150-151,159-161`; `fee-config.ts:39`; `07-34-PLAN.md:14-15,63` |
| T-07-34-02 | Information disclosure | Helius key in the numbers | mitigate | Counts only; logs redacted | closed (documented, owner-executed) | `rpc-stats.ts:8-17` (status and timing only, no URL); `PRODUCTION.md:161` |
| T-07-35-01 | Denial of service | pool exhausted at launch | mitigate | 100-mint precondition; health alert below 100 | closed (documented, owner-executed) | `switch-gate.ts:12,30`; `lib/admin-copy-health.ts:129-132`; `PRODUCTION.md:147`; `07-35-PLAN.md:20,63` |
| T-07-35-02 | Tampering | a broken path seen first by a stranger | mitigate | Owner test launch before the announcement | closed (documented, owner-executed) | `PRODUCTION.md:148`; `07-35-PLAN.md:22` |
| T-07-35-03 | Spoofing | vamp launches of fresh tickers | mitigate | Cooldown and reserved list live | closed (documented, owner-executed) | Code from 07-13 (T-07-13-01, T-07-13-06) |
| T-07-36-01 | Denial of service | shared quota suspending production | mitigate | Projection against 400 CU-h; no polling reads | closed (documented, owner-executed) | `PRODUCTION.md:74-75,153-154`; `07-36-PLAN.md:69` |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-07-01 | T-07-02-05 | 0008 adds nullable columns, one partial index, a CHECK, a trigger and a REVOKE. The Phase 6 worker keeps working. Staging applied it in web's pre-deploy at 07-24 without incident. | Plan 07-02 threat model | 2026-10-26 |
| AR-07-02 | T-07-03-04 | hello@trybondr.fun is a public forwarding address by design (D-17). | Plan 07-03 threat model | 2026-10-26 |
| AR-07-03 | T-07-06-04 | Refill runs only at boot and after a reservation, never on a timer (`grind.ts`, `vanity.ts` have no setInterval). | Plan 07-06 threat model | 2026-10-26 |
| AR-07-04 | T-07-08-03 | The check trusts the RPC like every other read. The worker uses the authenticated Helius endpoint behind the genesis guard (`net.ts:46-62`). | Plan 07-08 threat model | 2026-10-26 |
| AR-07-05 | T-07-11-04 | The facts name pump accounts and fee values, which are public chain data. They are shown only behind the admin cookie. | Plan 07-11 threat model | 2026-10-26 |
| AR-07-06 | T-07-15-03 | The treasury is a public key and is the on-chain creator of BONDR anyway. | Plan 07-15 threat model | 2026-10-26 |
| AR-07-07 | T-07-18-04 | The bypass is UI-only and genesis-only. The worker refuses reserved tickers for every child prepare (`prepare.ts:80`) and pins the genesis ticker to BONDR (`genesis.ts:82`). | Plan 07-18 threat model | 2026-10-26 |
| AR-07-08 | T-07-30-02 | Before G-8 every switch is off, and genesis mode starts no engine (`main.ts:107`), so only the genesis lookup table spends from ops. | Plan 07-30 threat model | 2026-10-26 |
| AR-07-09 | T-07-31-04 | BONDR cannot stop third-party buys at launch. The Sender tip narrows the window, and the token page publishes the sniped share (D-36). | Plan 07-31 threat model | 2026-10-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

None. The SUMMARY `## Threat Flags` sections in 07-03 to 07-18 all say "None" (or "None new"), and each maps what it mentions to existing threat IDs. 07-01, 07-02 and 07-19 to 07-24 have no threat section. 07-25 to 07-36 have no SUMMARY yet.

Several review fixes added attack surface or hardening, all inside existing threats:
- `switch-gate.ts` (WR-W-02): T-07-17-02, T-07-31-03, T-07-35-01.
- The web pass-through of the `not_ready` reason, allow-listed to three words: T-07-12-01.
- The exact web SOLANA_NET boot check (WR-O-03): T-07-06-01.
- `contractFailed` on the engine, retried pause and strict boot (CR-W-03, WR-W-01): T-07-10-01, T-07-10-06, T-07-28-03.
- deploy.sh project pin, origin/main and the CI gate (CR-O-04/05): T-07-19-04, T-07-20-02, T-07-25-01.
- env-diff no longer handling values (CR-O-02/03): T-07-20-01, T-07-28-01.

## Informational (not blockers; outside or beside the declared mitigations)

- **WR-O-05: CI has never run.** GitHub refuses every run on billing. All three runs on `phase-07-go-live` show `failure` within seconds, and no step ever executed. The CI-related closures (T-07-19-*) rest on the workflow text and a local emulation. deploy.sh blocks production until a green run exists for the exact SHA, so G-1 and 07-25 cannot proceed until the owner fixes billing.
- **No branch protection on main.** The repo is private on a free plan, and the protection API answers 403. "Merge only with green CI" is a procedural rule. The technical backstop is deploy.sh, which runs at deploy time, not at merge time.
- **Staging and devnet ran before the review fixes.** Staging was deployed at 5b26c35 (07-24), and the fork rerun and devnet contract check also predate the review fixes. The review reports the fork rerun passing after the fixes (fork 109 rows ok). Staging does not yet run the fixed contract check, switch gate, Sender fallback or sniped-null logic.
- **IN-B-06: the TRUNCATE guard stops accidents, not a compromised app role.** The app is the table owner, so it can drop or disable the trigger and re-grant TRUNCATE. To make this tamper-resistant, use separate migration-owner and app roles.
- **IN-W-02: genesisLanded keys on the current TREASURY_PUBKEY.** Changing the treasury between genesis landing and the BONDR_QUOTE_MINT redeploy would admit a second genesis. PRODUCTION.md does not say outright that the treasury must not change during genesis. A one-line warning in G-2 or section 6 would close this.
- **IN-W-04:** when the tip is dropped for size, the cost preview overstates it by 0.001 SOL. **IN-W-05:** boot resume resends a tipped launch over plain RPC (same signature, so safe). **IN-W-06:** the mainnet EVACUATE refusal without an external treasury still says `devnet_only`.
- **IN-B-03:** "Could not run" copy blames the RPC for any throw. After CR-W-02, only RPC errors reject, so the copy is now mostly accurate.
- **IN-O-06:** actions are pinned to major tags, not SHAs. The declared mitigation (T-07-19-02) says major tags, so it holds. `retries: 1` stays on for the smoke test.
- **CR-O-02 residual:** Railway has no names-only listing, so production values, the seed included, pass through jq's memory on the Mac during env-diff and are dropped there. They are never printed, compared or returned. The D-12 guarantee for the seed rests on the owner generating it fresh on the phone.
- **Owner-gate plans call Railway without `--project`.** `07-26-PLAN.md:122` (`railway deployment list`) and `07-28-PLAN.md:87` (`railway logs`) are read-only verify commands that rely on the directory link. deploy.sh and env-diff refuse a checkout linked to another project, so a wrong link would surface there first.
- **env-diff checks FEE_ENGINE and ADMIN_EVACUATE for presence only, not value.** This is not a gap for T-07-28-02: genesis mode starts no engine whatever FEE_ENGINE says, and boot refuses ADMIN_EVACUATE=on without an external treasury. After genesis, though, a wrong FEE_ENGINE value would be caught only by the runbook's log check (`fee engine on`).
- **T-07-04-01:** `net.ts:53` (mainnet on a local host) has no direct test. It is unreachable through config, because the mainnet URL is hard-coded to the Helius host, so it is pure defence in depth.
- **T-07-18-01:** no web-side test shows that a body `actor` is dropped. The worker's actor and wallet check is tested. Wallet comes from the consent session, so a forged actor alone cannot pass.
- **T-07-02-04:** the replay case is an e2e and was not run in this audit.

## Verification Run

`pnpm exec vitest run --project unit` on 33 non-database files passed: 33 files, 251 tests, run 2026-10-26. The files:
- Worker: ingest-retry, admin-intent, env, admin-evacuate, admin-evacuate-exec, fee-send, fee-config, grind, status, build, submit, contract-check, switches, admin-routes, fee-boot-gate, genesis, settle-flow, switch-gate.
- Web: proxy, worker, admin-copy-health, ticker-copy.
- Core: net, keys, contract, contract-gather, launch-genesis, trades, send, scrub, rules, cosign.
- Scripts: env-diff.

The database-backed suites were not re-run, to keep Neon asleep: db-admin, ingest, prepare, ticker, genesis-boot. Their 42501, P0001 and 23514 cases, sniped, cooldown and genesis-switch cases were read in source. No e2e, fork, devnet, staging or production run was made. Read-only `gh` calls checked branch protection, PRs and CI runs. No source file was changed, nothing was deployed or committed, and no SOL was spent.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-26 | 131 | 130 | 1 | gsd-security-auditor (Claude) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: secured` set in frontmatter

**Approval:** approved 2026-10-26 (T-07-25-02 closed by 07-25)
