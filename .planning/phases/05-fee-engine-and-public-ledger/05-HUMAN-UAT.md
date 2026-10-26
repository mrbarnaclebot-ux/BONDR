---
status: partial
phase: 05-fee-engine-and-public-ledger
source: [05-VERIFICATION.md]
started: 2026-10-25T09:30:00Z
updated: 2026-10-26T05:40:00Z
---

## Current Test

2. HV-05-02 (Phase 7, owner-gated)

## Tests

### 1. HV-05-01: staging window rows
After the staging 24h windows close (2026-10-25T19:15:52Z for EX8EUJ and 2026-10-26T04:29:47Z for TESTCOIN), open both coin pages on https://web-staging-72bad.up.railway.app and look for Collect, Split 90/10 and Sweep rows with Solscan links.
expected: Rows with amount, time and working tx links. A coin with no fees, or fees under the 10,000 lamport collect minimum, shows none, by design.
result: passed, no-fee path (checked 2026-10-26 in 06-26). Both windows ran unattended and showed no rows, by design: neither coin had creator fees to collect. Evidence: the staging worker logged `fee window CyR56jVf...bndr 2: done` at 2026-10-25T19:15:56Z and `fee window HHNKkxQx...bndr 2: done` at 2026-10-26T04:29:53Z (`done` = fees not worth collecting and W holds 0 BONDR, so nothing is sent); `/api/coins` shows `fees.budget` "0" for both (budget = feeBudget + 90% of fees unclaimed, so fees unclaimed is at most 1 base unit); EX8EUJ's last trade was 2026-10-24T20:12Z and TESTCOIN has never traded; `GET /api/coin/{mint}/ledger` answers 200 with `rows: []` for both; the ops wallet held 2.741621 SOL before and after both windows (0 spent); the 04:00Z batch logged `reconcile: 1 accounts, 0 diffs`. The token page reads "No fee movements yet" and "Window 4 closes in 13h 43m". The Collect, Split 90/10 and Sweep rows with Solscan links were shown on devnet in 05-12 (window job) and 06-24 (Sweep now). A staging window with real rows needs a trade on a staging coin before its window ends.

### 2. HV-05-02: mainnet Helius Sender
On the first mainnet forced bond (Phase 7, owner-gated), check the Helius Sender response and the tip transfer on Solscan.
expected: The buy and burn lands via Sender with a tip.
result: [pending]

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
