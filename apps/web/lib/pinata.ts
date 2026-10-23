// Pinata v3 uploads (RESEARCH Pattern 10). Plain TypeScript so Vitest can load it; the pin route
// passes the JWT in, so only that route ever reads it from the environment.
import type { Links } from "@bondr/core/api";

const UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
// The owner's Pinata gateway when PINATA_GATEWAY is set: ipfs.io now refuses server and wallet fetches
// (429, "service worker gateway only"), so on-chain links to it leave coins without images. The cost is that
// the links die with the Pinata account; ipfs.io stays the fallback. Inlined into the client by next.config.
export const gatewayHost = (raw = process.env.PINATA_GATEWAY): string =>
  raw
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "") || "ipfs.io";

export const ipfsUri = (cid: string, host = gatewayHost()): string => `https://${host}/ipfs/${cid}`;

export type MetaFields = { name: string; symbol: string; description: string; links: Links };

/** Pump's metadata shape. Links must already be normalized; absent links get no key at all. */
export function metadataJson(f: MetaFields, imageCid: string): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    name: f.name,
    symbol: f.symbol,
    description: f.description,
    image: ipfsUri(imageCid),
    showName: true,
    createdOn: "BONDR",
  };
  if (f.links.x) meta.twitter = f.links.x;
  if (f.links.telegram) meta.telegram = f.links.telegram;
  if (f.links.website) meta.website = f.links.website;
  return meta;
}

/** Carries only the HTTP status, so a logged or rethrown error can never include the JWT. */
export class PinError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`pinata upload failed with status ${status}`);
    this.status = status;
  }
}

/** Uploads one public file and returns its CID. */
export async function pinFile(blob: Blob, filename: string, jwt: string, fetchFn = fetch): Promise<string> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("network", "public");
  let res: Response;
  try {
    res = await fetchFn(UPLOAD_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PinError(0); // network or timeout; the original error is dropped with whatever it carried
  }
  if (!res.ok) throw new PinError(res.status);
  const cid = ((await res.json().catch(() => null)) as { data?: { cid?: unknown } } | null)?.data?.cid;
  if (typeof cid !== "string" || !/^[A-Za-z0-9]+$/.test(cid)) throw new PinError(res.status);
  return cid;
}
