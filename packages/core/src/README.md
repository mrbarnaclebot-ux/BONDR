# packages/core/src

The shared chain library. Phase 1 spike scripts call it, and Phase 2 apps import the same modules.

- `pump.ts`: the only file that loads the pump SDKs (through createRequire). Web code must never import it.
- `net.ts`: `connect(net)` with genesis and host guards, and `redact()` for every outbound error.
- `keys.ts`: `derive(master, role, net, id)` HMAC key derivation.
- `config.ts`: reads the live pump Global, FeeConfig and AMM FeeConfig as JSON-safe facts.
- `send.ts`: the one send path: program allowlist (`checkMessage`), `budget`, `wireSize`, paced `sendTx`.
- `alt.ts`: per-coin lookup tables: `tableKeys`, `sharedKeys`, `createTable` with warm-up wait.
- `math.ts`: pure bigint amount math (`applyBps`), no SDK import.
- `launch.ts`: `buildCreate` and `buildLaunch` (create + exact-out dev buy + burn or sell, one tx).
- `route.ts`: `routeBuy` / `routeSell`: multi_hop_swap through the SDK route resolver, simulated min out.
- `sharing.ts`: `finalizeIxs` (sweep, config, the one 80/20 update), `updateIxs`, `readSharing`.
- `curve.ts`: `readCurve` and `costToComplete` (SDK v3 quote for the rest of a curve).
- `*.test.ts`: vitest checks for the pure parts.
