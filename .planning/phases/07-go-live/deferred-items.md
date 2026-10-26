# Phase 7 deferred items

- apps/worker/src/env.test.ts "mainnet refuses a missing, malformed, off-curve or derivable TREASURY_PUBKEY" (07-04) flakes about 0.6% of runs: the `${TREASURY}x` case is a valid on-curve key whenever the random 43-character TREASURY plus "x" decodes to 32 bytes (120 of 20,000 sampled). Fix: use a value that can never decode to 32 bytes, such as `${TREASURY}xx`. Seen in the 07-16..07-18 batch run. FIXED: a fixed 33-byte base58 value replaces it.
