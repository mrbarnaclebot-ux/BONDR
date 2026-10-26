// Public reads (web IN-05): a miss is a Neon query or a worker call, so each IP gets a generous budget.
// Step 4 polls /api/launch/[id] every second and /launch polls /api/status every 10 s: about 66 a minute.
// /api/coin/:path* is the token page's Load more (50 trades a click); / and /api/coins are the home page and its
// tab switches and Show more (a list read each, kept 10 s per sort and page).
// /coin/:path* also covers the share card renders, so card fetches share the page's read budget.
// /api/live has its own scope: 30 SSE connects a minute per IP (the route caps open streams at 6).
import { rateLimited } from "./lib/guard";

// The seven read paths the matcher listed before the www redirect widened it (Pitfall 16).
const READ_PATHS = /^\/$|^\/api\/(coins|status|live)$|^\/api\/launch\/[^/]+$|^\/(api\/)?coin(\/.*)?$/;

// www.trybondr.fun answers 308 to SITE_URL, so the admin sign-in domain line always matches it (D-07).
// Railway terminates TLS in front of Next, so the public host is in x-forwarded-host and req.url may be internal.
// The Location is built from SITE_URL only: a client can set x-forwarded-host, but never steer the redirect.
function toApex(req: Request): Response | undefined {
  let site: URL;
  try {
    site = new URL(process.env.SITE_URL ?? "");
  } catch {
    return undefined;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host !== `www.${site.host}`) return undefined;
  const { pathname, search } = new URL(req.url);
  return Response.redirect(new URL(pathname + search, site), 308);
}

export function proxy(req: Request): Response | undefined {
  const apex = toApex(req);
  if (apex) return apex;
  if (req.method !== "GET") return undefined;
  const { pathname } = new URL(req.url);
  if (pathname === "/api/live") return rateLimited(req, "live", 30, 60_000) ?? undefined;
  if (!READ_PATHS.test(pathname)) return undefined;
  return rateLimited(req, "read", 300, 60_000) ?? undefined;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
