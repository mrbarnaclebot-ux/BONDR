---
phase: 7
slug: go-live
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-26
---

# Phase 7 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Built from 07-RESEARCH.md, Validation Architecture, and the 36 plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (projects `unit` and `db`; DB suites skip without DATABASE_URL with a printed reason). Playwright 1.63.0 with axe 4.13.0 (`*.e2e.ts`; `@smoke` subset runs against `next start` with no worker). Spike runner on Surfpool 1.6.1 for the fork rows |
| **Config file** | `vitest.config.ts` (DB list), `playwright.config.ts`, `scripts/spike/nets/fork.ts`, `.github/workflows/ci.yml` (07-19) |
| **Quick run command** | `pnpm exec vitest run <touched test files>` and `pnpm lint` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @bondr/web build && pnpm check:bundle && pnpm e2e` (after 07-20: `sh scripts/test.sh --full`) |
| **Fork gate** | `pnpm spike:fork-up && SPIKE_NETS=fork pnpm spike` with every `genesis.*` row passing, then `node --env-file=.env scripts/contract-check.ts --net fork --bondr <genesis mint>` |
| **CI gate** | GitHub Actions `ci.yml` on push: lint, typecheck, Vitest on postgres:18.6, web build, check:bundle, `--grep @smoke` |
| **Estimated runtime** | About 5 s unit project, 60 s full Vitest, 30 s smoke, 5 min full e2e, 2 min fork genesis stage |

---

## Sampling Rate

- **After every task commit:** the task's `<automated>` command (always a touched test file or a grep gate) plus `pnpm lint`
- **After every plan wave:** `pnpm lint && pnpm typecheck && pnpm test`, plus the smoke set once 07-19 lands; after a wave touching chain code (07-08, 07-09, 07-15..07-17) also the fork gate
- **Before `/gsd:verify-work`:** CI green on the branch, `sh scripts/test.sh --full`, the fork genesis rows (D-04, D-33), the devnet contract check, the staging regression (07-24), the size and emoji checks (07-25)
- **Owner-gated plans (07-26..07-36):** each verifies with read-only checks after the owner acts (env-diff hashes, worker log lines, public `/api/status`, mainnet reads)
- **Max feedback latency:** 60 s for units; no task goes more than one task without an automated check

---

## Per-Task Verification Map

Threat Ref names the first STRIDE row of the task's plan; each plan's full register is in its `<threat_model>`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|----------|-----------|-------------------|--------|
| 07-01-01 | 01 | 1 | OPS-05, TOKEN-02 | T-07-01-01 | Version 1 at every transaction read, the captured v1 fixture and the parser proof | auto | `pnpm exec vitest run packages/core/src/trades.test.ts && ! rg -n "maxSupportedTransactionVersion: 0" packages apps scripts && rg -q '"version": 1' packages/c...` | pending |
| 07-01-02 | 01 | 1 | OPS-05, TOKEN-02 | T-07-01-01 | Drop -32015 without retrying, with its unit check | auto | `pnpm exec vitest run apps/worker/src/ingest-retry.test.ts && rg -q -- "-32015" apps/worker/src/ingest.ts` | pending |
| 07-02-01 | 02 | 1 | ADMIN-01, ADMIN-10, LAUNCH-09, TOKEN-07 | T-07-02-01 | [BLOCKING] Migration 0008 with sniped columns, the ticker index and the audit TRUNCATE guard | auto | `pnpm exec vitest run packages/core/src/db-admin.test.ts packages/core/src/db.test.ts && rg -q "BEFORE TRUNCATE ON admin_audit" packages/core/migrations/0008_...` | pending |
| 07-02-02 | 02 | 1 | ADMIN-01, ADMIN-10, LAUNCH-09, TOKEN-07 | T-07-02-01 | Intent eviction order (IN-W-04) and the sign-in replay test (T-06-03-03) | auto | `pnpm exec vitest run apps/worker/src/admin-intent.test.ts && pnpm exec playwright test apps/web/e2e/admin-signin.e2e.ts --project=chromium --reporter=line` | pending |
| 07-03-01 | 03 | 1 | OPS-05, LAUNCH-09 | T-07-03-01 | Terms contact, network and cooldown sentences under one version bump | auto | `pnpm exec playwright test apps/web/e2e/terms.e2e.ts --project=chromium --reporter=line && ! rg -n "@BONDR on X" apps/web` | pending |
| 07-03-02 | 03 | 1 | OPS-05, LAUNCH-09 | T-07-03-01 | www to apex redirect ahead of the unchanged rate limit | auto | `pnpm exec vitest run apps/web/proxy.test.ts && pnpm --filter @bondr/web typecheck` | pending |
| 07-04-01 | 04 | 2 | OPS-05, ADMIN-11 | T-07-04-01 | Mainnet in core Net, rpcUrl, wsUrl and the genesis guard | auto | `pnpm exec vitest run packages/core/src/net.test.ts packages/core/src/keys.test.ts` | pending |
| 07-04-02 | 04 | 2 | OPS-05, ADMIN-11 | T-07-04-01 | launchNet mainnet, the external treasury and its three callers | auto | `pnpm exec vitest run apps/worker/src/env.test.ts && pnpm typecheck` | pending |
| 07-04-03 | 04 | 2 | OPS-05, ADMIN-11 | T-07-04-01 | EVACUATE on mainnet only with the external treasury, one predicate for boot and loop | auto | `pnpm exec vitest run apps/worker/src/env.test.ts apps/worker/src/admin-evacuate.test.ts` | pending |
| 07-05-01 | 05 | 3 | OPS-05, LAUNCH-08 | T-07-05-01 | Per-net pace, ops floor and launch tip in feeConfig, readers moved | auto | `pnpm exec vitest run apps/worker/src/fee-config.test.ts apps/worker/src/fee-send.test.ts && ! rg -n "OPS_FLOOR_LAMPORTS" apps/worker/src` | pending |
| 07-05-02 | 05 | 3 | OPS-05, LAUNCH-08 | T-07-05-01 | Authenticated Sender URL with the swqos rule | auto | `pnpm exec vitest run apps/worker/src/fee-send.test.ts packages/core/src/net.test.ts` | pending |
| 07-06-01 | 06 | 3 | OPS-05 | T-07-06-01 | Production vanity lane and per-lane refill targets | auto | `pnpm exec vitest run apps/worker/src/grind.test.ts apps/worker/src/env.test.ts` | pending |
| 07-06-02 | 06 | 3 | OPS-05 | T-07-06-01 | Real net in /status and the mainnet web chrome check | auto | `pnpm exec vitest run apps/worker/src/status.test.ts && ! rg -n 'net: "devnet" as const' apps/worker/src/status.ts` | pending |
| 07-07-01 | 07 | 2 | TOKEN-07 | T-07-07-01 | Create slot on new coins and sniped_bps written on window trades | auto | `pnpm exec vitest run apps/worker/src/ingest.test.ts packages/core/src/trades.test.ts` | pending |
| 07-07-02 | 07 | 2 | TOKEN-07 | T-07-07-01 | Sniped line on the token page | auto | `pnpm exec playwright test apps/web/e2e/coin.e2e.ts --project=chromium --reporter=line && pnpm --filter @bondr/web typecheck` | pending |
| 07-08-01 | 08 | 3 | OPS-02 | T-07-08-01 | contract.ts profiles, pure judge, moved drift and the RPC gatherer | auto | `pnpm exec vitest run packages/core/src/contract.test.ts && rg -q "@bondr/core/contract" scripts/spike/stages/config.ts && pnpm typecheck` | pending |
| 07-08-02 | 08 | 3 | OPS-02 | T-07-08-01 | The runner and the live devnet pass | auto | `node --env-file=.env scripts/contract-check.ts --net devnet` | pending |
| 07-09-01 | 09 | 4 | LAUNCH-08 | T-07-09-01 | Split prepare.ts, then the tip in compileLaunch with the size guard and the cost math | auto | `pnpm exec vitest run apps/worker/src/build.test.ts apps/worker/src/prepare-flow.test.ts && pnpm exec vitest run apps/worker/src/prepare.test.ts && wc -l apps...` | pending |
| 07-09-02 | 09 | 4 | LAUNCH-08 | T-07-09-01 | Sender at submit with the RPC fallback, and senderTipEstimate in /status | auto | `pnpm exec vitest run apps/worker/src/submit.test.ts apps/worker/src/status.test.ts && pnpm typecheck` | pending |
| 07-09-03 | 09 | 4 | LAUNCH-08 | T-07-09-01 | Sender tip row in the launch summary and the balance check | auto | `pnpm exec playwright test apps/web/e2e/launch-tip.e2e.ts --project=chromium --reporter=line && pnpm --filter @bondr/web typecheck` | pending |
| 07-10-01 | 10 | 5 | OPS-02 | T-07-10-01 | switchesOff and contract-check.ts with the forced-mismatch proof | auto | `pnpm exec vitest run apps/worker/src/contract-check.test.ts apps/worker/src/switches.test.ts && rg -q "contract check passed" apps/worker/src/contract-check.ts` | pending |
| 07-10-02 | 10 | 5 | OPS-02 | T-07-10-01 | Boot, timer, admin route and health wiring | auto | `pnpm exec vitest run apps/worker/src/admin-routes.test.ts apps/worker/src/health.test.ts && pnpm typecheck` | pending |
| 07-10-03 | 10 | 5 | OPS-02 | T-07-10-01 | contract_check pause reason and the launch banner per reason | auto | `pnpm exec vitest run apps/worker/src/status.test.ts && pnpm exec playwright test apps/web/e2e/launch-paused.e2e.ts --project=chromium --reporter=line && pnpm...` | pending |
| 07-11-01 | 11 | 6 | OPS-02 | T-07-11-01 | contractCopy, one case per state row | auto | `pnpm exec vitest run apps/web/lib/admin-copy-health.test.ts` | pending |
| 07-11-02 | 11 | 6 | OPS-02 | T-07-11-01 | The health cell, Run check now, the forwarder entry and the mismatch callout | auto | `pnpm exec playwright test apps/web/e2e/admin-contract.e2e.ts --project=chromium --reporter=line && pnpm --filter @bondr/web typecheck` | pending |
| 07-12-01 | 12 | 6 | LAUNCH-09 | T-07-12-01 | Codes, fields and the forwarder pass-through | auto | `pnpm exec vitest run apps/web/lib/worker.test.ts && pnpm exec tsc -p tsconfig.json` | pending |
| 07-12-02 | 12 | 6 | LAUNCH-09 | T-07-12-01 | FAULTS moved to a lib file, ticker-copy.ts and the step 4 wiring | auto | `pnpm exec vitest run apps/web/lib/ticker-copy.test.ts && pnpm typecheck && wc -l apps/web/components/launch-sign.tsx \| awk '{ exit ($1 < 260) ? 0 : 1 }'` | pending |
| 07-13-01 | 13 | 7 | LAUNCH-09 | T-07-13-01 | Reserved guard and ticker.ts with the D-42 lock matrix | auto | `pnpm exec vitest run packages/core/src/rules.test.ts apps/worker/src/ticker.test.ts && rg -q "apps/worker/src/ticker.test.ts" vitest.config.ts` | pending |
| 07-13-02 | 13 | 7 | LAUNCH-09 | T-07-13-01 | Refuse in admit before anything is spent | auto | `pnpm exec vitest run apps/worker/src/prepare.test.ts apps/worker/src/prepare-flow.test.ts && wc -l apps/worker/src/prepare.ts \| awk '{ exit ($1 < 260) ? 0 :...` | pending |
| 07-14-01 | 14 | 8 | LAUNCH-09 | T-07-14-01 | Reserved and locked field errors in step 1, and the refusal e2e | auto | `pnpm exec playwright test apps/web/e2e/launch-ticker.e2e.ts --project=chromium --reporter=line && pnpm --filter @bondr/web typecheck` | pending |
| 07-14-02 | 14 | 8 | LAUNCH-09 | T-07-14-01 | Oldest-first exact matches with the First marker | auto | `pnpm exec vitest run apps/web/lib/coins.test.ts && pnpm exec playwright test apps/web/e2e/search-first.e2e.ts --project=chromium --reporter=line` | pending |
| 07-15-01 | 15 | 9 | OPS-05 | T-07-15-01 | buildGenesis, the SOL-pair create, buy and burn | auto | `pnpm exec vitest run packages/core/src/launch-genesis.test.ts && wc -l packages/core/src/launch.ts \| awk '{ exit ($1 < 300) ? 0 : 1 }'` | pending |
| 07-15-02 | 15 | 9 | OPS-05 | T-07-15-01 | Genesis in /status, the pause priority and the public banner | auto | `pnpm exec vitest run apps/worker/src/status.test.ts && pnpm exec playwright test apps/web/e2e/launch-paused.e2e.ts --project=chromium --reporter=line && pnpm...` | pending |
| 07-16-01 | 16 | 10 | OPS-05 | T-07-16-01 | genesis.ts and the prepare builder hook | auto | `pnpm exec vitest run apps/worker/src/genesis.test.ts apps/worker/src/prepare-flow.test.ts && wc -l apps/worker/src/prepare.ts \| awk '{ exit ($1 < 260) ? 0 :...` | pending |
| 07-16-02 | 16 | 10 | OPS-05 | T-07-16-01 | Genesis codes, copy and the submit allowance | auto | `pnpm exec vitest run apps/worker/src/submit.test.ts apps/web/lib/worker.test.ts && pnpm typecheck` | pending |
| 07-17-01 | 17 | 11 | OPS-05 | T-07-17-01 | Optional quote mint on mainnet, genesis-boot.ts and verifyQuoteMint | auto | `pnpm exec vitest run apps/worker/src/env.test.ts apps/worker/src/genesis-boot.test.ts && rg -q "genesis-boot.test.ts" vitest.config.ts` | pending |
| 07-17-02 | 17 | 11 | OPS-05 | T-07-17-01 | The main.ts branch, the settle flag and the backfill exclusion | auto | `pnpm exec vitest run apps/worker/src/ingest.test.ts apps/worker/src/settle.test.ts apps/worker/src/settle-flow.test.ts && pnpm typecheck && wc -l apps/worker...` | pending |
| 07-17-03 | 17 | 11 | OPS-05 | T-07-17-01 | Genesis visible in admin | auto | `pnpm exec playwright test apps/web/e2e/admin-contract.e2e.ts --project=chromium --reporter=line && pnpm typecheck` | pending |
| 07-18-01 | 18 | 12 | OPS-05 | T-07-18-01 | Server-side owner check, the actor forward, the banner and genesis errors | auto | `pnpm --filter @bondr/web typecheck && pnpm exec playwright test apps/web/e2e/launch-paused.e2e.ts apps/web/e2e/launch-form.e2e.ts --project=chromium --report...` | pending |
| 07-18-02 | 18 | 12 | OPS-05 | T-07-18-01 | The owner variant in buy, review, summary and coin steps, with the e2e | auto | `pnpm exec playwright test apps/web/e2e/launch-genesis.e2e.ts apps/web/e2e/launch-ticker.e2e.ts --project=chromium --reporter=line && pnpm --filter @bondr/web...` | pending |
| 07-19-01 | 19 | 13 | OPS-03 | T-07-19-01 | Tag the smoke set and prove it locally against next start | auto | `pnpm --filter @bondr/web build && (cd apps/web && WORKER_URL=http://127.0.0.1:9 pnpm exec next start -p 3000 & echo $! > /tmp/bondr-smoke.pid) && for i in $(...` | pending |
| 07-19-02 | 19 | 13 | OPS-03 | T-07-19-01 | ci.yml with the Postgres service, pushed and watched until green | auto | `rg -q "postgres:18.6" .github/workflows/ci.yml && rg -q "check:bundle" .github/workflows/ci.yml && ! rg -q "env-file" .github/workflows/ci.yml && ! rg -qi "s...` | pending |
| 07-20-01 | 20 | 14 | OPS-04 | T-07-20-01 | env-diff.ts with its policy test | auto | `pnpm exec vitest run scripts/env-diff.test.ts` | pending |
| 07-20-02 | 20 | 14 | OPS-04 | T-07-20-01 | setup, dev, test and deploy scripts with package wiring | auto | `for f in scripts/setup.sh scripts/dev.sh scripts/test.sh scripts/deploy.sh; do sh -n "$f" \|\| exit 1; done && sh scripts/deploy.sh staging --dry-run \| grep...` | pending |
| 07-21-01 | 21 | 12 | OPS-05, OPS-02, LAUNCH-08 | T-07-21-01 | The genesis stage on the fork | auto | `pnpm exec tsc -p tsconfig.json && rg -q "genesis" scripts/spike/nets/fork.ts && rg -q "genesisOne" scripts/spike/stages/genesis.ts && rg -q "verifyQuoteMint"...` | pending |
| 07-21-02 | 21 | 12 | OPS-05, OPS-02, LAUNCH-08 | T-07-21-01 | Run the fork rehearsal and the contract check, record the evidence | auto | `node -e 'const r=require("./scripts/spike/results/fork.json");const g=r.rows.filter(x=>x.id.startsWith("genesis."));const need=["genesis.create","genesis.tip...` | pending |
| 07-22-01 | 22 | 15 | OPS-04, OPS-05, ADMIN-11 | T-07-22-01 | PRODUCTION.md with the gate checklist and the incident runbook | auto | `test -f apps/worker/PRODUCTION.md && wc -l apps/worker/PRODUCTION.md \| awk '{ exit ($1 >= 120 && $1 < 300) ? 0 : 1 }' && for g in G-1 G-2 G-3 G-4 G-5 G-6 G-...` | pending |
| 07-22-02 | 22 | 15 | OPS-04, OPS-05, ADMIN-11 | T-07-22-01 | README links and src README lines | auto | `rg -q "PRODUCTION.md" apps/worker/README.md && rg -q "PRODUCTION.md" README.md && for f in $(git diff --name-only --diff-filter=A main -- apps/worker/src \| ...` | pending |
| 07-23-01 | 23 | 13 | OPS-05, OPS-02, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-23-01 | The Phase 7 responsive and axe matrix | auto | `pnpm exec playwright test apps/web/e2e/golive-responsive.e2e.ts --reporter=line && ls .planning/phases/07-go-live/screenshots/golive-*-390.png \| wc -l \| aw...` | pending |
| 07-23-02 | 23 | 13 | OPS-05, OPS-02, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-23-01 | Designer critique and audit, and the fixes | auto | `pnpm exec playwright test apps/web/e2e/golive-responsive.e2e.ts --reporter=line && pnpm typecheck && pnpm lint` | pending |
| 07-24-01 | 24 | 16 | OPS-02, OPS-04, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-24-01 | Deploy staging with deploy.sh and check the boot | auto | `git rev-parse -q --verify refs/tags/deployed-staging >/dev/null && railway logs --service worker --environment staging 2>/dev/null \| tail -500 \| grep -q "c...` | pending |
| 07-24-02 | 24 | 16 | OPS-02, OPS-04, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-24-01 | Regression matrices, the cooldown check, Neon idle and spend | auto | `E2E_BASE_URL="$(rg -o 'https://web-staging[^ )`]*' apps/worker/README.md \| head -1)" pnpm exec playwright test --project=chromium --grep @smoke --reporter=line` | pending |
| 07-25-01 | 25 | 17 | OPS-02, OPS-03, OPS-04, OPS-05, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-25-01 | Full gates, size and emoji checks | auto | `sh scripts/test.sh --full && git diff --name-only main -- '*.ts' '*.tsx' \| xargs -I{} sh -c 'test -f "{}" && wc -l < "{}" \| awk -v f="{}" "\$1 >= 300 { pri...` | pending |
| 07-25-02 | 25 | 17 | OPS-02, OPS-03, OPS-04, OPS-05, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-25-01 | Evidence map, the PR and the merge | auto | `gh pr list --head phase-07-go-live --state merged --json number -q 'length' \| grep -qx 1 && gh run list --branch phase-07-go-live --workflow ci.yml --limit ...` | pending |
| 07-26-01 | 26 | 18 | OPS-05 | T-07-26-01 | OWNER GATE G-1, approve the production environment | owner gate | `gh pr list --head phase-07-go-live --state merged --json number -q 'length' \| grep -qx 1` | pending |
| 07-26-02 | 26 | 18 | OPS-05 | T-07-26-01 | Create Neon production and an empty Railway production, set every variable, deploy web | auto | `node scripts/env-diff.ts --from staging --to production --service worker --phase g1 && node scripts/env-diff.ts --from staging --to production --service web ...` | pending |
| 07-26-03 | 26 | 18 | OPS-05 | T-07-26-01 | DNS records at Porkbun, then verify the domains | human action | `curl -sfI https://trybondr.fun/terms \| head -1 \| grep -q " 200" && curl -sI https://www.trybondr.fun/coins \| grep -qi "^location: https://trybondr.fun/coi...` | pending |
| 07-27-01 | 27 | 19 | OPS-05, ADMIN-11 | T-07-27-01 | OWNER GATE G-2, choose the treasury | owner gate | `owner reply (manual)` | pending |
| 07-27-02 | 27 | 19 | OPS-05, ADMIN-11 | T-07-27-01 | Set TREASURY_PUBKEY on production | auto | `node scripts/env-diff.ts --from staging --to production --service worker --phase g1` | pending |
| 07-28-01 | 28 | 20 | OPS-02, OPS-05 | T-07-28-01 | OWNER GATE G-3, generate and set the production seed | owner gate | `node scripts/env-diff.ts --from staging --to production --service worker --phase g3` | pending |
| 07-28-02 | 28 | 20 | OPS-02, OPS-05 | T-07-28-01 | Deploy the worker dark and verify the genesis boot | auto | `railway logs --service worker --environment production 2>/dev/null \| tail -500 \| grep -q "mainnet (genesis)" && railway logs --service worker --environment...` | pending |
| 07-29-01 | 29 | 21 | ADMIN-11 | T-07-29-01 | OWNER GATE G-7, unlock EVACUATE on mainnet | owner gate | `owner reply (manual)` | pending |
| 07-29-02 | 29 | 21 | ADMIN-11 | T-07-29-01 | Set ADMIN_EVACUATE=on and redeploy the worker | auto | `railway logs --service worker --environment production 2>/dev/null \| tail -300 \| grep -q "mainnet (genesis)" && ! railway logs --service worker --environme...` | pending |
| 07-30-01 | 30 | 21 | OPS-05 | T-07-30-01 | OWNER GATE G-4, fund ops with 0.5 SOL | owner gate | `owner reply (manual)` | pending |
| 07-30-02 | 30 | 21 | OPS-05 | T-07-30-01 | Verify the ops balance | auto | `OPS="$(rg -o 'ops=[1-9A-HJ-NP-Za-km-z]{32,44}' apps/worker/PRODUCTION.md \| head -1 \| cut -d= -f2)" && cd apps/worker && OPS="$OPS" node -e 'const {Connecti...` | pending |
| 07-31-01 | 31 | 22 | OPS-05, LAUNCH-08 | T-07-31-01 | OWNER GATE G-5, send the genesis launch | owner gate | `owner reply (manual)` | pending |
| 07-31-02 | 31 | 22 | OPS-05, LAUNCH-08 | T-07-31-01 | Verify the genesis on chain, set BONDR_QUOTE_MINT and leave genesis | auto | `node scripts/env-diff.ts --from staging --to production --service worker --phase g5 && curl -sf https://trybondr.fun/api/status \| grep -q '"paused":"kill_sw...` | pending |
| 07-32-01 | 32 | 23 | OPS-05 | T-07-32-01 | OWNER GATE G-8, fee engine on | owner gate | `owner reply (manual)` | pending |
| 07-32-02 | 32 | 23 | OPS-05 | T-07-32-01 | Set FEE_ENGINE=on, redeploy, and verify after the owner's switch flips | auto | `railway logs --service worker --environment production 2>/dev/null \| tail -500 \| grep -q "fee engine on" && curl -sf https://trybondr.fun/api/status \| gre...` | pending |
| 07-33-01 | 33 | 24 | LAUNCH-08 | T-07-33-01 | OWNER GATE G-6, the launch Sender tip | owner gate | `owner reply (manual)` | pending |
| 07-33-02 | 33 | 24 | LAUNCH-08 | T-07-33-01 | Apply the choice and verify on production | auto | `curl -sf https://trybondr.fun/api/status \| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).senderTipEstimate;process....` | pending |
| 07-34-01 | 34 | 24 | OPS-05 | T-07-34-01 | OWNER GATE G-10, the Helius plan | owner gate | `owner reply (manual)` | pending |
| 07-34-02 | 34 | 24 | OPS-05 | T-07-34-01 | Verify RPC health after the decision | auto | `curl -sf https://trybondr.fun/api/status >/dev/null && ! railway logs --service worker --environment production 2>/dev/null \| tail -300 \| grep -q " 429"` | pending |
| 07-35-01 | 35 | 25 | OPS-05, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-35-01 | OWNER GATE G-9, open launches and send the test launch | owner gate | `owner reply (manual)` | pending |
| 07-35-02 | 35 | 25 | OPS-05, LAUNCH-08, LAUNCH-09, TOKEN-07 | T-07-35-01 | Verify the first child launch and hand over HV-05-02 | auto | `curl -sf https://trybondr.fun/api/status \| grep -q '"paused":null'` | pending |
| 07-36-01 | 36 | 26 | OPS-05 | T-07-36-01 | OWNER GATE G-11, the Neon plan | owner gate | `owner reply (manual)` | pending |
| 07-36-02 | 36 | 26 | OPS-05 | T-07-36-01 | Record the decision and close the phase docs | auto | `! rg -n "OPS-0[2-5].*Pending\|LAUNCH-0[89].*Pending\|TOKEN-07.*Pending" .planning/REQUIREMENTS.md && rg -q "7\. Go-Live.*Complete" .planning/ROADMAP.md` | pending |

Status values: pending, green, red, flaky.

---

## Requirement and Decision Coverage

| Requirement / Decision | Proven by | Plans |
|------------------------|-----------|-------|
| OPS-02 contract check | contract.test.ts (profiles, judge), contract-check.test.ts (forced mismatch pauses switches only, audit row, pass log line, contractFailed until a green rerun), admin-contract.e2e.ts, devnet CLI run, fork `genesis.contract`, staging and mainnet log line `contract check passed` | 07-08, 07-10, 07-11, 07-21, 07-24, 07-28 |
| OPS-03 CI | ci.yml green run on the branch | 07-19 |
| OPS-04 scripts | env-diff.test.ts, `sh -n`, deploy dry runs, test.sh | 07-20 |
| OPS-05 genesis and gating | launch-genesis.test.ts, status.test.ts, genesis.test.ts, submit.test.ts, env.test.ts, genesis-boot.test.ts (DB: fresh all-on switches written off), ingest/settle tests, launch-genesis.e2e.ts, fork `genesis.create/verify/verify-neg` | 07-15..07-18, 07-21, 07-31 |
| LAUNCH-08 Sender tip | build.test.ts (tip outside table, size fallback), submit/status tests, launch-tip.e2e.ts, fork `genesis.tip`, G-5 on-chain check | 07-05, 07-09, 07-21, 07-31, 07-33 |
| LAUNCH-09 ticker cooldown | ticker.test.ts (D-42 matrix incl. a stale unknown row, retryAfter clamped), prepare.test.ts (no spend), worker.test.ts pass-through, ticker-copy.test.ts, launch-ticker.e2e.ts, coins.test.ts and search-first.e2e.ts, staging prepare-only check | 07-12..07-14, 07-24 |
| TOKEN-07 sniped % | ingest.test.ts sniped cases, coin.e2e.ts line | 07-02, 07-07 |
| D-01 mainnet refusals, D-10, D-37 | env.test.ts, net.test.ts, keys.test.ts, admin-evacuate tests | 07-04 |
| D-11 vanity 100 | grind.test.ts refill table | 07-06 |
| D-15 v1 ingest | trades.test.ts v1 fixture, ingest-retry.test.ts | 07-01 |
| D-16 security follow-ups | db-admin.test.ts TRUNCATE, admin-intent.test.ts eviction, admin-signin.e2e.ts replay | 07-02 |
| D-17, D-43 terms | terms.e2e.ts | 07-03 |
| D-07 www redirect | proxy.test.ts (exact SITE_URL www host only, forged x-forwarded-host refused) | 07-03 |
| D-38 runbook | PRODUCTION.md grep gate | 07-22 |
| UI surfaces | golive-responsive.e2e.ts at 390/768/1440 with axe, Designer sign-off | 07-23 |

---

## Wave 0 Requirements

Phase 7 extends existing infrastructure; each new test file is created by the task that needs it, test first (`tdd="true"` tasks write the test before the code):

- [ ] `packages/core/src/fixtures/v1-bondr-sell.json` (07-01, after the capture-tx version fix)
- [ ] `packages/core/src/contract.test.ts`, `apps/worker/src/contract-check.test.ts` (07-08, 07-10)
- [ ] `apps/worker/src/ticker.test.ts` added to the DB list (07-13)
- [ ] `packages/core/src/launch-genesis.test.ts`, `apps/worker/src/genesis.test.ts`, `apps/worker/src/genesis-boot.test.ts` added to the DB list (07-15..07-17)
- [ ] `scripts/env-diff.test.ts` in the unit project (07-20)
- [ ] `.github/workflows/ci.yml` and the `@smoke` tags (07-19)

No new framework is installed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Designer critique and audit of the Phase 7 screenshots | UI | Judgment against UI-SPEC | 07-23 Task 2; scores and fixes in 07-23-SUMMARY.md |
| Production environment, DNS, seed, treasury, funding, genesis, engine, tip, launches, Helius and Neon plans | OPS-05, LAUNCH-08 | Owner gates G-1..G-11 (real money, billing, custody) | 07-26..07-36 checkpoint tasks, each followed by an automated read-only check |
| HV-05-02 first mainnet forced bond through Sender | LAUNCH-08 | Happens when a coin first reaches forced bond | 07-35 SUMMARY hands it over |
| HV-06-01 and HV-06-02 on staging | ADMIN-01, ADMIN-06 | Need the owner's Phantom and a Sentry token | 07-24 SUMMARY hands them over |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are owner checkpoints followed by an automated check
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (each new test is created test-first by its own task)
- [x] No watch-mode flags
- [x] Feedback latency under 60 s for unit checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
