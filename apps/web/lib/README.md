# apps/web/lib

Server and client helpers for the web app. Files that import `server-only` must never reach a client component.

- `db.ts`: server-only re-export of `@bondr/core/db` (`db()` and the tables).
- `guard.ts`: POST guards: `sameOrigin`, `json` (capped body), `BASE58_KEY`, and the fixed-window `take`, `clientIp`, `rateLimited`.
- `guard.test.ts`: rate limit windows, client IP choice and the 429 response.
- `worker.ts`: server-only `workerGet` and `workerPost`, the bearer-token proxy to the worker.
- `pinata.ts`: `metadataJson`, `ipfsUri` and `pinFile` (Pinata v3 uploads). The pin route supplies the JWT.
- `pinata.test.ts`: metadata shape, URI length, upload request and JWT redaction; a live pin with `PINATA_LIVE=1`.
- `format.ts`: display formats `sol`, `pct`, `compact`, `short`, `explorer`.
- `format.test.ts`: the display formats.
- `use-status.ts`: `useStatus()`, polls `/api/status` every 10 s.
- `terms.ts`: `TERMS_VERSION`, stored with each consent.
- `cn.ts`: `cn()`, clsx plus tailwind-merge.
