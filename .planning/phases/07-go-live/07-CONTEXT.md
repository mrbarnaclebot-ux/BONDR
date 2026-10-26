# Phase 7: Go-Live - Context

**Gathered:** 2026-10-26
**Status:** Ready for planning
**Mode:** Auto. The owner delegated every gray area ("continue on the automated workflow, keep going and dont stop until goal is reached. only stop if human intervention is needed in regards to real money"). Each non-money decision below is the recommended option, recorded as "owner-delegated (auto)" and logged in 07-DISCUSSION-LOG.md. Every decision that commits real money or touches mainnet funds carries a recommended default and is marked **OWNER GATE: confirm before execution**. Gates are not approved. Plans may build and test the code behind a gate on devnet and the Surfpool fork. The mainnet step itself waits for the owner.

<domain>
## Phase Boundary

As the owner, I want BONDR live on mainnet with guardrails, so that strangers can launch and trade safely.

ROADMAP Phase 7, requirements OPS-02, OPS-03, OPS-04 and OPS-05. Success criteria:
1. A weekly contract check verifies pump program IDs, IDL account layouts and the Global flags. A forced mismatch pauses jobs.
2. CI runs lint, tests and a Playwright smoke test on every push. `scripts/` has one-command setup, dev, test and deploy.
3. The BONDR token is launched on mainnet through BONDR (SOL pair, treasury as creator, insta burn). Child launches stay disabled until it exists.

Phase 7 delivers:
- **Mainnet switch:** each mainnet refusal in the code is listed and flipped behind env (D-01..D-05), and devnet and staging stay as strict as they are today.
- **Production environment:** Railway `production`, trybondr.fun, its own Neon branch, its own seed and keys, and a treasury that is not derived from the seed (D-06..D-14).
- **Must-fix items before mainnet:**
  - v1 transaction ingest (D-15)
  - the Phase 6 security follow-ups (D-16)
  - the terms contact placeholder (D-17)
- **Contract check (OPS-02):** D-18..D-22.
- **CI and scripts (OPS-03, OPS-04):** D-23..D-27.
- **BONDR genesis launch and child-launch gating (OPS-05):** D-28..D-33.
- **Sniping:** the launch is sent through Helius Sender, and the token page shows a "sniped %" figure (D-34..D-36).
- **EVACUATE on mainnet and the seed rotation runbook:** D-37..D-38.
- **Rollout order:** owner gates G-1..G-11 (D-39).

Not in Phase 7:
- Meteora (parked by the owner, see Deferred).
- Streamflow, Dexscreener, a multi-replica worker, a leader lock, and a trading kill switch.
- Any change to the fee mechanic proven in Phase 1.

</domain>

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

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` (Phase 7 section): goal and 3 success criteria
- `.planning/REQUIREMENTS.md`: OPS-02, OPS-03, OPS-04, OPS-05 (plus the new LAUNCH-08, D-34)
- `.planning/PROJECT.md`: Fee Mechanic items 1 and 9, Defaults 4 and 5, Constraints (budget, seed in the worker), Risks (contract check, seed leak, BONDR curve completion), Build Step 7
- `.planning/STATE.md`: Pending Todos (v1 ingest, terms contact), Blockers (BONDR SOL-quote path), 02-16 note (Railway settings on services, IaC deferred)
- `AGENTS.md`: sections 2 (ask before outward-facing actions), 6 (`scripts/`, CI, feature flags), 7 (screenshots), 11 (git), 12 (done)

### Research
- `.planning/research/SNIPING.md`: Sender for the launch, tip inside the tx, size headroom, sniped %
- `.planning/research/METEORA.md`: parked by the owner (2026-10-26); Deferred only
- `.planning/research/FINDINGS.md`: the pump fee facts the contract check asserts

### Prior phase decisions and findings
- `.planning/phases/06-admin-dashboard/06-CONTEXT.md`: D-08 (ADMIN_WALLET), D-18/D-19 (switches), D-26/D-27 (health), D-35..D-37 (EVACUATE), the Deferred list (external treasury, seed rotation, contract check health row)
- `.planning/phases/06-admin-dashboard/06-SECURITY.md`: IN-B-02, IN-W-04, T-06-03-03, T-06-08-06
- `.planning/phases/06-admin-dashboard/deferred-items.md`: the 06-26 v1 ingest finding
- `.planning/phases/06-admin-dashboard/06-HUMAN-UAT.md`: HV-06-01, HV-06-02 (SITE_URL on web and worker)
- `.planning/phases/05-fee-engine-and-public-ledger/05-CONTEXT.md`: D-09 (FEE_ENGINE), D-16 (Sender), D-20 (ops floor), the Deferred list
- `.planning/phases/05-fee-engine-and-public-ledger/05-HUMAN-UAT.md`: HV-05-02
- `scripts/spike/README.md` and `scripts/spike/results/`: the fork rehearsal pattern

### Code
- `apps/worker/src/env.ts`: launchNet, the ADMIN_EVACUATE guard, role derivation, and BONDR_QUOTE_MINT required
- `packages/core/src/net.ts`, `packages/core/src/keys.ts`: RPC entry point, genesis guard, Net type
- `packages/core/src/config.ts`, `scripts/spike/stages/config.ts`: readLiveConfig and drift (contract check base)
- `packages/core/src/pump.ts`: program IDs, IDLs, SDK load point
- `packages/core/src/send.ts` (`fetchTx`), `apps/worker/src/ingest.ts`, `apps/worker/src/admin-inspect.ts`: the v1 fix
- `apps/worker/src/fee-send.ts`, `apps/worker/src/fee-config.ts`: Sender, tips, per-net values
- `apps/worker/src/submit.ts`, `apps/worker/src/prepare.ts`, `apps/worker/src/build.ts`, `packages/core/src/launch.ts`: launch path (Sender, SOL-quote genesis)
- `apps/worker/src/status.ts`, `apps/worker/src/switches.ts`, `apps/worker/src/admin-evacuate.ts`, `apps/worker/src/admin-intent.ts`, `apps/worker/src/health.ts`: pause path, intent store, health row
- `packages/core/migrations/0007_admin.sql`: admin_audit_guard (TRUNCATE trigger)
- `apps/worker/src/grind.ts`, `apps/worker/src/vanity.ts`: lanes and pool
- `package.json`, `vitest.config.ts` (DB suite list), `playwright.config.ts`, `biome.json`, `.env.example`, `scripts/README.md`, `apps/worker/README.md` (deploy runbook)
- `apps/web/e2e/launch-stubs.ts`, `trade-stubs.ts`, `admin-stubs.ts`, `phantom.ts`: smoke building blocks

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readLiveConfig` (core `config.ts`) and `drift()` (spike `config.ts`): the contract check is mostly these two plus program and account checks.
- `tipIxs`, `urgentBroadcast`, `SENDER_URL`, `SENDER_TIPS` (`fee-send.ts`, `fee-config.ts`): the launch Sender path reuses them unchanged.
- The EVACUATE pause step (`admin-evacuate.ts`) and `setSwitch` (`switches.ts`): the contract check mismatch reuses the "all switches off, persist, audit" path.
- The paused banner and `pauseReason` (`status.ts`): genesis mode and the contract check failure become new reasons.
- `buildCreate` with optional `quoteMint` (core `launch.ts`): the SOL-pair genesis create.
- The `connect()` genesis guard (`net.ts`): extended with a mainnet branch.
- `scripts/capture-tx.ts`: captures the v1 fixture.
- The `.env.example` comments already document `SITE_URL` for trybondr.fun and `ALLOW_MAINNET`.

### Established Patterns
- Ship dark with env flags (`FEE_ENGINE`, `ADMIN_WALLET`, `ADMIN_EVACUATE`). Boot refuses unknown values.
- Settings are loaded at boot and held in memory. No timer reads (Neon).
- Per-network constants live in one place (`fee-config.ts`, `math.ts`), not scattered `if (mainnet)`.
- Fork rows are the evidence for mainnet behaviour (Phase 1, Phase 5, Phase 6).
- Railway: settings on the services, secrets set one per call with `--stdin`, web deployed first when a migration is new.

### Integration Points
- `env.ts`: SOLANA_NET mainnet, TREASURY_PUBKEY, optional BONDR_QUOTE_MINT, ADMIN_EVACUATE mainnet rule, VANITY_LANE production.
- `main.ts`: the contract check at boot and on the batch timer. Genesis mode skips the indexer and engine start.
- The admin Health panel: the "Pump contract check" row. The admin routes: an on-demand check.
- The launch page and the prepare route: genesis mode and the tip line in the preview.
- The token page proof area: sniped %.
- New: `.github/workflows/ci.yml`, `scripts/setup.sh`, `dev.sh`, `test.sh`, `deploy.sh`, a migration for the TRUNCATE trigger and the coin create slot / sniped columns.

</code_context>

<specifics>
## Specific Ideas

- Paused banner copy in genesis mode: "Launches open after the BONDR token is live."
- Sniped line: "BONDR cannot stop third-party buys at launch. This shows how much was bought in the first 3 slots."
- Contract check red row: name the failed facts in plain words, for example "creator fee no longer configurable", as the spike drift strings do.
- `deploy.sh production` prompt: "Type production to deploy to trybondr.fun".

</specifics>

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

---

*Phase: 07-go-live*
*Context gathered: 2026-10-26 (auto mode, owner-delegated; money decisions held as OWNER GATES G-1..G-11)*
