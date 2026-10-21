---
phase: 02-launch-flow
plan: 12
subsystem: worker
tags: [cosign, sign-order-a, settle, state-machine, devnet]
requires:
  - phase: 02-11
    provides: prepare, getLaunch, advance, mintKeyFor, compileLaunch, fundSimDev, RUN_BUDGET_SOL
provides:
  - "packages/core/src/cosign.ts: sameMessage, slot, signatureOk (node:crypto Ed25519), exitPresent, cosign, signatureOf"
  - "packages/core/src/send.ts: broadcast (pace and send only) and sendRaw (broadcast then settle); sendTx now calls sendRaw"
  - "apps/worker/src/submit.ts: submit (POST /submit)"
  - "apps/worker/src/settle.ts: nextState, resumeAction, launchFacts, settleLaunch, settleInBackground, releaseMint, resumeLaunches"
  - "vanity.ts canRelease and vanityRow; launches.ts unsettled"
  - "http.ts status map: not_found 404, expired 410, cosign_refused 422"
  - "scripts/devnet-launch.ts default mode (burn and sell through submit) and --tamper; scripts/devnet-checks.ts assertLanded"
affects: [02-13, 02-14, 02-17, 02-18]
tech-stack:
  added: []
  patterns:
    - "Submit order: parse, row, idempotent return unless prepared, pause, expiry, cosign from stored row, then prepared -> signed with the co-signed wire, then broadcast"
    - "signed always holds a fully signed, sendable wire, so a restart can resend it while the blockhash is valid"
    - "Landed is written at confirmation; facts follow from the fetched tx"
key-decisions:
  - "Cosign runs before the prepared -> signed transition (the plan had the transition first). signed then always holds the co-signed wire that resume can resend, and a garbage slot 0 never reaches the unique signature column. A double submit still loses at the guarded transition"
  - "The sell exit check matches the pump AMM program's multi_hop_swap (discriminator sha256('global:multi_hop_swap')[0..8] = 2b644913e9f66f94). pumpIdl has no multi_hop_swap; the SDK builds the sell through the AMM program on both venues"
  - "Submit uses broadcast (send only) and settles in the background, so it returns right after the RPC accepts the tx. A send that throws without preflight logs is treated as sent and settled by status, never resent"
  - "solBack fact = dev lamport delta + solIn + fee + rent of the accounts the tx created. It matched the prepare preview to the lamport on devnet"
requirements-completed: [LAUNCH-04]
duration: ~25 min
completed: 2026-10-21
---

# Phase 2 Plan 12: Co-sign, submit and settle Summary

**The worker now adds the mint signature only to the exact message it stored, signed by the dev, with the stored exit inside. It sends the tx and settles it through a guarded state machine that records landed at confirmation and never resends an unseen launch. Two real devnet launches went through submit, one per exit, and a tampered wire was refused with nothing sent.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-21
- **Tasks:** 3
- **Files:** 16 (6 created, 10 modified)

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Core cosign checks and sendRaw extraction | d177bd7 |
| 2 | Worker submit, settle state machine, resume on boot | 5aa94b3 |
| 3 | Devnet proof: both exits through the worker, tamper refused | 353c2a4 |

## Devnet evidence (2026-10-21)

**Default run** (sim dev `9Hm1YEfX...TjwQM6` signs slot 0 in Phantom's place, minimum dev buy 2,500,000 lamports, exit code 0):

| Exit | Signature | Mint | Bytes | CU | State | Facts |
|------|-----------|------|-------|----|-------|-------|
| burn | [uZnRgWJa...EbdRo](https://solscan.io/tx/uZnRgWJabZxcei8rFmc2BefsPRg9kXANk7uDdJJ9ZYs1fS5JaHxPyk98GSF27KTqsuDKAYHu3UHQnryFJ1EbdRo?cluster=devnet) | `4xEfLsmWx8o89XA9iWtf2T5KESn3hLjT4sLK7kBJbndr` | 768 | 301,463 | landed | tokens 31,120,363,129,478; devChildAfter 0 |
| sell | [3Utqqf4i...yBzXvB](https://solscan.io/tx/3Utqqf4ikwNg4kL6ELekJJuzKGMdowgL2wLYAAcbVttpM7KUyLEnZ4DHnMdei4gREv3Pgx55R5SiM4zLsnyBzXvB?cluster=devnet) | `APrDvPFcz7qBssiG1Mdv6e9LSJz8KUCpy4TayCG2bndr` | 869 | 453,544 | landed | tokens 30,941,666,409,995; solBack 2,342,792; devChildAfter 0 |

Every assertion passed on both launches:
- **Mints:** both end in `bndr`.
- **Creator:** each curve's creator is its coin's W. That is `6Vf6pcQQ...re2Ew` for burn and `BUPNscrW...o98Ws` for sell.
- **Dev balance:** the dev's child token balance is 0 after both.
- **Burn supply:** supply dropped by exactly the bought amount, 31,120,363,129,478.
- **Sell facts:** solBack (2,342,792) equals the prepare preview's solBack to the lamport.
- **Prepare previews:** createCost 8,829,040 and networkFee 10,600 on both.

Burn reused 02-11's mint and table (`6NTJ...BHTmi`). Sell got a new mint, so ops paid for one new table.

**--tamper** (exit code 0): prepare `2fcb423c8062735ae4f90e647ed41172`, dev signs, one byte flipped near the end of the message section.
- Worker log: `refused: message_mismatch`.
- Submit threw 422 `cosign_refused`, and the row is `failed` / `cosign_refused`.
- The would-be signature `5RzshJhb...3MQNc` had no status with history after 5 s, so nothing was sent.

**No-spend checks:**
- A second submit of the landed burn returns `{ state: "landed", signature }`.
- A second submit of the refused launch returns `{ state: "failed" }`.
- An unknown id returns 404 `not_found`.
- `resumeLaunches` with no unsettled rows returns cleanly.
- `--size-only` still gives 789 and 890 bytes, now with the exit check inside compileLaunch.

**Ops balance (floor 2.40 SOL):**

| Run | Ops before | Ops after | Funded | Run spend | Budget |
|-----|-----------|-----------|--------|-----------|--------|
| --size-only | 2.911282 | 2.911282 | 0 | 0 | 0 |
| default (burn + sell) | 2.911282 | 2.905136 | 0 | 0.006147 (sell's new table) | 0.03 |
| --tamper | 2.905136 | 2.898989 | 0 | 0.006147 (one new table, nothing sent) | 0.01 |

The sim dev went from 0.052755 to 0.032418 SOL over the two launches, about 0.0203 together. No top-up was needed, so fundSimDev sent nothing. Ops ends at 2.898989 SOL, 0.499 above the floor.

## Verification

- `pnpm vitest run`: 86 passed, 1 skipped (the live Pinata case).
- `pnpm lint` and `pnpm typecheck` exit 0 after each commit.
- `cosign.test.ts` (7 tests) covers:
  - the happy path: slot 1 verifies for the mint, and the message slice equals the stored bytes
  - a flipped byte: `message_mismatch`
  - another key in slot 0: `bad_signature`
  - an all-zero slot 0: `bad_signature`
  - `wire[0] = 3`: `message_mismatch`
  - no burn with burn stored, and no sell with sell stored: `exit_missing`
  - the `pool-sell-launch.json` fixture: exitPresent passes for sell and fails for burn
- `send.test.ts`:
  - sendRaw with a preflight rejection that has logs gives `failed` with no sig.
  - A network error gives `unknown` with the sig and lastValidBlockHeight.
  - The existing cases stay green.
- `settle.test.ts` covers:
  - nextState: landed, onchain failed, poll before expiry, recheck, `failed expired` after 3 rechecks, `unknown` on an RPC error past expiry
  - resumeAction: `resend` only for a signed row with a valid blockhash
  - canRelease
- Acceptance greps:
  - These match: `pool-sell-launch` in cosign.test.ts, `createPublicKey` in cosign.ts, `export async function sendRaw` in send.ts, `searchTransactionHistory` in settle.ts, and `resumeLaunches` in main.ts.
  - These find nothing: tweetnacl, the deserialize-and-reserialize compare, and `req.exit` / `body.exit` in submit.ts.
- File sizes: cosign.ts 101, settle.ts 144, submit.ts 91, build.ts 150, devnet-launch.ts 244, devnet-checks.ts 46 lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The sell exit is the AMM program's multi_hop_swap, not a pump-program instruction**
- **Found during:** Task 1.
- **Issue:** pumpIdl has no `multi_hop_swap`; it has only `multi_hop_curve_swap` and `sell_v3`. The SDK's `multiHopSwapInstruction` builds through the pump AMM program (`pAMMBay...`) on both venues, and the fixture confirms it: the AMM's `2b644913e9f66f94` instruction has 26 accounts.
- **Fix:** exitPresent matches that program plus the anchor discriminator, computed with node:crypto because the AMM IDL is not exported. The dev and the mint must be among its accounts.
- **Commit:** d177bd7

**2. [Rule 2 - Correctness] Cosign before the prepared -> signed transition**
- **Found during:** Task 2.
- **Issue:** In the plan's order, a row would be `signed` holding a wire with only the dev's signature. A restart could not resend that wire, because the mint signature would be missing. And an unverified slot 0 (all zeros) would reach the unique `signature` column, where it could collide across rows and give a 500.
- **Fix:** Pause, expiry and cosign now run first. Then `prepared -> signed` stores the fully co-signed wire and the verified signature, and the send follows. Exclusivity is unchanged: a double submit loses at the guarded UPDATE.
- **Commit:** 5aa94b3

**3. [Rule 3 - Blocking] `broadcast` split out of sendRaw**
- **Found during:** Task 2.
- **Issue:** sendRaw waits for confirmation inside core settle. Submit has to return right after the send (Pattern 8), and the worker's own settle machine does the polling.
- **Fix:** `broadcast` holds the pace, the send and the throw handling and returns null when the RPC accepts the tx. `sendRaw` is broadcast then settle, so sendTx behaves as before.
- **Commit:** d177bd7

**4. [Rule 2 - Correctness] A resend's preflight result is ignored**
- **Found during:** Task 2.
- **Issue:** A resend of a tx that already landed also fails preflight ("already processed").
- **Fix:** resumeLaunches only advances `signed -> sent` when the resend is accepted, and always settles by signature status.
- **Commit:** 5aa94b3

**5. [Design] Small helpers outside the listed files**
- **What was added:**
  - `canRelease` in vanity.ts, which release() now uses
  - `vanityRow` in vanity.ts (mint pubkey to idx, needed for mintKeyFor and release)
  - `unsettled` in launches.ts
  - a one-line prepare.ts change so the probes compile with their own exit
  - scripts/devnet-checks.ts, which keeps devnet-launch.ts under 300 lines
- **Commits:** 5aa94b3, 353c2a4

**6. [Rule 1] settle polls the block height every 5th poll (2 s), not every 400 ms**
- **Why:** Expiry is a 60-90 s matter, and Helius free allows about 10 RPS.
- **Commit:** 5aa94b3

### Notes

- **Failed rows store the error as text.**
  - On-chain failures store `onchain {"InstructionError":[...]}`.
  - Preflight rejections store the redacted preflight text.
  - Contract refusals store the code (`paused`, `expired`, `cosign_refused`).
- **Database state left on the dev branch:**
  - 2 landed launches. Their mints `4xEf...bndr` and `APrD...bndr` are marked used.
  - 1 failed `cosign_refused` launch, whose mint stays reserved for the sim dev until its 10-minute hold ends.
  - The 9 `prepared` rows from 02-11.

## Deferred Issues

- **Web passthrough.** apps/web/lib/worker.ts passes 400, 402, 403, 404, 409, 413, 429, 500 and 503, but not 410 (`expired`) or 422 (`cosign_refused`). The web submit route (02-13) has to add both, or those errors reach the browser as `worker_unavailable`. That file is outside this plan.
- **Unknown rows.** A row left `unknown` (the RPC was down past expiry) is checked again only on the next boot. That is acceptable at this volume. Add a periodic sweep if it ever happens in practice.

## TDD Gate Compliance

There are no separate RED commits, per the orchestrator rule never to commit a failing test. The tests were written with the code in d177bd7 and 5aa94b3. Each refusal case asserts a specific reason code, so a check that is skipped or reordered shows up as a different refusal.

## Requirements

- **LAUNCH-04 is complete.** Co-sign only a matching message that contains the exit: proven by the unit refusals and the devnet tamper run.
- **LAUNCH-03 is not ticked.** One-tx launch lands: proven on devnet through the worker, but 02-13, 02-17 and 02-18 also cover it (UI, staging, owner).

## Notes for later plans

- **02-13 (web submit).**
  - `POST /submit` takes `{ launchId, signed }`, where `signed` is the base64 wire after Phantom `signTransaction`. It returns `{ state: "sent" | "failed" | <current>, signature }`.
  - Poll the row every 1 s. On devnet a launch was `landed` with facts within a few seconds.
  - Add 410 and 422 to the web passthrough.
- **Facts on a landed row:** `tokens`, `devChildAfter` ("0") and, for sell, `solBack`.
- **02-14.** Send `submit ... refused:` (warn), `settle ... failed:` and `resume failed:` to Sentry.

## Threat Flags

None beyond the plan's threat model:
- **T-02-12-01:** raw compare, Ed25519 verify of slot 0, the stored exit, and exitPresent at both build and submit.
- **T-02-12-02:** the guarded transition; a double submit returns the current state.
- **T-02-12-03:** every state change is persisted with the signature or the error.
- **T-02-12-04:** never resend `sent` or `unknown`; history recheck 3 times 10 s apart.
- **T-02-12-05:** the pause is re-checked in submit.
- **T-02-12-06:** mintKeyFor re-derives and compares.

## Self-Check: PASSED

- **Files present:** packages/core/src/cosign.ts, cosign.test.ts, apps/worker/src/submit.ts, settle.ts, settle.test.ts, scripts/devnet-checks.ts.
- **Commits on phase-02-launch-flow:** d177bd7, 5aa94b3 and 353c2a4.
