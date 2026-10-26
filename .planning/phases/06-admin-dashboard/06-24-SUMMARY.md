---
phase: 06-admin-dashboard
plan: 24
subsystem: e2e
tags: [devnet, e2e, evacuate, neon, spend]
requires:
  - 06-15 fork admin stage (post-bond actions)
  - 06-18 simulation dialog, 06-22 EVACUATE worker, 06-23 EVACUATE section
provides:
  - apps/web/e2e/admin-devnet.e2e.ts (E2E_DEVNET=1 console money path and EVACUATE on devnet)
  - apps/web/e2e/admin-neon.e2e.ts (E2E_NEON=1 console-open Neon suspend check)
  - apps/web/e2e/devnet.ts (shared devnet RPC, balance and trade helpers)
  - apps/worker/README.md local admin devnet run recipe
affects: [06-25, 06-26]
tech-stack:
  added: []
  patterns:
    - devnet specs share e2e/devnet.ts (public RPC with 429 retry, tokens(owner, mint), supply(mint), trade())
    - a spec that pauses shared switches restores them through the console route, then the DB as backstop, in afterAll
key-files:
  created:
    - apps/web/e2e/admin-devnet.e2e.ts
    - apps/web/e2e/admin-neon.e2e.ts
    - apps/web/e2e/devnet.ts
  modified:
    - apps/web/e2e/fee-devnet.e2e.ts
    - apps/web/e2e/README.md
    - apps/worker/README.md
decisions:
  - "EVACUATE on devnet needs a W that holds something: every dev W was empty, so the spec has the sim dev curve-buy the coin and send its W 1 BONDR and the child tokens first, which also proves the leftover_burn path"
  - "The dev and staging overlap check reads every page of staging /api/coins; hidden staging coins are not listed (acceptable: each lane launches its own mints, so an overlap is not expected)"
  - "afterAll restores switches through POST /api/admin/switch (worker memory too), then writes the settings row directly as a backstop and asserts it"
  - "neonctl 8.10.3 has no `endpoints list`; the Neon check reads /projects/{id}/branches and /endpoints through `neonctl api`"
metrics:
  duration: 23 min
  completed: 2026-10-25
  tasks: 2
  files: 6
---

# Phase 6 Plan 24: Devnet console money path, EVACUATE and the Neon check Summary

On real devnet the console ran Sweep now, Burn buyback now, a negative Re-check launch and EVACUATE. Each money action used a real simulation, a fresh signature from the test admin key in the fake Phantom, and a landed execute. EVACUATE ran only after the spec proved no dev coin is a staging coin. It emptied the seeded W to the treasury and burn and paused every switch. The spec then restored every switch and cleared `evacuated_at`. The run's net spend was 0.004855 SOL. With the console open and visible for 8 minutes, the dev Neon compute went idle while health answered 49 times.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Devnet console money actions and EVACUATE | 221c110 | admin-devnet.e2e.ts, devnet.ts, fee-devnet.e2e.ts, e2e/README.md, worker/README.md |
| 2 | Console-open Neon check and phase spend record | f045489 | admin-neon.e2e.ts, e2e/README.md |

## Devnet run (Task 1)

**Setup**
- Worker started by hand with the README command: `ADMIN_WALLET=<derived test admin> ADMIN_EVACUATE=on FEE_ENGINE=off VANITY_THREADS=0 WORKER_PORT=8080`.
- The boot log showed `worker listening on devnet`, `switches: launches=on forcedBond=on sweeps=on finalize=on buybackBurn=on` and `fee engine off`. `/healthz` answered `{"ok":true}`.
- Playwright started the web dev server with the same ADMIN_WALLET.
- Command: `E2E_DEVNET=1 pnpm exec playwright test apps/web/e2e/admin-devnet.e2e.ts --project=chromium --reporter=line`.
- Result: **4 passed (3.5m)**, first run, no skips.
- Worker stopped right after (`pkill`, port 8080 down). The web server exited with the run.

**Coin:** ESQ6KT `GybxLBA6ondpQxCzr2XdWB75gxfEPgaRYnntLxcqbndr`. It is a curve coin, its W derives from the seed, and its symbol is unique in the dev DB.

**1. Sweep now** (passed)
- Trades (devnet-trades, indexed within 30 s):
  - buy 0.01 SOL: `AwxHPrZKwZfXWbpqGkeKygoXQM2Lc7tLEt2LYjsMpjtmaViDK16NHL32dr5CsJsWDkns1xeBdmtX4VcNuQV1wye`
  - sell: `5i9zPS7Frv8cMU2dhwbgcgDFENBRQMLFWQZBx6po2em6zTXnGWE64Kaspyy6JgYLb6EG43XxefRYHJeqoMXyBkKK`
- The dialog showed "Destinations check passed:". The test clicked Connect Phantom, then signed and sent. The dialog read "Sent. 3 of 3 transactions landed." with 3 TxLinks.
- The token page showed Collect, Split 90/10 and Sweep, each with a Solscan link.
- The top audit row read "Sweep now: ESQ6KT", Result "Landed".

| Kind | Amount (BONDR base units) | Signature |
|------|---------------------------|-----------|
| collect | 202,733,365,826 | `5CmuxkHTCAc6njyF4wN8ogBrspeNhUYakA5gAefRvBNkv9AcXmiBDu95MMbebcMjLXJjqoZnAtzC3piBELJvhRYm` |
| split_treasury | 20,273,336,582 | `6MAqa8rSJaYahmvyoSTGzx25GZdkSTW2g2WAqQtHbA2jqdzKUvAeW6c6Mu86t6mDJGvo6AK77KSuJyiji6jedFC` |
| sweep_buyback | 164,214,026,320 | `4eecMtidmMgD6PKGZk4m74Vqg4UUW2NtPauKb1vEc9Vb2dP4xdEMCWhw7NuVy6Q7X44mKMqpyqUJnB4UaKmEDjTJ` |
| sweep_treasury | 18,246,002,924 | same tx as sweep_buyback |

**2. Burn buyback now** (passed, not skipped)
- The buyback held 164,214,026,320 base units, which is the sweep above.
- The burn signature is `3MfNmfaqQivYTVDuCK92CNSzr96ygwkGruYad3BhCDQKV4iwq6GWmbLvfdgvLM9GfXiB9cjdCVyExsmkeuSGostk`.
- BONDR supply dropped by exactly that amount, and the buyback was left at 0.
- The top audit row read "Burn buyback now", Result "Landed".

**3. Re-check launch, negative** (passed)
- The spec inserted a crafted `unknown` launch: symbol RCHK, a fresh 32-byte mint and a random 64-byte signature. Its W table row read "Launch unconfirmed".
- Re-check launch answered "The launch is not on chain yet. Nothing changed.", and the row stayed `unknown`.
- afterAll deleted the launch row and its vanity_mints row. 0 RCHK rows remain.
- The landed path is still covered by unit tests only (OQ4).

**4. EVACUATE** (passed)
- Overlap check: 6 dev coins, 2 staging coins, 0 shared.
- Seed (deviation 1): every dev W was empty, so the sim dev first gave one W something to move.
  - Curve buy of 1 BONDR: `2yPNoGvsF17S5qx7x3LJJn99pYwfpdtR6gZwF2PvNNjS8Azw6BYFPQpYQtPxEQUgMzJXnmPbSDRTp2Vi4TMgsVZR`
  - Transfer of 1,000,000 BONDR base units and 3,687,150 ESQ6KT base units to ESQ6KT's W: `2UEE4VdAp4y1wt9jH6tq43hFhfw43J6K2WKJFEzbupBAq5sfDc1KEwGrQJx581g4hMfKBMS9uCY9jJNBh899oCzV`
- The test typed the phrase. The real simulation then showed "Simulated now: 1 W balances, ...". The test clicked Connect Phantom, then "Sign and evacuate 1 wallets".
- The section read "Evacuated. 1 of 1 wallets moved to the treasury, 0 failed. Every job is paused."
- Evacuate tx: `2B5iMp3vraAEmwJdHwFVx5k7tzwhNjr9LeJ373X559YDXLmkdENMrANv8gLbDkdp4kdE1NMGaY53rhWHcCM3UP4n`
  - `evacuate` row, landed: amount 1,000,000.
  - `leftover_burn` row, landed: burned 3,687,150.
- All five switches read paused (aria-checked false), and `settings.evacuated_at` was set.
- Every derived dev W held 0 BONDR and 0 child tokens afterwards.

**Restore** (afterAll, and checked again by hand after the run)
- The settings row reads `launches_enabled, forced_bond_enabled, sweeps_enabled, finalize_enabled, buyback_burn_enabled` all true and `evacuated_at` null.
- The worker's memory still held evacuatedAt until it was stopped. The fresh worker for Task 2 booted with every switch on and evacuatedAt null.

**Spend** (ops pays engine and admin fees, sim pays trades and the seed)

| Wallet | Before | After |
|--------|--------|-------|
| ops | 2.744696 SOL | 2.741621 SOL |
| sim | 0.086777 SOL | 0.084996 SOL |

- Run net spend: **0.004855 SOL**, against the run cap of 0.05 SOL.
- That includes the rent for ESQ6KT's W child token account, which stays locked in that account.
- Real money: none. Every send was on devnet, and the worker booted with `listening on devnet`.

## Neon check (Task 2)

- Setup: a plain worker (the same command without ADMIN_EVACUATE=on) and the Playwright web server. Nothing else was running against the dev DB.
- Command: `E2E_NEON=1 pnpm exec playwright test apps/web/e2e/admin-neon.e2e.ts --project=chromium --reporter=line`.
- Result: **1 passed (8.3m)**.
- Health answered 49 times, all 49 with 200. The overview was called 0 times in the 8 minutes.
- Dev branch compute: `idle`, last active 2026-10-25T20:01:28Z, checked at 20:09:38Z.
- The worker was stopped afterwards.

## Phase 6 devnet spend

- 06-01 to 06-23 each spent 0 SOL: units, the fork (06-15 is surfpool only) and stubbed e2e.
- 06-24 spent 0.004855 SOL.
- **Phase total: 0.004855 SOL**, under the 0.1 SOL phase cap.

## Verification

- `pnpm lint`: exit 0 (426 files).
- `pnpm typecheck`: exit 0.
- Devnet run: 4 passed. Neon run: 1 passed.
- `pnpm test`: **92 files, 690 passed, 2 skipped**.
- `rg -n "ADMIN_EVACUATE=on" apps/worker/README.md`: matches the recipe. The README lists env names only.
- File sizes: admin-devnet.e2e.ts 297 lines, admin-neon.e2e.ts 46, devnet.ts 57.

## Requirements

ADMIN-01, ADMIN-04 and ADMIN-11 are now ticked: a fresh signature on every money action, and simulate-first with the destination check, both proven on devnet, plus EVACUATE end to end. ADMIN-03, ADMIN-06 and ADMIN-10 were already ticked. The EVACUATE screenshots and axe check are still owed to 06-25.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Every dev W was empty, so EVACUATE had nothing to move**
- **Found during:** Task 1 (a balance read before writing the spec)
- **Issue:** All 6 dev W held 0 SOL, 0 BONDR and 0 child tokens. A sweep also leaves W at 0, so EVACUATE would only have shown "Every W is empty. Nothing to evacuate.", with no intent to sign.
- **Fix:** Before EVACUATE, `seedW` has the sim dev curve-buy 1 BONDR of the coin. It then sends the coin's W 1 BONDR and all of those child tokens in one tx: idempotent ATA creates, then TransferChecked, signed in Node. This also proves the `leftover_burn` path the must-have names.
- **Files modified:** apps/web/e2e/admin-devnet.e2e.ts
- **Commit:** 221c110

**2. [Rule 3 - Blocking] neonctl 8.10.3 has no `endpoints list`**
- **Found during:** Task 2
- **Fix:** The spec reads `/projects/royal-waterfall-05278863/branches` and `/endpoints` through `neonctl api`, picks the branch named `dev` and prints only its state and timestamps.
- **Files modified:** apps/web/e2e/admin-neon.e2e.ts
- **Commit:** f045489

**3. [Rule 2 - Reuse] Shared devnet helpers**
- **Issue:** The new spec needed the same RPC, balance and trade helpers that fee-devnet.e2e.ts defined inline.
- **Fix:** Moved them to `e2e/devnet.ts`. fee-devnet now imports them, with no behaviour change; typecheck and lint cover it. fee-devnet was not re-run on devnet.
- **Commit:** 221c110

**4. Restore backstop**
- afterAll POSTs every switch on and then also writes the settings row directly. The switches are therefore back on even when the web sign-in fails.

## Known Stubs

None.

## Threat Flags

None. The spec prints SOL amounts, signatures, states and timestamps only (T-06-24-04). The sim key goes from its KeyObject to a web3.js Keypair in Node and never reaches the page.

## Self-Check: PASSED

- FOUND: apps/web/e2e/admin-devnet.e2e.ts, apps/web/e2e/admin-neon.e2e.ts, apps/web/e2e/devnet.ts
- FOUND: commits 221c110, f045489
