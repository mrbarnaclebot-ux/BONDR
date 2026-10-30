---
phase: 07-go-live
plan: 28
gate: G-3
status: complete
---

# 07-28 Summary: G-3 production seed, worker dark in genesis

Owner replies (2026-10-30): "g-3 approved generate it on the ma", then "backup done".

## Done
- MASTER_SEED generated on the Mac and piped into Railway; never printed, and Claude has not read it. The owner made the paper backup. env-diff g3 passed by name only.
- Full deploy from `6098e98`: web e294d733, worker 35bcdde9, tag deployed-production.
- Boot log: "worker listening on mainnet (genesis)", all five switches off, "contract check passed" on mainnet, treasury accepted. /api/status answers paused "genesis".
- ops=EbjVtMGEiPGZYEGS8dJLEYxS2r1frStrEv1z3JAYijv3 buyback=FptmTag1DwDaQ7yv3kS18xzWCDi2QPSgjm2SJcYcY1qe (ops balance 0).

## Deviations
- The seed was not generated on the phone: owner decision, recorded in PRODUCTION.md G-3. T-07-28-01's mitigation changed accordingly.
- D-14 RPC stats: read from the admin Health panel once the owner signs in; the log has no stats line. Helius credits are read in the dashboard at G-10.

## Open
- Vanity pool started at 0; production grinds to 150 with 2 threads. No mint had been logged when this was written.
