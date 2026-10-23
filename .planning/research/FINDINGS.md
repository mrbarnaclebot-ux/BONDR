# BONDR pre-spec research findings (2026-10-18)

Sources: pump-fun/pump-public-docs @ 639b87f (2026-10-13), live mainnet FeeConfig/Global decoded with @pump-fun/pump-sdk 4.1.0 and @pump-fun/pump-swap-sdk 2.1.0, agencybook reference code at /Users/uzi/agencybook-phase-15. Re-verify against the docs repo before each phase: pump shipped breaking changes on 2025-11-11, 2026-03-19, 2026-09-01.

## Fee claim verdict

- 1.25% on the bonding curve: true. Flat, not tiered: protocol 0.95% + creator 0.30% + LP 0.
- "USDC pairing goes up to 3%": false. USDC uses the same schedule as SOL. The 3% is `max_configurable_creator_fee_bps = 300`, a cap on the creator fee alone, only for custom quote pairs (a pump coin or other listed token as quote). Max total on such a pair is about 3.95%. SOL and USDC pairs reject a custom creator fee (error 6091).
- PumpSwap after migration (canonical pools) is tiered by market cap. The creator fee jumps to 0.95% at 420-1470 SOL mcap, then steps down 5 bps per tier to 0.05%. Post-bond creator fees are worth more than pre-bond ones.

## Fee recipient control (core mechanic)

- `create_v2` takes `creator` as a plain pubkey arg (not a signer). BONDR can set creator = per-token wallet W at launch.
- `set_creator` is pump-admin only. BONDR cannot change creator later.
- Fee sharing (`pump_fees`): `create_fee_sharing_config` is callable by the current creator. `update_fee_shares_v2` can run exactly ONCE (since 2026-03-19). It then sets admin_revoked and locks the list permanently. Up to 10 shareholders, summing to 10000 bps. Distribution is permissionless.
- Consequence: the "80/20 now, deployer later" switch must spend the single update at the revert. During bonding, W holds 100% and BONDR splits 80/20 off-chain when collecting.
- Workable flow: create_v2(creator=W). Bonding fees accrue to W and are split 80 burn / 20 treasury on collection. After migration: buy and burn, create_fee_sharing_config, then update_fee_shares_v2 once to the final split (deployer 100% or deployer 80 / treasury 20).
- Before any config change, sweep pending fees (errors 6095 and 6033) and run transfer_creator_fees_to_pump_v2 for AMM fees.
- W is custodial (server-held key). Derive per-token keys from a master seed via HMAC, as agencybook did (packages/core/src/launch/sign.ts).

## Migration

- The curve completes when 793.1M of 1B tokens are sold, about 85 SOL raised and about 411 SOL mcap. The migration fee is about 0.015 SOL.
- Pump's keeper runs `migrate` separately. LP is burned.
- While complete but unmigrated, no buys or sells are possible.
- A v3 buy that crosses the threshold does a "synthetic migration" and fills the rest at the pool price.
- Detect by subscribing to the bonding curve account (`complete` flag, progress from real_token_reserves) plus the CompleteEvent and CreatePoolEvent events.

## Burn pool size

- The creator fee is 0.30% of gross volume. With 3-10x churn to graduate (assumed), that is about 0.77-2.55 SOL per graduated coin. The 80% share means about 0.6-2 SOL buys roughly 0.15-0.5% of supply at graduation price.
- Most coins never graduate. Their W balances need a policy.

## Future features

- Dev buy: `createV2AndBuyInstructions` is one tx, about 500k CU. Token-2022 mint, 6 decimals. Holder-reward and cashback coin modes conflict with BONDR (they redirect fees). Keep both off.
- Insta sell / insta burn: no documented same-tx restriction. Unverified, test on devnet.
- Streamflow lock: `@streamflow/stream` 13.4.0, `createLock`. Cost 0.16 SOL + 0.5% of tokens. Token-2022 support unconfirmed. This blocks the lock option until tested.
- Dexscreener Enhanced Token Info: $299, web checkout only, no official order API. The only programmatic path is the Bags.fm third-party endpoint (undocumented terms). $299 is likely larger than a typical coin's whole pre-bond creator fee.

## Infra

- Helius Developer ($49/mo) is the realistic floor. The free tier 429s on bursts (agencybook lesson).
- Jito bundles hold up to 5 txs, atomic; tip at least 5000 lamports.
- Metadata: self-host content-addressed JSON (agencybook) or Pinata. Pump's IPFS endpoint is undocumented.
- Key custody: node:crypto AES-256-GCM envelope or HMAC derivation from one master seed in env (worker only, never web).
- Snipers hit agencybook's launch within the same second. Use a private or MEV-protected send for create + dev buy and for the burn buy.

## Competitors

- Heaven: per-token flywheel wallets that burn. Closest analogue.
- Bags.fm: on-chain fee-share configs.
- Believe: platform-held fees, a 2026 class action alleges missed buybacks. A transparency lesson.
- LetsBonk: burns its own token, not per coin.
