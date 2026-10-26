---
phase: 07-go-live
reviewed: 2026-10-26T15:00:00Z
depth: standard (deploy.sh, env-diff.ts, ci.yml, PRODUCTION.md, genesis rehearsal); quick (e2e specs, other scripts)
files_reviewed: 38
files_reviewed_list:
  - .github/workflows/ci.yml
  - apps/worker/PRODUCTION.md
  - apps/web/e2e/admin-contract.e2e.ts
  - apps/web/e2e/admin-locked.e2e.ts
  - apps/web/e2e/admin-signin.e2e.ts
  - apps/web/e2e/admin-stubs.ts
  - apps/web/e2e/coin-sniped.e2e.ts
  - apps/web/e2e/fee-devnet.e2e.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/golive-responsive.e2e.ts
  - apps/web/e2e/home.e2e.ts
  - apps/web/e2e/launch-form.e2e.ts
  - apps/web/e2e/launch-genesis.e2e.ts
  - apps/web/e2e/launch-paused.e2e.ts
  - apps/web/e2e/launch-ticker.e2e.ts
  - apps/web/e2e/launch-tip.e2e.ts
  - apps/web/e2e/search-first.e2e.ts
  - apps/web/e2e/shoot.ts
  - apps/web/e2e/terms.e2e.ts
  - apps/web/e2e/wallet.e2e.ts
  - scripts/capture-tx.ts
  - scripts/contract-check.ts
  - scripts/deploy.sh
  - scripts/dev.sh
  - scripts/devnet-launch.ts
  - scripts/devnet-trades.ts
  - scripts/env-diff.test.ts
  - scripts/env-diff.ts
  - scripts/setup.sh
  - scripts/spike/nets/fork.ts
  - scripts/spike/results.ts
  - scripts/spike/stages/config.ts
  - scripts/spike/stages/engine-bond.ts
  - scripts/spike/stages/genesis.ts
  - scripts/spike/stages/launch.ts
  - scripts/spike/stages/pool-launch.ts
  - scripts/stream-probe.ts
  - scripts/test.sh
findings:
  critical: 5
  warning: 6
  info: 7
  total: 18
status: fixed_partial # fixes applied 2026-10-26; WR-O-05 owner-blocked (GitHub billing)
---

# Phase 7: Code Review Report (ops: deploy, env-diff, CI, runbook, e2e, fork rehearsal)

**Reviewed:** 2026-10-26
**Depth:** standard for deploy.sh, env-diff.ts, ci.yml, PRODUCTION.md and the genesis fork stage; quick for the e2e specs and the other scripts
**Files Reviewed:** 38
**Status:** issues_found

## Summary

What holds up: deploy.sh quotes every path, so the space in "Git Projects.nosync" is safe. It refuses a dirty tree and any branch name other than `main`, asks for the typed word unless `--yes`, and names `--service`/`--environment` on every Railway call. env-diff never logs a value on the success path, and its unit test checks that. ci.yml holds no secrets and only uses a throwaway Postgres container, never Neon. All four action tags and `postgres:18.6` exist. The genesis rehearsal rules are strict: creator is the treasury, quote is SOL, the dev ends with 0, supply drops by exactly tokensOut, the tip key is static, and the child mint is refused. The checker counts a missing row as FAIL.

The real problems:

1. A runbook command prints every staging secret. I confirmed this against the live staging config by printing key paths only.
2. The production seed procedure puts the seed on the Mac, which contradicts D-11.
3. env-diff dumps every raw variable when it exits on an error.
4. deploy.sh trusts whatever project the directory is linked to, and whatever local `main` happens to be checked out.
5. The migration-order guard never runs in production, because the runbook deploys with `--only` every time.

Verification notes:
- `railway environment config -e staging --json` was checked by printing only jq key paths. The output contains `services.<id>.variables.{MASTER_SEED,DATABASE_URL,WORKER_TOKEN,SESSION_SECRET,helius_api_key,pinata_jwt,...}.value`.
- The env-diff error dump was reproduced with Node 24.13.
- CI run history (`gh run list`) shows every run was refused before starting, because of GitHub billing.

## Critical Issues

### CR-O-01: Runbook step prints every staging secret, including the seed and the Helius key production shares

**File:** `apps/worker/PRODUCTION.md:14` (also `.planning/phases/07-go-live/07-26-PLAN.md:73,119`, out of scope but it carries the same step)
**Issue:** Section 1b tells the operator (Claude, at G-1) to read staging settings with `railway environment config -e staging --json`. On Railway CLI 5.71 that JSON includes `services.<id>.variables.<NAME>.value` for every variable. I confirmed this on the live staging environment by printing key paths only. Running the step as written puts these into the terminal and the Claude transcript, which persists on disk under `~/.claude/projects`:
- staging `MASTER_SEED`
- `DATABASE_URL`, which holds the Neon password for a branch in the same Neon project as production
- `WORKER_TOKEN` and `SESSION_SECRET`
- `pinata_jwt`
- `helius_api_key`, which D-12 reuses on production

So a G-1 step leaks a production credential and breaks Pitfall 18 ("never print a value"). The 07-26 plan's final check, `railway environment config -e production --json | grep -q '"repo"'`, is safe because grep -q prints nothing. The "read staging's service settings" step is not.
**Fix:** Allow-list only the settings fields before anything reaches stdout, and put the filter in the runbook verbatim:
```sh
railway environment config -e staging --json \
  | jq '{services: (.services | map_values({build, deploy}))}'   # allow-list: no variables key can survive
```
Add a line: "Never run `railway environment config` or `railway variable list` without a filter that drops `variables`."

**Outcome:** Fixed (d756be7, a64cff7). Section 1b reads staging's settings only through `jq '.services | map_values({build, deploy})'` (checked against live staging: 0 variable paths survive), adds a rule never to run `railway environment config --json`, `railway variable list` or `railway variables` without a value-dropping filter, and gives a names-only command (`... --json | jq 'keys'`). 07-26 quotes the same filter in its context and action, and its verify no longer greps the environment config.

### CR-O-02: G-3 and the leak runbook have the owner create the production seed on the Mac (contradicts D-11)

**File:** `apps/worker/PRODUCTION.md:120`, `apps/worker/PRODUCTION.md:171`
**Issue:** D-11 says "the production seed never sits on the owner's Mac." G-3 says "the owner runs `openssl rand -base64 32` on their own machine, pastes it ... and keeps an offline copy." The owner's machine is this Mac, where Claude Code has a shell. The seed then sits in:
- terminal scrollback, and any saved session or tmux log
- the macOS clipboard, Universal Clipboard and any clipboard manager

Section 10 step 3, seed rotation after a leak, repeats this ("as G-3"). That is the one moment the Mac might be the compromised machine.

There is a second route onto the Mac. G-3 and section 6 step 3 tell Claude to run `env-diff --phase g3/g5`. That runs `railway variable list --json` on the Mac, which downloads the raw production `MASTER_SEED` into a process Claude started. The value is hashed and nothing is printed on success, but the seed still crosses onto the Mac, and CR-O-03 shows how it can then be printed.
**Fix:**
- Rewrite G-3 and section 10 step 3: generate the seed on a device that is not the Mac (a phone password-manager generator, or a hardware wallet's entropy written to paper), and paste it into the Railway dashboard from that device. Keep the offline copy on paper or in that manager. Say explicitly: "not on the Mac, not through a terminal".
- For env-diff, either record an explicit owner-accepted exception to D-11 for its in-memory hash, or drop the seed from what env-diff downloads. For example, drop `MASTER_SEED` from the parsed object straight after `JSON.parse`, keeping only a presence flag. Then show that it differs from staging another way, such as the owner confirming they generated a fresh one. The derived pubkeys cannot prove this, because derivation includes the net.

**Outcome:** Fixed (d756be7, a64cff7, a43cdda). G-3 and section 10 step 3 now have the owner generate the seed on the phone, Handoff off, in the password manager's generator: exactly 43 letters and digits, which `env.ts` decodes to exactly 32 bytes (checked). The offline copy stays there or on paper, and the seed is pasted into the Railway dashboard in the phone's browser. Never on the Mac, never in a terminal, chat or the Mac clipboard. 07-28's default, owner steps, verify and threat row match. env-diff never fetches a value into node. Railway's lists are piped straight into jq inside one sh pipeline, and jq returns only facts. MASTER_SEED is read for presence only and never compared or hashed. Residual: Railway has no names-only listing, so the raw bytes still pass through jq's memory on the Mac and are dropped there; the D-12 guarantee for the seed is now the owner generating it fresh.

### CR-O-03: env-diff dumps every raw variable value if `railway variable list` exits non-zero

**File:** `scripts/env-diff.ts:84-88`, `scripts/env-diff.ts:100-106`
**Issue:** `execFileSync` throws an Error carrying `stdout` and `output`. Nothing catches it, so Node prints the error through `util.inspect`, own properties included. I reproduced this on Node 24.13:
```
Error: Command failed: ...
  output: [ null, '{MASTER_SEED:SECRETSEED}\n', null ],
  stdout: '{MASTER_SEED:SECRETSEED}\n',
```
Any path where the Railway CLI writes the JSON and then exits non-zero prints every variable of that environment into the terminal and the Claude transcript. Examples: a post-print error, or the process being signalled after printing. At g3 and g5 that output includes the production `MASTER_SEED`. The trigger is unlikely, but the script has no defense at all, and the file's own header promises "no secret ever reaches the terminal."
**Fix:**
```ts
function readHashed(environment: string, service: Service): Hashed {
  const args = ["variable", "list", "--project", PROJECT_ID, "--environment", environment, "--service", service, "--json"];
  let out: string;
  try {
    out = execFileSync("railway", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    const status = (e as { status?: number }).status;
    throw new Error(`railway variable list failed for ${environment}/${service} (exit ${status ?? "?"})`); // no stdout
  }
  try {
    return hashAll(JSON.parse(out) as Record<string, string>);
  } catch {
    throw new Error(`railway variable list for ${environment}/${service} returned non-JSON`); // no snippet
  } finally {
    out = "";
  }
}
```
Also wrap the `import.meta.main` block in try/catch so it prints only `e.message`.

**Outcome:** Fixed (a43cdda). Every subprocess runs with stdout piped and stderr ignored. A non-zero exit throws a fixed message with the exit code only (`reading the worker variables failed (exit N); output not shown`), and the main block catches and prints `e.message` only. Test `env-diff script` runs the real script against a fake `railway` that prints a seed to stdout and stderr and then exits 3: the script exits 1 with the fixed message and the seed is absent from its output.

### CR-O-04: deploy.sh and env-diff deploy to, and read, whatever project the directory is linked to

**File:** `scripts/deploy.sh:68`, `scripts/deploy.sh:91`, `scripts/env-diff.ts:85`
**Issue:** No call passes `--project`. Railway resolves the project from `~/.railway/config.json`, keyed by directory path. This machine links several projects that have a `production` environment, among them agencybook (`7ad7d0cc-...`), the pump launchpad these services were ported from, which likely uses the same `web`/`worker` service names. agencybook is also used through extra worktree paths. Two ways this goes wrong:
- A stray `railway link` in the BONDR directory, or a BONDR checkout at a path that resolves to another link, makes `sh scripts/deploy.sh production --yes` upload BONDR's tree to the other project's `production` environment.
- env-diff silently compares the wrong project.

The typed prompt says "trybondr.fun" but nothing checks that the target really is trybondr.fun. The runbook passes `--yes` on every production deploy anyway.
**Fix:** Pin the project ID. It is not secret.
```sh
PROJECT=cf985056-2099-4497-a2c1-1aa639343af4 # Railway project bondr
railway deployment list --project "$PROJECT" --service "$1" --environment "$TARGET" --json --limit 1 | ...
railway up --project "$PROJECT" --service "$svc" --environment "$TARGET" --ci
```
Add the same constant to env-diff's `args` array.

**Outcome:** Fixed (ede0239, a43cdda). `PROJECT=cf985056-2099-4497-a2c1-1aa639343af4` (bondr, verified with `railway status --json | jq .id`) is passed as `--project` to every `railway deployment list`, `railway up` and `railway variable list`. Both scripts refuse when `railway status --json` names another linked project. deploy.sh was checked with a fake railway in a scratch clone; env-diff has unit tests for the refusal and for the pinned `--project` on every list call.

### CR-O-05: Production accepts any local `main`, stale or ahead of origin, with no CI check

**File:** `scripts/deploy.sh:33-36`
**Issue:** The guard only checks the branch name. `railway up` uploads the local tree, so the following all pass every check and go to mainnet:
- **Stale `main`.** Section 1b has every gate do `git switch main`, deploy, then switch back, with no pull. A fix merged on GitHub between G-1 and G-3 means the worker ships an older commit than the web. If `main` was never pulled after the Phase 7 merge, pre-Phase-7 code ships.
- **Unpushed commits on `main`.** Section 4 tells the operator to `git revert` on main locally and deploy. That puts unreviewed code, absent from origin and never CI-tested, on mainnet.
- **No green CI.** G-1's precondition is "CI green". CI has never run (WR-O-05), and deploy.sh does not check it.
**Fix:**
```sh
if [ "$TARGET" = production ]; then
  git fetch -q origin main || die "cannot fetch origin/main"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "production deploys only the exact origin/main commit (pull or push first)"
  [ "$(gh run list --commit "$(git rev-parse HEAD)" --workflow ci --json conclusion --jq '.[0].conclusion')" = success ] \
    || die "CI is not green for $(git rev-parse --short HEAD)"
fi
```

**Outcome:** Fixed (ede0239, d756be7). For production, deploy.sh runs `git fetch origin main` and requires HEAD to be exactly `origin/main`, a clean tree, and `gh run list --commit <sha> --workflow ci.yml` returning `success`; anything else is refused. Checked in a scratch clone with a bare origin: off main, a dirty tree, main ahead of origin, and "CI is not green for <sha> (no run)" all refuse; nothing was uploaded. Rollback in section 4 is dashboard Redeploy, then a revert PR merged with CI green, then pull and deploy. It never commits on main locally.

## Warnings

### WR-O-01: `--only` skips the migration-order guard, and the runbook never runs a full production deploy

**File:** `scripts/deploy.sh:48-53`; `apps/worker/PRODUCTION.md:110,121,100,134,138,142,171`
**Issue:**
- `[ -z "$ONLY" ] || ORDER=$ONLY` replaces the computed order without a warning, even when it just found "migrations changed since $TAG" or "no $TAG tag".
- Every production deploy in the runbook uses `--only`: G-1 web; G-3, section 6 step 4, G-6, G-7, G-8 and section 10 all worker. So `deployed-production` is never created, the order logic never runs in production, and every later worker deploy reports "no tag" and goes ahead anyway.
- The worker has no schema or journal check at boot (none in `apps/worker/src`).

Failure scenario: a merged PR adds a migration. Examples are the G-6 alternative ("code PR ... then a worker deploy") or any hotfix. `--only worker` boots new worker code against the unmigrated schema. It reaches SUCCESS, then fails at query time inside fee jobs, where a sent transaction whose ledger insert fails loses its ledger row.
**Fix:**
- In deploy.sh, refuse `--only worker` when `WHY` is "migrations changed" or "no tag", unless `--force-only` is given.
- Track per-service tags (`deployed-production-web`, `deployed-production-worker`) so `--only` deploys are recorded too.
- In the runbook, make G-3 a full deploy (web then worker from the same commit), so the tag exists from G-3 on.

**Outcome:** Fixed (ede0239, d756be7, a64cff7). `--only worker` is refused when the order would be web-first, meaning migrations changed since the tag or the tag is missing. `--only web` stays allowed. G-3 is now a full deploy (`sh scripts/deploy.sh production --yes`), so `deployed-production` exists before any later `--only worker` (G-7, G-8, section 6, section 10). Per-service tags were not added: the tag still means "both services run this commit", and the refusal covers the unmigrated-schema case.

### WR-O-02: The tag records HEAD at the end, not the commit uploaded; the clean check runs before the prompt

**File:** `scripts/deploy.sh:31-32`, `scripts/deploy.sh:53`, `scripts/deploy.sh:95`
**Issue:**
- `git status` runs before the interactive prompt and before a deploy that can take up to 30 minutes. `railway up` uploads whatever is on disk when it runs, and `git tag -f "$TAG" HEAD` tags whatever HEAD is at the end.
- Section 1b has the operator `git switch phase-07-gates` straight after deploying. If that happens in another terminal mid-deploy, or a file is edited during the prompt, the upload or the tag no longer matches the checked commit. A wrong tag then breaks the next migration-order decision.
**Fix:** Record `SHA=$(git rev-parse HEAD)` at the start. After the prompt, re-check `git status --porcelain` is empty and `git rev-parse HEAD` equals `$SHA`. Before each `railway up`, check that HEAD still equals `$SHA`. Tag with `git tag -f "$TAG" "$SHA"`.

**Outcome:** Fixed (ede0239). SHA is read at the start. `unchanged` re-checks HEAD == SHA, and a clean tree when it started clean, after the prompt and before each `railway up`. The tag is `git tag -f "$TAG" "$SHA"`.

### WR-O-03: env-diff passes a production that is missing D-12 secrets, or has a wrong SOLANA_NET, SITE_URL or VANITY_LANE

**File:** `scripts/env-diff.ts:24-32`, `scripts/env-diff.ts:58`
**Issue:**
- `differ` fails only when both sides exist and are equal. A production web with no `SESSION_SECRET`, `DATABASE_URL`, `WORKER_TOKEN`, `SOLANA_NET` or `SITE_URL` still prints "all checks passed".
- `SOLANA_NET`, `SITE_URL` and `VANITY_LANE` have fixed expected values (`mainnet`, `https://trybondr.fun`, `production`) but are only checked for "differs from staging".
- Web reads `process.env.SOLANA_NET === "mainnet"` without a trim (`apps/web/components/chrome.tsx:8`, `app/coin/[mint]/page.tsx:154`, `lib/admin-data.ts:52`). The worker does trim (`env.ts:13`). So web `SOLANA_NET="mainnet "` or `Mainnet` passes env-diff and boots web on the devnet wallet profile while the worker runs mainnet.
**Fix:**
```ts
const p: Policy = { differ: [...DIFFER], absent: [], present: ["WORKER_TOKEN", "DATABASE_URL", "SOLANA_NET", "SITE_URL"], equal: {
  SOLANA_NET: sha("mainnet"), SITE_URL: sha("https://trybondr.fun") } };
if (service === "web") { p.present.push("SESSION_SECRET"); p.absent.push("MASTER_SEED", "helius_api_key"); return p; }
p.equal.VANITY_LANE = sha("production");
```
Keep `differ` for the real secrets only. Add an env-diff test case for "missing SESSION_SECRET fails".

**Outcome:** Fixed (a43cdda, 68a3bea). Production presence is required for WORKER_TOKEN, DATABASE_URL, SOLANA_NET and SITE_URL on both services, plus SESSION_SECRET on web and helius_api_key, FEE_ENGINE and ADMIN_EVACUATE on the worker. Exact values: SOLANA_NET=mainnet and SITE_URL=https://trybondr.fun; on the worker also ALLOW_MAINNET=1 and VANITY_LANE=production. Surrounding whitespace on any value fails, computed in jq as a boolean. Web must not hold MASTER_SEED or helius_api_key. `differ` now covers only the real secrets (WORKER_TOKEN, SESSION_SECRET, DATABASE_URL, pinata_jwt). env-diff accepts only `--to production`. Web `instrumentation.ts` refuses to boot when SOLANA_NET is set to anything but exactly `devnet` or `mainnet`; unset or empty is still allowed for local and CI. Tests cover a missing SESSION_SECRET, a missing DATABASE_URL, `Mainnet`, `mainnet `, a padded secret and a wrong VANITY_LANE.

### WR-O-04: The G-2 verify step is vacuous: env-diff never looks at TREASURY_PUBKEY

**File:** `apps/worker/PRODUCTION.md:117`, `scripts/env-diff.ts:34-47`
**Issue:** G-2's verification is "env-diff g1 for the worker passes", but `policyFor` has no rule for `TREASURY_PUBKEY`. The check passes the same way whether the treasury was set or not. G-7 (`ADMIN_EVACUATE=on`) depends on it being set (D-37), and G-7 is scheduled before any worker boot that would refuse without it.
**Fix:** Add a `g2` phase, or make the worker base rule `p.present.push("TREASURY_PUBKEY")` from g2 on. Give `ADMIN_WALLET` and `TREASURY_PUBKEY` a "must differ from each other" check on the `to` side. Or change the G-2 verify line to something that actually checks the value.

**Outcome:** Fixed (a43cdda, d756be7, a64cff7). New phase `g2`: from g2 on TREASURY_PUBKEY must be present, and it must not equal ADMIN_WALLET (both are public values compared in node). G-2 and 07-27 verify with `--phase g2`.

### WR-O-05: ci.yml has never run; every OPS-03 claim is unverified on GitHub

**File:** `.github/workflows/ci.yml:1-60`
**Issue:** `gh run list` shows all three runs (40331597503, 40332148354, 40335057660) refused in 2 to 4 s with "recent account payments have failed". No step has ever executed on a runner. 07-19 discloses this. Still, the workflow's role setup, its migrate step and its smoke boot are proven only by a local emulation. G-1's precondition ("CI green") cannot be met, and nothing in deploy.sh enforces it (see CR-O-05).
**Fix:** This is an owner billing step. Do not mark OPS-03 or G-1 ready until a run on the merged `main` is green. Add the CI-green check from CR-O-05 so the precondition is enforced, not just documented.

**Outcome:** Owner-blocked, no code change. CI cannot start until the owner fixes GitHub billing, which is a money step. deploy.sh now enforces the precondition (CR-O-05): production refuses any commit without a green ci.yml run, so G-1 cannot proceed until billing is fixed and a run on the merged main passes.

### WR-O-06: Owner-path e2e specs skip instead of failing when sign-in returns not_configured or not_admin

**File:** `apps/web/e2e/launch-genesis.e2e.ts:43-44`, `apps/web/e2e/golive-responsive.e2e.ts:99`, `apps/web/e2e/admin-signin.e2e.ts:33,66,104,113`
**Issue:** These skips exist for a reused dev server. But when Playwright boots the server itself, `playwright.config.ts:26` injects `ADMIN_WALLET` and `SITE_URL`. A real regression in how web reads `ADMIN_WALLET`/`SITE_URL`, or in the sign-in domain check, returns `not_configured` or `not_admin`. Then the genesis owner variant, the genesis error copy and the admin matrix all report "skipped" and the run stays green while the owner can no longer sign in.
**Fix:** Skip only when the server is known to be reused, and otherwise let `expect(res.status()).toBe(200)` fail:
```ts
const reused = !!process.env.E2E_BASE_URL || !!process.env.E2E_REUSED;
test.skip(reused && (error === "not_configured" || error === "not_admin"), `reused server: ${error}`);
```

**Outcome:** Fixed (3cbe621). The shared `skipRefused(error)` and `EXTERNAL` in `e2e/admin.ts` skip a not_configured or not_admin refusal only when E2E_BASE_URL is set. Otherwise the following `expect(res.status()).toBe(200)` fails. This is used by openConsole (every admin spec), launch-genesis, golive-responsive and admin-signin (the closed card, and the three 403 paths). A local dev server reused without ADMIN_WALLET now fails too; point E2E_BASE_URL at it to skip.

## Info

### IN-O-01: Rollback tells the operator to commit a revert directly on main

**File:** `apps/worker/PRODUCTION.md:81`
**Issue:** Running "`git revert` the bad change on main and deploy that" breaks AGENTS.md section 11 ("never commit directly to main"), and it deploys a commit that is on neither origin nor CI. CR-O-05's origin check would block it.
**Fix:** Revert on a branch, open a PR, merge with CI green, pull, then deploy. The dashboard "Redeploy" covers the interim.

**Outcome:** Fixed with CR-O-05 (d756be7): rollback goes through a revert PR.

### IN-O-02: env-diff prints unsalted SHA-256 prefixes of every secret, and gate SUMMARYs record them

**File:** `scripts/env-diff.ts:18,70`
**Issue:** 32 bits of `sha256(MASTER_SEED)` and of `sha256(DATABASE_URL)` end up in committed docs. For these high-entropy values the practical risk is low: derived pubkeys and a live connection test already confirm a guess. Still, a value fingerprint is published where nothing needs one.
**Fix:** Hash with `createHmac("sha256", randomBytes(32))`, one key per run. Comparisons inside a run still work, and printed prefixes mean nothing outside it.

**Outcome:** Fixed by removal (a43cdda). env-diff no longer hashes anything and prints no fingerprint, only set/- and same/differs per name.

### IN-O-03: PRODUCTION.md has no "no repo source" verification

**File:** `apps/worker/PRODUCTION.md:14-15`
**Issue:** The runbook says production has no GitHub source but gives no check. The 07-26 plan's verify does have one (`! ... | grep -q '"repo"'`). Recreating the environment from the runbook alone skips it.
**Fix:** Add that check to section 1b and to the G-1 Verify line.

**Outcome:** Fixed (d756be7, a64cff7). Section 1b and the G-1 Verify line have a repo-source check that prints only its result. It reads each production service's `source.repo` from `railway status --json`, which holds no variables (checked). Checked against staging: both services have no repo source. 07-26's verify uses the same check, because `railway environment config` turned out not to carry `repo` at all, so the old grep could never fail.

### IN-O-04: G-7 says "right after G-2", but the worker cannot deploy before G-3

**File:** `apps/worker/PRODUCTION.md:137-138`
**Issue:** G-7 ends in a worker deploy, but before G-3 there is no seed and the worker refuses to boot (G-1: "not deployed yet (no seed)"). The plan order (07-29 after 07-28) is right; the runbook text is not.
**Fix:** Change the text to "right after G-3".

**Outcome:** Fixed (d756be7, a64cff7). G-7 now reads "right after G-3" in PRODUCTION.md and 07-29.

### IN-O-05: The genesis rehearsal hard-codes the priority fee and stubs the once-only guards

**File:** `scripts/spike/stages/genesis.ts:35`, `scripts/spike/stages/genesis.ts:69-70`
**Issue:**
- `PRIORITY_FEE = 1000` is hard-coded, while production sets `PRIORITY_FEE_MICROLAMPORTS` explicitly at G-1.
- `consented` and `genesisLanded` always return true and false, so the "genesis only once" path is never exercised on the fork. Not a false pass of what the stage claims, but worth knowing before G-5.
**Fix:** Read the G-1 value, or add a comment saying the fee does not change the measured facts. Rely on `genesis-boot.test.ts` for the once-only guard, and name it in the stage header.

**Outcome:** Fixed as a comment (f39b780). The stage header names the stubbed once-only guard and points to `apps/worker/src/genesis.test.ts`. PRIORITY_FEE notes that the price changes only the compute-budget value, not the size, CU or accounts the stage measures.

### IN-O-06: CI tooling hygiene

**File:** `.github/workflows/ci.yml:29-31,54`; `playwright.config.ts` (`retries: process.env.CI ? 1 : 0`)
**Issue:**
- Actions are pinned to major tags, not SHAs.
- `actions/checkout` keeps the (read-only) `GITHUB_TOKEN` in `.git/config` while `pnpm install` runs dependency lifecycle scripts.
- `retries: 1` hides a flaky smoke test.
**Fix:** Pin the actions to SHAs, set `persist-credentials: false`, and consider `retries: 0` for `@smoke`.

**Outcome:** Partly fixed (41465fe): `persist-credentials: false` on checkout. Skipped SHA pinning, which needs each action's release SHA looked up and maintained; add it when CI runs at all (WR-O-05). Skipped `retries: 0` for @smoke: a policy change for every run, best judged once CI has real history.

### IN-O-07: Every production deploy in the runbook passes `--yes`

**File:** `apps/worker/PRODUCTION.md:100,110,121,171`
**Issue:** The D-27 typed confirmation never runs in practice. Consent rests entirely on the gate replies. That is acceptable, but it makes CR-O-04 and CR-O-05 the only real guards on target and content.
**Fix:** None needed beyond CR-O-04 and CR-O-05. Optionally, have deploy.sh print the project name and commit before uploading.

**Outcome:** Fixed (ede0239). The deploy plan line prints the Railway project and the commit before any upload.

---

_Reviewed: 2026-10-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard / quick (mixed per config)_
