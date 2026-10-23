import { expect, test } from "vitest";
import {
  checkDescription,
  checkDevBuy,
  checkImage,
  checkName,
  checkSymbol,
  checkUri,
  imageType,
  MAX_IMAGE_BYTES,
  normalizeLink,
  parseSol,
} from "./rules.ts";

test("checkName trims and counts UTF-8 bytes, not characters", () => {
  expect(checkName("  Bondr  ")).toEqual({ ok: true, value: "Bondr" });
  expect(checkName("   ")).toEqual({ ok: false, code: "required" });
  expect(checkName("a".repeat(32))).toEqual({ ok: true, value: "a".repeat(32) });
  expect(checkName("a".repeat(33))).toEqual({ ok: false, code: "too_long", n: 33 });
  expect(checkName("é".repeat(17))).toEqual({ ok: false, code: "too_long", n: 34 });
});

test("checkSymbol trims, uppercases and allows A-Z and 0-9 up to 13", () => {
  expect(checkSymbol("bnd1")).toEqual({ ok: true, value: "BND1" });
  expect(checkSymbol("BND-R")).toEqual({ ok: false, code: "charset" });
  expect(checkSymbol("A".repeat(14))).toEqual({ ok: false, code: "too_long", n: 14 });
  expect(checkSymbol("")).toEqual({ ok: false, code: "required" });
});

test("checkDescription is optional and at most 500 characters", () => {
  expect(checkDescription("a".repeat(500)).ok).toBe(true);
  expect(checkDescription("a".repeat(501))).toEqual({ ok: false, code: "too_long", n: 501 });
  expect(checkDescription("")).toEqual({ ok: true, value: "" });
});

test("normalizeLink adds https, checks the host per kind and refuses other schemes", () => {
  expect(normalizeLink("x", "x.com/coin")).toEqual({ ok: true, value: "https://x.com/coin" });
  expect(normalizeLink("x", "twitter.com/coin")).toEqual({ ok: true, value: "https://twitter.com/coin" });
  expect(normalizeLink("x", "t.me/coin").ok).toBe(false);
  expect(normalizeLink("x", "x.com").ok).toBe(false);
  expect(normalizeLink("telegram", "t.me/c")).toEqual({ ok: true, value: "https://t.me/c" });
  expect(normalizeLink("website", "coin.xyz")).toEqual({ ok: true, value: "https://coin.xyz" });
  expect(normalizeLink("website", "http://coin.xyz/a")).toEqual({ ok: true, value: "https://coin.xyz/a" });
  expect(normalizeLink("website", "javascript:alert(1)").ok).toBe(false);
  expect(normalizeLink("website", "ftp://a").ok).toBe(false);
  expect(normalizeLink("website", "https://user:pw@coin.xyz").ok).toBe(false);
  expect(normalizeLink("website", "localhost").ok).toBe(false);
  expect(normalizeLink("website", "  ")).toEqual({ ok: true, value: undefined });
});

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

test("imageType reads magic bytes and refuses SVG", () => {
  expect(imageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("png");
  expect(imageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
  expect(imageType(ascii("GIF89a"))).toBe("gif");
  expect(imageType(ascii("RIFF\x00\x00\x00\x00WEBPVP8 "))).toBe("webp");
  expect(imageType(ascii("RIFF\x00\x00\x00\x00WAVE"))).toBe(null);
  expect(imageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(null);
  expect(imageType(bytes())).toBe(null);
});

test("checkImage refuses over 4 MB and unknown types", () => {
  const png = bytes(0x89, 0x50, 0x4e, 0x47);
  expect(checkImage(png, MAX_IMAGE_BYTES)).toEqual({ ok: true, value: "png" });
  expect(checkImage(png, 5 * 1024 * 1024)).toEqual({ ok: false, code: "too_big", mb: 5 });
  expect(checkImage(ascii("<svg"), 10)).toEqual({ ok: false, code: "type" });
});

test("checkUri accepts only ipfs.io or a Pinata dedicated gateway, up to 200 characters", () => {
  const cid = `bafkrei${"a".repeat(52)}`;
  expect(cid.length).toBe(59);
  expect(checkUri(`https://ipfs.io/ipfs/${cid}`).ok).toBe(true);
  expect(checkUri(`https://some-name-123.mypinata.cloud/ipfs/${cid}`).ok).toBe(true);
  expect(checkUri(`https://evil.com/x.mypinata.cloud/ipfs/${cid}`).ok).toBe(false);
  expect(checkUri(`https://a.mypinata.cloud.evil.com/ipfs/${cid}`).ok).toBe(false);
  expect(checkUri(`http://ipfs.io/ipfs/${cid}`).ok).toBe(false);
  expect(checkUri(`https://gateway.pinata.cloud/ipfs/${cid}`).ok).toBe(false);
  expect(checkUri(`https://ipfs.io/ipfs/${"a".repeat(180)}`).ok).toBe(false);
  expect(checkUri("https://ipfs.io/ipfs/").ok).toBe(false);
  expect(checkUri("https://ipfs.io/ipfs/a/../../x").ok).toBe(false);
});

test("parseSol reads up to 9 decimals into lamports", () => {
  expect(parseSol("0.25")).toEqual({ ok: true, value: 250_000_000n });
  expect(parseSol("1")).toEqual({ ok: true, value: 1_000_000_000n });
  expect(parseSol(" 0.000000001 ")).toEqual({ ok: true, value: 1n });
  for (const bad of ["0.0000000001", "abc", "", "-1", ".5", "1e3", "1.", "0x10"])
    expect(parseSol(bad)).toEqual({ ok: false, code: "nan" });
});

test("checkDevBuy refuses below the live minimum", () => {
  expect(checkDevBuy(2_499_999n, 2_500_000n)).toEqual({ ok: false, code: "below_min" });
  expect(checkDevBuy(2_500_000n, 2_500_000n)).toEqual({ ok: true, value: 2_500_000n });
});
