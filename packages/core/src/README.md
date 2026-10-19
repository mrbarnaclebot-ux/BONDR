# packages/core/src

The shared chain library. Phase 1 spike scripts call it, and Phase 2 apps import the same modules.

- `pump.ts`: the only file that loads the pump SDKs (through createRequire). Web code must never import it.
- `net.ts`: `connect(net)` with genesis and host guards, and `redact()` for every outbound error.
- `keys.ts`: `derive(master, role, net, id)` HMAC key derivation.
- `config.ts`: reads the live pump Global, FeeConfig and AMM FeeConfig as JSON-safe facts.
- `send.ts`: the one send path: program allowlist (`checkMessage`), `budget`, `wireSize`, paced `sendTx`.
- `alt.ts`: per-coin lookup tables: `tableKeys`, `sharedKeys`, `createTable` with warm-up wait.
- `math.ts`: pure bigint amount math (`applyBps`, `split90_10`, `trigger105`), no SDK import.
- `launch.ts`: `buildCreate` and `buildLaunch` (create + exact-out dev buy + burn or sell, one tx).
- `trade.ts`: v3 curve trades `buyExactIn`, `buyExactOut`, `sellExactIn`, each with the idempotent ATAs it needs; PumpSwap v2 `poolBuy` / `poolSell` and `poolState`, the one pool state fetch (pinned buyback wallet).
- `collect.ts`: `collectIxs` (W's quote ATA, sweep, collect_creator_fee_v2) and `splitIxs` (10% to the treasury).
- `route.ts`: `routeBuy` / `routeSell`: multi_hop_swap through the SDK route resolver, simulated min out.
- `sharing.ts`: `finalizeIxs` (sweep, config, the one 80/20 update), `updateIxs`, `readSharing`, `distributeIxs` (the SDK's sweeps, consolidation and distribute_creator_fees_v2, order untouched).
- `curve.ts`: `readCurve` and `costToComplete` (SDK v3 quote for the rest of a curve).
- `bond.ts`: `forcedBondIxs` (simulated buy then BurnChecked), `exactBondIxs`, `migrateIxs`, `poolBuyBurnIxs`, `poolBaseOut`.
- `events.ts`: `innerEvents` and `completeEvents` from emit_cpi inner instructions, never from logs.
- `fixtures/`: captured transactions for the event tests (public chain data).
- `*.test.ts`: vitest checks for the pure parts.
