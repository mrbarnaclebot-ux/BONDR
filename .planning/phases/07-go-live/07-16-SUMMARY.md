---
phase: 07-go-live
plan: 16
subsystem: worker prepare and submit, launch fault copy
tags: [genesis, prepare, submit, worker, tdd]
requires: [07-15]
provides:
  - "apps/worker/src/genesis.ts genesisOne(ctx: GenesisCtx, body, deps = live), genesisQuote(ctx, body), types GenesisCtx and GenesisDeps"
  - "prepare<C = PrepareCtx>(ctx, body, one = prepareOne): the single-flight queue takes a builder"
  - "prepare.ts exports reserveMint, finish, rowOf, recordPaid and type Sized (Chain ctx: conn, env, priorityFee)"
  - "core genesisAmount(online, solIn) -> { g, amount }, used by buildGenesis and genesisQuote"
  - "LaunchErrorCode not_ready (503) and genesis_landed (409); launch-faults GENESIS_FAULTS; Fault.link"
  - "submit.ts SubmitCtx = StatusCtx & { env }: the genesis row passes the genesis pause"
affects: [07-17 genesis boot (routes prepare(gctx, body, genesisOne), quote to genesisQuote, submit with the Q-null ctx), 07-18 owner variant (GENESIS_FAULTS, Fault.link)]
key-files:
  created:
    - apps/worker/src/genesis.ts
    - apps/worker/src/genesis.test.ts
  modified:
    - apps/worker/src/prepare.ts
    - apps/worker/src/build.ts
    - apps/worker/src/status.ts
    - apps/worker/src/submit.ts
    - apps/worker/src/submit.test.ts
    - apps/worker/src/http.ts
    - packages/core/src/launch.ts
    - packages/core/src/api.ts
    - apps/web/lib/launch-faults.ts
    - apps/web/lib/worker.test.ts
key-decisions:
  - "07-16: genesis_landed counts an in-flight genesis row (signed, sent, unknown) as well as a landed one, so a second genesis cannot be signed while the first settles"
  - "07-16: submit's genesis allowance also requires row.w = env.treasury, not only paused genesis, so no other prepared row can ride it"
  - "07-16: genesis prepare refuses paused contract_check before reserving a mint, so ops pays no table rent for a launch submit would refuse (D-20)"
requirements-completed: []
duration: 12min
completed: 2026-10-26
---

# Phase 7 Plan 16: Genesis Prepare and Submit Summary

**The worker can now build BONDR's own launch through the same pipeline as a child launch, for the owner only, once, and burn only. `genesisOne` checks, in order: an actor is present (else `not_ready`), the actor and the wallet both equal ADMIN_WALLET (else `forbidden`), the wallet has consented, the exit is burn, no genesis row is landed or in flight, and the contract check has not failed. Then it reserves a `bndr` mint, builds with `buildGenesis` (the treasury is the creator), and pays the ops table. It stores the row through the shared `finish` (Sender tip, simulation, stored message) with `w` set to the treasury. Submit lets that row through the `genesis` pause unless the contract check failed.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 RED | Failing genesis prepare and quote tests | 16791aa |
| 1 GREEN | genesisOne, genesisQuote and the prepare builder hook (plus the codes and copy) | 1b5bd37 |
| 2 | Submit genesis allowance, forwarder pass-through tests | 3818477 |
| docs | Worker and core README entries | ecbdedd |

## Evidence

- genesis.test.ts: 7 passed. RED came first (the module did not exist). The cases:
  - No actor answers not_ready before any read.
  - forbidden for three cases: another actor, the admin actor with another wallet, and a worker without ADMIN_WALLET.
  - consent_required with no mint reserved.
  - A sell exit answers invalid_input.
  - genesis_landed with no mint reserved.
  - Happy path: the build gets treasury, dev and mint, and `rowOf` over what finish received gives `w` = the treasury, exit burn, wallet = admin and symbol BONDR.
  - The quote gives tokens > 0 and solBackEstimate "0" from a stubbed Global.
- prepare-flow.test.ts: unchanged and green (4).
- submit.test.ts: 9 passed. New cases:
  - The genesis row is co-signed and sent under paused genesis.
  - A failed contract check refuses it with paused, and nothing is broadcast.
  - kill_switch, or a genesis pause on a row that is not the treasury's, still refuses.
  - Mutation check: with the allowance removed, the first new case fails.
- worker.test.ts: 503 not_ready and 409 genesis_landed pass through as themselves. launch-genesis.test.ts still passes after the `genesisAmount` extraction.
- `pnpm typecheck` and `pnpm lint` are clean. Line counts: prepare.ts 234, genesis.ts 108, submit.ts 118, launch.ts 283. `rg -c admin_session packages/core/src/api.ts` gives 0.

## Deviations from Plan

1. **[Rule 2] The genesis prepare also refuses a failed contract check.** It answers paused contract_check before any mint or table, so ops spends nothing on a launch that submit would refuse. The submit check stays as the plan describes.
2. **[Rule 2] Submit's allowance also needs `row.w === env.treasury`.** The plan's condition was paused genesis and no contract failure. A stale child row from before genesis mode could otherwise pass.
3. **[Rule 2] genesis_landed also counts in-flight rows** (signed, sent, unknown). A double submit could otherwise land two BONDR coins. The copy still says "already landed", which fits a launch that is settling.
4. **[Rule 2] A balance check runs before the reservation,** the same as prepareOne (WR-01). A table that ops paid for is recorded on failure through the exported `recordPaid` (WR-02). The table reuses a held mint's table through `tableFor`.
5. **Small refactors not in the plan, so finish works without a Q:**
   - core `genesisAmount` is shared, so the quote and the tx agree.
   - status.ts `parseQuote` is exported.
   - build.ts `Builds` is narrowed to `{ ixs, amount }` per exit.
   - prepare.ts has a `Chain` ctx type for reserveMint, finalMessage and finish.
   - The genesis `LaunchOpts` sets `Q: NATIVE_MINT` and `W: treasury`. The burn path never reads Q, and W becomes the row's w.
6. The api.ts codes and the launch-faults entries went into the Task 1 commit instead of Task 2. The FAULTS record is total, so web typecheck needs them in the same commit.
7. `Fault.link` (optional, "/admin") marks the link inside the session-ended text. 07-18 renders it.

## Notes for later plans

- 07-17: `"POST /prepare": (b) => prepare(gctx, b, genesisOne)` with `gctx: GenesisCtx = { ...ctx, Q: null, treasury: env.treasury, env }`, `"POST /quote": (b) => genesisQuote(gctx, b)`, `"POST /submit": (b) => submit(gctx, b)`. `prepare(gctx, body)` without the third argument would type-check but run prepareOne, so always pass genesisOne.
- 07-18: GENESIS_FAULTS holds forbidden, not_ready (with `link: "/admin"`) and genesis_landed. In FAULTS, not_ready falls back to BUILD_FAILED.

## Threat Flags

None new. T-07-16-01: actor and wallet are both checked against ADMIN_WALLET (tested). T-07-16-02: genesisLanded is read before building (tested). T-07-16-03: burn only (tested). T-07-16-04: contractFailed is checked in submit and prepare (tested in submit). T-07-16-05: consent is checked before any build (tested).

## Self-Check: PASSED

- FOUND apps/worker/src/genesis.ts, apps/worker/src/genesis.test.ts
- FOUND commits 16791aa, 1b5bd37, 3818477, ecbdedd
