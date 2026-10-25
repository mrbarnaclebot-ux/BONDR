# Phase 5 deferred items

- **05-04, for 05-09:** `LedgerStore.diff(null, ...)` (a buyback-wallet reconcile diff) cannot be written to Postgres yet. The 0005 check `fee_ledger_platform` requires `(mint is null) = (kind = 'buyback_burn')`, so a `reconcile_diff` row with no mint gets 23514. The memory store accepts it. Fix in 05-09: either relax the check to `kind in ('buyback_burn','reconcile_diff')` with a migration, or record the buyback diff under a mint-less detail on another row.
  - **Resolved in 05-09:** migration 0006 relaxes `fee_ledger_platform` to `kind = 'reconcile_diff' or (mint is null) = (kind = 'buyback_burn')`; the pgLedger test writes a mint-less diff.
