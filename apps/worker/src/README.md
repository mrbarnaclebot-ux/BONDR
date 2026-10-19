# apps/worker/src

The private worker. It is the only Phase 2 service that touches the chain (D-15). The web server calls it over Railway private networking with a bearer token.

- `main.ts`: boot (env, one devnet connection, routes) and SIGTERM shutdown. No background loop (Pitfall 6).
- `env.ts`: `loadEnv` and `launchNet` (refuses mainnet in Phase 2, D-02); `ops` and `treasury` keys with the Phase 1 ids.
- `http.ts`: node:http server, `authorized` (timingSafeEqual), `readJson` (16 KB cap), `Fail` for contract errors. `GET /healthz` is the only route without the token.
- `status.ts`: `liveStatus` (`GET /status`, cached 5 s) and `quote` (`POST /quote`); `pauseReason` and `networkFee` are pure.
- `*.test.ts`: vitest checks for auth, body cap, error mapping, pause reasons and the mainnet guard.

Run locally: `pnpm --filter @bondr/worker dev` (reads the repo-root .env; set WORKER_PORT to move off 8080).
