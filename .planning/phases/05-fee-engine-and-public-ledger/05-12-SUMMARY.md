---
phase: 05-fee-engine-and-public-ledger
plan: 12
subsystem: e2e
tags: [e2e, devnet, responsive, axe, sign-off-local]
requires:
  - 05-09 POST /fee/batch, buyback burn, reconciliation
  - 05-11 responsive-fee.e2e.ts home part, PHASE5_SHOTS, gate
provides:
  - apps/web/e2e/fee-devnet.e2e.ts (real devnet engine e2e, E2E_DEVNET=1)
  - apps/web/e2e/responsive-fee.e2e.ts token page half (six states x three widths)
  - apps/worker/README.md fee engine runbook
  - phantom.ts seedAccount (any seed-derived address, no Solana import)
affects: [05-13]
tech-stack:
  added: []
  patterns:
    - the devnet e2e reads chain state over the public devnet RPC by fetch (no Helius key in the runner)
    - seed-derived addresses in e2e via HMAC + Ed25519 (seedAccount), never the worker's Keypair
key-files:
  created:
    - apps/web/e2e/fee-devnet.e2e.ts
    - .planning/phases/05-fee-engine-and-public-ledger/screenshots/coin-*-{390,768,1440}.png (18)
  modified:
    - apps/web/e2e/responsive-fee.e2e.ts
    - apps/web/e2e/phantom.ts
    - apps/worker/README.md
decisions:
  - "The devnet e2e picks the derived-W curve coin whose window closes soonest but at least 4 minutes out, so both trades are indexed before the window fires"
  - "The sweep pair is checked against sweepSplit(W's BONDR before + collects - splits before the sweep), which holds whether one or two windows collected"
  - "The batch check also asserts no new platform (mint null) reconcile_diff, since the buyback must reconcile to 0 right after its burn"
  - "Staging gates one coin-curve state from /api/coins?sort=top and seeds nothing; the other five states are seeded-only"
metrics:
  duration: 31 min
  completed: 2026-10-25
  tasks: 3
  files: 21
---

# Phase 5 Plan 12: Devnet engine e2e, token page UI gate and runbook Summary

On real devnet the fee engine collected, split 90/10 and swept 90/10 at a coin's window end with no manual help. A bearer batch then burned the buyback's BONDR: supply dropped by exactly the burned amount and reconcile found 0 diffs. The run's net spend was 0.006348 SOL. The six token page states pass axe with 0 violations and no horizontal scroll at 390, 768 and 1440, and the screenshots are ready for the Designer.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Token page states in the responsive and axe matrix | 10ed0cd | responsive-fee.e2e.ts, 18 coin-*.png |
| 2 | Real devnet engine e2e with the spend cap | 4ad54be | fee-devnet.e2e.ts, phantom.ts |
| 3 | Fee engine runbook in the worker README | 028442b | apps/worker/README.md |

Task 3 was committed before Task 2, because it was written while the 6-minute devnet run was going.

## Devnet run (Task 2)

**Setup**
- Worker: `FEE_ENGINE=on FEE_WINDOW_MS=600000 VANITY_THREADS=0 node --env-file=.env apps/worker/src/main.ts`, started by hand. It logged `fee engine on: 6 coins armed`.
- Web: dev server started by Playwright with `FEE_WINDOW_MS=600000`.
- Command: `E2E_DEVNET=1 FEE_WINDOW_MS=600000 pnpm exec playwright test apps/web/e2e/fee-devnet.e2e.ts`.
- Result: 2 passed in 5.7 min.

**Coin:** BSELL `APrDvPFcz7qBssiG1Mdv6e9LSJz8KUCpy4TayCG2bndr`. Its W derives from the seed.

**Trades** (devnet-trades, `--expect-indexed 30`, 22 s for both)
- buy 0.01 SOL: `daFS6xLSA5Q4EEcHZfkRmqtEvPMCSMa2Ngom9hgzJAKCufR1QVwe8pVSXukdvo5FBEdJUAamJtzgKUBGnJN3WzG`
- sell: `3i9HDEufN5VAZ8TFfebwwnRmUKG4aLnp8M6eJFu4ToiFGXVAUoYxtFWbsATAzvXQgnKZAewaKuickgbnbyq68eeH`

**Window 566** ended at 2026-10-25T08:17:26Z. The worker logged `landed, landed, landed`. All three rows were on the token page with Solscan links 64 s after the window end.

| Kind | Amount (BONDR base units) | Signature |
|------|---------------------------|-----------|
| collect | 227,614,984,572 | `3CF4BWF87Jq13gMuWqoBD7V7Pg73cmVN2KGg3NtWvGNmKweaNYs1XEQvjVesd9SEHJaZ6WJMbkTTjRgREtxAxsAk` |
| split_treasury | 22,761,498,457 (= floor(collect / 10)) | `4HHsXcQ8hvgiWPbLuumWPCAoqdMNXa8pY7Gs84GwY65AVbZd9DagcewMSEFQTv51tr96DxoZpEpxJRatVEKz5h4E` |
| sweep_buyback | 184,368,137,504 | `5154v32w228gNzsS7vBruqYSHw2764hRxCp3G5tbAeSv5LduwQtnFW75o4sP3KwaBk9yUyDZzuvNQ4acFR2njVvF` |
| sweep_treasury | 20,485,348,611 | same tx as sweep_buyback |

The sweep pair equals sweepSplit(204,853,486,115), which is the collect minus the split (W held 0 BONDR before).

**Batch** (bearer POST /fee/batch)
- Response: `{"opsLow":false,"burn":"landed","distribute":0,"finalize":0,"accounts":2,"diffs":0}`.
- buyback_burn of 184,368,137,504: `4WwZ1Th2SGVnFWR5TikBQSfbLWqjm2devu2D498LYGSE9NEyMbinRtsBFkrQFpzvPyBFAEguFdXnDYknN5kzDX9x`.
- BONDR supply dropped by exactly that amount, and the buyback was left at 0.
- No new reconcile_diff row for the coin or for the platform.

**Spend** (ops pays every engine fee)

| Wallet | Before | After |
|--------|--------|-------|
| ops | 2.750788 SOL | 2.744696 SOL |
| sim | 0.087033 SOL | 0.086777 SOL |

- Run net spend: 0.006348 SOL, against the run cap of 0.05 SOL.
- Phase 5 devnet total so far: 0.006348 SOL. Plans 05-01 to 05-11 each recorded 0 SOL (units, dry run and fork only). That is under the 0.1 SOL phase cap.
- Real money: none. Every send was on devnet.

**Worker stopped** after the run (`kill`, port 8080 down, confirmed at 08:19 UTC), so no local engine keeps driving the shared devnet ops wallet (Pitfall 11). The Playwright-started web server exited with the run.

## Verification

- `pnpm exec playwright test apps/web/e2e/responsive-fee.e2e.ts --workers=3`: 24 passed, 6 skipped (the staging-only tests).
  - 18 coin-*.png shots: curve-nofees, curve-budget, forced, traders, held and ledger-more, each at 390, 768 and 1440.
  - The 6 home shots are also there.
  - The 05-11 home shots were regenerated by the run and then restored, not committed.
- `E2E_DEVNET=1 FEE_WINDOW_MS=600000 pnpm exec playwright test apps/web/e2e/fee-devnet.e2e.ts`: 2 passed. Without E2E_DEVNET both tests skip.
- `rg FEE_ENGINE`, `/fee/release` and `/fee/batch` in apps/worker/README.md: all match. No token or URL value appears in the README.
- `pnpm test`: 58 files, 417 passed, 2 skipped, with no Neon timeouts.
- `pnpm typecheck` and `pnpm lint`: exit 0.
- File sizes: responsive-fee.e2e.ts 182 lines, fee-devnet.e2e.ts 201 lines. Both are under 300, so the planned split into responsive-coin-fee.e2e.ts was not needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The e2e needed seed-derived addresses and two more env names**
- **Found during:** Task 2
- **Issue:** rootEnv returned neither BONDR_QUOTE_MINT nor VANITY_LANE, and phantom.ts could derive only the sim key.
- **Fix:** rootEnv now also returns those two non-secret names. `seedAccount(id)` generalizes `simDevAccount`, which now calls it. The ops, sim, buyback and W addresses come from it, with no Solana import.
- **Files modified:** apps/web/e2e/phantom.ts
- **Commit:** 4ad54be

**2. [Rule 2 - Missing] README route table lacked POST /fee/batch**
- **Found during:** Task 3
- **Fix:** Added the route row and its contract paragraph (summary fields, 409 `paused`). The Env line already had the three names from 05-05.
- **Commit:** 028442b

## Known Stubs

None.

## Threat surface

Nothing new. The e2e reads WORKER_TOKEN and the seed file in process and never prints them (T-05-12-02). The run's spend is asserted (T-05-12-01). The worker was stopped after the run (T-05-12-03). env.ts still refuses mainnet (T-05-12-04).

## Self-Check: PASSED

- FOUND: apps/web/e2e/fee-devnet.e2e.ts, apps/web/e2e/responsive-fee.e2e.ts, apps/worker/README.md, 18 coin-*.png
- FOUND: commits 10ed0cd, 028442b, 4ad54be
