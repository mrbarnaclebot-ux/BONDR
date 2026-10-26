---
phase: 07-go-live
plan: 15
subsystem: core launch builder, worker status, launch banner
tags: [genesis, launch-builder, status, sol-pair, tdd]
requires: [07-14]
provides:
  - "@bondr/core/launch buildGenesis(o: GenesisOpts) -> { ixs, amount } and type GenesisOpts"
  - "status.ts StatusCtx = Omit<Ctx,'Q'> & ({ Q: PublicKey; treasury?: PublicKey } | { Q: null; treasury: PublicKey }); liveStatus takes it"
  - "PauseReason 'genesis' (checked first); Status.quoteMint: string | null; Status.genesisTreasury?: string"
  - "Launch page and home banners for genesis mode"
affects: [07-16 genesis prepare, 07-17 genesis boot (builds the Q-null status ctx with the treasury), 07-18 owner genesis variant, 07-21 fork rehearsal]
key-files:
  created:
    - packages/core/src/launch-genesis.test.ts
  modified:
    - packages/core/src/launch.ts
    - packages/core/src/api.ts
    - apps/worker/src/status.ts
    - apps/worker/src/status.test.ts
    - apps/web/components/launch-flow.tsx
    - apps/web/app/page.tsx
    - apps/web/e2e/launch-paused.e2e.ts
    - packages/core/src/README.md
    - apps/worker/src/README.md
key-decisions:
  - "07-15: StatusCtx is a union: a Q-null ctx must carry the treasury, a quoted ctx need not, so every existing Ctx (prepare, submit, quote) still fits liveStatus and main.ts needed no change"
  - "07-15: pause order after genesis stays the 07-10 one (contract_check, kill_switch, awaiting_migration); the plan's must_have line naming awaiting before kill_switch conflicts with its own behavior line and was not applied"
  - "07-15: the genesis buy amount is 98% of what solIn buys on newBondingCurve(g), and the burn takes exactly that amount"
requirements-completed: []
duration: 15min
completed: 2026-10-26
---

# Phase 7 Plan 15: Genesis Builder and Genesis Status Summary

**Core can now build BONDR's own launch with `buildGenesis`. It is a SOL-pair create_v2 with no quote and no creator_fee_bps, with the treasury as creator and the dev as user. The same transaction holds an exact-out SOL buy and a Token-2022 burn of exactly the bought amount, so `exitPresent` holds unchanged. `/status` has a genesis branch, used when there is no BONDR quote mint. It reports paused "genesis", quoteMint null, SOL-curve fees and the minimum from the live Global, no insta-sell legs, and the treasury for the review row. It never calls fetchPumpQuote. The public launch page shows "Launches are not open yet." with Launch disabled.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | buildGenesis, the SOL-pair create, buy and burn | 09fc47e |
| 2 | Genesis in /status, the pause priority and the public banner | b1dc853 |
| docs | Core and worker README entries | bc13d15 |

## Evidence

- launch-genesis.test.ts: 4 passed. RED came first (buildGenesis was not a function).
  - The create has fewer accounts than a quoted `buildCreate`, its data holds the treasury key, and the dev signs.
  - Buy data: amount at offset 8 equals 98% of `getBuyV3TokenAmountFromQuoteAmount` over `newBondingCurve(g)`, and max quote at offset 16 equals solIn.
  - The last instruction is a Token-2022 BurnChecked (tag 15) of that amount over [dev ATA, mint, dev], signed by the dev.
  - `exitPresent` on a compiled v0 message is true for the dev and false for another key.
- Acceptance grep: inside buildGenesis, the only `quoteMint:` is the buy's NATIVE_MINT, and there is no creatorFeeBps. launch.ts is 277 lines. The burn instruction is now one `burnIx` that `exitIxs` shares.
- status.test.ts: 9 passed. RED came first. The new cases:
  - pauseReason with genesis true wins over contract, disabled, awaiting and null.
  - liveStatus on a Q-null StatusCtx: paused genesis, quoteMint null, genesisTreasury equal to the treasury base58, fees `{93, 30}` from the stubbed SOL tier, minimum and create cost non-null, and the fetchPumpQuote spy never called.
  The existing 07-10 table passes unchanged except for the added `genesis: false`.
- launch-paused.e2e.ts: 3 passed. In the genesis case the status stub has quoteMint null. It shows the exact UI-SPEC title and body, does not show the "Launches are paused." banner, and keeps Launch disabled at step 3. Gate shots launch-genesis-banner at 390, 768 and 1440.
- Full `pnpm test` (end of the 07-13..07-15 batch): 103 files, 798 passed, 2 skipped, exit 0. `pnpm typecheck` and `pnpm lint` are clean. status.ts is 283 lines.

## Deviations from Plan

1. **The pause priority is not fully the must_haves order.** The truth line says genesis, contract_check, awaiting_migration, kill_switch. That matches UI-SPEC surface 1, but the plan's behavior says "with genesis false the 07-10 table is unchanged". The 07-10 table ranks kill_switch over awaiting_migration, and status.test.ts asserts that. I kept the tested 07-10 order and only added genesis first. **The orchestrator or owner should decide** whether awaiting_migration should outrank kill_switch. The change is one line in `pauseReason` plus one test row.
2. **main.ts was not changed.** Because StatusCtx is a union, today's quoted Ctx already fits. The Q-null ctx with `treasury` gets built where genesis mode boots (07-17), and the type forces the treasury there.
3. **[Rule 2] app/page.tsx gained a genesis entry.** Its `Record<PauseReason, string>` would not typecheck otherwise (carry note from 07-10). The home banner title reads "Launches are not open yet." for genesis. Its body is "Launches open after the BONDR token is live. Browsing is unaffected." That body is not in the UI-SPEC: it follows the kill switch line's pattern. No e2e covers it, because home.e2e.ts uses the real worker status.
4. The acceptance grep for `"genesis"` matches api.ts and status.ts. In launch-flow.tsx the entry is a bare object key, `genesis:`, because Biome removes the quotes.
5. No web reader of `status.quoteMint` existed, so making it nullable needed no web code change.

## Notes for later plans

- 07-17: build the status ctx as `{ ...ctx, Q: null, treasury: env.treasury }` in genesis mode. `readGenesis` returns `venue: null` (Where null), so pauseReason only reports genesis.
- buildGenesis takes `GenesisOpts` (Coin, online, mint, dev, treasury, solIn, cuLimit, priorityFee?). It does not call the reserved-ticker guard. The combined tx is unproven on chain until the 07-21 fork row.

## Threat Flags

None. T-07-15-01: the burn amount equals the buy amount, and the test asserts it. T-07-15-02: the creator is the treasury argument, and the test asserts it. T-07-15-03 is accepted (a public key). T-07-15-04: the Q-null branch never calls fetchPumpQuote, and the test asserts it.

## Self-Check: PASSED

- FOUND packages/core/src/launch-genesis.test.ts, 3 launch-genesis-banner screenshots
- FOUND commits 09fc47e, b1dc853, bc13d15
