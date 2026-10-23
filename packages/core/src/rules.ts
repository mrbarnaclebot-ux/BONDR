// The one set of launch field rules, run by the browser, the web server and the worker (RESEARCH Pattern 7).
// Pure and import-free so every tier can load it. Checks return codes and numbers; the copy lives in web.

export const NAME_MAX_BYTES = 32;
export const SYMBOL_MAX = 13;
export const DESCRIPTION_MAX = 500;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// ipfs.io or the owner's Pinata dedicated gateway, then a bare CID.
const URI = /^https:\/\/(?:ipfs\.io|[a-z0-9-]+\.mypinata\.cloud)\/ipfs\/[A-Za-z0-9]+$/;
const URI_MAX = 200;
const LINK_MAX = 200;

export type Code = "required" | "too_long" | "charset" | "invalid" | "type" | "too_big" | "nan" | "below_min";
export type Check<T> = { ok: true; value: T } | { ok: false; code: Code; n?: number; mb?: number };

const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const fail = <T>(code: Code, extra?: { n?: number; mb?: number }): Check<T> => ({
  ok: false,
  code,
  ...extra,
});

// A8: pump limits the name by bytes, so emoji and accents count more than one.
export function checkName(raw: string): Check<string> {
  const name = raw.trim();
  if (!name) return fail("required");
  const n = new TextEncoder().encode(name).length;
  return n > NAME_MAX_BYTES ? fail("too_long", { n }) : ok(name);
}

export function checkSymbol(raw: string): Check<string> {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return fail("required");
  if (symbol.length > SYMBOL_MAX) return fail("too_long", { n: symbol.length });
  return /^[A-Z0-9]+$/.test(symbol) ? ok(symbol) : fail("charset");
}

export function checkDescription(raw: string): Check<string> {
  const text = raw.trim();
  const n = [...text].length;
  return n > DESCRIPTION_MAX ? fail("too_long", { n }) : ok(text);
}

export type LinkKind = "x" | "telegram" | "website";
const HOSTS: Record<Exclude<LinkKind, "website">, string[]> = {
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  telegram: ["t.me"],
};

// Bare input gets https://; http is upgraded; every other scheme is refused. No logins, no dotless hosts.
export function normalizeLink(kind: LinkKind, raw: string): Check<string | undefined> {
  const text = raw.trim();
  if (!text) return ok(undefined);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return fail("invalid");
  let u: URL;
  try {
    u = new URL(scheme ? text : `https://${text}`);
  } catch {
    return fail("invalid");
  }
  u.protocol = "https:";
  const host = u.hostname.toLowerCase();
  const hostOk = kind === "website" ? host.includes(".") : HOSTS[kind].includes(host) && u.pathname !== "/";
  if (!hostOk || u.username || u.password || u.href.length > LINK_MAX) return fail("invalid");
  return ok(u.href.replace(/\/$/, ""));
}

export type ImageType = "png" | "jpeg" | "gif" | "webp";
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

// Magic bytes, never the file name or the browser's MIME guess. SVG is text and never matches.
export function imageType(b: Uint8Array): ImageType | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(b, ascii("GIF8"))) return "gif";
  if (starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8)) return "webp";
  return null;
}

// `head` may be just the first bytes of the file; `size` is the whole file's length.
export function checkImage(head: Uint8Array, size: number): Check<ImageType> {
  if (size > MAX_IMAGE_BYTES) return fail("too_big", { mb: Math.round((size / 1024 / 1024) * 10) / 10 });
  const type = imageType(head);
  return type ? ok(type) : fail("type");
}

export function checkUri(uri: string): Check<string> {
  if (uri.length > URI_MAX) return fail("too_long", { n: uri.length });
  return URI.test(uri) ? ok(uri) : fail("invalid");
}

// Decimal SOL to lamports with no float on the way: digits, an optional point and at most 9 decimals.
export function parseSol(raw: string): Check<bigint> {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(raw.trim());
  if (!m?.[1]) return fail("nan");
  return ok(BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0")));
}

// `min` comes from math.ts minLamports over live Global (D-17); never a constant here.
export const checkDevBuy = (lamports: bigint, min: bigint): Check<bigint> =>
  lamports < min ? fail("below_min") : ok(lamports);
