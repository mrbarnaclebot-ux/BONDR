// D-19 consent promise: error reports carry no wallet data. Pure and import-free, so web may import it.
const ADDR = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const HEX = /^[0-9a-f]+$/i;

// The JSON round trip reaches every nested string of an event or breadcrumb and keeps the shape. Bigints
// (worker console breadcrumbs carry raw lamport args) become strings instead of throwing.
// All-hex runs are kept: Sentry's event_id and trace ids are 32 hex chars and often have no 0.
// ponytail: also hides tx signatures and other long base58 ids; fine for error reports.
export function scrub<T>(value: T): T {
  const json = JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return JSON.parse(json.replace(ADDR, (m) => (HEX.test(m) ? m : "[addr]")));
}

// FEE-10: names the web process must never hold. Web needs no seed and no seed path, the Helius key stays in
// the worker, and the Sentry token and staging URL are owner tooling only.
const NAMES = new Set(["MASTER_SEED_FILE", "helius_api_key", "sentry_auth_token", "DATABASE_URL_STAGING"]);

export function forbiddenEnv(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((name) => env[name] && (name.endsWith("_SEED") || NAMES.has(name)));
}

// Sentry v11 dataCollection shared by web server, web client and worker. v11 collects more than v10 did
// when this is unset (RESEARCH Contradiction 3), so every source of user data is switched off explicitly.
// Local variables could hold key material, so they stay off too.
export const dataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: ["forwarded", "-ip", "remote-", "via", "-user", "referer"] },
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
