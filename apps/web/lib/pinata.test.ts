import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { checkUri, normalizeLink } from "@bondr/core/rules";
import { expect, test, vi } from "vitest";
import { fetchCardImage, gatewayHost, imageUrl, ipfsUri, metadataJson, pinFile } from "./pinata";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"; // a 59-char CIDv1
const IMG = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

test("metadataJson uses the gateway image URI, shows the name and keeps only the links given", () => {
  vi.stubEnv("PINATA_GATEWAY", "");
  const x = normalizeLink("x", "x.com/coin");
  if (!x.ok || !x.value) throw new Error("fixture link");
  const meta = metadataJson({ name: "Coin", symbol: "COIN", description: "d", links: { x: x.value } }, IMG);
  expect(meta).toEqual({
    name: "Coin",
    symbol: "COIN",
    description: "d",
    image: `https://ipfs.io/ipfs/${IMG}`,
    showName: true,
    createdOn: "BONDR",
    twitter: "https://x.com/coin",
  });
  expect("telegram" in meta).toBe(false);
});

test("ipfsUri of a CIDv1 is 80 chars on ipfs.io and passes checkUri on either gateway", () => {
  const uri = ipfsUri(CID, "ipfs.io");
  expect(uri).toHaveLength(80);
  expect(checkUri(uri).ok).toBe(true);
  expect(gatewayHost(" https://my-gw.mypinata.cloud/ipfs/ ")).toBe("my-gw.mypinata.cloud");
  expect(gatewayHost("")).toBe("ipfs.io");
  expect(checkUri(ipfsUri(CID, gatewayHost("my-gw.mypinata.cloud"))).ok).toBe(true);
});

test("imageUrl accepts only an alphanumeric CID", () => {
  vi.stubEnv("PINATA_GATEWAY", "");
  expect(imageUrl(CID)).toBe(`https://ipfs.io/ipfs/${CID}`);
  for (const bad of [null, "", `${CID}/x`, `${CID}?x=1`, `${CID}.png`, "../etc"])
    expect(imageUrl(bad)).toBeNull();
});

test("fetchCardImage embeds a small PNG from the gateway and refuses everything else", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const calls: [string, RequestInit][] = [];
  const serve = (body: BodyInit, type: string) =>
    (async (u: string, i: RequestInit) => {
      calls.push([u, i]);
      return new Response(body, { headers: { "content-type": type } });
    }) as unknown as typeof fetch;
  vi.stubEnv("PINATA_GATEWAY", "");
  expect(await fetchCardImage(IMG, serve(png, "image/png"))).toBeNull(); // no gateway, no server fetch
  vi.stubEnv("PINATA_GATEWAY", "my-gw.mypinata.cloud");
  expect(await fetchCardImage(IMG, serve(png, "image/png"))).toBe("data:image/png;base64,iVBORw==");
  expect(calls[0][0]).toBe(`https://my-gw.mypinata.cloud/ipfs/${IMG}`);
  expect(calls[0][1].redirect).toBe("error");
  expect(await fetchCardImage(`${IMG}/x`, serve(png, "image/png"))).toBeNull();
  expect(await fetchCardImage(IMG, serve(png, "image/webp"))).toBeNull();
  expect(await fetchCardImage(IMG, serve(new Uint8Array(2 * 1024 * 1024 + 1), "image/png"))).toBeNull();
  const thrown = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  expect(await fetchCardImage(IMG, thrown)).toBeNull();
  vi.unstubAllEnvs();
});

test("pinFile posts the file publicly with the bearer JWT and returns data.cid", async () => {
  let url = "";
  let init: RequestInit = {};
  const fake = async (u: string | URL | Request, i?: RequestInit) => {
    url = String(u);
    init = i ?? {};
    return Response.json({ data: { id: "f1", cid: CID } });
  };
  const cid = await pinFile(new Blob(["x"]), "a.png", "jwt-1", fake as typeof fetch);
  expect(cid).toBe(CID);
  expect(url).toBe("https://uploads.pinata.cloud/v3/files");
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-1");
  const form = init.body as FormData;
  expect(form.get("network")).toBe("public");
  expect((form.get("file") as File).name).toBe("a.png");
});

test("a refused upload throws without the JWT in the message", async () => {
  const jwt = "secret.jwt.value";
  const fake = async () => new Response(`bad token ${jwt}`, { status: 401 });
  const err = await pinFile(new Blob(["x"]), "a.png", jwt, fake as typeof fetch).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("401");
  expect((err as Error).message).not.toContain(jwt);
});

// A real upload: PINATA_LIVE=1 pnpm vitest run apps/web/lib/pinata.test.ts. The CIDs are printed so the
// test pins can be unpinned afterwards.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
test.skipIf(process.env.PINATA_LIVE !== "1")(
  "live: pins a 1x1 PNG and its metadata",
  async () => {
    const jwt = parseEnv(readFileSync(new URL("../../../.env", import.meta.url), "utf8")).pinata_jwt;
    if (!jwt) throw new Error("pinata_jwt missing from the root .env");
    const png = new Blob([Buffer.from(PNG_1X1, "base64")], { type: "image/png" });
    const imageCid = await pinFile(png, "bondr-test-pin.png", jwt);
    const meta = metadataJson(
      { name: "BONDR test pin", symbol: "TESTPIN", description: "", links: {} },
      imageCid,
    );
    const json = new Blob([JSON.stringify(meta)], { type: "application/json" });
    const cid = await pinFile(json, "bondr-test-pin.json", jwt);
    console.log(`test pins: image ${imageCid} metadata ${cid}`);
    expect(checkUri(ipfsUri(cid)).ok).toBe(true);
  },
  60_000,
);
