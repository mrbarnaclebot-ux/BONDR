// Public reads (web IN-05): a miss is a Neon query or a worker call, so each IP gets a generous budget.
// Step 4 polls /api/launch/[id] every second and /launch polls /api/status every 10 s: about 66 a minute.
// /api/coin/:path* is the token page's Load more (50 trades a click); / and /api/coins are the home page and its
// tab switches and Show more (a list read each, kept 10 s per sort and page).
// /coin/:path* also covers the share card renders, so card fetches share the page's read budget.
// /api/live has its own scope: 30 SSE connects a minute per IP (the route caps open streams at 6).
import { rateLimited } from "@/lib/guard";

export function proxy(req: Request): Response | undefined {
  if (req.method !== "GET") return undefined;
  if (new URL(req.url).pathname === "/api/live") return rateLimited(req, "live", 30, 60_000) ?? undefined;
  return rateLimited(req, "read", 300, 60_000) ?? undefined;
}

export const config = {
  matcher: [
    "/",
    "/api/coins",
    "/coin/:path*",
    "/api/coin/:path*",
    "/api/launch/:id",
    "/api/status",
    "/api/live",
  ],
};
