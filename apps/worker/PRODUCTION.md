# Production runbook

The single runbook for BONDR on mainnet: the environment, its variables (names only, never values), deploys, the dark boot, genesis, the owner gates G-1 to G-11, load measurement and the seed leak response. Every gate plan (07-26 to 07-36) follows a section here. Gates are not approved until the owner says so; each needs the owner's explicit reply. Staging is described in README.md.

## 1. Environment

- Railway project `bondr`, environment `production`, services `web` (public) and `worker` (private, no domain), region US East next to Neon. One worker replica only (C-04): two would send every fee job twice.
- Domains on the production web service: the apex `trybondr.fun` and `www.trybondr.fun`. The web proxy redirects www to the apex (308), so the admin sign-in domain line always matches `SITE_URL`.
- DNS is at Porkbun. Add the records `railway domain trybondr.fun --service web --environment production` and the same for `www.trybondr.fun` print: an ALIAS at the apex, a CNAME for www, and both TXT verification records. If Porkbun refuses an apex ALIAS, move DNS to Cloudflare's free plan: add the site in Cloudflare, copy the records, switch the nameservers at Porkbun to Cloudflare's, and add the apex as a CNAME (Cloudflare flattens it) with the proxy off (grey cloud). Not a money step.

## 1b. Creating the environment

- `railway environment new production`: empty. Never `--duplicate staging`: a duplicate copies every staging variable, the seed included, and can start a second devnet worker with the staging seed next to the real one (C-04).
- Copy only the non-variable service settings from staging: root directory, build and start commands, the web pre-deploy `node packages/core/src/migrate.ts`, healthchecks, region. Read them through an allow-list, so no `variables` key can reach the terminal: `railway environment config -e staging --json | jq '.services | map_values({build, deploy})'`. Never copy the GitHub repo source. Production services have no repo source and no auto-deploy, so a merge to main never reaches mainnet.
- Never run `railway environment config --json`, `railway variable list` (`--json` or `--kv`) or `railway variables` without a filter that drops every value: each prints every raw value, the staging seed and the shared Helius key included. Names only: `railway variable list --service <s> --environment <e> --json | jq 'keys'`.
- Check there is no repo source on either production service (prints only the result; `railway status --json` holds no variables): `railway status --json | jq -e '[.environments.edges[].node | select(.name == "production") | .serviceInstances.edges[].node.source.repo] | length == 2 and all(. == null)' >/dev/null && echo "no repo source"`.
- Production deploys only through `scripts/deploy.sh` (`railway up` of the local tree, project bondr pinned), from a clean `main` at exactly `origin/main` with CI green for that commit; it refuses anything else.
- Production services have no watch patterns (removed 2026-10-30). With them, redeploying an unchanged commit, as every variable-only deploy does, is SKIPPED by Railway and `railway up --ci` never returns. Staging keeps its patterns, so the same hang applies there.
- Gate records (gate SUMMARYs, edits to this file after G-1) live on the `phase-07-gates` branch. Before any production deploy: commit the records there, `git switch main && git pull --ff-only`, deploy, `git switch phase-07-gates`.

## 2. Variables

Every variable is set explicitly, one per call. Every secret is new (D-12), never copied from staging. Set a value without it reaching the shell history or a log:

```sh
openssl rand -base64 48 | tr -d '\n' | railway variable set SESSION_SECRET --stdin --service web --environment production --skip-deploys
```

A value that must match on both services is generated once inside a subshell and piped to each:

```sh
(t=$(openssl rand -base64 48 | tr -d '\n'); for s in web worker; do printf %s "$t" | railway variable set WORKER_TOKEN --stdin --service "$s" --environment production --skip-deploys; done)
```

Public values (a public key, `mainnet`, a flag) may go as `railway variable set NAME=value --service ... --environment production --skip-deploys`.

| Name | Service | Value or source |
|------|---------|-----------------|
| `SOLANA_NET` | web, worker | `mainnet` |
| `ALLOW_MAINNET` | worker | `1` (with `SOLANA_NET=mainnet`, D-01) |
| `SITE_URL` | web, worker | `https://trybondr.fun` |
| `DATABASE_URL` | web, worker | the Neon production database (section 3), piped from `neonctl`, never printed |
| `WORKER_TOKEN` | web, worker | new, the same on both |
| `WORKER_URL` | web | `http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:${{worker.PORT}}` (a Railway reference, in single quotes) |
| `SESSION_SECRET` | web | new |
| `pinata_jwt` | web | a new Pinata API key; the owner pastes it in the Railway dashboard, never in chat |
| `PINATA_GATEWAY` | web | the same gateway host as staging (public) |
| `NEXT_PUBLIC_SENTRY_DSN` | web | the bondr-web DSN; Sentry tags the environment from `RAILWAY_ENVIRONMENT_NAME` |
| `SENTRY_DSN` | worker | the bondr-worker DSN |
| `SENTRY_READ_TOKEN` | worker | optional, for the Health panel's Sentry cell |
| `ADMIN_WALLET` | web, worker | the owner's Phantom public key, the same on both; unset keeps admin closed (C-07) |
| `helius_api_key` | worker only | the same key as staging; web refuses to boot holding it |
| `PRIORITY_FEE_MICROLAMPORTS` | worker | set explicitly at G-1 (RESEARCH Q1); the dev pays it, the preview shows it |
| `VANITY_LANE` | worker | `production` |
| `VANITY_THREADS` | worker | `2` |
| `FEE_ENGINE` | worker | `dry` until G-8 |
| `ADMIN_EVACUATE` | worker | `simulate` until G-7 |
| `TREASURY_PUBKEY` | worker | G-2 |
| `MASTER_SEED` | worker only | G-3, set by the owner only; Claude never sees it |
| `BONDR_QUOTE_MINT` | worker only | unset until G-5 (unset = genesis mode); web does not read it |

`FEE_WINDOW_MS` and `FEE_BATCH_HOUR_UTC` keep their defaults. Check the result with env-diff, which pipes Railway's lists straight into jq and gets back names and facts only, never a value:

```sh
node scripts/env-diff.ts --from staging --to production --service web --phase g1
node scripts/env-diff.ts --from staging --to production --service worker --phase g1
```

It fails when any value has surrounding whitespace; when `WORKER_TOKEN`, `DATABASE_URL`, `SOLANA_NET` or `SITE_URL` is missing (and `SESSION_SECRET` on web, `helius_api_key`, `FEE_ENGINE` and `ADMIN_EVACUATE` on the worker); when `SOLANA_NET` is not exactly `mainnet`, `SITE_URL` not `https://trybondr.fun`, and on the worker `ALLOW_MAINNET` not `1` or `VANITY_LANE` not `production`; when a D-12 secret (`WORKER_TOKEN`, `SESSION_SECRET`, `DATABASE_URL`, `pinata_jwt`) equals staging; when web holds `MASTER_SEED` or `helius_api_key`; and on the phase rule: `g1` no `MASTER_SEED` or `BONDR_QUOTE_MINT`, `g2` also `TREASURY_PUBKEY` present and not `ADMIN_WALLET`, `g3` the seed present (by name only: env-diff never compares it, D-11), `g5` the quote mint present. It reads only the project bondr and refuses a checkout linked to another project.

## 3. Neon

- `neonctl branches create --project-id royal-waterfall-05278863 --name production --parent main`, then a fresh empty database on it: `neonctl databases create --project-id royal-waterfall-05278863 --branch production --name bondr`. Never `--schema-only`: the migrator would find tables but no journal rows and fail (Pitfall 17). The web pre-deploy migrates the empty database from 0000.
- Pipe the pooled connection string (`neonctl connection-string production --project-id royal-waterfall-05278863 --database-name bondr --pooled`) straight into `railway variable set DATABASE_URL --stdin` for web and worker in one subshell; never print it.
- Fixed 0.25 CU, default autosuspend, no timer reads (C-03).
- The 500 CU-h monthly quota is shared by every branch of the project: a staging or dev spike can suspend production until the 1st (Pitfall 19). Watch month-to-date use with `neonctl api /consumption_history/projects` or the console; after go-live the owner may scale the staging services to zero when not testing. G-11 reviews the plan above 400 CU-h projected.

## 4. Deploy

- Always dry-run first: `pnpm run deploy -- production --dry-run` prints the order, the services and the tag move.
- `sh scripts/deploy.sh production [--only web|worker] [--yes]` refuses a checkout not linked to the Railway project bondr, a dirty tree, a branch other than `main`, a `HEAD` that is not exactly `origin/main` after a fetch, and a commit without a green CI run; then it asks "Type production to deploy to trybondr.fun" unless `--yes`. It prints the project and commit before uploading.
- Order: web first when `packages/core/migrations` changed since the local tag `deployed-production` (or the tag is missing): its pre-deploy migrates, and the worker needs the new tables. Otherwise the worker first. Each service must reach SUCCESS before the next. `--only worker` is refused in the web-first case: run a full deploy.
- The tag `deployed-production` moves to the commit checked at the start only after a full deploy (no `--only`) succeeded; HEAD or the tree changing mid-deploy stops it. It is a local tag: push it with `git push origin deployed-production` if another machine deploys.
- Rollback: redeploy the previous successful deployment from the Railway dashboard (its "Redeploy" action) right away. Then fix forward: `git revert` the bad change on a branch, open a PR, merge it with CI green, `git switch main && git pull --ff-only`, and deploy that. Never commit on main locally: deploy.sh refuses anything but the exact `origin/main` commit.

## 5. Dark boot checklist

Production boots dark (D-13): `FEE_ENGINE=dry`, every switch off, `ADMIN_EVACUATE=simulate`, no `BONDR_QUOTE_MINT`. Read logs only with `railway logs --service worker --environment production`, grepping for known lines; never list variables.

- `worker listening on mainnet (genesis)`
- `switches: launches=off forcedBond=off sweeps=off finalize=off buybackBurn=off` (genesis writes the fresh database's switches off, audited as actor `genesis`)
- `contract check passed: pump=... pump AMM=... pump fees=...` (mainnet profile)
- `wallets: ops=... buyback=... treasury=...` (public keys only)
- `vanity <idx> <pubkey>` lines as the production pool grinds toward 150 (it refills below 100)
- `curl -sf https://trybondr.fun/api/status` answers `"paused":"genesis"`
- env-diff phase g1 passes for both services before the first deploy, g2 after the treasury, g3 after the seed.

## 6. Genesis and leaving genesis

1. G-5: the owner, signed in at `/admin` with `ADMIN_WALLET`, opens `/launch` and sends the genesis launch (SOL pair, treasury creator, insta burn, 0.25 SOL dev buy, the Sender tip).
2. Claude checks the transaction: creator = `TREASURY_PUBKEY`, quote SOL, the dev holds 0 BONDR, a Sender tip transfer is present.
3. `railway variable set BONDR_QUOTE_MINT=<mint> --service worker --environment production --skip-deploys` (worker only), then `node scripts/env-diff.ts --from staging --to production --service worker --phase g5`.
4. `sh scripts/deploy.sh production --only worker --yes` from main. Boot runs `verifyQuoteMint`: a wrong mint, a non-SOL pair or a missing curve refuses to start, naming the fact. Then `backfilled N launches`, `stream subscribed`, and the switches line still all off.
5. `/api/status` answers `"paused":"kill_switch"`, not `genesis`. Then G-8.

## 7. Owner gates

Each gate: the default, what the owner does, what Claude runs, how it is verified. Claude never handles real SOL, the seed or a billing setting.

### G-1 Create production, deploy web dark (07-26)
- Default: create it once Phase 7 is merged with CI green; about +$5-15/month of Railway usage.
- Owner: reply "G-1 approved" with the `ADMIN_WALLET` public key; paste a new `pinata_jwt` in the dashboard; add the DNS records (section 1).
- Claude: sections 1b, 2 and 3; env-diff g1 for web and worker; `sh scripts/deploy.sh production --only web --yes` from main. The worker is not deployed yet (no seed).
- Verify: the section 1b "no repo source" check, `/terms` answers 200 with the contact line, www answers 308 to the apex, `/api/status` answers 503 until the worker runs.
- Record (2026-10-27): Railway's default `production` environment was already there and empty (no services, no variables), so it was used instead of `environment new`. Service settings were staged from staging's allow-listed config and committed with no source; region us-east4, one replica each. Neon branch `production` with an empty database `bondr` (0.25 CU). `PRIORITY_FEE_MICROLAMPORTS=10000` (RESEARCH Q1: no static mainnet default, so 10000). `PORT=8080` on web and worker; both domains target 8080. Web deployed from `1b9a845` (migrations applied); the worker has no deployment. env-diff g1 passed for both. Still open: `ADMIN_WALLET` (not sent yet, admin stays closed), `pinata_jwt` (launch uploads fail until set), DNS.
- Record (2026-10-30): DNS added by the owner; both certificates valid. `ADMIN_WALLET` set on web and worker (`GWWb...ZVRe`). Web redeployed from `6098e98` (deployment 5eac3839) so the wallet took effect. One build failed with no error message at the compile step and the identical retry passed; a local build on the same Node 24.22 also passed. Verified: `/terms` 200, www 308 to the apex, `/api/status` 503 until the worker runs, env-diff g1 for both, no repo source. `pinata_jwt` set and deployed (f56ce186, env-diff: differs from staging). G-1 complete.
- DNS records for Porkbun: apex `ALIAS` (or CNAME-flattened) `trybondr.fun` -> `waoiuq03.up.railway.app`; `CNAME` `www` -> `xe8jc8gj.up.railway.app` (www was missing from Railway on 2026-10-30 and was re-attached, which replaced the earlier target); `TXT` `_railway-verify` and `_railway-verify.www` with the tokens `railway domain status <domain> --service web --environment production` prints. Remove Porkbun's parking A records on the apex first.

### G-2 Treasury address (07-27)
- Default: a new owner-only wallet (fresh Phantom account or hardware wallet), not derived from the seed and not the admin wallet. It is locked into every finalized coin's sharing config, receives EVACUATE funds, and claims BONDR's own creator fees on pump.fun (D-31).
- Owner: reply "G-2 approved" with the public key.
- Claude: check it parses and differs from `ADMIN_WALLET`, then `railway variable set TREASURY_PUBKEY=<key> --project cf985056-2099-4497-a2c1-1aa639343af4 --service worker --environment production --skip-deploys`. No deploy.
- Verify: env-diff g2 for the worker passes (`TREASURY_PUBKEY` present, no whitespace, not `ADMIN_WALLET`). Boot later refuses a treasury equal to ops or any derived role.
- Record (2026-10-30): `TREASURY_PUBKEY` set to `HSor...BXwt`, no deploy; env-diff g2 passed for the worker.
- Never change `TREASURY_PUBKEY` between G-2 and the post-genesis redeploy (G-5): the one-genesis guard keys on the current treasury, so a change would admit a second BONDR genesis (07-SECURITY IN-W-02).

### G-3 Production seed (07-28)
- Default: the production seed never touches the Mac (D-11): no file, no terminal, no shell history, no chat, no clipboard on the Mac. On the phone, with Handoff off so Universal Clipboard cannot carry it to the Mac, the owner generates it in the password manager's generator: exactly 43 characters, letters and digits only (no symbols), which is 32 random bytes in base64. They save it there as the offline copy (or write it on paper), open the Railway dashboard in the phone's browser (project bondr, environment production, service worker, Variables), add `MASTER_SEED` with that value, and do not deploy from the dashboard. Never reused from staging or local. Claude never asks for, reads or handles it.
- Claude: env-diff g3 (the seed's presence, by name only), then a full deploy `sh scripts/deploy.sh production --yes` (web then worker from the same commit; it creates the `deployed-production` tag that later `--only worker` deploys need); section 5 checklist; record the `ops=` and `buyback=` public keys here from the wallets line.
- Verify: the section 5 lines, and `"paused":"genesis"` on `/api/status`.

### G-4 Fund ops (07-30)
- Default: 0.5 SOL from the owner to the ops address recorded at G-3. The mainnet ops floor is 0.1 SOL; the low-ops alert asks for manual top-ups.
- Claude: read the balance from public RPC (no key) and confirm at least 0.5 SOL.

### G-5 BONDR genesis launch (07-31)
- Default: after G-1 to G-4, a passing mainnet contract check and the fork genesis rows (07-21). Dev buy 0.25 SOL, insta burned, from the owner's Phantom; metadata per D-32.
- Owner: send it from `/launch` and paste the signature. Claude: section 6.

### G-6 Launch Sender tip (07-33)
- Default: 0.001 SOL (Sender full path), paid by each creator inside their launch, shown in the cost preview. Alternative: 0.000005 SOL, SWQOS only.
- Claude: default changes nothing; the alternative is a code PR (`launchTipLamports`) merged, then a worker deploy. Verify `senderTipEstimate` on `/api/status`.

### G-7 EVACUATE on (07-29)
- Default: flip `ADMIN_EVACUATE` to `on` right after G-3 (the worker cannot boot before the seed), once section 10 is read. Mainnet accepts it only with `TREASURY_PUBKEY` set (D-37).
- Claude: `railway variable set ADMIN_EVACUATE=on --service worker --environment production --skip-deploys`, worker deploy, check the boot did not refuse. Evacuate nothing.

### G-8 Fee engine on (07-32)
- Default: right after genesis and `BONDR_QUOTE_MINT`, before the first child launch.
- Claude: `FEE_ENGINE=on`, worker deploy, log `fee engine on: N coins armed`. The owner flips forcedBond, sweeps, finalize and buybackBurn on in `/admin`; launches stay off.

### G-9 Open child launches (07-35)
- Preconditions (D-30): `BONDR_QUOTE_MINT` set and verified, the contract check passed, the vanity pool at least 100 free, G-6 and G-10 decided.
- Owner: one owner or friend test launch on mainnet, then the launches switch on. Claude: check the test launch (Sender tip, exit in the same transaction, quote BONDR), screenshot the coin page, `/api/status` `"paused":null`.

### G-10 Helius plan (07-34)
- Default: stay on the current plan through the dark period and genesis; upgrade to Developer ($49/month) before public launches, or earlier on the section 8 thresholds.

### G-11 Neon plan (07-36)
- Default: no upgrade; Launch (about $19/month) only if projected use passes 400 CU-h (section 3).

### Contract check mismatch
Every job is paused, launches included, and Sentry gets the failed facts; the Health panel's Pump contract check cell turns red. Review the facts against pump's announcements. Nothing re-enables by itself. Turn jobs back on one at a time in `/admin`, and only once Run check now passes: launches stay paused until then, because a failed check must be re-run green (D-20). A changed deploy slot with every fact passing is an amber warning only.

## 8. Load measurement (D-14)

During the dark period read the admin Health RPC cell (p50, p95, error rate, 429 count in the last hour, from the worker's RPC stats ring) and the credits used in the Helius dashboard. G-10 upgrades early on any 429s or credits above 80% of the plan.

## 9. HV-05-02

On the first mainnet forced bond, check the Sender response in the worker log and the tip transfer on Solscan: the buy and burn landed through Sender with a tip paid by ops. Record it in `05-HUMAN-UAT.md`.

## 10. Seed leak: mainnet incident runbook

Use this when the production `MASTER_SEED`, or any key derived from it, may be in someone else's hands (D-38, ADMIN-11).

1. **Leak signal.** An unexpected outflow from any W, ops or buyback wallet (Solscan, the Health panel's balances, a reconcile diff).
2. **EVACUATE.** Sign in at `https://trybondr.fun/admin` with Phantom, scroll to the EVACUATE panel (last in the console), type `EVACUATE ALL W TO TREASURY` to arm it and run the simulation, read the totals, then press "Sign and evacuate N wallets" and approve in Phantom. Every job pauses first, then every W's BONDR and SOL move to the treasury and child tokens are burned. It needs `ADMIN_EVACUATE=on` (G-7); on `simulate` the button reads "Simulation only on this deploy".
3. **Rotate the seed.** The owner generates a new `MASTER_SEED` exactly as G-3 (on the phone, in the password manager, pasted into the Railway dashboard there; never on the Mac, which may be the leaked machine) and sets it on the worker; Claude never sees it. `sh scripts/deploy.sh production --only worker --yes`. New launches then derive new W, a new ops and a new buyback (read them from the `wallets:` line). The owner funds the new ops (as G-4) and moves what is left in the old ops.
4. **What rotation cannot fix.** Unbonded coins keep their old W as the on-chain creator, so whoever holds the old seed can still collect those coins' future creator fees. Finalized coins pay through their sharing config and are unaffected.
5. **Hide or announce.** Hide the affected unbonded coins in `/admin` (moderation) or announce them with the facts, then turn jobs back on one at a time.
