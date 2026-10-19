---
phase: 01-chain-spike
plan: 10
subsystem: spike
tags: [gate, evidence, spec-change]
requires: [01-09]
provides:
  - "pnpm spike:all (scripts/spike/all.sh): fork up, devnet then fork, page always, check, exit status line"
  - "Committed evidence: scripts/spike/results/devnet.json, fork.json, index.html"
  - ".planning/PROJECT.md updated from the spike, every change citing its row id"
affects: [02]
tech-stack:
  added: []
  patterns:
    - "The gate script never uses set -e: the page is written first, then the run and check statuses decide the exit"
key-files:
  created:
    - scripts/spike/all.sh
    - scripts/spike/results/index.html
  modified:
    - package.json
    - .gitignore
    - scripts/spike/README.md
    - scripts/spike/results/devnet.json
    - scripts/spike/results/fork.json
    - .planning/PROJECT.md
decisions:
  - "Phase 5 forced-bond default is the full-budget buy_exact_quote_in_v3 with the simulated burn: it spends and burns the whole budget and leaves nothing in W"
  - "The per-coin launch lookup table stays mandatory: insta sell with a shared table only is 1,191 bytes, plus 99 for a migrated-BONDR create is about 1,290"
  - "Launch table rent is about 0.007-0.008 SOL at mainnet rent (0.0052-0.0060 SOL measured on devnet), not 0.003"
  - "W's finalize float is 0.018 SOL (8,017,920 lamports of rent plus a 0.01 SOL buffer), not 0.006"
metrics:
  duration: "about 20 min"
  completed: 2026-10-19
  tasks: "2 of 3 (Task 3 is the owner checkpoint)"
  files: 8
---

# Phase 1 Plan 10: Phase gate, evidence page and PROJECT.md from the spike Summary

`pnpm spike:all` now runs the whole spike in one command. From a stopped fork it ran in about 46 s and printed `spike:all run=0 check=0`. The page shows PASS 67, FAIL 0, EXPECTED FAIL 5, NOT RUN 0, and the check shows 74 passed, 0 failed. The devnet launch and multihop rows were refreshed against the current code. PROJECT.md now carries 24 cited evidence references and 7 decisions marked Validated (Phase 1). **Owner sign-off (Task 3) is pending.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | spike:all, devnet refresh, committed evidence page | fb990d6 |
| 2 | Fold the spike evidence into PROJECT.md | 92f1f6e |
| 3 | Owner reviews the page and the PROJECT.md changes | checkpoint, awaiting owner |

## spike:all

- all.sh runs `fork.sh up`, then `SPIKE_NET=all pnpm spike`, then `pnpm spike:page` (always), then `SPIKE_NET=all pnpm spike:check`. It prints `spike:all run=<n> check=<n>` and exits 1 if either status is non-zero.
- Negative test: with `SPIKE_FORK_URL` pointed at a dead port, the run recorded `fork.error` and the page still wrote (FAIL 1, NOT RUN 41). The script printed `spike:all run=1 check=1` and exited 1. The real results were then restored, byte-identical.
- index.html is no longer gitignored. It has no `<script`, it contains "Devnet" and "Surfpool mainnet fork", and the Helius key scan over results/ finds nothing.

## Devnet refresh (row aux.devnet.refresh)

- Ops held 2.978331927 SOL, so the refresh ran (the threshold is 0.25 SOL). It ran `SPIKE_FRESH=1 SPIKE_ONLY=create`, then launch, then multihop, all on devnet.
- Old Q 5xUbg681... (complete and migrated in 01-05), new Q 4Jw2pr67... (a fresh stand-in on its curve).
- The sharing rows and the 6107 rows ran against the old Q (plus old C0 and Q2). The row's notes say so, and so does the page.
- Refreshed rows: standin.create arR7G22o..., child.create 1UsFdo1h..., child.create150.refused 4UQzPgfb... (6077), launch.burn 2cYEyQd2... (780 bytes, 313,495 CU), launch.sell 43Bndc1G... (881 bytes, 431,536 CU), multihop.buy kb1irdzo... (1,110 bytes, venues curve,curve), multihop.sell 2Rgsjcb8... (1,100 bytes).
- **Devnet ops balance: 2.917428942 SOL remaining** (0.061 SOL spent).

## ROADMAP Phase 1 success criteria to evidence (final spike:all run)

| # | Criterion | Rows (signature prefix) |
|---|-----------|-------------------------|
| 1 | create_v2, creator = W, stand-in quote, 150 bps on the fork | standin.create 4E54kNtLNXGF, child.create 2zuzPpaE3dYb (creatorFeeBps 150, creator = W, quoteMint = Q, depth 1) |
| 2 | One-tx create + dev buy + insta sell, and + insta burn, sized | fork launch.burn 26yTv3fhzvVK (780 / 1232 bytes, 316,738 / 600,000 CU), launch.sell 3hDFdqnpYFFa (881 bytes, 448,775 CU); devnet launch.burn 2cYEyQd2JaHC, launch.sell 43Bndc1Gm33f |
| 3 | Forced bond + burn in one tx; post-migration PumpSwap buy + burn | bond.forced 5UViydNBmxfn (926 bytes), bond.exact fRHu22JuNXhL, bond.migrate eo7WYexRGo9A, bond.pool.burn 7KEMqi7LyJzK |
| 4 | Sharing config + one 80/20 update, second rejected, distribution pays both | fork finalize.config 3DVDWjsWZ9PM, finalize.update 2KkrWvPQgVpg, finalize.distribute 2HdGVu6C8URi, finalize.update2.rejected UXHk3rRffw6s (6009); devnet sharing.update 67XyaXMAK8xV, sharing.update2.rejected 3yp5BinX23o4 (6009) |
| 5 | Page lists every step incl. multi_hop_swap SOL to stand-in to coin | scripts/spike/results/index.html; devnet multihop.buy kb1irdzojFZW, multihop.sell 2Rgsjcb8B4Er; fork migrated.multihop.buy WuMb7dXBMotD, migrated.multihop.sell 5UWk3nh1nEQF. No failed rows, so no forced PROJECT.md change; deviations are folded in below |

## PROJECT.md edits (each cites its row)

1. Fee Mechanic header: proven by the Phase 1 spike, with a pointer to results/index.html.
2. Item 1: child create on BONDR's curve is 1,064 bytes, and 1,163 bytes on a migrated BONDR (migrated.child.create, fork; aux.child.create.migratedQ, devnet).
3. Item 2, dev buy: the exact-out buy always leaves the dev a BONDR remainder, 140,041 and 277,783 BONDR on 0.25 SOL, and the dev holds 0 child tokens (launch.burn, launch.sell, fork, devQLeft, devChildAfter).
4. Item 2, table: it is created in 2 txs of 1,072 bytes. Rent is 0.0052-0.0060 SOL on devnet, about 0.007-0.008 SOL at mainnet rent, replacing "about 0.003" (launch.table.burn, launch.table.sell, devnet).
5. Item 2, sizes: 780 bytes / 316,738 CU (burn) and 881 / 448,775 (sell), replacing "742-745 bytes, 347k-382k CU". With no table they are 1,552 and 1,808 bytes. With a shared table only (sharedOnlyBytes) they are 1,059 and 1,191 bytes. The per-coin table is mandatory once BONDR migrates (launch.burn, launch.sell, migrated.child.create).
6. Item 3: no config drift. The creator fee measured exactly 150.00 bps. Devnet refuses 150 bps with 6077 (config, prebond.collect, fork; child.create150.refused, devnet).
7. Item 4: the collect needs no W signature, and the 10% is sized from the collect tx delta. The split is exact (prebond.collect, prebond.split).
8. Item 5: the simulated burn path. The burn can exceed the curve's remaining supply (804.8M vs 793.1M). The exact variant leaves 7.37M BONDR in W. The Phase 5 default is the full-budget variant. The burn is atomic with completion, and the keeper migrates about 10 slots later (bond.forced, bond.exact, fork; aux.child.create.migratedQ, devnet).
9. Item 6: the pool buy + burn is exact. PumpSwap SDK quirk: the buyback recipient is random and its quote ATA is not created, so the buy pins the recipient and ops creates the ATA (bond.pool.burn).
10. Item 8: the bonded finalize is 2 txs (1,351 bytes as one). The second update is rejected with 6009 on both nets. Distribution is exactly 80:20 and needs no W signature (finalize.config, finalize.update, finalize.distribute, finalize.update2.rejected, sharing.update2.rejected).
11. Item 9: measured W floats. The finalize needs 0.018 SOL against the 0.006 estimate; the forced bond 0.0069, the fallback burn 0.0039 and the split 0.0009 (finalize.config, bond.forced, bond.pool.burn, prebond.split).
12. Key Decisions marked Validated (Phase 1): the 150 bps BONDR quote, creator = W, the 90/10 and 80/20 splits, buy and burn in one tx, the dev exit in the launch tx (the co-sign check ships in Phase 2), ops pays the fees, and devnet plus the fork. The rolling sweep, the stack, the keys and the UI decisions stay Pending.
13. Default 5 and the 6107 risk row: 6107 is confirmed on both nets, and the pause lasts seconds (child.create.6107; keeper timing from aux.child.create.migratedQ).
14. Phase 7 risk row: softened. The stall lasts seconds, and SOL routes through BONDR's pool after migration (migrated.multihop.buy). The child raise at BONDR about 90% complete is 122.8M against the 115M estimate (bond.create).
15. Footer: "Last updated: 2026-10-19 after Phase 1 chain spike".

Not changed: item 7 (the rolling sweep was not exercised in the spike), Defaults 1-4, 6 and 7, Out of Scope, and the Build Steps.

## Verification

- `pnpm spike:fork-down; pnpm spike:all`: exit 0, `spike:all run=0 check=0`, devnet 22 ok, fork 50 ok (all six devnet stages skipped after the refresh).
- The plan's page check (every row id on the page, FAIL shown for any not-ok row) exits 0. `git check-ignore` on index.html exits 1.
- `pnpm vitest run` (25 tests), `pnpm lint` and `pnpm typecheck` pass after each commit.
- PROJECT.md: `grep -c "Phase 1 spike, row"` is 24, `grep -c "Validated (Phase 1)"` is 7, and the emoji scan finds nothing.
- No transient Surfpool fetch failure this time. The fork was stopped with `pnpm spike:fork-down`.

## Deviations from Plan

1. **[Rule 2] Lookup table rent corrected.** Item 2 claimed about 0.003 SOL. The devnet tables hold 5,161,280 and 5,974,080 lamports (888 and 1,048 bytes). That was read from chain for launch.table.burn and launch.table.sell, and PROJECT.md cites those rows.
2. **The keeper-timing claim cites aux.child.create.migratedQ.** That row's notes carry the slot numbers (MigrateV2 10 slots after completion). The plan's row list did not name it.
3. **Negative test of spike:all.** I ran it once against a dead fork URL to prove the always-write behavior, then restored the real results byte-identically. No devnet SOL was spent.

## Known Stubs

None.

## Awaiting

Task 3: the owner opens scripts/spike/results/index.html, reads `git diff planning/v1-spec -- .planning/PROJECT.md`, and replies "approved" or lists the edits to revise. In particular, they decide on the forced-bond default, the W float and the per-coin table. Phase 2 does not start before that.

## Self-Check: PASSED

- scripts/spike/all.sh and scripts/spike/results/index.html are present.
- Commits fb990d6 and 92f1f6e are on phase-01-chain-spike.
