import "server-only";
import type { Links } from "@bondr/core/api";
import {
  checkDescription,
  checkImage,
  checkName,
  checkSymbol,
  checkUri,
  MAX_IMAGE_BYTES,
  normalizeLink,
} from "@bondr/core/rules";
import { rateLimited, sameOrigin } from "@/lib/guard";
import { ipfsUri, type MetaFields, metadataJson, PinError, pinFile } from "@/lib/pinata";
import { consentRequired, pinProof, sessionWallet } from "@/lib/session";

export const runtime = "nodejs";

const MAX_BODY = MAX_IMAGE_BYTES + 64 * 1024;
const MAX_META = 8 * 1024;
const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;

const fail = (status: number, error?: string) =>
  error ? Response.json({ error }, { status }) : new Response(null, { status });

type Parsed = { image: File; raw: Record<string, unknown> };

// Multipart: `image` (File) and `meta` (JSON: name, symbol, description, links). The wallet is the session's.
async function parse(req: Request): Promise<Parsed | null> {
  const form = await req.formData().catch(() => null);
  const image = form?.get("image");
  const meta = form?.get("meta");
  if (!(image instanceof File) || typeof meta !== "string" || meta.length > MAX_META) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(meta);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return { image, raw: raw as Record<string, unknown> };
}

// Server-side rerun of the browser's checks (rules.ts); null when any field is invalid.
function fields(raw: Record<string, unknown>): MetaFields | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const name = checkName(str(raw.name));
  const symbol = checkSymbol(str(raw.symbol));
  const description = checkDescription(str(raw.description));
  if (!name.ok || !symbol.ok || !description.ok) return null;
  const given = (raw.links ?? {}) as Record<string, unknown>;
  const links: Links = {};
  for (const kind of ["x", "telegram", "website"] as const) {
    const link = normalizeLink(kind, str(given[kind]));
    if (!link.ok) return null;
    if (link.value) links[kind] = link.value;
  }
  return { name: name.value, symbol: symbol.value, description: description.value, links };
}

/** Pins the image, then the metadata JSON pointing at it (LAUNCH-07). Nothing is signed before this. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return fail(403);
  const length = Number(req.headers.get("content-length"));
  if (!(length > 0 && length <= MAX_BODY)) return fail(413); // a missing length could stream without end
  // A session exists only after a signed consent was stored, so it stands in for the consent row.
  const wallet = sessionWallet(req);
  const limited = rateLimited(req, "pin", LIMIT, WINDOW_MS, wallet ?? undefined);
  if (limited) return limited;
  if (!wallet) return consentRequired();
  const parsed = await parse(req);
  if (!parsed) return fail(400, "invalid_input");
  const meta = fields(parsed.raw);
  const bytes = new Uint8Array(await parsed.image.arrayBuffer());
  const image = checkImage(bytes.subarray(0, 12), bytes.length);
  if (!meta || !image.ok) return fail(400, "invalid_input");
  return pin(meta, bytes, image.value);
}

async function pin(meta: MetaFields, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<Response> {
  const jwt = process.env.pinata_jwt; // lowercase, as in the root .env (Pitfall 9)
  if (!jwt) {
    console.error("pin failed", "pinata_jwt is not set");
    return fail(502, "pin_failed");
  }
  try {
    const imageCid = await pinFile(
      new Blob([bytes], { type: `image/${type}` }),
      `${meta.symbol}.${type}`,
      jwt,
    );
    const json = new Blob([JSON.stringify(metadataJson(meta, imageCid))], { type: "application/json" });
    const cid = await pinFile(json, `${meta.symbol}.json`, jwt);
    const uri = ipfsUri(cid);
    if (!checkUri(uri).ok) throw new PinError(200);
    const proof = pinProof(uri, imageCid);
    return Response.json({ uri, cid, imageCid, proof }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("pin failed", e instanceof PinError ? e.status : "unknown");
    return fail(502, "pin_failed");
  }
}
