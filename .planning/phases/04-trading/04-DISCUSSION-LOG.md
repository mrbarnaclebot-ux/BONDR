# Phase 4: Trading - Discussion Log

**Date:** 2026-10-24
**Mode:** --auto. The owner delegated all choices on 2026-10-24: "continue on the automated workflow, keep going and dont stop until goal is reached. only stop if human intervention is needed in regards to real money".

All gray areas were auto-selected. Each question took the recommended option.

| Area | Question | Selected (recommended) | Alternatives considered |
| --- | --- | --- | --- |
| Transaction flow | How is the trade built, signed and sent? | Worker builds, Phantom signTransaction, worker checks the message is unchanged and sends through Helius (D-06) | Phantom signAndSend (needs a client RPC and breaks connect-src 'self'); the browser builds the tx (needs RPC in the browser) |
| Transaction flow | Where are prepared txs kept? | Worker memory for 2 min (D-07) | A Postgres table (Neon writes per quote, D-04) |
| Transaction flow | Priority fee | Helius estimate Medium, capped at 0.0005 SOL (D-08) | Fixed fee; a user setting (deferred) |
| Transaction flow | Consent | Reuse the Phase 2 consent (D-09) | No consent for trading |
| Quote | Source | Worker /trade/quote; the method is the researcher's choice, and it must work before a wallet connects (D-10) | Browser-side math (no RPC in the browser) |
| Quote | Refresh | 2 s while visible, paused after 60 s idle (D-12) | Only on input; 5 s |
| Quote | Price impact guard | Warn over 5%, confirm over 15% (D-13) | No guard |
| Amounts | Presets | Buy 0.1, 0.5, 1 SOL and Max; sell 25/50/75/100% (D-14) | Typed amounts only |
| Amounts | Slippage | 0.5 / 1 / 3% chips plus Custom, 1% default, remembered (D-15) | Fixed 1% |
| Amounts | Balances | Worker read on connect, after a trade and on focus (D-16) | Polling |
| Results | Feedback | Inline result with a Solscan link and plain error messages (D-17) | Toasts |
| Results | Kill switch | None in Phase 4 (D-18) | A trading pause flag now |
| Testing | Coverage | Units, Phantom-mock e2e, one devnet curve buy and sell; PumpSwap on fork fixtures (D-19) | Skip the real devnet trade |

## Deferred Ideas
- Trading kill switch (Phase 6), limit orders, a portfolio page, a priority-fee setting.
