# Phase 6 deferred items

- 06-12: `apps/web/components/token-ledger.tsx` uses `md:p-8 min-[1100px]:p-6`. Tailwind v4 emits the px arbitrary breakpoint before `md` (48rem), so `md:p-8` likely wins from 1100px too. Write `min-[68.75rem]:` instead. Out of scope for 06-12. Fixed in 06-25 (bfc65d6), token-bond.tsx too; admin-responsive.e2e.ts checks both panels' padding at 390/768/1440.
- 06-16: the audit log table scroll box (`admin-audit.tsx`) needs `relative`, or its hidden "(opens Solscan)" text widens the page at 390px once rows have signatures. Fix in 06-17 or 06-25. Fixed in 06-17 (589ca75).
- 06-25 non-blocking Designer notes (not built): panel h2s wrap beside head notes at 390 (stack the note below 768px); Health "Last runs" all-null value is long; EVACUATE intro counts coins while the button counts simulated W with balances.
