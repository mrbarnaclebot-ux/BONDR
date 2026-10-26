---
phase: 07-go-live
plan: 09
subsystem: worker launch path, launch UI
tags: [sender, launch, tip, prepare-split, tdd]
requires: [07-05, 07-06]
provides:
  - "apps/worker/src/prepare-rules.ts: walletOf, Req, parseRequest, GuardInput, prepareGuard, signBy, sellFloor, TABLE_CAP, WALLET_TABLE_CAP (re-exported from prepare.ts)"
  - "compileLaunch(o, ixs, table, blockhash, tip = []) and buildMessage(o, table, blockhash, tip = []); tipped(msg) exported from build.ts"
  - "fee-config.ts launchTip(net): bigint (mainnet feeConfig.launchTipLamports, else 0n)"
  - "submit broadcastLaunch: Sender for tipped stored messages, one RPC resend of the same bytes on a Sender error"
  - "Status.senderTipEstimate: string | null"
affects: [07-13 ticker cooldown in prepare, 07-15 genesis prepare, 07-21/07-23/07-31 fork and mainnet Sender rows]
key-files:
  created:
    - apps/worker/src/prepare-rules.ts
    - apps/worker/src/build.test.ts
    - apps/web/e2e/launch-tip.e2e.ts
  modified:
    - apps/worker/src/prepare.ts
    - apps/worker/src/build.ts
    - apps/worker/src/fee-config.ts
    - apps/worker/src/submit.ts
    - apps/worker/src/submit.test.ts
    - apps/worker/src/status.ts
    - apps/worker/src/status.test.ts
    - packages/core/src/api.ts
    - apps/web/components/launch-receipt.tsx
    - apps/web/components/launch-buy.tsx
key-decisions:
  - "07-09: the launch tip per net is fee-config.ts launchTip(net) (0n off mainnet); prepare's balance gate, finalMessage pricing and /status senderTipEstimate all read it"
  - "07-09: the cost preview folds the tip into the fee only when the kept message is tipped (the size guard may drop it); for sell, the burn probe decides"
  - "07-09: submit resends over RPC on any urgentBroadcast result with status unknown and err starting 'sender' (HTTP error, JSON error or timeout): identical bytes, one signature"
requirements-completed: []
duration: 15min
completed: 2026-10-26
---

# Phase 7 Plan 09: Sender Launch With the Tip Inside the Dev-Signed Message Summary

**Mainnet launch messages now carry a dev-paid 0.001 SOL transfer to a Sender tip account, compiled after the lookup table keys so the tip account is always static; a tip that would push the message past 1,232 bytes is dropped with a warning, never failing the launch. Submit picks Helius Sender from the stored message alone and falls back once to RPC with the same bytes. Creators see a "Sender tip" row on mainnet, and the balance check counts it.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1a | Split prepare.ts (no behaviour change) | abbbf78 |
| 1b | Tip in compileLaunch, size guard, tipped(), cost math and balance gate | a2a028d |
| 2 | Sender at submit with the RPC fallback; senderTipEstimate in /status | 9acc311 |
| 3 | Sender tip row and balance check in the launch UI | fb1a40a |

## Evidence

- build.test.ts (new, unit): tip account static and not in the table, devnet untipped, a transfer to a non-tip account is not tipped, padded message over the limit compiles untipped with one warn, previewCosts with fee + tip. RED checked first (4 failed before the implementation).
- submit.test.ts: tipped goes to urgentBroadcast (net mainnet, identical wire, swqosOnly false) and never to broadcast on accept; a Sender error resends the identical wire once through broadcast, and broadcast's result decides failed or sent; untipped goes to broadcast only. RED checked first.
- status.test.ts: mainnet senderTipEstimate "1000000", devnet null.
- prepare.test.ts (DB) and prepare-flow.test.ts pass unchanged after the split. prepare.ts is 220 lines, prepare-rules.ts 98, build.ts 182, submit.ts 111.
- launch-tip.e2e.ts: 3 passed (row "about 0.001 SOL" and the five-row order on mainnet; hidden on devnet; a quoted balance covering dev buy, create and network fee but not the tip shows the balance error).
- `pnpm typecheck`, `pnpm lint`: clean.

## Deviations from Plan

1. **[Rule 2] buildMessage takes the tip too.** The sell path rebuilds the final message with its floor through buildMessage, so without the parameter a mainnet insta-sell launch would have gone out untipped.
2. **launchTip(net) in fee-config.ts** instead of an inline mainnet check in prepare and status: one per-net value in the per-net file (D-02).
3. **The split landed as its own refactor commit** before the tip commit, so the no-behaviour step is reviewable alone.

## Notes for later plans

- prepare.ts imports the pure rules from ./prepare-rules.ts; add new pure guards (the D-44 reserved list) there, not in prepare.ts.
- Any Status literal (web e2e stubs, tests) needs `senderTipEstimate`.
- The tip account is picked with Math.random per compile, so the probe and final messages may tip different accounts; harmless.

## Threat Flags

None. T-07-09-01..05 are mitigated as planned (tip compiled at prepare and byte-compared at submit; size guard; one RPC resend; same signature; the tip row and balance check).

## Self-Check: PASSED

- FOUND apps/worker/src/prepare-rules.ts, apps/worker/src/build.test.ts, apps/web/e2e/launch-tip.e2e.ts
- FOUND commits abbbf78, a2a028d, 9acc311, fb1a40a
