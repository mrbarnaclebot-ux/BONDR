# Phase 7: Go-Live - Research

**Researched:** 2026-10-26
**Domain:** Mainnet enablement of an existing Next.js 16 + node:http worker + pump.fun launchpad: Solana transaction v1 ingest, Helius Sender for the launch, a pump contract check, CI with a Postgres service container, one-command scripts, a SOL-pair genesis launch with child-launch gating, sniped %, and the Railway/Neon production environment.
**Confidence:** HIGH for the code inventory, v1 behaviour, Sender facts, launch byte sizes and pump layouts (all measured or read in this session against installed packages, live devnet and live mainnet). MEDIUM for CI smoke selection (the no-worker subset was run locally; the DB-backed part was not run against a container). LOW/ASSUMED where marked (Porkbun ALIAS, Neon schema-only branch behaviour, PL/pgSQL statement-trigger detail).

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied verbatim from `07-CONTEXT.md` (`<decisions>`, `<owner_gates>`, `<deferred>`).

<decisions>
## Implementation Decisions

### Carried forward (locked earlier, not re-decided)
- **C-01:** The fee mechanic follows PROJECT.md items 1-9 as proven in Phase 1. Pins stay at `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0. Fee tiers are read live, never hardcoded.
- **C-02:** Chain access, keys and the master seed stay in the worker only (FEE-10). Web reads Postgres and the worker's private bearer HTTP. Web refuses to boot if it holds the seed or the Helius key.
- **C-03:** Neon budget: a 500 CU-h/month hard quota on project `bondr`, 0.25 CU computes, no Postgres reads on a timer, and an open admin tab must not keep Neon awake (Phase 3 D-04, Phase 5 D-03, Phase 6 D-02).
- **C-04:** One worker replica. In-memory stores (trades, intents, engine state) are per process.
- **C-05:** The kill switches (launches, forced bond, sweeps, finalize, buyback burn) are `settings` columns held in worker memory (Phase 6 D-18). `FEE_ENGINE` off/dry/on is the deploy-time master flag above them (Phase 5 D-09).
- **C-06:** The forced bond and the fallback burn are sent through Helius Sender on mainnet with the Sender minimum tip, paid by ops (Phase 5 D-16, `fee-send.ts` `tipIxs`/`urgentBroadcast`). On devnet and the fork they use plain RPC. HV-05-02 verifies this on the first mainnet forced bond.
- **C-07:** Admin is fail-closed without `ADMIN_WALLET`. Every admin sign-in and money intent carries a SIWS domain line from `SITE_URL`. The web refuses sign-in without it, and the worker refuses simulate and execute without it (Phase 6 D-08, WR-B-03).
- **C-08:** The dev-buy minimum is 0.25 SOL on mainnet, scaled from live reserves (`packages/core/src/math.ts`, Phase 2 D-17).
- **C-09:** Launches auto-pause while BONDR's curve is complete but not migrated (pump 6107, `status.ts` `awaiting_migration`).
- **C-10:** No emoji anywhere. The UI shows SOL equivalents. Files stay under 300 lines, and each non-trivial change leaves one runnable check.

### Mainnet switch: inventory and how each refusal flips
- **D-01 (owner-delegated (auto)):** Mainnet is allowed only when `SOLANA_NET=mainnet` and `ALLOW_MAINNET=1` are both set.
  - Every other combination keeps refusing exactly as it does today.
  - The devnet, fork and staging paths are unchanged, and their tests stay green.
  - The refusal inventory below is the checklist. Each row gets a test that mainnet is refused without the flag and accepted with it.

  | # | Where | Today | Phase 7 |
  |---|---|---|---|
  | 1 | `apps/worker/src/env.ts:10-19` `launchNet` | throws on mainnet even with ALLOW_MAINNET=1 | returns "mainnet" when both flags are set, after rows 2-3 exist |
  | 2 | `packages/core/src/net.ts` `rpcUrl`/`wsUrl`/`connect` | no mainnet member | mainnet Helius URL (same `helius_api_key`), must report MAINNET_GENESIS from a non-local host. A local host claiming mainnet genesis still means fork, and Surfpool is still required there |
  | 3 | `packages/core/src/keys.ts` `Net = "devnet" \| "fork"`; `env.ts` `ops`/`treasury`/`buyback` typed `"devnet"` | cannot derive mainnet keys | `Net` gains "mainnet", so mainnet ids never collide with devnet or fork ids even under one seed |
  | 4 | `env.ts:71-75` and `admin-evacuate.ts:219,230` | EVACUATE `on` is refused off devnet | see D-37 (OWNER GATE G-7) |
  | 5 | `apps/worker/src/admin-inspect.ts:168` | Solscan link hardcoded `?cluster=devnet` | link built by net (reuse the web `format.ts` rule) |
  | 6 | `fee-send.ts:120,143` Sender and tip | mainnet only | unchanged: switches on by net. Re-verify the tip accounts and `SENDER_URL` against the Sender docs (fee-config.ts note) |
  | 7 | `trade-prepare.ts:55` priority fee estimate | mainnet only | unchanged |
  | 8 | `trade-quote.ts:68`, `trade-prepare.ts:96`, `packages/core/src/api.ts:237` devnet buy cap | devnet only | unchanged (it exists to protect the shared devnet BONDR curve) |
  | 9 | `fee-config.ts` mainnet values | collectMin 0.001 SOL, paceMs 0, 150 bps | `paceMs` stays 1100 on mainnet until the Helius plan changes (G-10); the rest unchanged |
  | 10 | `apps/worker/src/submit.ts` launch broadcast | plain `sendRawTransaction` on every net | Sender on mainnet (D-34) |
  | 11 | web: `wallet.tsx:230`, `format.ts:33`, `coin/[mint]/page.tsx:144`, `admin-data.ts:52` | read `SOLANA_NET` | unchanged; covered by a mainnet-config build check |
  | 12 | `VANITY_LANE` is `local \| staging` | no production lane | gains `production` (D-11) |
  | 13 | `BONDR_QUOTE_MINT` required at boot | worker cannot boot before BONDR exists | optional on mainnet only; when unset, the worker runs in genesis mode (D-29) |
- **D-02 (owner-delegated (auto)):** No new `if (mainnet)` branches beyond the rows above. Per-network values stay where they live today (`fee-config.ts`, `math.ts`). The researcher greps for any refusal this list missed and adds it here before planning.
- **D-03 (owner-delegated (auto)):** The fork keeps its "local plus Surfpool" guard. Mainnet must never be reachable from a local host. The spike scripts stay devnet and fork only.
- **D-04 (owner-delegated (auto)):** Rehearsal first. Every mainnet code path in this phase (genesis launch, Sender launch, contract check, external treasury) runs first on the Surfpool fork with the mainnet config, the same way the Phase 1 and Phase 5 fork rows ran. The fork rows are the evidence before any mainnet send.
- **D-05 (owner-delegated (auto)):** Web needs no mainnet flag of its own. It follows `SOLANA_NET`. The worker is the only sender, and it refuses mainnet without `ALLOW_MAINNET=1`.

### Production environment
- **D-06 (owner-delegated (auto); creating it is OWNER GATE G-1):** Railway project `bondr` gets a new environment, `production`, with the same two services (web public, worker private) in US East next to Neon.
  - Settings live on the services, as in staging.
  - Railway IaC (`.railway/railway.ts`, deferred from 02-16) is not built. `scripts/deploy.sh` and the worker README runbook cover deploys (ponytail: add IaC if a third environment appears).
- **D-07 (owner-delegated (auto); the owner adds the DNS records):** trybondr.fun.
  - The apex `trybondr.fun` is the custom domain on the production web service. `www.trybondr.fun` is added too and redirects to the apex in the web proxy, so the admin domain line always matches.
  - The owner adds the records Railway prints at the registrar. If the registrar cannot CNAME-flatten the apex, the owner moves DNS to Cloudflare's free DNS. That is not a money step.
  - `SITE_URL=https://trybondr.fun` is set on both web and worker.
- **D-08 (owner-delegated (auto); any plan change is OWNER GATE G-11):** Neon. Production gets its own branch, `production`, in project `bondr`, under the same quota.
  - Fixed 0.25 CU with default autosuspend.
  - Migrations run as the production web pre-deploy step, as in staging.
  - No new timer reads.
  - After go-live, the owner may scale the staging services to zero when not testing, to protect the shared quota. That is a non-money owner action, listed in the runbook.
- **D-09 (owner-delegated (auto); seed custody is OWNER GATE G-3):** Production has its own `MASTER_SEED`, never shared with staging or local.
  - Together with the `mainnet` net id (D-01 row 3), no production key equals any devnet key.
  - The seed is set on the production worker only, and the owner keeps an offline backup.
  - The shared devnet keys between local and staging (ops, treasury) and the reconcile noise they cause are accepted on devnet (see Deferred).
- **D-10 (owner-delegated (auto) for the code; the address is OWNER GATE G-2):** The treasury becomes an external address, not derived from the seed. This resolves the Phase 6 deferred item.
  - `TREASURY_PUBKEY` (a public key) is required on mainnet. On devnet and the fork, the derived treasury stays (`env.ts treasury`).
  - The engine already uses only the treasury's public key (`fee-boot.ts:62`, `admin-overview.ts`, `admin-actions.ts`, `admin-inspect.ts`), so this is a config change. No treasury signature exists in any job.
  - Boot refuses mainnet if `TREASURY_PUBKEY` is missing, equals ops, or equals any derived role.
  - Effect: after a seed leak, EVACUATE moves funds to a wallet the attacker cannot derive. The owner claims BONDR's own creator fees on pump.fun with that wallet (D-31).
- **D-11 (owner-delegated (auto)):** Vanity pool.
  - `VANITY_LANE=production`.
  - The production pool is ground on the production worker (`VANITY_THREADS` at Claude's discretion, about 2) during the dark period, so the production seed never sits on the owner's Mac.
  - Child launches open only when the pool holds at least 100 free mints (the Phase 6 health alert threshold).
- **D-12 (owner-delegated (auto)):** Production secrets are all new values, never copied from staging:
  - `WORKER_TOKEN`, `SESSION_SECRET`
  - Sentry DSNs (same bondr-web and bondr-worker projects, with environment `production`)
  - the Pinata JWT (same account is fine)
  - `helius_api_key` (same key, which works on mainnet)
  - `ADMIN_WALLET` = the owner's Phantom public key, on web and worker together. The owner supplies it; that is non-money. Until then production admin stays closed (C-07).
- **D-13 (owner-delegated (auto)):** Production boots dark.
  - `FEE_ENGINE=dry`
  - every kill switch off, launches included
  - `ADMIN_EVACUATE=simulate`
  - `BONDR_QUOTE_MINT` unset (genesis mode)
  - Nothing sends until the gates in D-39 open.
- **D-14 (owner-delegated (auto)):** The Helius mainnet websocket subscription and the RPC call volume are measured during the dark period: the RPC stats ring from Phase 6 D-26 and the credits shown in the Helius dashboard. The G-10 decision uses those numbers.

### Must-fix before mainnet
- **D-15 (owner-delegated (auto)):** v1 transaction ingest, from the 06-26 finding and STATE Pending Todos.
  - `fetchTx` (`packages/core/src/send.ts:151`) and `admin-inspect.ts:158` must handle version 1 transactions, so a coin trade sent as v1 is indexed.
  - An unsupported-version error must not be retried 20 times.
  - Signatures that touch no known BONDR coin are dropped cheaply.
  - The method is Claude's discretion and the researcher checks it: raise `maxSupportedTransactionVersion` if web3.js 1.99.0 parses v1, or fetch the JSON with a raw RPC call and decode only what ingest uses (logMessages, slot, blockTime, signer).
  - Proof: a captured devnet v1 transaction fixture (`scripts/capture-tx.ts`) goes through ingest in a unit test, and the staging logs stop showing `Transaction version (1) is not supported`.
- **D-16 (owner-delegated (auto)):** The Phase 6 security follow-ups (`06-SECURITY.md`) are folded in:
  - **IN-B-02:** a migration adds the `BEFORE TRUNCATE` statement trigger on `admin_audit` that calls `admin_audit_guard()`, and revokes TRUNCATE from the app role. A DB test asserts that TRUNCATE raises.
  - **T-06-03-03:** an automated nonce-replay test. The same admin sign-in signature is used twice, and the second gets 401.
  - **IN-W-04:** `admin-intent.ts:77` evicts expired entries first, then executed ones. When only live, unused intents remain, a new simulate gets 429 and nothing is evicted.
- **D-17 (owner-delegated (auto); the owner sets up forwarding, non-money):** The terms page contact placeholder (STATE Pending Todo) becomes `hello@trybondr.fun`. It forwards to the owner through Cloudflare Email Routing or the registrar's free forwarding. If the owner names a different handle, use that. Go-live waits for a real contact line.

### Contract check (OPS-02)
- **D-18 (owner-delegated (auto)):** The check lives in the worker. It runs at boot and then weekly, on the existing daily batch timer every 7th day at `FEE_BATCH_HOUR_UTC`, plus an on-demand admin route.
  - It uses RPC only and reads no Postgres.
  - It writes only when a mismatch pauses switches, plus one Sentry event.
  - It reuses `packages/core/src/config.ts` `readLiveConfig`. The `drift()` logic in `scripts/spike/stages/config.ts` moves into core, so the spike and the worker share it.
- **D-19 (owner-delegated (auto)):** What is checked, each with a per-network expected profile. Devnet has `creatorFeeConfigurable` false by design, so the devnet profile expects that, and the mainnet and fork profile expects true.
  - **Program IDs:** `PUMP_PROGRAM_ID`, `PUMP_AMM_PROGRAM_ID`, `PUMP_FEE_PROGRAM_ID` exist, are executable, and are owned by the upgradeable loader. Each programdata last-deploy slot is recorded.
  - **IDL layouts:** every account BONDR decodes (Global, FeeConfig, the AMM GlobalConfig and FeeConfig, BONDR's own BondingCurve or Pool once it exists) decodes with the pinned SDK, at the expected byte size and discriminator. Comparing the on-chain Anchor IDL hash is Claude's discretion, if pump publishes one.
  - **Global flags:**
    - `createV2Enabled` true
    - `creatorFeeConfigurable` per profile
    - `maxConfigurableCreatorFeeBps` at least 150
    - `maxCurveDepth` at least 1
    - the effective fee schedule equals PROJECT.md item 3 (curve protocol 95, AMM LP 20, AMM protocol 5)
- **D-20 (owner-delegated (auto)):** On a mismatch:
  1. Every kill switch is set off, launches included, through the same path EVACUATE uses to pause (no transfers).
  2. The engine pauses (switches off), and Sentry gets an error naming the failed facts.
  3. The admin Health panel's "Pump contract check" row (the mockup row Phase 6 left waiting) turns red with the facts.
  4. Switches stay off until the owner turns them back on one by one, as after EVACUATE. Nothing re-enables automatically.

  A changed programdata deploy slot with every fact still passing is a Sentry warning and an amber row, not a pause. Pump deploys often without breaking BONDR.
- **D-21 (owner-delegated (auto)):** "Forced mismatch" proof: a unit test injects a wrong expected value (and a wrong account size) and asserts every switch goes off and the row reads red. A devnet run of the real check passes against the devnet profile, and a fork run passes against the mainnet profile.
- **D-22 (owner-delegated (auto)):** Trading has no kill switch (Phase 4 D-18), so a mismatch does not block user trades. They are signed by users, and pump itself rejects a broken layout. The paused banner on the launch page names the check as the reason.

### CI (OPS-03)
- **D-23 (owner-delegated (auto)):** GitHub Actions on every push and pull request to `mrbarnaclebot-ux/BONDR`:
  - `pnpm install --frozen-lockfile`
  - `pnpm lint` (`biome ci`)
  - `pnpm typecheck`
  - `pnpm test` (Vitest)
  - `pnpm check:bundle`
  - the Playwright smoke set
  Node 24 and pnpm 10.34.6 from `package.json`.
- **D-24 (owner-delegated (auto)):** CI holds no secrets: no Helius key, no seed, no Neon URL, no Sentry token.
  - DB-backed suites (the `DB` list in `vitest.config.ts`) run against a Postgres service container in the Actions job, with migrations applied. CI never touches Neon or its CU quota.
  - Suites that need devnet RPC or the seed skip when their env is missing, with a printed reason. They do not fail.
- **D-25 (owner-delegated (auto)):** The Playwright smoke set is the specs that pass against `next build` plus `next start`, with the Postgres container and route stubs (`launch-stubs.ts`, `trade-stubs.ts`, `admin-stubs.ts`) and no worker or chain. It is selected by an `@smoke` title tag and run with `--grep @smoke` on desktop Chrome only.
  - Target: under 5 minutes.
  - Candidates: terms, home empty state, launch form validation, coin page with a stubbed coin, admin-locked (fail-closed), wallet connect UI with the fake Phantom.
  - The researcher confirms which run without a worker.

### Scripts (OPS-04)
- **D-26 (owner-delegated (auto)):** Four entry points in `scripts/`, each wired as a root `package.json` script:
  - **`setup.sh`:** checks node 24 and pnpm, runs `pnpm install`, copies `.env.example` to `.env` if missing, generates a local seed file outside the repo if missing (`spike:keys`), and runs `db:migrate` when `DATABASE_URL` is set.
  - **`dev.sh`:** worker plus web together, with both logs prefixed, and Ctrl-C stops both.
  - **`test.sh`:** lint, typecheck, Vitest and the smoke set, the same steps as CI. `--full` adds the full Playwright run.
  - **`deploy.sh <staging|production>`:** `railway up`, web first when a new migration exists (otherwise worker first), as in the worker README.
- **D-27 (owner-delegated (auto)):** `deploy.sh production` asks for the typed word `production` (or `--yes` in non-interactive use) before uploading, because it is an outward-facing action (AGENTS.md section 2). It refuses from a dirty tree or from a branch other than `main`. `scripts/README.md` lists all four.

### BONDR genesis launch and child-launch gating (OPS-05)
- **D-28 (owner-delegated (auto)):** BONDR launches through BONDR's own launch page and worker flow, as PROJECT.md default 4 requires.
  - Pair: SOL. Creator: the treasury (`TREASURY_PUBKEY`, D-10). Exit: insta burn only. Creator fee: the network default, with no `creator_fee_bps`.
  - The mint comes from the `bndr` vanity pool.
  - The dev is the owner's Phantom (`ADMIN_WALLET`). It signs and pays the dev buy, and the buy is burned in the same transaction.
  - The worker co-signs with the mint key under the same rule as every launch (the exit must be present).
  - This needs the SOL-quote path in the Phase 2 launch builder (STATE Blockers: "BONDR's own launch is a SOL pair"). `buildCreate` already takes `quoteMint` as optional. The SOL path is create_v2 without a quote, `buy` with SOL, then burn. Whether it needs a lookup table is measured.
- **D-29 (owner-delegated (auto)):** Genesis mode is the worker on mainnet with `BONDR_QUOTE_MINT` unset.
  - The indexer, engine, trade routes and child launch prepare answer `not_ready`. The launch page shows the existing paused banner: "Launches open after the BONDR token is live".
  - The only launch prepare accepted is the genesis launch, and only from `ADMIN_WALLET` with a valid admin session.
  - After it lands, the owner sets `BONDR_QUOTE_MINT` to the new mint on web and worker, and redeploys (runbook step).
  - The worker refuses to boot in genesis mode on devnet, so devnet behaviour is unchanged.
  - The admin cookie and a fresh signature authorize the genesis launch, the same as any money action.
- **D-30 (owner-delegated (auto)):** Child launches open only when all of these hold:
  1. `BONDR_QUOTE_MINT` is set and the mint exists on chain as a pump coin.
  2. The contract check passes.
  3. The vanity pool holds at least 100 free mints.
  4. The owner flips the launches switch on (G-9).

  BONDR does not have to bond before child launches open. This resolves the PROJECT.md risk row. Reasons: the 6107 auto-pause (C-09) covers the complete-but-unmigrated window, which lasts seconds, and SOL routes through BONDR's pool after migration (Phase 1 row migrated.multihop.buy).
- **D-31 (owner-delegated (auto)):** BONDR's own creator fees accrue to the treasury's creator vault, and the owner claims them on pump.fun with the treasury wallet. No engine job is added. This resolves the Phase 5 deferred item "collecting BONDR's own creator fees". BONDR is not a BONDR-quoted child coin, so no W, split, sweep or finalize applies to it.
- **D-32 (owner-delegated (auto)):** BONDR genesis metadata is name "BONDR", ticker "BONDR", the description from PROJECT.md "What This Is" in one line, and the image from the existing brand art in `apps/web/public/art`, pinned through Pinata. The owner may swap the copy or image before G-5. That is non-money.
- **D-33 (owner-delegated (auto)):** Fork rehearsal. The genesis launch (SOL pair, creator = an external treasury key, insta burn), then a child launch quoted in the new BONDR, run on the Surfpool fork with the mainnet profile before G-5. Signatures are recorded as spike-style rows.

### Sniping
- **D-34 (owner-delegated (auto) for the code; the tip amount is OWNER GATE G-6):** On mainnet, the launch transaction is broadcast through Helius Sender.
  - The tip transfer is inside the dev-signed transaction: added at prepare, because submit byte-compares the signed message (`submit.ts:43-56`). The tip account is not in the lookup table.
  - Reuse `tipIxs` and `urgentBroadcast` from `fee-send.ts`. Devnet and the fork keep plain RPC.
  - The tip is shown in the launch cost preview (`networkFee`).
  - A size assertion in the launch compile covers the migrated-BONDR insta-sell case, about 70 B of headroom (SNIPING.md). If the measured case exceeds 1,232 bytes, that case keeps plain RPC and logs it. It never fails the launch.
  - Track it as a new requirement, LAUNCH-08 ("mainnet launches are sent through Helius Sender with the tip inside the dev-signed transaction").
- **D-35 (owner-delegated (auto)):** "Sniped %" on the token page.
  - Each coin records its create slot, read from the launch landing, which already settles from chain.
  - Formula: supply bought by wallets other than the dev and W in slots createSlot to createSlot + 2, divided by total supply. It is computed from `trades.slot` with one query and no new table.
  - It is written to the coin row when it changes (the Phase 5 D-23 pattern), never computed on a timer.
- **D-36 (owner-delegated (auto)):** Copy states plainly: "BONDR cannot stop third-party buys at launch. This shows how much was bought in the first 3 slots." Never say "sniper-proof". It is one line in the token page proof area, following the existing proof styling. gsd-ui-phase covers it with the genesis-mode banner and the launch tip line. That is a small UI-SPEC.

### EVACUATE on mainnet and seed rotation
- **D-37 (code owner-delegated (auto); unlocking on production is OWNER GATE G-7):** Code change: `ADMIN_EVACUATE=on` is accepted on mainnet only when `TREASURY_PUBKEY` is set and passes the D-10 checks. It stays accepted on devnet as today. Every other net and combination still refuses at boot and in the loop (`env.ts:74`, `admin-evacuate.ts:219,230`).
  - Production boots with `simulate` (D-13). The owner flips it to `on` after reading the runbook.
  - Tests cover both mainnet branches: refused without the treasury, accepted with it. This closes the untested non-devnet branch noted in T-06-08-06.
- **D-38 (owner-delegated (auto)):** The worker README gains a mainnet incident runbook:
  1. Leak signal: an unexpected outflow from any W, ops or buyback.
  2. EVACUATE, the steps as in Phase 6.
  3. Rotate the seed: a new `MASTER_SEED`, so new launches derive new W, a new ops and a new buyback. Fund the new ops.
  4. What rotation cannot fix: unbonded coins keep their old W as the on-chain creator, so the attacker can still collect those coins' future fees. Finalized coins pay through their sharing config and are unaffected.
  5. Hide or announce the affected coins.

  It is documentation only, with no new code.

### Rollout order (D-39)
- **D-39 (owner-delegated (auto) as an order; every money step is a gate):**
  1. Phase 7 code merged with CI green. Fork rehearsals D-04 and D-33 pass.
  2. **G-1:** create Railway production and deploy dark (D-13). Owner: DNS, `ADMIN_WALLET`, contact forwarding.
  3. **G-2, G-3:** treasury address and production seed set. The contract check passes on mainnet, and the vanity pool starts grinding.
  4. **G-4:** fund ops.
  5. **G-5:** the BONDR genesis launch from the owner's Phantom. Then set `BONDR_QUOTE_MINT` and redeploy.
  6. **G-8:** `FEE_ENGINE=on`.
  7. **G-6** decided before the first child launch. **G-10** decided before public launches.
  8. **G-9:** first owner or friend child launch, then the launches switch goes on.
  9. **G-7:** EVACUATE on, at any time after G-2.

  HV-05-02 is checked on the first mainnet forced bond.

### Anti-vamp: 24h ticker cooldown (owner request 2026-10-26)

Source: owner asked for "anti vamp measures like ticker cooldowns for 24 hours"; design in `.planning/research/ANTI-VAMP.md`. BONDR lists only coins it launched (`ingest.ts:19` knownCoins), so the cooldown covers the whole BONDR namespace; coins launched directly on pump.fun are outside it by nature.

- **D-40 (owner-delegated (auto)):** A ticker cannot be launched through BONDR again within 24h of the last landed BONDR launch with the same ticker. The window is fixed from landing (not traction-based). Checked in `admit` (`prepare.ts:132`) as one more read in the existing `Promise.all`, before the balance RPC, vanity reservation and table spend. One indexed read per prepare, no polling (Neon quota).
- **D-41 (owner-delegated (auto)):** Key = the stored symbol as is: `checkSymbol` (`rules.ts:31`) already restricts tickers to uppercase A-Z0-9, so case, `$`, whitespace, homoglyph and zero-width tricks cannot reach it. No leet fold (`0`/`O`, `1`/`I`). No exemption for the original creator wallet. Hidden coins keep their lock.
- **D-42 (owner-delegated (auto)):** What holds the lock: landed launches for 24h; signed, sent and unknown launches; a fresh `prepared` row from another wallet for its 3-minute life. Failed and expired launches free it. Index: a partial index on `launches (symbol, landed_at)` over non-failed states in a NEW migration (0008, alongside the D-xx admin_audit TRUNCATE trigger; 0007 is Phase 6's and is already applied on staging). Race safety comes from prepare's single-flight (`prepare.ts:285-291`); `ponytail:` comment naming the `ticker_locks` upsert upgrade if the worker is ever duplicated.
- **D-43 (owner-delegated (auto)):** Refusal: new `LaunchErrorCode` `ticker_locked` (409 in `http.ts`, a FAULTS entry in `launch-sign.tsx`), `ApiError.retryAfter` seconds, copy shows exact time remaining, e.g. "$PEPE launched on BONDR 3h ago. Try again in 21h." The terms page gains one sentence about the 24h ticker cooldown.
- **D-44 (owner-delegated (auto)):** A static reserved-ticker list in code (BONDR, SOL, USDC, USDT, WSOL) refused with its own copy. Search lists the oldest coin first among exact ticker matches and marks it "First" (UI spec addendum for the marker).
- Deferred: traction-based lock start (anti-squat), image-CID duplicate check, name normalisation match, admin "release ticker" override, perceptual image hashing.

### Claude's Discretion
- The v1 ingest fix method (D-15), as long as the proof holds.
- How the contract check compares IDL layouts (sizes and discriminators at minimum; an on-chain IDL hash if available), and where its last result is held (memory, like the other health rows).
- The smoke spec list and tag mechanics (D-25). The Postgres version in CI (match Neon's major version).
- `VANITY_THREADS` on production. The exact `dev.sh` process runner (plain shell `trap` preferred over a new dependency).
- The www-to-apex redirect mechanism (Next proxy, or Railway if it offers one for free).
- How genesis mode surfaces in `/status` and the paused-reason enum.
- The mainnet `OPS_FLOOR_LAMPORTS` value within G-4's recommendation.

</decisions>

<owner_gates>
## OWNER GATES (not approved; each needs the owner's explicit confirmation before execution)

| Gate | What | Recommended default | Why it is a gate |
|---|---|---|---|
| **G-1** | Create the Railway `production` environment and deploy it dark (mainnet deploy timing) | Create it as soon as Phase 7 code passes review and CI. Deploy with `SOLANA_NET=mainnet`, `ALLOW_MAINNET=1`, `FEE_ENGINE=dry`, every switch off, `ADMIN_EVACUATE=simulate`, genesis mode. Expected about +$5-15/month of Railway usage, within the $100 budget | Adds Railway billing and puts a mainnet worker online |
| **G-2** | The treasury address (`TREASURY_PUBKEY`) that receives the 10% splits, the 10% sweep share, the permanent 20% post-bond share, EVACUATE funds and BONDR's creator fees | A new wallet held only by the owner (a fresh Phantom account or a hardware wallet), not derived from the seed and not the admin wallet. Required on mainnet | Every finalize locks it permanently into each coin's sharing config |
| **G-3** | Production master seed: generation and offline backup | Owner generates 32 random bytes (`openssl rand -base64 32`), sets `MASTER_SEED` on the production worker only, and keeps an offline copy. Never reused from staging or local | Custody of every mainnet W, ops and buyback wallet. Losing it strands funds, and leaking it exposes them |
| **G-4** | Initial mainnet ops funding and floor | 0.5 SOL from the owner to the production ops address. Raise the mainnet `OPS_FLOOR_LAMPORTS` to 0.1 SOL. The low-ops alert triggers manual top-ups (PROJECT.md item 9) | Real SOL |
| **G-5** | The BONDR genesis launch on mainnet: timing, dev buy and metadata | After G-1..G-4, a passing mainnet contract check and the fork rehearsal (D-33). Dev buy 0.25 SOL (the minimum), insta burned, from the owner's Phantom. Metadata per D-32 | Real SOL is spent and burned, and the mint is permanent |
| **G-6** | The Sender tip on launches, paid by creators inside their launch transaction | 0.001 SOL (the Sender full-path minimum, about 0.4% of a 0.25 SOL dev buy), shown in the cost preview. The alternative is 0.000005 SOL (SWQOS-only, fewer relays) | Every creator pays it |
| **G-7** | Unlock EVACUATE execution on mainnet (`ADMIN_EVACUATE=on` on production) | The code allows it on mainnet only with `TREASURY_PUBKEY` set (D-37). Production starts at `simulate`. The owner flips it to `on` right after G-2, once the runbook (D-38) is read, because PROJECT.md relies on EVACUATE as the seed-leak response | It moves every W balance on mainnet |
| **G-8** | Turn the fee engine on for mainnet (`FEE_ENGINE=on`) | Turn it on right after genesis lands and `BONDR_QUOTE_MINT` is set, before the first child launch, so no coin ever runs unmanaged | The engine sends real-money transactions (splits, sweeps, forced-bond burns, ops-paid tips) |
| **G-9** | Open child launches (launches switch on) | After G-8, a pool of at least 100 mints and one owner or friend test launch on mainnet (that dev pays 0.25 SOL plus the G-6 tip) | First real launches. Strangers' SOL goes through the flow |
| **G-10** | Helius plan | Stay on the current plan for the dark deploy and genesis (`paceMs` 1100 on mainnet). Upgrade to Developer ($49/month, already in the PROJECT.md budget) before child launches open to the public, or earlier if the D-14 numbers show 429s or credits above 80% | Billing change |
| **G-11** | Neon plan | No upgrade. Production is a branch in project `bondr` under the 500 CU-h quota (D-08). Upgrade to Launch (about $19/month) only if the projected monthly usage passes 400 CU-h | Billing change |

Already decided earlier, to confirm at first use (not a new gate): the forced-bond and fallback-burn Sender tip of 0.001 SOL paid by ops (Phase 5 D-16), checked by HV-05-02 on the first mainnet forced bond.

Owner actions that need a human but no money (no gate, but they block go-live):
- DNS records for trybondr.fun.
- The contact email forwarding (D-17).
- The production `ADMIN_WALLET` value.
- `SENTRY_READ_TOKEN`.
- HV-06-01 and HV-06-02 on staging.
- Optional swaps of the BONDR genesis copy or image.

</owner_gates>

<deferred>
## Deferred Ideas

- **Meteora DBC lane:** parked by the owner on 2026-10-26. Stay on pump for v1. Revisit as a second lane in a later milestone, starting with a one-phase devnet spike (`.planning/research/METEORA.md`).
- Separate seeds for local and staging, to end the devnet reconcile noise from shared ops and treasury keys. Accepted on devnet for now, because changing it orphans staging coins' W.
- Railway IaC (`.railway/railway.ts`): add if a third environment appears.
- Wallet exclusion lists and delayed public listing against snipers (SNIPING.md items 4): only if a feature needs them.
- Reclaiming launch lookup table rent: a later chore (Phase 6 Deferred).
- A Postgres leader lock and a multi-replica worker, and a trading kill switch: unchanged from Phase 6.
- Site-wide burn totals and the home ledger tape: a later phase (Phase 5 Deferred).
- The Phase 6 Designer notes (admin h2 wrapping at 390, the long "Last runs" null value, EVACUATE count copy): polish only, not go-live blockers.

</deferred>
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-02 | A weekly contract check verifies the pump program IDs, the IDL account layouts and the Global flags BONDR depends on, and pauses jobs on a mismatch | Pattern 5 (contract check), measured devnet and mainnet profiles (program owner, deploy slots, account sizes, discriminators, Global flags, fee schedules), Pitfalls 6-9 |
| OPS-03 | CI runs lint, tests and a Playwright smoke test on every push | Pattern 8 (workflow), smoke subset run locally with no worker and no DB (29 tests passed), Pitfalls 12-14 |
| OPS-04 | `scripts/` has one-command setup, dev, test and deploy | Pattern 9, Pitfall 15 (the `test` script name collision) |
| OPS-05 | BONDR token is launched on mainnet through BONDR; child launches enable only after it exists | Pattern 6 (genesis mode and the SOL-pair builder), Pitfalls 3-5 (settings default true, backfill indexing BONDR as a coin, refill never reaching 100) |
| LAUNCH-08 (new, D-34) | Mainnet launches are sent through Helius Sender with the tip inside the dev-signed transaction | Pattern 2 (tip at compile, Sender chosen at submit by scanning the stored message), measured +49 to about +81 B, worst case 1,003 B of 1,232 |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- No code before an approved spec (the spec and CONTEXT are approved; owner-delegated auto mode is in force).
- No emoji anywhere: code, UI, commits, docs.
- Never break the build: tests green and app runnable after every change.
- Never silently narrow or widen scope.
- Never commit secrets; `.env` with a committed `.env.example`. CI holds no secrets (D-24).
- Ask before destructive or outward-facing actions: deploys, force pushes, anything external. `deploy.sh production` asks for the typed word (D-27). Every money step is an OWNER GATE.
- Files under 300 lines, functions under 40 lines, three directory levels, a README in any directory with more than five files. Comments say why. Dead code deleted. `ponytail:` comments on deliberate shortcuts.
- Database constraints over application checks.
- Feature flags for anything risky (ship dark).
- `scripts/` with one-command setup, dev, test and deploy. CI runs lint, tests and a Playwright smoke test on every push.
- Every UI phase ends with Playwright screenshots at mobile, tablet and desktop widths; Designer `critique` and `audit`.
- One runnable check per non-trivial change. No new test frameworks (Vitest and Playwright exist).
- Branch per phase (`phase-07-go-live`), commit after every green task, PR per phase, never force push.
- Prefer `rg`, targeted reads; route noisy work to haiku.

## Summary

Phase 7 is mostly plumbing on code that already exists, but four findings change the plan. First, the v1 ingest fix is one line in one place. Transaction v1 (SIMD-0385, the 4,096-byte format of SIMD-0296) went live on mainnet at epoch 1035 on 2026-09-15. Every RPC read must pass `maxSupportedTransactionVersion: 1` or it fails with -32015. The installed `@solana/web3.js` 1.99.0 already decodes v1 responses (`MessageV1`, `versionedMessageFromResponse` version-1 branch). I checked that against Helius devnet with a real v1 transaction (`AQ5D3WBU...`) that sells the devnet BONDR mint through a third-party router. Our parser reads plain JSON fields (`accountKeys`, `innerInstructions`, `loadedAddresses`), and that v1 response has exactly that shape. Run on the response, it decoded 4 pump events and no errors. So `fetchTx` (`packages/core/src/send.ts:151`) and `admin-inspect.ts:158` change 0 to 1. A -32015 must not be retried. No upgrade and no `@solana/kit` are needed.

Second, the "about 70 B headroom" for the Sender tip (SNIPING.md) is wrong. The 1,064 and 1,163 B figures are create-only transactions with no lookup table. The real launch transactions with their per-coin table are 780/881 B (curve BONDR, burn/sell) and 921/954 B (migrated BONDR, burn/sell) in the spike rows. Measured on the captured migrated insta-sell message, a dev-paid tip transfer adds 49 B (System Program is already static there). Where System Program sits in the table, it adds about 81 B. The worst case is therefore about 1,003 B, with 229 B of headroom. The D-34 fallback stays as a guard, but it will practically never fire.

Third, the contract check needs a real devnet profile, not just `creatorFeeConfigurable: false`. Live devnet has an all-zero exotic AMM schedule, so its effective AMM LP fee is the flat 25 bps, not 20. Devnet `maxConfigurableCreatorFeeBps` is 0. A check that applies D-19's "AMM LP 20" and ">= 150" to devnet would pause staging on its first run. Mainnet passes every fact today: create_v2 on, creator fee configurable with a 300 bps max, depth 2, curve 95, AMM LP 20, AMM protocol 5. Program owners, Anchor discriminators and the four config account sizes are identical on both networks (Global 1,088 B, the two FeeConfigs 4,097 B each, AMM GlobalConfig 949 B).

Fourth, there are three production-state traps the code would walk into. Migration 0000 seeds `settings` with every switch true, so a fresh production branch boots with launches on, against D-13. The boot backfill would index the genesis launch as a BONDR coin once `BONDR_QUOTE_MINT` is set. The vanity refill only grinds while fewer than 10 mints are ready (up to 20), so the production pool never reaches the 100 that D-30 requires.

**Primary recommendation:** Install no new packages. Raise the version to 1 at the single `fetchTx` choke point. Put the tip in `compileLaunch`, outside the lookup table. Choose Sender at submit by scanning the stored message for a tip transfer. Give the contract check measured per-network profiles. Make genesis mode force every switch off at boot. Gate CI's smoke run on `E2E_BASE_URL` against `next start` with a Postgres 18.6 service container, which needs no Playwright config change.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| v1 transaction read and decode | Worker (core `send.ts` `fetchTx`) | — | Only the worker reads chain (C-02) |
| Sender tip in the launch tx | Worker prepare (`build.ts` `compileLaunch`) | Web shows `senderTipEstimate` | The byte compare at submit means the tip must be in the stored message |
| Sender broadcast | Worker submit (`submit.ts` via `fee-send.ts` `urgentBroadcast`) | — | Only the worker sends |
| Mainnet net, keys, external treasury | Worker `env.ts`, core `net.ts`/`keys.ts` | Web follows `SOLANA_NET` (D-05) | Seed and RPC live in the worker |
| Contract check | Worker (RPC only, memory result) | Web health cell and admin route forwarder | No Postgres reads (C-03); pause writes reuse `switches.ts` |
| Genesis mode and genesis prepare | Worker (`main.ts` boot branch, new `genesis.ts`) | Web launch page (admin cookie gates the owner variant; the worker gates on `ADMIN_WALLET`) | The worker is the only gate that matters: the payer must be ADMIN_WALLET, so only the owner can sign |
| Sniped % | Worker ingest writes `coins.sniped_bps` | Web reads the coin row | D-35: written when it changes, never on a timer |
| CI | GitHub Actions + Postgres service container | — | No Neon, no secrets (D-24) |
| Production env | Railway (web public, worker private), Neon branch `production` | Porkbun DNS (owner) | D-06..D-08 |

## Standard Stack

### Core (all installed; no new packages)

| Library | Version (installed) | Purpose | Phase 7 fact |
|---------|---------------------|---------|--------------|
| `@solana/web3.js` | 1.99.0 | RPC, messages | Reads v1 (`MessageV1` exported; `getTransaction` decodes version 1 when asked with `maxSupportedTransactionVersion: 1`). Cannot build, sign or serialize v1 (`MessageV1.serialize` throws). We never build v1. [VERIFIED: node_modules/.pnpm/@solana+web3.js@1.99.0/lib/index.cjs.js:1186-1300, 4794-4808; live Helius devnet call] |
| `@pump-fun/pump-sdk` | 4.1.0 (pinned, C-01) | create_v2, buy_v3, IDL, PDAs | `createV2Instruction` with no `quoteMint` is a SOL coin; `creatorFeeBps` is ignored on SOL (`index.d.ts:46090-46125`). [VERIFIED: installed d.ts] |
| `@pump-fun/pump-swap-sdk` | 2.1.0 (pinned) | AMM IDL, GlobalConfig, FeeConfig PDAs | Account discriminators read from `pumpAmmJson` |
| `vitest` | 4.1.11 | Unit and DB projects | Unit project: 80 files, 601 tests, 5 s with no DB (run this session) |
| `@playwright/test` | 1.63.0 | e2e and smoke | `tag: "@smoke"` + `--grep @smoke` [CITED: playwright.dev/docs/test-annotations] |
| `@biomejs/biome` | 2.5.15 | `pnpm lint` = `biome ci .` | unchanged |
| `typescript` | 7.0.2 | `pnpm typecheck` | unchanged |
| Node | 24.x (`engines`), 24.13.0 local | runtime | `--env-file-if-exists` exists (tested); `--env-file` exits 9 on a missing file (tested) |
| pnpm | 10.34.6 (`packageManager`) | installs | `pnpm/action-setup@v6` reads `packageManager` |

### Supporting (tools, not npm deps)

| Tool | Version | Purpose |
|------|---------|---------|
| GitHub Actions `actions/checkout` | v7 (v7.0.1, 2026-07-20) | CI [VERIFIED: gh api releases/latest] |
| `actions/setup-node` | v7 (v7.1.0, 2026-10-08) | Node 24 + `cache: pnpm` [VERIFIED: gh api] |
| `pnpm/action-setup` | v6 (v6.1.0, 2026-09-05) | pnpm from `packageManager` [VERIFIED: gh api, README] |
| Docker image `postgres` | 18.6 | CI DB, matches Neon (Postgres 18, project `bondr`, `pg_version: 18`) [VERIFIED: docker-library tags; neonctl api] |
| Railway CLI | 5.71.0 | `environment new --duplicate`, `domain`, `up --ci`, `deployment list --json`, `variable set --stdin`, `ssh` [VERIFIED: local `--help`] |
| neonctl | installed | `branches create`, quota reads [VERIFIED: local] |
| Surfpool | 1.6.1 (`scripts/spike/fork.sh`) | Fork rehearsals; v1-capable from 1.5 [CITED: solana.com/upgrades/larger-transaction-sizes] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `maxSupportedTransactionVersion: 1` on web3.js 1.99.0 | Raw JSON `getTransaction` and decode only what ingest uses (D-15 option 2) | Unneeded: 1.99.0 already decodes v1, and the parser is already shape-agnostic. Raw JSON would duplicate `fetchTx` |
| web3.js 1.99.0 | `@solana/web3.js` 3.x or `@solana/kit` 8 | Only needed to build or sign v1. BONDR builds v0 with lookup tables (v1 has no ALTs), so no |
| `E2E_BASE_URL` against `next start` in CI | A `E2E_SMOKE` branch in `playwright.config.ts` that drops the worker webServer | The config branch is more code. `E2E_BASE_URL` already skips both webServers, and the smoke specs pass in that mode (run this session) |
| Railway `environment new production --duplicate staging` | Empty environment + recreate both services by hand | Duplicate copies service settings (build, start, pre-deploy, healthcheck) but also every staging variable, including `MASTER_SEED`. Use duplicate, then overwrite every variable before approving the staged deploy, with a hash-compare check (Pitfall 18) |

**Installation:** none. `pnpm install --frozen-lockfile` only.

## Package Legitimacy Audit

No npm, PyPI or crates packages are added in this phase. slopcheck was not run because there is nothing to check. Third-party code that CI will execute:

| Artifact | Registry | Source | Disposition |
|----------|----------|--------|-------------|
| `actions/checkout@v7` | GitHub Marketplace | github.com/actions/checkout (GitHub-owned) | Approved |
| `actions/setup-node@v7` | GitHub Marketplace | github.com/actions/setup-node (GitHub-owned) | Approved |
| `pnpm/action-setup@v6` | GitHub Marketplace | github.com/pnpm/action-setup (pnpm org) | Approved |
| `postgres:18.6` | Docker Hub official image | docker-library/official-images | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────── mainnet / devnet RPC (Helius) ────────────┐
                         │                                                        │
 logsSubscribe(BONDR) ──►│ stream.ts onMessage ─► queue ─► ingestOrKeep           │
 (not version-gated)     │                                   │                    │
                         │                     fetchTx(sig, maxSupportedTxVer=1)  │
                         │                       │ ok (legacy|0|1)   │ -32015      │
                         │                       ▼                   ▼            │
                         │                  parseTx (shape-       drop, log once, │
                         │                  agnostic JSON)        no retry        │
                         │                       │ no known coin ─► return [] (1 call)
                         │                       ▼                                │
                         │                writeParsed ─► trades, coins (+sniped_bps when a
                         │                               window trade is new)     │
                         └────────────────────────────────────────────────────────┘

 Launch (child or genesis)
 browser ─POST /api/launch/prepare─► web (cookie, consent) ─► worker /prepare
     worker: guards ─► reserve bndr mint ─► table keys (tip NOT included) ─► ensureTable (ops pays)
             ─► build ixs: child = buildLaunch(BONDR-quoted) | genesis = buildGenesis(SOL pair, creator TREASURY_PUBKEY, burn)
             ─► compileLaunch(ixs + [tip transfer dev->SENDER_TIPS[i]] on mainnet) ─► size <= 1232? else recompile without tip
             ─► simulate (dev balance drop includes tip) ─► store message bytes
 browser signs (Phantom) ─POST submit─► worker cosign (byte compare, exit present) ─► mint signature
     ─► stored message has a SENDER_TIPS transfer? yes: urgentBroadcast (Sender) ─► on explicit Sender error: same bytes via RPC
                                                   no:  broadcast (RPC)
     ─► settle by signature ─► genesis: mark landed, no ingest | child: ingestLaunch (create slot, sniped window)

 Contract check (worker, RPC only)
 boot ─┐                                   ┌─ all facts pass, deploy slot same ─► memory: passed (leaf)
 weekly (UTC weekday at FEE_BATCH_HOUR) ─┼─► checkContract(conn, profile[net]) ─┼─ facts pass, deploy slot moved ─► memory: redeployed (amber) + Sentry warning
 POST /admin/contract-check ─┘             ├─ any fact fails ─► switchesOff() (no evacuated_at) + audit row + Sentry error ─► memory: mismatch (red)
                                           └─ RPC error, no facts ─► memory: could not run (amber), nothing paused
 admin health poll (10 s, memory) ─► web health cell "Pump contract check"

 Boot modes (main.ts)
 loadEnv ─► net=mainnet needs ALLOW_MAINNET=1 + TREASURY_PUBKEY checks
        ─► BONDR_QUOTE_MINT unset? mainnet: GENESIS MODE (switches forced off, no index/engine/stream, /status paused "genesis",
                                    only ADMIN_WALLET genesis prepare)   devnet: refuse boot
                                   set: verify Q is a SOL-pair pump coin with creator = treasury (mainnet) ─► normal boot
```

### Recommended Project Structure (new and touched files)

```
.github/workflows/ci.yml          # OPS-03
scripts/setup.sh dev.sh test.sh deploy.sh   # OPS-04 (+ scripts/README.md rows)
packages/core/src/
├── send.ts            # fetchTx version 1 (line 151)
├── net.ts             # mainnet rpcUrl/wsUrl/connect branch
├── keys.ts            # Net gains "mainnet"
├── contract.ts        # NEW: program/account/flag checks + drift (moved from scripts/spike/stages/config.ts)
├── launch.ts          # buildGenesis (SOL pair) next to buildLaunch (237 lines; or launch-genesis.ts)
└── migrations/0008_*.sql  # drizzle-generated: launches_symbol_live index, coins.create_slot, coins.sniped_bps; hand-appended TRUNCATE trigger + revoke
apps/worker/src/
├── env.ts             # launchNet, TREASURY_PUBKEY, optional BONDR_QUOTE_MINT, EVACUATE rule, lane production
├── contract-check.ts  # NEW: schedule, memory result, pause on mismatch, admin route handler
├── genesis.ts         # NEW: genesis prepare (prepare.ts is at 293 lines)
├── build.ts           # compileLaunch(…, tip?)
├── submit.ts          # Sender when the stored message carries a tip
├── status.ts          # net from env, pauseReason genesis/contract_check, senderTipEstimate
├── ingest.ts / sniped.ts  # sniped_bps write (ingest.ts is 258 lines)
├── admin-intent.ts    # IN-W-04 eviction
└── grind.ts           # per-lane refill thresholds
```

### Pattern 1: v1 ingest (D-15)

**What:** Change `maxSupportedTransactionVersion` 0 to 1 at the one shared fetch, and drop -32015 without retrying.
**Facts:**
- v1 = SIMD-0385 format (version byte 0x81 at offset 0, signatures last, compute budget in a config mask, no lookup tables, no duplicate keys) for the SIMD-0296 4,096-byte limit. Mainnet active since epoch 1035, 2026-09-15 about 01:00 UTC; devnet and testnet active. [CITED: solana.com/upgrades/larger-transaction-sizes; github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md]
- RPC: the value must be the integer `1`. `0` or omitted gives -32015 on `getTransaction`; `"1"` gives -32602. `getSignaturesForAddress` is unaffected. v1 responses carry `message.transactionConfig`. [CITED: same page; VERIFIED live]
- Live probe, 2026-10-26: devnet signature `AQ5D3WBUa6Ha2Ggk6DEBNQBh4wQMFTvJUbDbx1seNX9DdH8283qAkJPqzAh5GZgLfFKo25EKabAjFDkkWsMqWYo` (slot 515272717, program `5CUaiAeF...`, 38 static keys, 192 log lines, `loadedAddresses` empty). Helius devnet: version 0 gives `SolanaJSONRPCError` code -32015, version 1 decodes as `version: 1`. Our `innerEvents` returns 4 events (2 pump `TradeEvent`s selling the devnet BONDR mint `4Jw2pr67...`); `parseTx` with no known coins gives 0 trades, 0 patches, no throw. [VERIFIED: this session]
- `logsSubscribe` is not version-gated: staging logs show the stream already queues these v1 signatures (deferred-items 06-26).

**Call sites (all):**
| File:line | Change |
|---|---|
| `packages/core/src/send.ts:151` `fetchTx` | 0 to 1. Covers ingest (`ingest.ts:123,249`), settle (`settle.ts:94`), trade submit (`trade-submit.ts:71`), fee meta (`fee-send.ts:220`), finalize (`fee-finalize.ts:54`), and the scripts that use it |
| `apps/worker/src/admin-inspect.ts:158` | 0 to 1. `MessageV1` has `getAccountKeys`, `isAccountSigner`, `isAccountWritable`, `compiledInstructions`, so `instructionsOf` works unchanged |
| `apps/worker/src/ingest.ts:174-184` `ingestOrKeep` | On `e instanceof SolanaJSONRPCError && e.code === -32015`: delete from `failed`, log once, return (no retry) |
| `scripts/capture-tx.ts:38` | raw read 0 to 1, so it can capture the v1 fixture |
| `apps/web/e2e/fixtures.ts:145`, `scripts/spike/stages/pool-launch.ts:36` | 0 to 1 (safe superset) |

"Dropped cheaply": the logs notification carries no account list (pump events are emit_cpi inner instructions, not logs), so a fetch is unavoidable. After the fix a non-BONDR v1 signature costs exactly one `getTransaction` and no DB write, because `ingestTx` returns `[]` when nothing parses (`ingest.ts:126`). Today it costs 20 calls.

**Fixture plan:** capture `AQ5D3WBU...` as `packages/core/src/fixtures/v1-bondr-sell.json` with the fixed `capture-tx.ts` (`--net devnet --mint 4Jw2pr67...`; it is devnet chain data and public). Unit test: `innerEvents` gives 4 events, `parseTx` with the devnet BONDR context gives a BONDR price, 0 coin trades. A second derived test proves a v1-shaped coin trade indexes: transform `curve-buy.json` by appending `loadedAddresses.writable` then `.readonly` to `accountKeys` (index space is static then writable then readonly, so indices are unchanged), set `loadedAddresses` empty and `version: 1`, then assert `parseTx` output equals the v0 fixture's. A `stream`/`ingest` unit test with an injected ingest that throws `new SolanaJSONRPCError({code: -32015, message: "..."})` asserts `failedSigs()` stays empty.

### Pattern 2: Sender for the launch with the tip inside the dev-signed tx (D-34, LAUNCH-08)

**Facts (Helius docs, fetched 2026-10-26):** [CITED: helius.dev/docs/sending-transactions/sender]
- Endpoint `https://sender.helius-rpc.com/fast` (global HTTPS) matches `fee-config.ts:11`. Regional HTTP endpoints exist for backends.
- Every `sendTransaction` must carry a tip transfer and a `setComputeUnitPrice` in the same transaction, or it is rejected. Minimums: 0.001 SOL for all paths ("Sender Max"); 0.000005 SOL with `?swqos_only=true`. Tips in between are accepted on fewer paths.
- The 10 tip accounts listed match `fee-config.ts:12-23` exactly.
- Rate limit: keyless 1 request/s per egress IP per region; with `?api-key=` 50/s per key. Sender sends cost no API credits. `fee-send.ts:150` posts keyless today.

**Size (measured this session):**

| Launch (spike rows, per-coin table) | Bytes now | + tip | Headroom |
|---|---|---|---|
| curve BONDR, burn (`launch.burn`) | 780 | about +81 (System Program in the table) | about 371 |
| curve BONDR, sell (`launch.sell`) | 881 | about +81 | about 270 |
| migrated BONDR, burn (`migrated.launch.burn`) | 921 | +49 to +81 | 230+ |
| migrated BONDR, sell (`pool-sell-launch.json`, decompiled and recompiled with a dev-paid tip to `4ACfpUFo...`) | 954 | **+49 measured** (System Program already static) | **229** |

The tip adds the tip account as a static key (32 B), the transfer instruction (17 B), and System Program as a static key (+32 B, -1 index byte) when it was only in the table. The 1,064 and 1,163 figures in PROJECT.md item 1 are create-only rows with no table (`child.create`, `migrated.child.create`).

**How:**
1. `compileLaunch(o, ixs, table, blockhash, tip?: TransactionInstruction[])` in `build.ts:77` appends the tip instructions after the table keys were computed (`unionTableKeys` runs on `builds[e].ixs` without the tip). The tip account then stays static, and a random tip account never invalidates table reuse.
2. `tipIxs(net, payer, lamports)` (`fee-send.ts:119`) already returns `[]` off mainnet. Pass the dev as the payer (the parameter is named `ops` but is only `fromPubkey`).
3. Size guard: compile with the tip; if `messageSize > PACKET_LIMIT`, compile without it and log (D-34). Never fail the launch.
4. Submit: pick the broadcast by inspecting the stored message. If any instruction is a System transfer to a `SENDER_TIPS` key, use `urgentBroadcast(net, …)`; otherwise use `broadcast`. This is stateless, needs no new column, and survives restarts (submit resends from `signed_tx`).
5. `urgentBroadcast` returns `unknown` on any Sender error, so a bad launch would wait out its blockhash (about 60-90 s) before failing. Recommended: on an explicit Sender JSON or HTTP error, send the same signed bytes once through `broadcast` (preflight on). The same bytes carry the same signature, so this cannot double-execute.
6. Costs: `previewCosts(solIn, fee + tip, burnSpent)`, because the simulated dev balance drop now includes the tip. The balance gate in `prepareOne` (`prepare.ts:255`) adds the tip. `Status.senderTipEstimate` comes from the same config value (UI-SPEC surface 3).
7. Tip amount: a new `launchTipLamports` in `feeConfig` (G-6, default 1,000,000). If G-6 picks 5,000 lamports, the URL must gain `?swqos_only=true` for that send (Pitfall 10).

### Pattern 3: Mainnet switch inventory (D-01, D-02), confirmed with misses added

| # | Where (confirmed this session) | Today | Phase 7 |
|---|---|---|---|
| 1 | `apps/worker/src/env.ts:10-19` `launchNet` (returns type `"devnet"`; line 16 throws even with the flag; line 18 message "must be devnet") | refuses | returns `"mainnet"` when `SOLANA_NET=mainnet` and `ALLOW_MAINNET=1` |
| 2 | `packages/core/src/net.ts:21-24` `rpcUrl`, `:27-30` `wsUrl`, `:53` genesis rule | devnet or fork only | mainnet: `https://mainnet.helius-rpc.com/?api-key=` and `wss://mainnet.helius-rpc.com/?api-key=` [CITED: helius.dev/docs/api-reference/endpoints]; ok = `!local && genesis === MAINNET_GENESIS`. Fork rule unchanged (local + Surfpool) |
| 3 | `packages/core/src/keys.ts:8` `Net = "devnet" \| "fork"`; `env.ts:117-122` `ops`/`treasury`/`buyback` typed `"devnet"`; `trade-quote.ts:21` `TradeNet = Net \| "mainnet"` | no mainnet ids | `Net` gains `"mainnet"`; `TradeNet` becomes an alias of `Net`. `keygen.ts` NETS stays devnet and fork (D-03) |
| 4 | `env.ts:71-75` (refusal at 74); `admin-evacuate.ts:219` (simulate gate), `:230` (`evacuateRefusal`) | devnet only | accept `on` when net is devnet, or net is mainnet and the external treasury passed D-10 checks (D-37) |
| 5 | `admin-inspect.ts:168` `?cluster=devnet` hardcoded | devnet link | by net (`format.ts:33` rule) |
| 6 | `fee-send.ts:119-128` `tipIxs`, `:136-161` `urgentBroadcast`; `fee-config.ts:11-23` | mainnet only | unchanged; tip accounts and URL re-verified against the docs. Add `?api-key=` (Pitfall 11) |
| 7 | `trade-prepare.ts:55` priority estimate | mainnet only | unchanged |
| 8 | `trade-quote.ts:68`, `trade-prepare.ts:96`, `packages/core/src/api.ts:237` | devnet cap | unchanged |
| 9 | `fee-config.ts:38` `paceMs: devnet ? 1100 : 0` | **mainnet is 0 today** | CONTEXT says it "stays 1100": it does not. Change to 1100 on every net until G-10 |
| 10 | `submit.ts:7,69` `broadcast` | RPC on every net | Pattern 2 |
| 11 | web: `wallet.tsx:231` (CONTEXT said 230), `format.ts:33`, `coin/[mint]/page.tsx:144`, `admin-data.ts:52`, **missed: `components/chrome.tsx:8,71`** (devnet badge and explorer cluster) | read `SOLANA_NET` | unchanged; covered by a mainnet-config build check |
| 12 | `env.ts:88-89` `VANITY_LANE`, `vanity.ts:11` `Lane` | local, staging | gains `production` |
| 13 | `env.ts:90-95` `BONDR_QUOTE_MINT` required | refuses boot | optional on mainnet only (genesis mode) |
| **14 (missed)** | `apps/worker/src/status.ts:153` `net: "devnet" as const` | every `/status` says devnet | report `env.net`. Web `launch-sign.tsx:201,267` and `launch-live.tsx:88` build Solscan links and devnet-only hints from `status.net`, so mainnet would show devnet links |
| **15 (missed)** | `fee-config.ts:8` `OPS_FLOOR_LAMPORTS = 0.05 SOL`, one constant | same floor on every net | G-4 recommends 0.1 SOL on mainnet: move it into `feeConfig(net)` (D-02 says per-net values live there). Its readers are `build.ts:67` and `fee-send.ts:104` |
| **16 (missed)** | `scripts/capture-tx.ts:22` `--net devnet\|fork`, `:38` version 0 | — | net list stays (D-03); version to 1 |
| 17 (note) | `send.ts:68` `checkMessage` refuses anything but v0; `cosign.ts:28-31` assumes signatures first | — | keep: BONDR builds only v0. A wallet cannot re-encode to v1 without changing the bytes, which cosign already refuses |
| 18 (docs) | `.env.example` (`SOLANA_NET`, `VANITY_LANE` comments), `apps/worker/README.md:72` "SOLANA_NET (devnet only)" | — | update |

`BONDR_QUOTE_MINT` is not in the web allowlist (`next.config.ts:9-22`). D-29's "set it on web and worker" only needs the worker; web gets `quoteMint` from `/status`.

### Pattern 4: External treasury (D-10)

- `treasury(seed, net)` callers use only `.publicKey`: `admin-inspect.ts:177`, `fee-boot.ts:62`, `admin-overview.ts:35` (confirmed by grep; `admin-actions.ts` reads `d.treasury`). Replace them with one `treasuryKey(env): PublicKey` from `env.ts`: `TREASURY_PUBKEY` on mainnet, derived on devnet and fork.
- Boot checks on mainnet: present, valid base58 that round-trips, on curve (`PublicKey.isOnCurve`, so it can be a wallet), and not equal to ops, buyback, or the derived treasury. `ADMIN_WALLET` equality is G-2's advice, not a code rule; logging a warning is enough.
- No signature: the treasury only receives (splits, sweeps, finalize sharing config, EVACUATE, rent from closed W accounts). Creating its token ATAs is permissionless.

### Pattern 5: Contract check (OPS-02, D-18..D-22)

**Measured today (2026-10-26), devnet vs mainnet:** [VERIFIED: live RPC reads this session]

| Fact | devnet | mainnet |
|---|---|---|
| pump / AMM / fees programs executable, owner `BPFLoaderUpgradeab1e1111…` | yes | yes |
| programdata last-deploy slot (pump / AMM / fees) | 510657843 / 508659436 / 508659783 | 458921440 / 458921517 / 456132171 |
| Global (`GLOBAL_PDA`) | 1,088 B, `a7e8e8b1c86c727f` | same |
| pump-fees FeeConfig (`PUMP_FEE_CONFIG_PDA`) | 4,097 B, `8f3492bbdb7b4c9b` | same |
| AMM GlobalConfig (`GLOBAL_CONFIG_PDA`) | 949 B, `95089ccaa0fcb0d9` | same |
| AMM FeeConfig (`PUMP_AMM_FEE_CONFIG_PDA`, owned by pump fees) | 4,097 B, `8f3492bbdb7b4c9b` | same |
| BondingCurve (devnet BONDR) | 166 B, `17b7f83760d8ac60` | (BONDR not yet live) |
| All discriminators equal the pinned IDLs | yes | yes |
| Anchor IDL account (`createWithSeed(PDA([]), "anchor:idl")`) | present, all three | present, all three |
| createV2Enabled / creatorFeeConfigurable / max bps / maxCurveDepth | true / **false / 0** / 2 | true / true / 300 / 2 |
| curve fees flat (protocol, creator) / exotic | 95, 30 / **0, 0 (unset)** | 95, 30 / 95, 30 |
| AMM fees flat (lp, protocol, creator) / exotic | 25, 5, 0 / **0, 0, 0 (unset)** | 25, 5, 0 / 20, 5, 5 |
| spike `drift()` result | "creator fee not configurable…", **"AMM LP 25 bps, assumed 20"** | empty (passes) |

**Profiles (recommended):**
- `mainnet` (also fork): createV2Enabled true; creatorFeeConfigurable true; max >= 150; maxCurveDepth >= 1; effective curve protocol 95; effective AMM LP 20; AMM protocol 5; sizes and discriminators as measured.
- `devnet`: the same except creatorFeeConfigurable false, max bps unchecked, effective AMM LP **25**. Without this the first staging run pauses everything.

**How:**
- Move `effective()` and `drift()` from `scripts/spike/stages/config.ts:41-59` into core `contract.ts` with a profile argument; the spike imports it back (D-18). Keep the existing strings verbatim (UI-SPEC surface 5 reuses them).
- Programs: one `getMultipleAccountsInfo([PUMP, AMM, FEE])`; programdata address = `data.subarray(4, 36)`; then `getMultipleAccountsInfo(programdatas, { dataSlice: { offset: 0, length: 45 } })` and read `readBigUInt64LE(4)` for the slot. A full programdata read would be megabytes.
- Accounts: one `getMultipleAccountsInfo` of the four config PDAs (plus BONDR's curve, or its pool once migrated): check owner, length, first 8 bytes against `pumpIdl`/`pumpAmmJson` `accounts[].discriminator`, then decode with the SDK coder. A decode throw becomes the fact "{account} no longer decodes with the pinned SDK"; an RPC throw becomes "Could not run".
- On-chain IDL hash: skip (Claude's discretion). The account exists, but the deploy slot already signals "pump changed", and discriminators plus SDK decode are the actual compatibility test. The IDL account is uploaded separately and can lag the program.
- About 4 RPC calls per run, no Postgres read. The result is held in memory and served in `AdminHealth.contract`.
- **Pause:** `pauseAll()` (`switches.ts:62-72`) also writes `evacuated_at`, which would show the evacuated callout and make the runbook `/kill-switch` refuse (`status.ts:186`). Add a sibling that writes only the five switch columns (one `UPDATE`), and audit it as action `switch` (already allowed by `admin_audit_action`), actor `contract_check`, params `{ job: "all", enabled: false, facts }`. That avoids a constraint migration.
- **Schedule:** the batch timer exists only when the engine runs (`fee-boot.ts:79-91`; `scheduleBatch` is wired only for dry and on). Genesis mode and `FEE_ENGINE=off` have no timer. Give the check its own `setTimeout` reusing `nextBatchAt(now, FEE_BATCH_HOUR_UTC)` (`fee-batch.ts:171`) that fires daily and runs on a fixed UTC weekday (for example Monday). That is restart-safe, unlike "every 7th day since boot". The boot run covers redeploys. `timer.unref()`, as `scheduleBatch` does.
- A changed deploy slot with all facts passing gives a Sentry warning and an amber row; the expected slots are the ones seen at boot (memory). "Could not run" pauses nothing.

### Pattern 6: Genesis mode and the SOL-pair genesis launch (D-28..D-33)

**Builder (core):** `buildGenesis(o)` returns `[...budget(cuLimit, priorityFee), buildCreate({ name, symbol, uri, mint, creator: TREASURY, user: dev }) /* no quoteMint */, ...buyExactOut({ global, mint, user: dev, quoteMint: NATIVE_MINT, amount, maxQuote: solIn }), createBurnCheckedInstruction(devAta, mint, dev, amount, 6, [], T22)]`. Here `amount = pct(getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: g.tokenTotalSupply, bondingCurve: newBondingCurve(g), amount: solIn, curveBaseTokenBalance: g.tokenTotalSupply }), 9800)`, mirroring `childAmount` (`launch.ts:135-146`). `trade.ts` `accounts()` already handles a SOL quote: classic program, no buyback ATA (`trade.ts:36-60`). Pass no `creatorFeeBps`: it is ignored on SOL (SDK docs) and D-28 wants the default. The stand-in Q in Phase 1 was created exactly this way (`scripts/spike/stages/create.ts:20-43`, SOL pair, treasury creator); the buy + burn in the same transaction is new and is rehearsed on the fork (D-33).
**Path:** keep the per-coin table and the rest of the prepare/cosign/submit chain unchanged (`cosign` needs `row.lookupTable`, `submit.ts:45`). `exitPresent` burn detection is quote-agnostic (`cosign.ts:51-56`). Put the genesis prepare in a new `genesis.ts`, because `prepare.ts` is at 293 lines.
**Genesis mode boot (`main.ts`):**
- `quoteMint` null and net mainnet means genesis mode. On devnet, refuse boot.
- Skip `bootIndex` (`seedBondrPrice`, `loadCoins`, `startEngine`, `backfillLaunches`, `startStream`). Trade routes, engine routes and `/quote` answer `not_ready`.
- `/status` returns `paused: "genesis"` and skips `fetchPumpQuote(ctx.Q)` (`status.ts:128`). `minLamports` still comes from Global (`status.ts:138`).
- `/prepare` accepts only `wallet === ADMIN_WALLET` and `exit === "burn"`, refuses once a genesis launch row is landed, and keeps the consent and caps guards.
- **Force every switch off at genesis boot** (Pitfall 3).
- Settle: on landing, mark landed and record facts, but do not call `ingestLaunch` (it needs a seeded BONDR price, `ingest.ts:140-141`).
- Web: the owner variant is shown from the `bondr_admin` cookie (UI-SPEC surface 2). The real gate is the worker plus the transaction itself, because the payer must be `ADMIN_WALLET`, so only the owner's key can sign it.
**Leaving genesis:**
- Set `BONDR_QUOTE_MINT`, then redeploy.
- At boot on mainnet, read BONDR's curve and refuse unless `quoteMint` is SOL and `creator` equals `TREASURY_PUBKEY`. That catches a typo in the mint.
- Exclude the genesis row from `backfillLaunches` (`launches.mint <> quoteMint`), or BONDR is indexed as its own child coin (Pitfall 4).
- Launches stay off until G-9, because genesis forced them off.

### Pattern 7: Sniped % (D-35)

- Add `coins.create_slot bigint` and `coins.sniped_bps integer`, both nullable. Coins launched before this phase stay null and show no line (UI-SPEC). Set `createSlot` in `newCoin` from `c.slot` (`trades.ts:190-215`): the launch tx's slot is the create slot.
- Recompute in `writeParsed` (`ingest.ts:88-105`) only when an inserted trade's slot is within `create_slot .. create_slot + 2`. The launch, its gap fill and live sniper trades all pass through there (`ingestLaunch` then `gapFill`, `ingest.ts:154-159`).
- One query: `select coalesce(sum(t.token_amount),0) from trades t join coins c on c.mint = t.mint join launches l on l.id = c.launch_id where t.mint = $1 and t.side = 'buy' and not t.launch and t.slot between c.create_slot and c.create_slot + 2 and t.trader <> l.wallet and t.trader <> l.w`. Then `ceil(sum * 10000 / SUPPLY)`, with `SUPPLY = 1e15` from `price.ts:6`, and write it in the same transaction.
- `trader` is the pump event `user` (`trades.ts:133`). An aggregator PDA counts as a third-party buyer, which is the right reading.

### Pattern 8: CI (D-23..D-25)

- Postgres 18.6 service container; migrations with `node packages/core/src/migrate.ts` (`pnpm db:migrate` uses `--env-file=.env`, which exits 9 when the file is missing).
- `pnpm test` runs both Vitest projects; the DB project reads `process.env.DATABASE_URL` first (`db.test.ts:9-11`, `ingest.test.ts:14`).
- Smoke: build web, `next start` in the background (no worker; `WORKER_URL` points nowhere so worker calls answer 503), then `E2E_BASE_URL=http://127.0.0.1:3000 pnpm exec playwright test --project=chromium --grep @smoke`. With `E2E_BASE_URL` set, both `webServer` entries are skipped (`playwright.config.ts:88-90`), so the config needs no change.
- **Run this session against `next start` with no worker and a dead DB URL:** `terms.e2e.ts` 6/6, `wallet.e2e.ts` 7/7, `admin-locked.e2e.ts` 5/5 (it runs only when `E2E_BASE_URL` is set), `launch-form.e2e.ts` step-1 tests 7/7, `home.e2e.ts` hero 4/5. The pulse line needs a DB; an empty migrated DB shows "No coins launched yet." [ASSUMED]. Total wall time about 30 s.
- Write a one-line `.env` with `DATABASE_URL` in CI only if DB-seeded specs join the smoke set (the specs read it through `rootEnv()`, `e2e/keys.ts:32-55`).

### Pattern 9: Scripts (D-26, D-27)

- `setup.sh`: `node -v` matches `^v24\.`; `pnpm -v`; `pnpm install`; `cp -n .env.example .env`; `pnpm spike:keys` (creates `~/.bondr-spike/{devnet,fork}/master.seed` 0600 if missing; the worker's `MASTER_SEED_FILE` points at the devnet one); `pnpm db:migrate` only when `DATABASE_URL` is set in `.env`.
- `dev.sh`: `trap 'kill 0' INT TERM EXIT`, worker and web each piped through `sed 's/^/[worker] /'`, `wait`. No new dependency.
- `test.sh`: the CI steps; `--full` adds `pnpm e2e`.
- `deploy.sh <staging|production>`:
  - `railway up --service <s> --environment <e> --ci` (waits for the build), then poll `railway deployment list --service <s> --environment <e> --json` until the newest deployment reports success, before the next service.
  - Web goes first when `git diff --quiet deployed-<env> HEAD -- packages/core/migrations` fails, or when the local tag `deployed-<env>` is missing (safe default). The tag is moved after a full success.
  - Production guards: clean tree, branch `main`, typed `production` or `--yes`.
- **Name collision:** root `test` is already `vitest run`, and CI runs `pnpm test` (D-23). Wire `scripts/test.sh` under another name (for example `pnpm verify`).

### Pattern 10: Production environment (D-06..D-14)

- Railway: `railway environment new production --duplicate staging` copies services, variables and configuration, staged until approved [CITED: docs.railway.com/reference/environments]. Overwrite every variable before approving (Pitfall 18).
- Domains: `railway domain trybondr.fun --service web --environment production` and `www.trybondr.fun` print the CNAME and TXT records; both are required [CITED: docs.railway.com/networking/domains/working-with-domains]. The Hobby plan allows 2 custom domains per service, exactly apex and www.
- DNS is at Porkbun (`dig NS`: `*.ns.porkbun.com`; registrar Porkbun, created 2026-10-25). Railway supports CNAME flattening and dynamic ALIAS at the apex. Porkbun offers an ALIAS record type [ASSUMED: secondary source]; otherwise use Cloudflare DNS (D-07).
- www to apex: in `apps/web/proxy.ts`. Its matcher covers only 7 public read paths and rate limits every GET it matches (`proxy.ts:9-25`), so the redirect needs a matcher for all paths and must run before the rate limit, which keeps its old path list (Pitfall 16).
- Neon:
  - The October 2026 usage so far is 29,085 CU-s (about 8 CU-h of the 500 CU-h quota, `neonctl api`); branches `main` (staging) and `dev`, both 0.25 CU fixed.
  - A third branch at worst 24/7 is about 182 CU-h. The quota is project-wide, so a dev or staging spike can suspend production (Pitfall 19).
  - Create `production` from `main`, then create a new empty database on it (`neonctl databases create --branch production --name bondr`) for the production `DATABASE_URL`, so no staging rows exist in it. Do not use `--schema-only` (Pitfall 17).
- Vanity: about 34k keys/s per thread on the M4 (02-09); a `bndr` suffix averages 58^4 = 11.3M tries, about 5.5 min per mint per thread there. Railway vCPUs are likely slower [ASSUMED]: with 2 threads, plan for about 10-20 h to reach 100 mints during the dark period. It needs a per-lane refill target (Pitfall 5).

### Pattern 11: Security follow-ups (D-16)

- **IN-B-02:** migration `CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_guard();` plus `REVOKE TRUNCATE ON admin_audit FROM CURRENT_USER;`.
  - The guard raises for any `TG_OP` other than an allowed `UPDATE` (`0007_admin.sql:52-62`).
  - In a statement trigger `OLD` is null; the `TG_OP = 'UPDATE' AND …` condition is false either way, so it reaches the `RAISE` [ASSUMED: PL/pgSQL semantics; the DB test proves it on PG 18].
  - The revoke is defence in depth only: the table owner can re-grant, and the CI `postgres` superuser bypasses privileges but still fires triggers.
  - Test in `db-admin.test.ts`: `TRUNCATE admin_audit` rejects with "append-only: TRUNCATE refused".
- **T-06-03-03:** extend `admin-signin.e2e.ts`. After `adminSignIn`, POST the same `{ op: "verify", wallet, nonce, signature }` again and expect 401 `bad_signature` (`session/route.ts:57-62`). It needs the admin key (skips without `MASTER_SEED_FILE`), so it runs locally and on any run with the seed.
- **IN-W-04:** in `putIntent` (`admin-intent.ts:74-77`), after the expiry sweep, while full, evict the oldest `used` entry. If none is used, throw `fail({ error: "rate_limited" })` (429) and evict nothing. Test next to `admin-intent.test.ts:168`.

### Pattern 12: Anti-vamp 24h ticker cooldown (D-40..D-44)

Code anchors confirmed this session: `admit` `prepare.ts:132-160` (rows `Promise.all` at 135-141, `isBlocked` refusal at 147, `parseRequest` after the guard), `checkSymbol` `rules.ts:31`, `LaunchErrorCode` `api.ts:22-46`, `ApiError` `api.ts:50` (no numeric field), `STATUS` map `http.ts:22`, `FAULTS` `launch-sign.tsx:42` (a total `Record`, so tsc lists every map that needs the new code), search `apps/web/lib/coins.ts:33-45` (`ilike` on name and symbol, ties by newest). Launch indexes today: only `launches_landed_mint` and `launches_inflight_mint` (`schema.ts:99-101`); none on `symbol`.

- **Migration 0008 (shared):** one migration carries the IN-B-02 TRUNCATE trigger plus revoke, `coins.create_slot`/`coins.sniped_bps` (D-35), and the ticker index. Migrations are drizzle-kit generated with snapshots (`migrations/meta/_journal.json`, 0007 is idx 7): add the index and columns in `schema.ts`, run `drizzle-kit generate` to get 0008 plus its snapshot and journal row, then append the trigger and revoke by hand (drizzle does not model triggers; 0007 did the same). 0007 is already applied on staging, so never edit it.
- **Partial index:** `index("launches_symbol_live").on(t.symbol, t.landedAt).where(sql("state <> 'failed'"))` (SQL: `CREATE INDEX launches_symbol_live ON launches (symbol, landed_at) WHERE state <> 'failed'`). `now()` cannot appear in an index predicate, so the 24h cut is in the query.
- **The read in `admit`:** the symbol is raw at that point (`parseRequest` runs after the guard), so take `checkSymbol(body.symbol)`; when it is ok, add one query to the existing `Promise.all`; when it is not ok, skip the read and let `prepareGuard` refuse `invalid_input` as today. Query (server clock, one index range):
  ```sql
  select max(case when state = 'landed' then landed_at + interval '24 hours'
                  else created_at + interval '3 minutes' end) as until,
         max(landed_at) as last_landed
  from launches
  where symbol = $1
    and (   (state = 'landed' and landed_at > now() - interval '24 hours')
         or state in ('signed', 'sent', 'unknown')
         or (state = 'prepared' and created_at > now() - interval '3 minutes' and wallet <> $2))
  ```
  For in-flight rows the `until` is only a hint (they may still land and then hold 24h). No join to `coins`, so hidden coins keep the lock (D-41). Refuse after `blocked` and before `prepareGuard`'s rate caps, so a refused ticker spends no table quota. Everything stays before `getBalance`, `reserveMint` and the table spend (D-40).
- **Refusal:** `ticker_locked` joins `LaunchErrorCode`, `STATUS.ticker_locked = 409`, `ApiError` gains `retryAfter?: number` (seconds, `ceil((until - now) / 1000)`). "Launched {n}h ago" for a landed lock is `24h - retryAfter`. An in-flight lock (no `last_landed`) needs its own line, for example "$PEPE is being launched on BONDR right now. Try again in a few minutes." Round up to whole hours; below 60 minutes say "under an hour". The web forwarder must pass `retryAfter` through unchanged, and the FAULTS entry derives its text from it. Check that the web launch route copies the whole worker body and not just `error`.
- **Reserved list (D-44):** `RESERVED_TICKERS = ["BONDR", "SOL", "USDC", "USDT", "WSOL"]` in `rules.ts`, refused in the worker with its own code (for example `ticker_reserved`, 409, own FAULTS copy). Put it in a separate pure guard and not inside `checkSymbol`: `checkSymbol` also runs in the browser and the genesis path, and **the genesis launch uses ticker BONDR (D-32)**, so `genesis.ts` must not call the reserved check (Pitfall 22). The 24h read still applies to genesis. It is harmless there, because no BONDR row can exist.
- **"First" marker and oldest-first:** in `coins.ts`, when `q` is present, put `(launches.symbol = upper(q)) desc` and then `launchedAt asc` among exact matches, ahead of the sort's order, keeping `mint` as the final tie-break so pages stay stable. Return `first: true` on the oldest row of the exact matches, computed in SQL as `launches.launched_at = min(launched_at) over (partition by symbol)` with the window run over visible coins only (hidden coins excluded, as search already does), or simply as the first exact-match row on page 0. Symbols are stored uppercase, so `upper(trim(q))` is the key. UI copy for the marker is a UI-SPEC addendum (not in 07-UI-SPEC.md today: grep found no "First", "ticker_locked" or "reserved" entry).
- **Terms:** one sentence on the 24h cooldown in `lib/terms.ts`. It rides the same TERMS_VERSION bump as D-17 (one bump, not two).
- **Neon:** one extra indexed read per prepare, run in parallel with the five that already exist. Prepares are capped by `TABLE_CAP`/`WALLET_TABLE_CAP`, and nothing polls.

### Anti-Patterns to Avoid

- Re-serializing a fetched v1 message (`MessageV1.serialize()` throws). Only read.
- Putting the tip instruction into `builds[e].ixs` before `unionTableKeys`: the tip account and System Program would go into the table, and a random tip account would break table reuse.
- New `if (mainnet)` branches outside `fee-config.ts`, `math.ts` and the rows above (D-02).
- Reusing `pauseAll()` for the contract check (it marks the platform evacuated).
- Computing sniped % on a timer, or on every page render.
- `--env-file=.env` in any CI step.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| v1 decode | A v1 wire parser or raw-JSON decoder | `getTransaction(…, { maxSupportedTransactionVersion: 1 })` on web3.js 1.99.0 | Already decodes `MessageV1` |
| Tip transfer | A new tip builder | `tipIxs` (`fee-send.ts:119`) | Already random-picks from the verified accounts |
| Sender POST | A new HTTP client | `urgentBroadcast` (`fee-send.ts:136`) | Already base64, skipPreflight, timeout, redact |
| Fee drift strings | New wording | `drift()` strings (moved to core) | UI-SPEC reuses them verbatim |
| Account decode | Hand byte offsets for Global and friends | SDK `fetchGlobal`/coders + IDL discriminators | Layouts change; the pinned SDK is the contract |
| Weekly schedule | cron library | `nextBatchAt` + `setTimeout` + weekday check | One function exists |
| CI Postgres | Neon branch per run | Service container `postgres:18.6` | No secrets, no CU quota |
| Process runner for dev.sh | concurrently/npm-run-all | `trap 'kill 0'` + `&` + `wait` | No dependency (D-26 discretion) |
| Wait-for-server in CI | `wait-on` package | `curl` loop | No dependency |

## Runtime State Inventory (production environment, not a rename)

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Migration 0000 inserts `settings` row 1 with `launches_enabled true`; the other four switch columns default true (`schema.ts:39-51`). A fresh production DB therefore boots with every switch on | Code: genesis-mode boot writes every switch off (no `evacuated_at`), so D-13 holds without a manual SQL step |
| Stored data | Production `vanity_mints` is empty; refill grinds only below 10 ready, up to 20 (`grind.ts:83-84`) | Code: per-lane thresholds (production: grind below 100, up to about 150) |
| Live service config | Railway `production` does not exist; staging variables would be copied by `--duplicate` | Owner gate G-1; overwrite every variable before approving; hash-compare check |
| Live service config | DNS for trybondr.fun at Porkbun; no records for Railway yet | Owner adds CNAME/ALIAS + TXT |
| OS-registered state | None: no cron, launchd or systemd. Timers are in-process (verified: `main.ts`, `fee-batch.ts`) | none |
| Secrets/env vars | New on production worker: `TREASURY_PUBKEY`, `ALLOW_MAINNET=1`, `SOLANA_NET=mainnet`, `VANITY_LANE=production`, new `MASTER_SEED`, `WORKER_TOKEN`, Sentry env `production`; `BONDR_QUOTE_MINT` unset; web: `SOLANA_NET`, `SITE_URL`, `ADMIN_WALLET`, `SESSION_SECRET`, `WORKER_TOKEN`, `DATABASE_URL` (Neon production database) | Set one per call with `--stdin --skip-deploys` before the first approval |
| Build artifacts | None carried over: Railway builds from the uploaded tree | none |

## Common Pitfalls

### Pitfall 1: Retrying -32015 twenty times
**What goes wrong:** every v1 signature costs 20 RPC calls and 20 log lines (staging since 2026-10-25).
**Why:** `ingestOrKeep` treats every throw as transient.
**How to avoid:** raise the version to 1 and drop -32015 outright (a future v2 would raise it again).
**Warning signs:** `Transaction version (` in logs.

### Pitfall 2: Tip cost counted as create cost
**What goes wrong:** `previewCosts` subtracts only `solIn + fee` from the simulated drop, so the tip shows up as "Pump create and accounts".
**How to avoid:** subtract the tip too, and add it to the `prepareOne` balance gate.

### Pitfall 3: Production boots with launches on
**What goes wrong:** `settings` is seeded all-true by migrations. After `BONDR_QUOTE_MINT` is set, child launches open at once, skipping G-9.
**How to avoid:** genesis boot forces all switches off; a test asserts it.

### Pitfall 4: Backfill indexes BONDR as its own child coin
**What goes wrong:** `backfillLaunches` (`ingest.ts:235-258`) ingests every landed launch without a coin row. The genesis row qualifies once genesis mode ends, so BONDR would get a `coins` row, join `knownCoins`, and its own trades would become coin trades.
**How to avoid:** exclude `launches.mint = env.quoteMint`, or skip it in `ingestLaunch` when `created.mint` equals Q.

### Pitfall 5: The vanity pool never reaches 100
**What goes wrong:** `startRefill` grinds only when ready < 10, to 20 (`grind.ts:83-84`), while the D-30 gate and the health alert (`admin-copy-health.ts:126-130`) use 100.
**How to avoid:** a lane-keyed `[low, target]` (`ponytail:` comment).

### Pitfall 6: Devnet profile pauses staging
**What goes wrong:** devnet effective AMM LP 25 and max creator bps 0 fail mainnet rules.
**How to avoid:** the measured devnet profile; unit test both profiles against the captured fact sets above.

### Pitfall 7: Contract mismatch marks the platform evacuated
**What goes wrong:** `pauseAll` writes `evacuated_at`; the runbook `/kill-switch` then refuses (`status.ts:186`) and the UI shows the EVACUATE callout.
**How to avoid:** a switches-only write.

### Pitfall 8: No timer in genesis or FEE_ENGINE=off
**What goes wrong:** riding `scheduleBatch` means the weekly check never runs in genesis mode, or on local and devnet with the engine off.
**How to avoid:** the check's own timer.

### Pitfall 9: Account size growth is a pause
**What goes wrong:** pump can realloc Global with appended fields. An exact size compare pauses while the SDK may still decode.
**How to avoid:** this is accepted by D-19/D-20 (fail-safe, owner re-enables). Put the size in the fact text so the owner can judge. Do not loosen without a decision.

### Pitfall 10: The low tip needs a different URL
**What goes wrong:** tips under 0.001 SOL route on fewer paths; the documented 0.000005 SOL minimum is for `?swqos_only=true`.
**How to avoid:** if G-6 picks the low tip, add the query parameter for launches.

### Pitfall 11: Keyless Sender shares 1 request/s per egress IP
**What goes wrong:** Railway egress IPs are not dedicated on Hobby [ASSUMED], and launches plus forced bonds share the keyless 1/s, so a 429 makes a launch "unknown".
**How to avoid:** append `?api-key=` to `SENDER_URL` at call time; `redact()` already strips `api-key=` (`net.ts:13`).

### Pitfall 12: `--env-file=.env` in CI
**What goes wrong:** Node exits 9 when the file is missing (tested), breaking `db:migrate` and Playwright's worker webServer.
**How to avoid:** call `node packages/core/src/migrate.ts` directly and use `E2E_BASE_URL`.

### Pitfall 13: Playwright boots the worker
**What goes wrong:** without `E2E_BASE_URL`, `playwright.config.ts:94` starts the worker, which needs Helius and the seed, and the run times out.
**How to avoid:** CI always sets `E2E_BASE_URL`. Specs that branch on it (`STAGING`) must be checked before tagging; `admin-locked` needs it.

### Pitfall 14: Smoke specs that need the root .env
**What goes wrong:** DB-seeding specs read `DATABASE_URL` from the root `.env` file via `rootEnv()`, not from `process.env`.
**How to avoid:** tag only no-DB specs, or write a minimal `.env` in CI.

### Pitfall 15: Script name collision
**What goes wrong:** `pnpm test` is Vitest, used by CI.
**How to avoid:** a different name for `scripts/test.sh`.

### Pitfall 16: www redirect breaks rate limiting
**What goes wrong:** widening the proxy matcher for the redirect also rate limits every page and asset.
**How to avoid:** check the host first, then apply the old path list inside the function.

### Pitfall 17: Neon schema-only branch
**What goes wrong:** the schema is copied but `drizzle.__drizzle_migrations` has no rows, so the migrator re-runs 0000 against existing tables and fails [ASSUMED: drizzle migrator compares journal rows].
**How to avoid:** use a fresh database on the new branch.

### Pitfall 18: Duplicated environment keeps staging secrets
**What goes wrong:** `--duplicate` copies `MASTER_SEED`, `DATABASE_URL`, `WORKER_TOKEN` and `SESSION_SECRET`. One forgotten overwrite means production derives devnet-seed keys or writes to the staging DB. Mainnet ids differ by net (D-01 row 3), but a shared seed is still a custody failure (D-09).
**How to avoid:** a scripted check reads both environments with `railway variables --json`, compares SHA-256 of each secret name, never prints values, and refuses equal pairs before the first approval.

### Pitfall 19: One quota for all branches
**What goes wrong:** the 500 CU-h hard quota is project-wide. If dev or staging exhaust it, every compute, production included, stays suspended until the 1st (memory note).
**How to avoid:** the runbook step to scale staging to zero after go-live (D-08); G-11 threshold monitoring.

### Pitfall 20: Line budgets
**What goes wrong:** `prepare.ts` 293, `send.ts` 294, `schema.ts` 283, `admin-evacuate.ts` 281, `trades.ts` 279, `fee-send.ts` 271 lines.
**How to avoid:** new files (`genesis.ts`, `contract-check.ts`, `contract.ts`, `sniped.ts`); new columns may need `schema.ts` split (schema-admin precedent).

### Pitfall 21: TERMS_VERSION bump re-asks consent
**What goes wrong:** the consent message embeds the version (`lib/terms.ts:9-21`), so every staging wallet re-consents after the bump. This is harmless and expected; production starts fresh. Check whether consent lookups compare versions before assuming.

### Pitfall 22: The reserved list blocks the genesis launch
**What goes wrong:** D-44 reserves BONDR, and D-32's genesis ticker is BONDR. If the reserved check sits inside `checkSymbol` or `parseRequest`, which genesis shares, G-5 fails with the reserved refusal.
**How to avoid:** keep the reserved check as a separate guard that only the child `admit` calls; add a genesis unit test with symbol BONDR.

### Pitfall 23: Raw symbol in the cooldown read
**What goes wrong:** `admit` sees the body before `parseRequest`, so querying `body.symbol` as sent ("pepe ") would miss the stored "PEPE".
**How to avoid:** use `checkSymbol`'s normalized value; skip the read when it fails.

### Pitfall 24: retryAfter dropped on the way to the browser
**What goes wrong:** a web route that rebuilds `{ error }` loses `retryAfter`, so the copy cannot show hours.
**How to avoid:** add an e2e or route unit case asserting the 409 body carries `retryAfter`.

## Code Examples

### fetchTx and the no-retry guard
```ts
// packages/core/src/send.ts:151 (pattern; web3.js 1.99.0 decodes legacy, 0 and 1)
const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });

// apps/worker/src/ingest.ts ingestOrKeep catch
import { SolanaJSONRPCError } from "@solana/web3.js";
// A version this client cannot read never becomes readable by retrying (Solana -32015).
const unsupported = (e: unknown) => e instanceof SolanaJSONRPCError && e.code === -32015;
```

### Derived v1 fixture (unit test)
```ts
// Index space is static, then loaded writable, then loaded readonly, so appending keeps every index valid.
const asV1 = (r: any) => ({
  ...r,
  version: 1,
  transaction: { ...r.transaction, message: { ...r.transaction.message,
    accountKeys: [...r.transaction.message.accountKeys, ...r.meta.loadedAddresses.writable, ...r.meta.loadedAddresses.readonly],
    transactionConfig: { computeUnitLimit: null, heapSize: null, loadedAccountsDataSizeLimit: null, priorityFee: null } } },
  meta: { ...r.meta, loadedAddresses: { writable: [], readonly: [] } },
});
expect(parseTx(asV1(fixture("curve-buy.json")), coins, b)).toEqual(parseTx(fixture("curve-buy.json"), coins, b));
```

### Tip at compile, Sender chosen at submit
```ts
// build.ts compileLaunch: tip after the table keys were computed, so it stays a static key.
const withTip = new TransactionMessage({ payerKey: o.dev, recentBlockhash: blockhash, instructions: [...ixs, ...tip] })
  .compileToV0Message([table]);
const v0 = tip.length && messageSize(withTip) <= PACKET_LIMIT ? withTip : compileWithout(); // D-34: never fail

// submit.ts: stateless choice from the stored message.
const tipped = (msg: VersionedMessage) => {
  const keys = msg.staticAccountKeys.map(String);
  return msg.compiledInstructions.some((ix) =>
    keys[ix.programIdIndex] === SYSTEM && ix.data[0] === 2 /* Transfer */ &&
    ix.accountKeyIndexes.some((i) => SENDER_TIPS.includes(keys[i] ?? "")));
};
```

### Programdata deploy slot without downloading the program
```ts
// Source: upgradeable loader layout (Program: tag u32 + programdata pubkey; ProgramData: tag u32 + slot u64 + Option<authority>)
const progs = await conn.getMultipleAccountsInfo([PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID]);
const pds = progs.map((p) => new PublicKey(p!.data.subarray(4, 36)));
const heads = await conn.getMultipleAccountsInfo(pds, { dataSlice: { offset: 0, length: 45 } });
const slots = heads.map((h) => h?.data.readBigUInt64LE(4));
```

### CI workflow skeleton
```yaml
# .github/workflows/ci.yml (no secrets; DB is the service container)
name: ci
on: [push, pull_request]
permissions: { contents: read }
concurrency: { group: "ci-${{ github.ref }}", cancel-in-progress: true }
jobs:
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:18.6
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: bondr }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 2s --health-timeout 5s --health-retries 30
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/bondr
      SOLANA_NET: devnet
      SITE_URL: http://127.0.0.1:3000
      WORKER_URL: http://127.0.0.1:1          # nothing listens: worker calls answer 503
      WORKER_TOKEN: ci-only-not-a-secret-0123456789abcdef
      SESSION_SECRET: ci-only-not-a-secret-0123456789abcdefghij
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6            # version from packageManager (pnpm@10.34.6)
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: node packages/core/src/migrate.ts   # not db:migrate: --env-file=.env exits 9 without a file
      - run: pnpm test
      - run: pnpm --filter @bondr/web build
      - run: pnpm check:bundle
      - run: pnpm exec playwright install --with-deps chromium
      - run: |
          pnpm --filter @bondr/web start > web.log 2>&1 &
          for i in $(seq 60); do curl -sf http://127.0.0.1:3000/terms >/dev/null && break; sleep 1; done
          E2E_BASE_URL=http://127.0.0.1:3000 pnpm exec playwright test --project=chromium --grep @smoke
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `maxSupportedTransactionVersion: 0` reads everything | Must be `1`; v1 is the 4,096-byte format without ALTs | Mainnet epoch 1035, 2026-09-15 | Ingest misses v1 trades until fixed |
| Compute budget via ComputeBudget instructions | v1 puts CU limit and a total-lamports priority fee in the message config; the instructions become no-ops | same | Only matters if BONDR ever builds v1 (it does not) |
| Launch via plain RPC | Helius Sender (multi-path, tip + CU price mandatory) | Sender docs current | LAUNCH-08 |

**Deprecated/outdated:**
- SNIPING.md "about 70 B headroom": superseded by the measurement above (229 B worst case).
- CONTEXT D-01 row 9 "paceMs stays 1100 on mainnet": the code gives 0 on mainnet; it must be changed, not kept.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | An empty migrated CI DB makes the home pulse line read "No coins launched yet." | Pattern 8 | One smoke test needs untagging or a fix |
| A2 | Porkbun supports an apex ALIAS that Railway accepts | Pattern 10 | Owner moves DNS to Cloudflare (D-07 fallback, non-money) |
| A3 | Neon `--schema-only` branch breaks the drizzle migrator | Pitfall 17 | None if the recommended fresh database is used |
| A4 | The PL/pgSQL guard reaches `RAISE` for a statement-level TRUNCATE | Pattern 11 | The DB test catches it; fix with an explicit `IF TG_OP = 'TRUNCATE'` |
| A5 | Railway Hobby egress IPs are shared, so keyless Sender 1/s can be exhausted by others | Pitfall 11 | Low cost either way: appending the api key is harmless |
| A6 | Railway vCPU grinds slower than the M4 (10-20 h to 100 mints on 2 threads) | Pattern 10 | Dark period runs longer; raise `VANITY_THREADS` |
| A8 | `drizzle-kit generate` emits 0008 for the new index and columns, and the trigger is appended by hand as in 0007 | Pattern 12 | If generate is not the repo practice, write 0008 and its journal row by hand |
| A7 | Pump mainnet Global and the config sizes measured today stay until pump redeploys | Pattern 5 | A size change pauses jobs (by design, D-20) |

## Open Questions

1. **Launch priority fee on mainnet.**
   - What we know: launches use `PRIORITY_FEE_MICROLAMPORTS` (default 1,000, `env.ts:101`), which is 600 lamports at 600k CU. Sender requires a CU price but sets no minimum.
   - What's unclear: whether 1,000 lands promptly on mainnet next to the tip.
   - Recommendation: keep it env-tunable and set a higher value on production. Optionally reuse `priorityMicroLamports` (`trade-prepare.ts:47-60`) for launches on mainnet. The dev pays it, and it is shown in the preview.
2. **Genesis launch table.**
   - What we know: a SOL-pair create + buy + burn is much smaller than a child launch.
   - What's unclear: whether it fits without a table.
   - Recommendation: keep the table for one uniform cosign path (ops pays about 0.006 SOL), measured on the fork row.
3. **Optional real v1 coin trade on devnet.**
   - What we know: web3.js 1.99.0 cannot build v1, and no one sends v1 to a BONDR coin today.
   - Recommendation: skip it. The captured real v1 response plus the derived fixture prove the parser. A hand-encoded v1 sender (about 40 lines over the SIMD-0385 table) is possible if the owner wants stronger evidence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | yes | 24.13.0 | — |
| pnpm | everything | yes | 10.34.6 | — |
| Railway CLI | production env, deploy.sh | yes | 5.71.0 | Railway MCP |
| neonctl | production branch | yes | installed, authed (read worked) | Neon console |
| gh | CI checks, PR | yes | authed | — |
| Surfpool | fork rehearsals | yes (`.cache/surfpool`, v1.6.1) | 1.6.1 | — |
| solana CLI | not required | 3.0.13 (pre-4.2, cannot confirm v1 blocks) | — | not needed |
| Docker / local Postgres | local CI repro | no | — | CI service container; local DB suites keep using Neon dev |
| Helius key | mainnet RPC | yes (same key, D-12) | — | — |

**Missing dependencies with no fallback:** none for code. Owner actions block go-live: DNS, `ADMIN_WALLET`, contact forwarding, G-1..G-11.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (projects `unit`, `db`); Playwright 1.63.0 |
| Config file | `vitest.config.ts` (DB list at lines 5-19), `playwright.config.ts` |
| Quick run command | `pnpm exec vitest run --project unit` (about 5 s) |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` |

### Phase Requirements to Test Map
| Req / Decision | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-15 | Captured v1 fixture decodes; BONDR price read; 0 coin rows | unit | `pnpm exec vitest run packages/core/src/trades.test.ts` | extend; fixture is new (Wave 0) |
| D-15 | Derived v1 coin trade equals v0 parse | unit | same | new case |
| D-15 | -32015 not retried | unit | `pnpm exec vitest run apps/worker/src/stream.test.ts` (or ingest unit) | new case |
| D-15 | Staging logs stop showing `Transaction version (1)` | staging | `railway logs --service worker --environment staging` grep after deploy | manual check |
| D-01 rows 1-4,12,13 | Each refusal: mainnet refused without the flag, accepted with it plus the treasury | unit | `pnpm exec vitest run apps/worker/src/env.test.ts packages/core/src/net.test.ts packages/core/src/keys.test.ts` | extend |
| D-01 row 2 | `connect("mainnet")` refuses a local host and a wrong genesis | unit (stubbed fetch) | `net.test.ts` | new case |
| D-01 row 14 | `/status` reports env net | unit | `status.test.ts` | new case |
| D-10 | Boot refuses mainnet without `TREASURY_PUBKEY`, or equal to ops/derived | unit | `env.test.ts` | new |
| D-37 | EVACUATE on: mainnet refused without the treasury, accepted with it; `evacuateRefusal` both branches | unit | `env.test.ts`, `admin-evacuate.test.ts` | extend |
| LAUNCH-08 | Tip present on mainnet, absent on devnet; tip key not in the table; size guard falls back; Sender chosen only for a tipped message; Sender error falls back to RPC with the same bytes | unit | `pnpm exec vitest run apps/worker/src/submit.test.ts apps/worker/src/fee-send.test.ts` + a build test | extend |
| LAUNCH-08 | Real mainnet launch through Sender | mainnet, owner-gated (G-5/G-9) | signature from the genesis launch | manual |
| OPS-02 | Forced mismatch (wrong expected value, wrong size) turns every switch off without `evacuated_at`, writes an audit row, red state | unit | `contract-check.test.ts` (new) | Wave 0 |
| OPS-02 | Devnet profile passes live devnet; mainnet profile passes the fork | devnet + fork | `node --env-file=.env scripts/contract-check.ts --net devnet` and `--net fork` (or a spike stage) | new |
| OPS-02 | Mainnet check passes before G-5 | mainnet dark worker | admin "Run check now" | manual (G-1 done) |
| OPS-03 | CI green on push | CI | GitHub Actions run | new |
| OPS-04 | Each script runs | smoke | `sh scripts/test.sh`; `sh scripts/setup.sh` on a clean clone; `deploy.sh staging` (owner-delegated on devnet) | new |
| OPS-05 | `buildGenesis`: SOL quote, creator = treasury, burn present, `exitPresent` true | unit | `launch` builder test | new |
| OPS-05 | Genesis mode: switches forced off, prepare refuses non-admin and sell, child prepare `not_ready`, boot refuses on devnet | unit | `genesis.test.ts`, `env.test.ts` | new |
| OPS-05 | Fork rehearsal: genesis then child quoted in the new BONDR (D-33) | fork | `pnpm spike` with a new genesis stage, `SPIKE_NET=fork` | new stage |
| OPS-05 | Backfill skips the genesis row | DB | `ingest.test.ts` | extend |
| D-35 | Sniped bps: window, excludes dev, W and sells, rounds up | DB | `ingest.test.ts` | extend |
| D-16 IN-B-02 | TRUNCATE raises | DB | `pnpm exec vitest run packages/core/src/db-admin.test.ts` | extend |
| D-16 T-06-03-03 | Replayed sign-in 401 | e2e | `pnpm exec playwright test admin-signin.e2e.ts` | extend |
| D-16 IN-W-04 | Full of live intents: 429, nothing evicted; used entries evicted first | unit | `admin-intent.test.ts` | extend |
| D-40/D-42 | Landed 1h ago refuses with retryAfter about 23h; landed 25h ago allows; failed allows; signed/sent/unknown refuse; another wallet's prepared under 3 min refuses, own prepared allows, prepared over 3 min allows; a hidden coin still refuses | DB | `pnpm exec vitest run apps/worker/src/ticker.test.ts` (new; add to the `DB` list) | Wave 0 |
| D-40 | Refused ticker spends nothing: no `getBalance`, no `reserveMint`, no table | unit (stubbed ctx) | `prepare.test.ts` | extend |
| D-41 | Key is the `checkSymbol` value: " pepe" hits the "PEPE" row | DB | `ticker.test.ts` | new case |
| D-42 | Partial index exists and the query uses it | DB | `EXPLAIN` in `ticker.test.ts` asserting `launches_symbol_live` (optional; small tables may seq-scan, so assert the index exists via `pg_indexes`) | new |
| D-43 | 409 body `{ error: "ticker_locked", retryAfter }` reaches the browser; copy shows hours | e2e (route-mocked worker reply) | `pnpm exec playwright test launch-sign.e2e.ts` | extend |
| D-44 | SOL, USDC, USDT, WSOL, BONDR refused for children; genesis with BONDR allowed | unit | `rules.test.ts`, `genesis.test.ts` | new |
| D-44 | Exact matches oldest first, "First" on the oldest; pages stable | DB | `apps/web/lib/coins.test.ts` (or the existing search DB test) | extend |
| D-43 | Terms page contains the cooldown sentence; TERMS_VERSION bumped once | e2e | `terms.e2e.ts` | extend |
| D-17 / UI | Terms contact; banners; tip row; sniped line; contract cell | e2e + screenshots | UI-SPEC verification list | extend |

### Sampling Rate
- **Per task commit:** `pnpm exec vitest run --project unit` plus the touched DB file when relevant.
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test`, plus the smoke set against `next start`.
- **Phase gate:** CI green, full `pnpm e2e` locally, fork rehearsal rows (D-04, D-33) recorded, devnet contract check passing on staging, then `/gsd:verify-work`. Mainnet rows are owner-gated (G-1..G-11) and verified after merge.

### Wave 0 Gaps
- [ ] `packages/core/src/fixtures/v1-bondr-sell.json` (capture after the `capture-tx.ts` version fix)
- [ ] `apps/worker/src/contract-check.test.ts`, `packages/core/src/contract.test.ts` with both measured fact sets as inline fixtures
- [ ] `apps/worker/src/genesis.test.ts`
- [ ] `apps/worker/src/ticker.ts` (cooldown read + pure refusal, keeps prepare.ts under 300 lines) and `ticker.test.ts`
- [ ] Migration 0008 and its DB cases (add any new DB suite to the `DB` list in `vitest.config.ts`)
- [ ] `.github/workflows/ci.yml`
- [ ] `@smoke` tags on the confirmed specs

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Admin sign-in (SIWS-style, single-use nonce; replay test added). Genesis prepare requires `ADMIN_WALLET`; the transaction payer must sign |
| V3 Session Management | yes | `bondr_admin` 30-minute cookie, unchanged; the genesis owner variant reads it server-side |
| V4 Access Control | yes | Worker-side gates: genesis only from `ADMIN_WALLET`; EVACUATE mainnet only with an external treasury; contract-check route behind `/admin` auth |
| V5 Input Validation | yes | `parseRequest` (prepare), `TREASURY_PUBKEY` round-trip and on-curve check, boot refuses unknown env values |
| V6 Cryptography | yes | No new crypto. Seed via HMAC derivation (`keys.ts`); production seed is new (G-3); ed25519 via web3.js and node:crypto |
| V7 Errors and Logging | yes | `redact()` covers `api-key=` (Sender URL with the key); the contract check logs facts, never keys |
| V14 Configuration | yes | CI has no secrets; production secrets new; duplicated-environment secret hash check |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Mainnet reached from a dev box | Elevation | `connect` mainnet only from a non-local host with mainnet genesis; fork needs local + Surfpool (D-03) |
| Staging secrets carried into production | Information disclosure | Overwrite before approval; SHA-256 compare script; seed only on the production worker |
| Seed leak drains to a derivable treasury | Tampering | External `TREASURY_PUBKEY` (D-10); EVACUATE to it (D-37) |
| Typo in `BONDR_QUOTE_MINT` opens launches on the wrong quote | Tampering | Boot verifies SOL quote and creator = treasury; launches stay off until G-9 |
| Pump layout change makes BONDR build wrong transactions | Tampering | Contract check pause (D-20); pump itself rejects broken layouts for user trades (D-22) |
| Sender 429 or rejection leaves a launch hanging | Denial of service | API key on Sender; fallback to RPC with identical bytes |
| Audit log wiped via TRUNCATE | Repudiation | Statement trigger + revoke (IN-B-02) |
| Admin sign-in replay | Spoofing | Nonce PK + `returning()`; automated replay test |
| Intent eviction by simulate spam | Denial of service | Evict expired, then used; 429 otherwise (IN-W-04) |

## Sources

### Primary (HIGH confidence)
- Installed `@solana/web3.js` 1.99.0 `lib/index.cjs.js` (`MessageV1` 1186-1300, `versionedMessageFromResponse` 4770-4815, `SolanaJSONRPCError` 2411-2424, `getTransaction` 7675-7695, `sendRawTransaction` 8368-8372) and `index.d.ts` (1464-1480, 1812)
- Installed `@pump-fun/pump-sdk` 4.1.0 `dist/index.d.ts` (createV2Instruction 46090-46140, createV2AndBuy 46165-46200, newBondingCurve 48061)
- Live RPC this session: Helius devnet and public devnet `getTransaction` of `AQ5D3WBU...` at versions 0 and 1; public devnet and mainnet `getMultipleAccountsInfo` of the pump programs, programdata and config PDAs; `readLiveConfig` on both
- Spike evidence: `scripts/spike/results/fork.json`, `devnet.json` (launch byte sizes); `packages/core/src/fixtures/pool-sell-launch.json` (tip measurement)
- https://solana.com/upgrades/larger-transaction-sizes (v1 activation, RPC breaking change, SDK minimums)
- https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md (wire format)
- https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/transactions-v1.md (v1 details, web3.js 1.99.0 read-only)
- https://www.helius.dev/docs/sending-transactions/sender (endpoint, tips, minimums, rate limits)
- https://www.helius.dev/docs/api-reference/endpoints (mainnet RPC and WS URLs)
- https://docs.railway.com/reference/environments, https://docs.railway.com/networking/domains/working-with-domains
- https://playwright.dev/docs/test-annotations (tags)
- `gh api` releases for actions/checkout, actions/setup-node, pnpm/action-setup; docker-library postgres tags; `neonctl api` project and branches

### Secondary (MEDIUM confidence)
- https://docs.chainstack.com/docs/solana-transaction-v1, https://solanacompass.com/news/transaction-v1-simd-0385-is-live-on-solana-mainnet-at-epoch-1035 (corroborate activation)
- https://github.com/anza-xyz/agave/issues/15531, https://github.com/solana-foundation/solana-com/pull/2292 (the same -32015 fix elsewhere)
- Local smoke trial: 29 Playwright tests against `next start` with no worker

### Tertiary (LOW confidence)
- https://help.neetocal.com/articles/how-to-add-dns-record-in-porkbun (Porkbun ALIAS)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (installed versions read, no new packages)
- v1 ingest: HIGH (installed code read, live Helius and public RPC, our parser run on the real v1 response)
- Sender and size: HIGH (docs fetched, sizes measured from committed evidence)
- Contract check: HIGH (live reads on both networks); profile thresholds are owner-delegated choices
- Genesis and gating: MEDIUM-HIGH (builders read; the combined create + buy + burn is unproven until the fork row)
- CI: MEDIUM (no-worker subset run; the container path not run locally, no Docker)
- Production env: MEDIUM (CLI and docs verified; DNS ALIAS and grind speed assumed)

**Research date:** 2026-10-26
**Valid until:** 2026-11-09 for pump layouts and fees (pump deploys often; the contract check exists for this reason); 2026-11-26 for the rest.
