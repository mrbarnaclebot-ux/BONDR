// Open Sentry issues for the health panel (D-27): one read of the org issues API, fetched only when the console
// asks and cached 60 s with one shared promise (the status.ts live() shape). A3: SENTRY_READ_TOKEN is a personal
// token with read scope; a wrong token type answers 403, which shows the failed state and is harmless.
// Never put the token in a message or log.
import type { AdminHealth } from "@bondr/core/api-admin";

type Count = AdminHealth["sentry"];

const ISSUES_URL = "https://sentry.io/api/0/organizations/mrbarnacle/issues/?query=is:unresolved&limit=100";
const LIMIT = 100;
const CACHE_MS = 60_000;
const TIMEOUT_MS = 5_000; // a slow Sentry must not hold the health poll
const FAILED: Count = { configured: true, failed: true };

let cached: { at: number; count: Promise<Count> } | undefined;

async function read(token: string, f: typeof fetch): Promise<Count> {
  const res = await f(ISSUES_URL, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`sentry issues answered ${res.status}`);
  const issues = (await res.json()) as { project?: { slug?: string } }[];
  const of = (slug: string) => issues.filter((i) => i.project?.slug === slug).length;
  return {
    configured: true,
    web: of("bondr-web"),
    worker: of("bondr-worker"),
    capped: issues.length >= LIMIT,
  };
}

export function sentryCount(token: string | null, f: typeof fetch = fetch, now = Date.now()): Promise<Count> {
  if (!token) return Promise.resolve({ configured: false });
  if (cached && now - cached.at < CACHE_MS) return cached.count;
  // A failed read is not cached, so the next poll tries again.
  const entry = {
    at: now,
    count: read(token, f).catch((): Count => {
      if (cached === entry) cached = undefined;
      return FAILED;
    }),
  };
  cached = entry;
  return entry.count;
}
