# Phase 6 deferred items

- 06-12: `apps/web/components/token-ledger.tsx` uses `md:p-8 min-[1100px]:p-6`. Tailwind v4 emits the px arbitrary breakpoint before `md` (48rem), so `md:p-8` likely wins from 1100px too. Write `min-[68.75rem]:` instead. Out of scope for 06-12.
- 06-16: the audit log table scroll box (`admin-audit.tsx`) needs `relative`, or its hidden "(opens Solscan)" text widens the page at 390px once rows have signatures. Fix in 06-17 or 06-25. Fixed in 06-17 (589ca75).
