---
status: partial
phase: 05-fee-engine-and-public-ledger
source: [05-VERIFICATION.md]
started: 2026-10-25T09:30:00Z
updated: 2026-10-25T09:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. HV-05-01: staging window rows
After the staging 24h windows close (2026-10-25T19:15:52Z for EX8EUJ and 2026-10-26T04:29:47Z for TESTCOIN), open both coin pages on https://web-staging-72bad.up.railway.app and look for Collect, Split 90/10 and Sweep rows with Solscan links.
expected: Rows with amount, time and working tx links. A coin with no fees, or fees under the 10,000 lamport collect minimum, shows none, by design.
result: [pending]

### 2. HV-05-02: mainnet Helius Sender
On the first mainnet forced bond (Phase 7, owner-gated), check the Helius Sender response and the tip transfer on Solscan.
expected: The buy and burn lands via Sender with a tip.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
