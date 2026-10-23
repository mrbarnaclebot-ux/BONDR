// Public reads (web IN-05): a miss is a Neon query or a worker call, so each IP gets a generous budget.
// Step 4 polls /api/launch/[id] every second and /launch polls /api/status every 10 s: about 66 a minute.
import { rateLimited } from "@/lib/guard";

export function proxy(req: Request): Response | undefined {
  if (req.method !== "GET") return undefined;
  return rateLimited(req, "read", 300, 60_000) ?? undefined;
}

export const config = { matcher: ["/coin/:mint", "/api/launch/:id", "/api/status"] };
