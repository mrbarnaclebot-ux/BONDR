---
phase: 05
slug: fee-engine-and-public-ledger
status: verified
threats_total: 62
threats_closed: 62
threats_open: 0
asvs_level: 1
block_on: open
register_authored_at_plan_time: true
created: 2026-10-25
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

This audit checked each mitigation against the code at `c7c7baa` on `phase-05-fee-engine`, after the review fixes (05-REVIEW-FIX-engine.md, 05-REVIEW-FIX-web.md). It did not take the summaries' word for anything. File:line references point at the current tree.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| worker -> Postgres | Intent rows that gate every engine send; the database is the last guard against a double send | fee_ledger rows, coin totals (integrity-critical) |
| Postgres -> web | Public ledger and coin reads | landed public rows only; held reasons and diffs must stay internal |
| browser -> /api/coin/[mint]/ledger | Untrusted mint and cursor | path param, query string |
| worker -> Solana | Engine-signed txs out of W, buyback and ops | signed transactions, real devnet SOL and tokens |
| seed -> derived keys | Role separation of the master seed | private keys (secret) |
| worker -> Helius Sender | Mainnet-only urgent path, unreachable on devnet | signed transactions |
| indexer -> engine | Trade, bond and migration events drive money jobs | reserves, venue, fees |
| worker env -> engine | FEE_ENGINE decides whether funds move | config flag |
| owner -> worker /fee/release, /fee/batch | Bearer-protected owner routes | mint, deployer address |
| worker -> web (SSE /api/live) | Landed fee rows fan out to public pages | public ledger rows, coin snapshot |
| server env -> client | FEE_WINDOW_MS passed as a prop | non-secret number |
| e2e / owner Mac -> devnet, Railway | Devnet spend and staging deploys | ops SOL, one variable |

---

## Threat Register

Status: all 62 closed. Disposition counts: 58 mitigate, 4 accept, 0 transfer.

| Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-----------|----------|-----------|-------------|------------|--------|----------|
| T-05-01-01 | Tampering | fee_ledger double sweep or double burn | mitigate | Partial unique indexes over state in (pending, landed) | closed | `packages/core/migrations/0005_fee_ledger.sql:43-46` (fee_ledger_once, _bond_burn, _sweep, _split); 23505 cases `packages/core/src/db.test.ts:174-197` |
| T-05-01-02 | Tampering | coin totals drift | mitigate | coins_fee_totals >= 0 check; totalsFor single map, unit-tested | closed | `0005_fee_ledger.sql:50-52`; `packages/core/src/fees.ts:102-126`; `fees.test.ts:60` |
| T-05-01-03 | Information disclosure | held and reconcile_diff rows | mitigate | PublicKind excludes held, reconcile_diff, buyback_burn; e2e asserts held/pending never render | closed | `packages/core/src/api.ts:123`; `fees.ts:8-18`; `apps/web/e2e/fee-ledger.e2e.ts:92-98` |
| T-05-01-04 | Elevation of privilege | wrong deployer in the permanent 80/20 | mitigate | deployerOk: equals launch wallet, distinct, on curve; used by 05-08 | closed | `fees.ts:46-59`; `fees.test.ts:46-53`; used at `apps/worker/src/fee-finalize.ts:60-65` |
| T-05-01-05 | Denial of service | migration on the dev branch | accept | Additive columns with defaults plus a new table | closed | Accepted risk AR-05-01; `0005_fee_ledger.sql` is CREATE TABLE plus ADD COLUMN ... DEFAULT; `0006` only swaps one check |
| T-05-02-01 | Information disclosure | ledger read | mitigate | inArray(PUBLIC_KINDS) plus state = landed; detail copied key by key | closed | `apps/web/lib/ledger.ts:61-66` (where), `:24-33` (publicDetail allowlist), `:75` |
| T-05-02-02 | Tampering | cursor and mint input | mitigate | BASE58_KEY 404, strict cursor regex with INT8_MAX (400), parameterized SQL | closed | `apps/web/app/api/coin/[mint]/ledger/route.ts:17-21`; `ledger.ts:18-22`, `:55` (bound params) |
| T-05-02-03 | Denial of service | ledger route on Neon | mitigate | PAGE = 20, first page kept 10 s; no timer reads | closed | `ledger.ts:11`, `:69`, `:87-88`; `apps/web/lib/trades.ts:96-98` (10_000 ms); page read shares `firstPage` entry `apps/web/app/coin/[mint]/page.tsx:66-69` |
| T-05-02-04 | Spoofing | Solscan links | mitigate | Links only via explorer("tx", sig, net); rel/target from TxLink | closed | `apps/web/components/tx-link.tsx:23-26`; `apps/web/lib/format.ts:32-33` (fixed https://solscan.io prefix); `token-ledger.tsx:141` |
| T-05-03-01 | Elevation of privilege | program allowlist | mitigate | checkMessage inside signTx, the single engine signing point; refusal unit-tested | closed | `packages/core/src/send.ts:67-74`, `:272-280`; engine signs only at `apps/worker/src/fee-send.ts:246`; no other sign/send in fee-*.ts; `send.test.ts:147-150` |
| T-05-03-02 | Information disclosure | seed exposure | mitigate | buyback via existing HMAC derive; nothing logged | closed | `packages/core/src/keys.ts:11`; `apps/worker/src/env.ts:89-90`; no secretKey/seed in any fee-*.ts log line |
| T-05-03-03 | Tampering | wrong rent on devnet | mitigate | wFloat reads rent live, one copy in core | closed | `packages/core/src/float.ts:6-8` (getMinimumBalanceForRentExemption) |
| T-05-03-04 | Tampering | forced-bond trigger from a wrong cost | mitigate | costFromReserves equals SDK quote (unit-checked); fresh chain re-check plus simulate before send | closed | `packages/core/src/curve.test.ts:73,78`; `apps/worker/src/fee-burns.ts:39-41`; simulate `packages/core/src/bond.ts:62-67,90` |
| T-05-04-01 | Tampering | double send after a crash | mitigate | sign, insertPending, broadcast; refused intent returns done; unknown never resent | closed | `fee-send.ts:246-258` (sign -> insertPending -> broadcast), `:253` (null -> done), `:236` (unknown returned, no resend); `fee-recover.ts:26-32` (RPC error never a verdict) |
| T-05-04-02 | Elevation of privilege | wrong destination | mitigate | split/sweep only to derived treasury and buyback ATAs; allowlist; no caller address | closed | `fee-prebond.ts:37-40,69-72`; `packages/core/src/collect.ts:47-55,75-85`; deps derive keys `fee-engine.ts:247-249` |
| T-05-04-03 | Tampering | split sized from W's balance | mitigate | split from collect meta delta only, asserted by prebond test | closed | `fee-prebond.ts:33-35`; collect amount = W delta `fee-send.ts:195`; `fee-prebond.test.ts:80-81` |
| T-05-04-04 | Denial of service | ops drained | mitigate | collect minimum per network; ops floor from postBalances[0] skips non-urgent sends | closed | `fee-config.ts:8,36`; `fee-prebond.ts:77-81`; `fee-send.ts:96-101,227,241`; latch fix `fee-send.ts:105-112` |
| T-05-04-05 | Information disclosure | RPC URL or Sender key in logs | mitigate | every logged error passes redact(); Sentry scrub unchanged | closed | `fee-send.ts:127,234`; `fee-burns.ts:83`; `fee-finalize.ts:131`; `fee-engine.ts:58`; `fee-recover.ts:23`; `fee-batch.ts:41`; `announce.ts:20`; `packages/core/src/net.ts:10-14`; scrub.ts/instrumentation.ts/sentry.ts untouched since `755b5f9^` |
| T-05-04-06 | Spoofing | mainnet Sender reached from devnet | mitigate | urgentBroadcast branches on net; devnet test asserts no fetch; env.ts refuses mainnet | closed | `fee-send.ts:138`; `fee-send.test.ts:119-120`; `env.ts:13-18` |
| T-05-05-01 | Tampering | double send across a restart | mitigate | recover settles pending before ready; jobs enqueue only when ready; unique indexes | closed | `fee-engine.ts:272-273` (recover then start); ready gates `:179,189` and `arm`/`release`; indexes as T-05-01-01 |
| T-05-05-02 | Elevation of privilege | engine signing for a coin it does not own | mitigate | derived W must equal launches.w, else skipped | closed | `fee-engine.ts:63-77`; `fee-engine.test.ts:141` |
| T-05-05-03 | Denial of service | Neon wakes | mitigate | one boot read; timers/hooks memory only; cost rides patch write | closed | `fee-engine.ts:270` (loadRows once), `:279-300` (withCost on existing write); guard reads DB only for `coin.open` `fee-guard.ts:17` |
| T-05-05-04 | Tampering | engine on by accident | mitigate | FEE_ENGINE defaults off, refuses unknown; dry writes nothing | closed | `env.ts:44-47`; `fee-send.ts:251` (dry before insertPending); dry guards `fee-finalize.ts:37`, `fee-reconcile.ts:110`, `fee-recover.ts:139,152`; `fee-send.test.ts:206-210`; devnet dry run in 05-05-SUMMARY |
| T-05-05-05 | Information disclosure | internal rows on the stream | mitigate | publishFee filters landed PUBLIC_KINDS | closed | `apps/worker/src/announce.ts:79` plus key-by-key detail `:58-66` |
| T-05-05-06 | Repudiation | shared devnet ops and buyback across lanes | mitigate | buyback per lane; ops shared, off locally except e2e | closed | `env.ts:87-90`; `.env.example:29` (FEE_ENGINE=off); `apps/worker/README.md:75,79` |
| T-05-06-01 | Information disclosure | WEB_ENV | mitigate | only FEE_WINDOW_MS added; boot guard unchanged | closed | `apps/web/next.config.ts:9-21`; `apps/web/instrumentation.ts:9-13` (no commits since `755b5f9^`) |
| T-05-06-02 | Spoofing | misleading ratio | mitigate | ratio floored from bigints, unit-tested | closed | `apps/web/lib/format.ts:111-120`; `format.test.ts:119-123`; used by `bond-budget.tsx:33-34` |
| T-05-06-03 | Tampering | client clock skew | accept | Countdown display only; worker timer is truth | closed | Accepted risk AR-05-02 |
| T-05-07-01 | Tampering | stale cached reserves trigger | mitigate | fresh costToComplete plus simulation before every forced bond; nothing before ready | closed | `fee-burns.ts:39-50`; `bond.ts:62-67`; `fee-engine.ts:179` (ready gate covers gap fill via `announce.ts:52`) |
| T-05-07-02 | Tampering | front-run between simulate and land | mitigate | minOut = simulated out minus prior balance; re-simulated on retry | closed | `fees.ts:40-43`; `bond.ts:90-91`; each `forcedSend` rebuilds via `forcedBondIxs` `fee-burns.ts:46` |
| T-05-07-03 | Tampering | double bond burn | mitigate | fee_ledger_bond_burn index, forcing flag, has() check | closed | `0005_fee_ledger.sql:44`; `fee-engine.ts:179-182`; `fee-burns.ts:64,115` |
| T-05-07-04 | Elevation of privilege | wrong recipient of the pool buy | mitigate | buyback recipient pinned from poolState; allowlist | closed | `packages/core/src/trade.ts:88-93`; `bond.ts:147-158,167-173` |
| T-05-07-05 | Denial of service | ops below floor at bond time | mitigate | forced bond and fallback burn are urgent | closed | `fee-burns.ts:30` (urgent: true); floor skip only for non-urgent `fee-send.ts:241` |
| T-05-07-06 | Spoofing | Sender on devnet or fork | mitigate | Sender only when net is mainnet | closed | `fee-send.ts:138,255-257`; `fee-send.test.ts:119-120` |
| T-05-08-01 | Elevation of privilege | wrong deployer locked into 80/20 | mitigate | CreateEvent user (authority verified) equals launches.wallet; distinct; on curve; failure holds, never auto-retried | closed | `fee-finalize.ts:48-66`; authority check `packages/core/src/events.ts:86`; held skip `fee-finalize.ts:149`; batch/boot only retry finalize = none `fee-batch.ts:130`, `fee-engine.ts` start() |
| T-05-08-02 | Spoofing | /fee/release caller | mitigate | bearer check (timingSafeEqual); body validated; redact log | closed | `apps/worker/src/http.ts:43-47,86` (all routes but /healthz); `fee-routes.ts:8-26`; coin-held check `fee-engine.ts:159-160` |
| T-05-08-03 | Tampering | second shares update | mitigate | fee_ledger_once on finalize_update; finalizeState read first; 6009 final | closed | `0005_fee_ledger.sql:43`; `fee-finalize.ts:150`, `:143` |
| T-05-08-04 | Repudiation | finalize evidence | mitigate | finalize rows with signatures and shares; held row kept after release | closed | `fee-finalize.ts:88,93-98`; `fee-ledger.ts:285-288` (release only updates coins); signature NOT NULL for tx kinds `0005:20` |
| T-05-08-05 | Information disclosure | held reason | mitigate | reason only in held row detail and logs; page shows Pending review | closed | `fee-ledger.ts:279-283`; held excluded from PUBLIC_KINDS; `apps/web/components/bond-after.tsx:191-199` |
| T-05-08-06 | Tampering | BONDR left in W after bond | mitigate | closing sweep 90/10 to derived buyback and treasury; W asserted 0 on fork | closed | `fee-finalize.ts:117-133`; `fee-prebond.ts:60-74`; fork result in 05-08-SUMMARY |
| T-05-09-01 | Elevation of privilege | buyback burn destination | mitigate | BurnChecked only; per-lane buyback key; allowlist | closed | `fee-batch.ts:55-63`; `env.ts:89-90` |
| T-05-09-02 | Tampering | distribution recipients | mitigate | distributeIxs pays on-chain shareholders; engine passes no recipient | closed | `fee-batch.ts:98-103`; `packages/core/src/sharing.ts:164-172` |
| T-05-09-03 | Denial of service | ops spent on dust payouts | mitigate | distributeMin; ops floor pauses batch sends | closed | `fees.ts:62`; `fee-batch.ts:86-90,139,148` |
| T-05-09-04 | Denial of service | Neon wakes | mitigate | one wake per daily batch; timers in memory | closed | `fee-batch.ts:175-183` (single daily timer, reads nothing itself); coins from memory `:120` |
| T-05-09-05 | Repudiation | silent ledger drift | mitigate | reconcile_diff rows plus Sentry error; never moves funds | closed | `fee-reconcile.ts:102-111` (no land/send in file) |
| T-05-09-06 | Spoofing | /fee/batch abuse | mitigate | bearer check; single-flight | closed | `http.ts:86`; `fee-batch.ts:166-171` |
| T-05-10-01 | Information disclosure | held reason | mitigate | UI renders held as Pending review; reason never leaves server; spec asserts absence | closed | `bond-after.tsx:191-199`; `ledger.ts:24-33`; `fee-ledger.e2e.ts:98` |
| T-05-10-02 | Tampering | live event injection | accept | Same-origin hub fed only by the worker; ledger read is truth on reload | closed | Accepted risk AR-05-03 |
| T-05-10-03 | Denial of service | event burst re-renders | mitigate | rows batched per animation frame; merged by id | closed | `apps/web/components/token-ledger.tsx:84-94`; `apps/web/lib/live-list.ts:148-152` |
| T-05-11-01 | Denial of service | home reads on Neon | mitigate | nextToBond in kept read set; 60 s tick re-sorts in memory | closed | `apps/web/lib/coins.ts:106-107`; `apps/web/app/page.tsx:43`; `home-live.tsx:114-117` (no fetch) |
| T-05-11-02 | Spoofing | misleading readiness | mitigate | rail uses same floored ratio | closed | `apps/web/components/home-next.tsx:52-53` |
| T-05-11-03 | Information disclosure | unlisted data | accept | Rail shows only public coin fields already on the token page | closed | Accepted risk AR-05-04 |
| T-05-12-01 | Denial of service | devnet ops spend | mitigate | run spend asserted <= 0.05 SOL; phase < 0.1 SOL; devnet-trades refuses below floor | closed | `apps/web/e2e/fee-devnet.e2e.ts:21,143-147`; `scripts/devnet-trades.ts:249`; phase total 0.006348 SOL (05-13-SUMMARY) |
| T-05-12-02 | Information disclosure | WORKER_TOKEN, seed, RPC key | mitigate | read from root .env in process, never printed; README reads from env | closed | `fee-devnet.e2e.ts:15,183` (no log of env values); `apps/worker/README.md:81-82` ($WORKER_TOKEN from shell) |
| T-05-12-03 | Tampering | two engines on one ops wallet | mitigate | local worker FEE_ENGINE=on only for the run, then stopped | closed | Procedural: 05-12-SUMMARY "Worker stopped ... 08:19 UTC"; `.env.example:29` off; `apps/worker/README.md:79` |
| T-05-12-04 | Elevation of privilege | mainnet | mitigate | env.ts refuses mainnet | closed | `env.ts:13-18` |
| T-05-13-01 | Elevation of privilege | staging deploy scope | mitigate | only bondr staging web and worker; one non-secret variable; recorded | closed | Procedural: 05-13-SUMMARY lines 48, 54 |
| T-05-13-02 | Information disclosure | WORKER_TOKEN, Helius key, DB URLs | mitigate | no secret read, set or printed; migration in web pre-deploy | closed | Procedural: 05-13-SUMMARY lines 39, 54 (stdin set of FEE_ENGINE only, URL never printed) |
| T-05-13-03 | Tampering | engine on staging double sends | mitigate | one replica, boot recovery before ready, partial unique indexes, log check | closed | `apps/worker/README.md:85` (one replica); `fee-engine.ts:272-273`; `0005:43-46`; log check 05-13-SUMMARY line 65 |
| T-05-13-04 | Denial of service | devnet ops and Neon budget | mitigate | ops floor alert and pause; Neon idle check; phase spend < 0.1 SOL | closed | `fee-send.ts:96-112,241`; Neon suspend and 0 SOL spend in 05-13-SUMMARY lines 92-113 |
| T-05-13-05 | Spoofing | mainnet | mitigate | env.ts refuses mainnet; Sender unreachable on devnet; HV-05-02 owner-gated Phase 7 | closed | `env.ts:13-18`; `fee-send.ts:138` |
| T-05-13-06 | Repudiation | sign-off evidence | mitigate | deployment ids, log lines, window ends, counts, Neon times in summary | closed | 05-13-SUMMARY (deployment e07a1f4e / 0cb154a4, armed log, window table, 35 passed, Neon table) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-01-05 | Migration 0005 is additive: a new table and new coin columns with defaults. Nothing existing changes shape, so the Phase 4 worker keeps running on it. This was confirmed on staging in 05-13, where the old worker ran while web's pre-deploy applied 0005 and 0006. | Plan 05-01 threat model (owner-approved roadmap) | 2026-10-25 |
| AR-05-02 | T-05-06-03 | The client countdown is display only. The worker's in-memory timer is the source of truth, and the sweep row arrives over the stream. | Plan 05-06 threat model | 2026-10-25 |
| AR-05-03 | T-05-10-02 | /api/live is the existing same-origin hub. Only the worker feeds it, over Railway's private network (Phase 3). Fee rows are display only, and the ledger read is the source of truth on reload. Web drops live rows of unknown kinds (`ledger-copy.ts` `known`, web WR-02). | Plan 05-10 threat model | 2026-10-25 |
| AR-05-04 | T-05-11-03 | The rail shows only public coin fields that are already on the token page. | Plan 05-11 threat model | 2026-10-25 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

None. Every SUMMARY `## Threat Flags` section says "None" or maps its items to existing threat IDs. 05-03-SUMMARY has no Threat Flags section. 05-12-SUMMARY gives its threat notes ("Nothing new", mapped to T-05-12-01..04) under another heading.

## Informational (not blockers; outside the declared mitigations)

- **Engine review WR-08 was skipped.** It is open in 05-REVIEW-FIX-engine.md. A front-run sell can leave extra child tokens in W after a forced bond or pool burn, and nothing burns them later. T-05-07-02's declared mitigation is against over-burning, and that holds (minOut reverts the tx). This is an under-burn, logged by `checkEmpty` (`fee-finalize.ts:123-133`), not a funds-loss path. T-05-08-06 covers BONDR only, and the closing sweep empties that. Track it for a later phase.
- **Engine review IN-05 was not fixed.** `deployerOk` does not exclude the ops or buyback keys. The declared T-05-01-04 rule (launch wallet, treasury/W distinct, on curve) is implemented as written. Adding ops and buyback to the distinctness check would be a cheap extra layer.
- **WR-09 repeat-diff suppression is kept per process.** A persistent diff alerts once per worker process. A restart writes one repeat row, marked `ponytail:` at `fee-reconcile.ts:68-70`. T-05-09-05 still holds.
- **Procedural mitigations.** T-05-12-03 and T-05-13-01/02/03 (replica count)/04/06 rest on the recorded run and deploy evidence in the 05-12 and 05-13 summaries, not on code. The replica count is a Railway setting, documented in `apps/worker/README.md:85`.

## Verification Run

`pnpm vitest run` on 16 non-database unit files passed: 16 files, 145 tests. The files: fee-batch, fee-burns, fee-engine, fee-finalize, fee-prebond, fee-reconcile, fee-recover, fee-send, http, core fees, send, curve, net, and web format, ledger-copy, live-list. The database-backed suites (db.test.ts, fee-ledger.test.ts, web ledger.test.ts) were not rerun, to keep Neon asleep. Their 23505 cases were read in source. Nothing was deployed, no worker was started and no SOL was spent.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-25 | 62 | 62 | 0 | gsd-security-auditor (Claude) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-25

Post-audit, 2026-10-25: IN-05 fixed. `deployerOk` now also refuses the ops and buyback keys as deployer (`packages/core/src/fees.ts`, test in `fees.test.ts`). WR-08 (leftover child tokens in W not burned) stays open as informational.
