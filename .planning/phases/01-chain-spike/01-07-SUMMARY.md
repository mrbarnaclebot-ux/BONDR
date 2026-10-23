---
phase: 01-chain-spike
plan: 07
subsystem: core
tags: [fork, forced-bond, migrate, pumpswap, burn]
requires: [01-06]
provides:
  - "packages/core/src/bond.ts: forcedBondIxs (simulate, then BurnChecked(simOut)), exactBondIxs, migrateIxs, poolBuyBurnIxs, poolBaseOut"
  - "packages/core/src/events.ts: innerEvents, completeEvents (emit_cpi inner instructions, pump event authority checked)"
  - "packages/core/src/math.ts: trigger105"
  - "scripts/spike/stages/bond.ts and pool.ts on the fork; state keys C2, C2b, bond.forced.sig"
  - "packages/core/src/fixtures/forced-bond.json: the fork forced-bond tx (raw RPC JSON)"
affects: [01-08, 01-09, 01-10]
tech-stack:
  added: []
  patterns:
    - "The forced-bond burn amount is W's child ATA balance after the whole tx, from simulateTransaction with the accounts option"
    - "The PumpSwap buyback recipient is pinned to the first listed wallet, and ops creates its quote ATA, because the SDK picks one at random"
    - "innerEvents reads raw RPC JSON and web3.js VersionedTransactionResponse alike"
key-files:
  created:
    - packages/core/src/bond.ts
    - packages/core/src/events.ts
    - packages/core/src/events.test.ts
    - packages/core/src/fixtures/launch-20261008.json
    - packages/core/src/fixtures/forced-bond.json
    - scripts/spike/stages/bond.ts
    - scripts/spike/stages/pool.ts
  modified:
    - packages/core/src/math.ts
    - packages/core/src/math.test.ts
    - packages/core/src/pump.ts
    - packages/core/src/launch.ts
    - packages/core/src/README.md
    - scripts/spike/stages/README.md
    - scripts/spike/nets/fork.ts
    - scripts/spike/results/fork.json
decisions:
  - "The forced-bond burn is in the same tx as the completing buy, so W never holds a bought token and pump's keeper cannot migrate in between"
  - "simulateTransaction with the accounts option works on Surfpool 1.6.1 (A7 holds); the dry-run fallback was not needed"
  - "A buy_exact_quote_in_v3 budget above the completion cost also buys from the pool-to-be (PostCompleteBuyEvent), so the forced bond burns more than the curve's remaining supply"
  - "The buy_v3 exact variant leaves the unspent 6% markup in W as Q; the forced variant spends the whole budget. Phase 5 picks one"
metrics:
  duration: "about 10 min"
  completed: 2026-10-19
  tasks: 3
  files: 15
---

# Phase 1 Plan 07: Fork forced bond, migrate_v2 and pool buy + burn Summary

On the mainnet fork W2 used buy_exact_quote_in_v3 to spend its whole 130.18M Q budget, which completed child C2. In the same transaction it burned exactly the 804,811,320,754,713 tokens the simulation said it would get. Afterwards W2 held 0 child tokens and 0 Q, the supply fell by exactly the burn, and one CompleteEvent was decoded from the emit_cpi inner instruction. The buy_v3 exact variant completed C2b and burned exactly 793,100,000,000,000. migrate_v2, which the spike called itself, moved C2 to its PumpSwap pool. A PumpSwap buy_v2 + BurnChecked in one tx then cut supply by exactly baseOut.

**The burn is atomic with completion.** In 01-05, pump's devnet keeper migrated a completed curve about 10 slots after completion, and mainnet should be treated the same way. Nothing can run between the completing buy and the burn, because they are the same transaction. The fork runs no keeper, so migrate_v2 is our own call here. On mainnet the keeper does that step, at a time we do not control (D-03). That is fine, because the burn has already landed.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Core bond builders, event decoding and trigger105 | 8b95bd5 |
| 2 | Fork bond stage: whale to 90%, forced bond, exact variant | 2103e45 |
| 3 | Fork pool stage: migrate_v2, PumpSwap buy + burn, forced-bond fixture | d930b28 |

## Fork evidence (results/fork.json, final run)

| Row | Signature | Bytes | CU / limit | Facts |
|-----|-----------|-------|------------|-------|
| bond.whale | 4J9LsvpYteW1... | 787 | 66,463 / 600,000 | Q cost to complete 83.80 SOL, whale spent 90% (75.42 SOL), Q complete false, whale holds 696,983,748,936,112 Q |
| bond.create (C2 3BoxFpTp...) | 2ayDoc3f3SCG... | 1,064 | 138,493 | creator W2 2QvUUQcF..., 150 bps, **child raise 122,808,523,808,861 Q** |
| bond.topup (TOP-UP) | 59SC2GaeZoJ2... | 439 | 20,046 | cost2 122,808,523,808,861; budget 130,177,035,237,392 (106%); trigger105 true |
| **bond.forced** | 475eAShUDY3h... | **926** | **109,506 / 600,000** | simPath "accounts"; simOut = burnAmount = landedOut 804,811,320,754,713; supply 1,000,000,000,000,000 to 195,188,679,245,287; complete true; wChildAfter 0; wQAfter 0; completeEvents 1; wFloatLamports 6,883,440 |
| bond.exact.create (C2b DeC7gfH5...) | 3m7hyzE6taoa... | 1,064 | 148,993 | child raise 122,808,523,808,861 Q |
| bond.exact.topup (TOP-UP) | 4Jjc5UAu16Tp... | 439 | 21,546 | maxQuote 130,177,035,237,392 |
| **bond.exact** | 4fGvhDqFdBos... | **926** | **107,770 / 600,000** | amount = realTokenReserves 793,100,000,000,000; supply fell by exactly that; complete true; wChildAfter 0; wQAfter 7,368,511,428,531 (the unspent markup); completeEvents 1 |
| bond.migrate | 2x22EpdLHSUN... | 1,060 | 342,461 | pool 98DU2pkN..., poolExists true |
| bond.pool.topup (TOP-UP) | 497bMGDX6yYx... | 439 | 7,302 | 4,366,296,784,613 Q (1% of the whale's Q) |
| **bond.pool.burn** | opBjPRyAioir... | 915 | 70,891 | baseOut 6,067,640,892,546 = supply drop; maxQuoteIn 4,366,296,784,613; wChildAfter 0; wQAfter 218,314,839,232 (the 5% margin); wFloatLamports 3,918,480 |

Notes on the evidence:
- **Child raise in Q (A3).** With Q about 90% complete, a child needs 122.8M Q to complete. The hand estimate was about 115M.
- **simOut vs landed.** The simulation predicted 804,811,320,754,713 tokens and the buy landed exactly that. W2's balance after the burn is 0, so landed = burn + 0. That is 11.71M more than the curve's 793.1M remaining supply. The 6% over cost bought from the pool-to-be, and the tx's events are TradeEvent (793.1M tokens for 119.87M Q), then CompleteEvent, then PostCompleteBuyEvent.
- **Simulation path.** `simulateTransaction` with `accounts: [W child ATA]` returned the post-tx account on Surfpool, so A7 holds and the dry-run fallback never ran.
- **TOP-UP labels.** All three top-ups carry `topUp: true` and the D-11 note, and the page shows each one as "TOP-UP:".
- **W float.** ops sends W the rent for 0, 170, 170 and 137 bytes, less W's balance, at the fork's rent rate. W's rent-paying instructions passed with that float.

## Verification

- `SPIKE_NET=fork pnpm spike` gave "fork: 30 ok, 0 failed".
- `SPIKE_NET=fork pnpm spike:check` gave 31 passed, 0 failed, including the secret scan.
- `pnpm spike:page` gave PASS 48, FAIL 0, EXPECTED FAIL 3, NOT RUN 0.
- `pnpm vitest run` passed 25 tests, including trigger105, the agencybook launch fixture (CreateEvent and TradeEvent), the spoofed event authority case, and the forced-bond completeEvents case. `pnpm lint` and `pnpm typecheck` exit 0.
- `rg "Program data:" packages/core/src/events.ts` finds nothing. `rg pump-swap-sdk packages/core/src --glob '!pump.ts'` finds nothing.
- `pnpm biome lint` passes on stages/bond.ts and stages/pool.ts. File sizes: core bond.ts 169 lines, stage bond.ts 260, pool.ts 75, events.ts 74. prebond.ts is unchanged at 298.
- `api-key` appears 0 times in fork.json. The fork was stopped with `pnpm spike:fork-down`. No devnet sends were made.

## Deviations from Plan

1. **[Rule 1 - Bug] The 106% markups do not use applyBps.** `applyBps(cost, 10600)` throws, because applyBps rejects bps above 10000 on purpose (01-05). The stage uses `markup106` (`x * 106 / 100`, BN) instead. Commit 2103e45.
2. **[Rule 3] Small exports.**
   - pump.ts exports `pumpIdl` (the SDK's runtime name), `PUMP_EVENT_AUTHORITY_PDA` and the AMM's `buyQuoteInput`.
   - launch.ts exports `COIN_DECIMALS`.
   - Core bond.ts adds `poolBaseOut`, which sizes the pool burn from the pool quote.
   - Commit 8b95bd5.
3. **[Rule 2] Pinned PumpSwap buyback recipient.** buy_v2 checks that the buyback recipient's quote ATA exists, and the SDK picks the recipient at random. poolBuyBurnIxs pins the first listed wallet and has ops create its Q ATA idempotently. Commit 8b95bd5.
4. **Event scope.**
   - innerEvents reads pump-program events only, with typed decoders for CreateEvent, TradeEvent and CompleteEvent through the SDK's IDL coder. Other pump events keep their name and have empty data. The fees and AMM events wait for Phases 3 and 5.
   - innerEvents takes both raw RPC JSON and web3.js responses.
   - The agencybook fixture decoded under the 4.1.0 IDL, so no replacement was needed.
   - Commit 8b95bd5.
5. **Stage structure.** `createChild` builds both C2 and C2b, `forcedPath` and `exactPath` group their rows, and run() calls whale, forcedPath, exactPath. Each function is under 40 lines, and biome passes. bond.ts exports `land`, `topUp`, `wFloat`, `newRun` and the shared rules for pool.ts. Commit 2103e45.
6. **The fork ran once in Task 2** as a smoke test before that commit, so no unrun stage was committed. The final run in Task 3 rebuilt everything from a fresh results file.
7. **Fixture format.** forced-bond.json is the raw JSON-RPC `getTransaction` result (json encoding, v0), wrapped like the agencybook fixture with source, net, mint, slot and capturedAt. The test checks the CompleteEvent mint against the fixture's `mint`, which was the run's state "C2" at capture. Commit d930b28.

## Known Stubs

None.

## Requirements

SPIKE-03 is complete. Each of these has a signature on the fork: the forced-bond buy + burn that completes a curve in one tx, the exact-amount variant, migrate_v2, and the post-migration PumpSwap buy + burn.

## Notes for later plans

- **Phase 5.** Both forced-bond variants fit in 926 bytes with no lookup table, at about 110k CU. The forced variant spends the whole budget and burns everything bought, including the post-completion leg. The exact variant burns exactly the curve's remaining supply and leaves the unspent markup in W as Q.
- **01-08.** C2 is migrated (pool 98DU2pkN... on that run), and W2's child ATA exists with balance 0. Fee sharing after bond builds on C2.
- **01-09.** Q is about 90% complete after the whale buy and has not completed. The complete stage can finish it.

## Self-Check: PASSED

- All 7 created files are present.
- Commits 8b95bd5, 2103e45 and d930b28 are on phase-01-chain-spike.
