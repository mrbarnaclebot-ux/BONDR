---
phase: 02-launch-flow
plan: 06
subsystem: worker
tags: [worker, node-http, status, quote, kill-switch, rules]
requires: [02-03, 02-04, 02-05]
provides:
  - "apps/worker (@bondr/worker): node:http server with GET /healthz (open), GET /status and POST /quote (bearer token)"
  - "env.ts: launchNet (devnet only in Phase 2, D-02), loadEnv { net, seed, quoteMint, token, priorityFee, lane }, ops(seed, net), treasury(seed, net)"
  - "http.ts: authorized (timingSafeEqual), readJson (16 KB cap, 413), Fail(status, ApiError), start(routes, token, port?)"
  - "status.ts: liveStatus (5 s shared-promise cache), quote, pauseReason, networkFee, LAUNCH_CU_LIMIT = 600000"
  - "@bondr/core/api: Status, Quote, QuoteRequest, ApiError, LaunchErrorCode, PauseReason, PrepareRequest, PrepareResult, SubmitRequest, SubmitResult, LaunchState, LaunchView, Links, Exit, Net"
  - "@bondr/core/rules: checkName, checkSymbol, checkDescription, normalizeLink, imageType, checkImage, checkUri, parseSol, checkDevBuy, plus NAME_MAX_BYTES, SYMBOL_MAX, DESCRIPTION_MAX, MAX_IMAGE_BYTES"
  - "@bondr/core/math: minLamports (D-17) and estimateSolBack"
  - "@bondr/core/pump: computeFeesBps (pump curve) and computeAmmFeesBps (PumpSwap pool) re-exported"
affects: [02-07, 02-08, 02-10, 02-11, 02-16, 02-17]
tech-stack:
  added: []
  patterns:
    - "Checks return { ok, value } or { ok: false, code, n?, mb? }; copy stays in web"
    - "Worker status is read on demand and cached 5 s as one shared promise; a failed read is not cached"
    - "A chain read failure gives null fees, minimum and create cost (the UI disables signing); a DB failure is a 500"
    - "Handlers throw Fail(status, ApiError) for contract errors; anything else becomes 500 build_failed with only redact(message) on stderr"
key-files:
  created:
    - packages/core/src/api.ts
    - packages/core/src/rules.ts
    - packages/core/src/rules.test.ts
    - apps/worker/package.json
    - apps/worker/src/main.ts
    - apps/worker/src/env.ts
    - apps/worker/src/http.ts
    - apps/worker/src/http.test.ts
    - apps/worker/src/status.ts
    - apps/worker/src/status.test.ts
    - apps/worker/src/README.md
  modified:
    - packages/core/src/math.ts
    - packages/core/src/math.test.ts
    - packages/core/src/pump.ts
    - packages/core/src/README.md
    - tsconfig.json
    - pnpm-lock.yaml
    - .env.example
decisions:
  - "The insta-sell estimate uses four legs [bondr, child, child, bondr]. The BONDR leg is protocol plus creator on the curve, or LP plus protocol plus creator on the pool"
  - "/status fees are those of a fresh child curve quoted in BONDR at the network default creator fee (no creatorFeeBps passed)"
  - "createCostEstimate is live rent over the seven accounts the devnet launch.burn tx created"
  - "Quote ignores the kill switch (read-only); it maps AwaitingMigration to 409 paused awaiting_migration"
  - "A missing settings row counts as launches switched off (fail closed)"
  - "401 answers { error: \"unauthorized\" }, which is outside LaunchErrorCode. Web maps any non-2xx it does not know to worker_unavailable"
metrics:
  duration: ~10 min
  completed: 2026-10-19
  tasks: 3
  files: 18
---

# Phase 2 Plan 06: Worker, /status and /quote, contract and rules Summary

The worker now runs. It refuses to start unless `SOLANA_NET=devnet`, and it serves live devnet fees, the D-17 minimum, the pause reason and dev-buy quotes behind a bearer token. Every tier can now build against two contracts: the types-only `api.ts`, and the pure field rules in `rules.ts`.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Contract types, minLamports and estimateSolBack | 5b5deb2 |
| 2 | Pure launch field rules with unit tests | a60fd4e |
| 3 | Worker env guard, authenticated HTTP server, /status and /quote | 989f8d9 |

Each test file failed locally before its code existed, except http.test.ts (see TDD below). Each test was committed together with its code, and no red step was committed.

## Verification

- `pnpm test`: 50 passed in 10 files. `pnpm lint` and `pnpm typecheck` both exit 0 after each commit.
- Acceptance greps all pass:
  - minLamports and estimateSolBack are exported.
  - api.ts has no import line and declares all six named types.
  - rules.ts uses TextEncoder. It has no import line at all, which is stricter than "only ./math.ts". rules.ts needs nothing from math, because the minimum is passed into `checkDevBuy`.
  - `timingSafeEqual` is in http.ts and `ALLOW_MAINNET` is in env.ts.
  - `rg '150|0\.015|1\.5' apps/worker/src/status.ts` finds nothing.
- **Devnet smoke (2026-10-19).** I started the worker with `node --env-file=../../.env src/main.ts` on WORKER_PORT 18080. The calls used `node --env-file=.env -e` with fetch, and the Authorization header was built from `process.env.WORKER_TOKEN`, so the token never reached argv.
  - `GET /status` returned 200 in 4.3 s cold and 5 ms cached:
    `{"net":"devnet","paused":null,"quoteMint":"4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA","fees":{"protocolBps":95,"creatorBps":30},"minLamports":"2500000","createCostEstimate":"11917680","networkFeeEstimate":"10600"}`
  - `GET /status` with no token: 401.
  - `POST /quote {"solIn":"2500000"}`: 200, `{"tokensOut":"31120363129478","solBackEstimate":"2377323"}`. With a wallet the body also has `balance`. `solIn "0"` gives 400 `invalid_input`.
  - SIGTERM: the worker closed the server and the DB pool, then exited.
- **Kill switch (D-18 truth).** On the Neon dev branch I set `launches_enabled` to false. `/status` reported `kill_switch` 2.7 s later. I then restored it to true, `/status` went back to `paused: null`, and the table still has exactly one settings row.
- At the time of the check, BONDR's venue on devnet was `curve`. Both the smoke and the kill-switch check ran the curve-venue BONDR leg.

## .env (gitignored, nothing printed)

Before appending I added the missing trailing newline after the last line, and the file now ends with a newline. A node one-liner appended `WORKER_TOKEN` (randomBytes(32) hex), `SOLANA_NET=devnet`, `BONDR_QUOTE_MINT=4Jw2pr67…FEovA`, `MASTER_SEED_FILE` (the devnet spike seed path) and `VANITY_LANE=local`, each only if it was absent. `git status --porcelain .env` is empty.

## Freshness

No new third-party package. The worker declares pins that core and the root already lock: @solana/web3.js 1.99.0, @solana/spl-token 0.4.15, bn.js 5.2.5, bs58 6.0.0, drizzle-orm 0.45.3 and postgres 3.4.9. The lockfile diff adds the `apps/worker` importer. It also drops a `utf-8-validate` peer suffix from the pump SDK and anchor snapshot keys. That is pnpm re-deriving peer contexts; no version changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-exported the pool fee calculator from pump.ts**
- **Found during:** Task 3
- **Issue:** `computeFeesBps` existed in pump-sdk 4.1.0 but was not re-exported. Pricing the BONDR leg on a migrated BONDR needs pump-swap-sdk's own `computeFeesBps` (LP, protocol, creator).
- **Fix:** pump.ts re-exports `computeFeesBps` and adds `computeAmmFeesBps = amm.computeFeesBps`. pump.ts was not in files_modified.
- **Commit:** 989f8d9

**2. [Rule 1 - Bug] .env.example said the inline seed is hex**
- **Issue:** The plan (and env.ts) read `MASTER_SEED` as base64, but the 02-04 comment said hex.
- **Fix:** The comment now says "32 bytes, base64".
- **Commit:** 989f8d9

**3. [Rule 2 - Correctness] Stricter trust-boundary checks than the plan listed**
- **Links:** refuse logins, dotless hosts (localhost) and anything over 200 characters. X and Telegram links need a path.
- **checkUri:** requires an alphanumeric CID after the prefix, so `../` and an empty CID fail.
- **quote:** refuses a `wallet` that is not a valid address with 400, instead of silently omitting the balance.
- **Settings:** a missing row fails closed.
- **Commit:** a60fd4e, 989f8d9

**4. [AGENTS.md] apps/worker/src/README.md**
- The directory has six files. AGENTS.md wants a README in any directory with more than five files.
- **Commit:** 989f8d9

### Additions

- `networkFee` is exported and tested (10600 lamports at 1000 micro-lamports).
- `LAUNCH_CU_LIMIT` is exported from status.ts for 02-11.
- I added a kill-switch check against the dev DB, run by hand and not committed.

## TDD Gate Compliance

Per the orchestrator, there are no separate RED commits. RED was observed locally for math (2 failing), rules (import failure) and status (import failure). http.test.ts was written just after http.ts. To compensate it checks a wrong token of the same length, a token of a different length, the 413 cap, 404, and a 500 with no stack text.

## Known Stubs

None. Note one gap: the pool branch of the BONDR leg fee (`computeAmmFeesBps`) did not run live, because devnet BONDR is on its curve. It type-checks against the SDK, and it reuses `poolState` from 02-03, which is proven on the fork. 02-11 or the 02-17 fork run should exercise `/quote` against a migrated BONDR.

## Notes for later plans

- 02-07 and 02-10: web imports `@bondr/core/rules` and `@bondr/core/api`, both already on the Biome allowlist. Map rule codes to the UI-SPEC copy. Names count UTF-8 bytes, so the "{n} characters" copy should say bytes, or the counter should show bytes (A8).
- 02-08: quote takes `solIn` as a lamport string and an optional `wallet`. Pass `wallet` only after consent.
- 02-11: reuse `Fail`, `LAUNCH_CU_LIMIT`, `ops()` and the `Ctx` from status.ts, and add `POST /prepare` to the route table in main.ts.
- 02-16: the worker listens on WORKER_PORT, then PORT, then 8080, with no host argument (dual-stack). It must run from the workspace checkout (core README ponytail note).
- `bigint: Failed to load bindings, pure JS will be used` appears on worker boot. It is the ignored bigint-buffer build and is harmless.

## Requirements

None ticked. LAUNCH-01 is also covered by 02-07 and 02-18, LAUNCH-02 by 02-08 and 02-18, LAUNCH-06 by 02-08, 02-17 and 02-18, and FEE-10 by 02-09, 02-11, 02-14, 02-16 and 02-18.

## Threat Flags

None beyond the plan's threat model. T-02-06-01 to T-02-06-05 are mitigated: the token is compared with timingSafeEqual after a length check and is unit tested; the 16 KB cap and solIn bounds are in place; 500 bodies carry only a code and logs go through redact(); launchNet is unit tested; and the balance is returned only when a wallet is passed.

## Self-Check: PASSED

- All 11 created files are present.
- Commits 5b5deb2, a60fd4e and 989f8d9 are on phase-02-launch-flow.
