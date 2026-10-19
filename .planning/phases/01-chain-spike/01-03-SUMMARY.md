---
phase: 01-chain-spike
plan: 03
subsystem: core
tags: [solana, pump, devnet, lookup-table, launch]
requires: [01-01, 01-02]
provides:
  - "packages/core/src/send.ts: sendTx (allowlist, paced, polling confirm), checkMessage, budget, wireSize, messageSize, confirm"
  - "packages/core/src/alt.ts: tableKeys, sharedKeys, memoryTable, createTable (chunked extend + warm-up wait)"
  - "packages/core/src/math.ts: applyBps"
  - "packages/core/src/launch.ts: buildCreate, buildLaunch (exit burn | sell | sellq)"
  - "scripts/spike/fund.ts: fundSol, prefundMint, paceMs"
  - "scripts/spike/stages/create.ts and launch.ts on devnet; state keys Q, C0, C.burn, C.sell"
affects: [01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10]
tech-stack:
  added: []
  patterns:
    - "Confirm by polling getSignatureStatuses, never confirmTransaction (its websocket keeps Node alive)"
    - "Expected failures are sent with skipPreflight so they land with a signature and meta.err"
    - "Error rows carry the Anchor error name from logs plus the custom code"
    - "Per-exit skip on devnet: a launch row that passed is not paid for again"
key-files:
  created:
    - packages/core/src/send.ts
    - packages/core/src/send.test.ts
    - packages/core/src/math.ts
    - packages/core/src/math.test.ts
    - packages/core/src/alt.ts
    - packages/core/src/alt.test.ts
    - packages/core/src/launch.ts
    - packages/core/src/README.md
    - scripts/spike/fund.ts
    - scripts/spike/stages/create.ts
    - scripts/spike/stages/launch.ts
  modified:
    - packages/core/src/pump.ts
    - scripts/spike/nets/devnet.ts
    - scripts/spike/results/devnet.json
decisions:
  - "sendTx confirms by polling signature status instead of confirmTransaction, because the websocket subscription kept the spike process alive after the run"
  - "wireSize always counts the v0 wire format (probe/measure.cjs method) instead of try-serialize, so one code path covers oversized messages; a unit test pins it to the real serialized length"
  - "createTable extends in chunks of 25 keys; the sell launch needs 31 keys, which does not fit in one create + extend tx"
  - "buildLaunch takes the coin name, symbol and uri (Coin) like buildCreate; the planned interface had no metadata fields"
metrics:
  duration: "about 18 min"
  completed: 2026-10-19
  tasks: 3
  files: 14
---

# Phase 1 Plan 03: Devnet create and one-tx launches Summary

Devnet now proves both parts of the plan with real signatures. The first part is SPIKE-01: a stand-in Q, a child create_v2 with creator = W and quote = Q, and the program refusing creator_fee_bps 150 with 6077. The second part is SPIKE-02: create, exact-out dev buy and insta burn, and separately insta sell back to SOL, each landed as one v0 transaction with a per-coin lookup table. Both fit well under 1232 bytes and 600k CU. After each launch the dev holds 0 child tokens.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Owner funds the devnet payer | resolved before execution: `solana balance` read 5 SOL (no commit) |
| 2 | Send path, funding helpers, devnet create stage | 4834a9e |
| 3 | One-tx launches (burn and sell) with per-coin lookup table | a36dd60 |

## Devnet evidence (results/devnet.json)

| Row | Signature | Bytes | CU |
|-----|-----------|-------|----|
| standin.create (Q 5xUbg6818zFdHMWBjoxhz1VVUs9hT8zv3kd61hgxBTb6, creator = treasury) | 4odjtHPP...tQ5u1xG | 928 | 105,129 |
| child.create (C0 HGC7QFRX..., creator = W, quote = Q, depth 1) | 5fqdXEmv...qyhTa | 1,064 | 139,971 |
| child.create150.refused (landed failure, `CreatorFeeNotConfigurable`, code 6077) | 4NGjAsYG...N6FWd | 1,064 | 114,382 |
| launch.table.burn (26 keys, 2 txs) | cZJfKqGe...AjBZ46 | 1,072 max | 29,712 |
| launch.burn | dRakxMEr...Zp5GU | 780 | 304,419 / 600,000 |
| launch.table.sell (31 keys, 2 txs) | 5WJbkQ5J...i68ZLM7 | 1,072 max | 31,155 |
| launch.sell (multi_hop child to Q to SOL) | 2wZoyaYg...WYSQPK | 881 | 420,959 / 600,000 |

### Launch sizes (the PROJECT.md Fee Mechanic item 2 evidence)

| Exit | No table | Shared-only table | Full per-coin table (landed) | CU |
|------|----------|-------------------|------------------------------|----|
| burn | 1,552 (too large) | 1,059 | 780 | 304,419 |
| sell to SOL (multi_hop) | 1,808 (too large) | 1,191 | 881 | 420,959 |

The shared-only sell is 1,191 bytes. That fits devnet, but leaves only 41 bytes of headroom, and RESEARCH measured 1,215 to 1,242 bytes with longer metadata. The per-coin table leaves 351 bytes free on the sell. Phase 2 makes the table choice using these numbers (Open Question 1).

### Launch facts

- solIn 2,500,000 lamports (devnet `initialVirtualSolReserves / 120`, noted "devnet scaled; curves are 100x cheaper").
- Burn: amount 31,310,301,754,067. The supply went from 1,000,000,000,000,000 to 968,689,698,245,933, so it dropped by exactly the amount. devChildAfter "0". The dev kept 240,997,308,542 Q (BONDR dust, not launch supply).
- Sell: amount 31,128,589,351,080, devChildAfter "0", and the supply is unchanged (the coins went back to the curve). The dev kept 478,061,084,830 Q.
- The aux.launch.sellq fallback did not run, because the multi_hop sell to SOL landed. Risk 1 (the sell does not fit) is not triggered on devnet.
- W for child.create was independently re-derived with `derive(master, "w", "devnet", mint)`, and it matches the on-chain curve creator F9eEXsaZ...ucKd.

## Devnet SOL

- Before this plan: 5 SOL on ops (5d9ABC...), 0 on sim dev.
- After this plan: ops 4.89934476 SOL and sim dev 0.05006225 SOL, so 4.949 SOL is still held.
- Spent by this plan: about 0.0506 SOL (rent for 4 creates, 2 tables and ATAs, 2 x 0.0025 SOL through Q, fees).
- 2 SOL stays in reserve for 01-05 and 01-10 with plenty of margin.

## pump-public-docs

Re-cloned to `.cache/pump-public-docs`. HEAD is 639b87f, the same commit the research used, with 0 new commits.

## Verification

- `pnpm vitest run`: 15 tests pass (send 4, math 4, alt 2, plus 5 from earlier).
- `SPIKE_NET=devnet pnpm spike:check`: 10 passed, 0 failed.
- `pnpm spike:page`: "PASS 8, FAIL 0, EXPECTED FAIL 1, NOT RUN 0". The page shows "780 / 1232", "881 / 1232", "304419 / 600000" and "420959 / 600000".
- `pnpm lint` and `pnpm typecheck` exit 0.
- The rent grep (`6960|890880|2039280`) finds nothing, and `api-key` appears 0 times in devnet.json.
- All files are under 300 lines. The largest are send.ts at 191 and launch.ts at 183.

## Deviations from Plan

1. **[Rule 1 - Bug] The spike process never exited after a send.** `confirmTransaction` opens a websocket signature subscription, and that kept Node alive after the run finished. Every row had already been saved. Fix: `confirm()` in send.ts polls `getSignatureStatuses` and gives up past `lastValidBlockHeight`. fund.ts uses it for fork airdrops too. Verified: the launch stage run exited in 27 s. Commit 4834a9e.
2. **[Rule 3 - Blocking] Chunked table extension.** The sell launch has 31 table keys, but one create + extend tx holds about 29. `createTable` now extends in chunks of 25. The row reports the first signature, the largest tx size, the summed CU and `txs`. Commit a36dd60.
3. **[Rule 2] The 150 bps refusal rule checks the code.** The plan only required `ok` and `expectFail`. The rule now also requires code 6077 (or the SDK error name), so an unrelated failure cannot pass as the refusal. `createV2Instruction` holds no Global, so the refusal came from the program itself, not the client-side SDK path. Commit 4834a9e.
4. **[Rule 2] Per-exit skip on devnet.** A launch row that already passed is not rerun when the other exit is retried. This saves devnet SOL (Pitfall 9). The fork always runs fresh. Commit a36dd60.
5. **Interface additions.** `buildLaunch` takes `name/symbol/uri`. The exit type adds `"sellq"` for the planned fallback row. alt.ts exports `memoryTable`, the in-memory table used for the shared-only measurement. send.ts exports `messageSize`, `confirm` and `PACKET_LIMIT`. `createTable` returns `table` as optional (it is absent on failure) plus `txs`. The tests for `tableKeys` and `sharedKeys` live in a new `alt.test.ts`, not in math.test.ts.
6. **sendTx refuses to sign a message over 1232 bytes** and returns the counted size as the error, instead of letting the RPC reject it.

## TDD Gate Compliance

As in 01-01: RED was observed for each task (a missing import failed send.test.ts, and the modules did not exist before they were written). No separate `test(...)` commit was made, because AGENTS.md forbids red commits. Each task landed as one green commit.

## Known Stubs

None. The multi_hop sell uses `minAmountOut` 1 on purpose. A `ponytail:` comment in launch.ts explains why: the child does not exist before the tx, so it cannot be simulated. Phase 2 sets a real floor.

## Notes for later plans

- 01-04 (fork): the create and launch stages are net-aware. The fork uses creator_fee_bps 150, solIn 0.25 SOL, prefundMint and airdrop funding, and always runs launches fresh. `nets/fork.ts` only needs `[configStage, createStage, launchStage]`.
- The lookup tables are never deactivated or closed. Each one holds about 0.008 SOL of devnet rent. Reclaim it later if devnet SOL gets tight.
- Q has taken 0.005 SOL of buys plus the sell-back. The devnet Q curve is still far from its about 0.85 SOL completion (Pitfall 1).

## Self-Check: PASSED

- All 11 created files and the 3 modified files are present.
- Commits 4834a9e and a36dd60 are on phase-01-chain-spike.
