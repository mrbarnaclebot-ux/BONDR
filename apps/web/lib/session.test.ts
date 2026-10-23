// The consent proof: nonce expiry (single use is a Postgres row, covered by consent.e2e), the Ed25519 check and the session cookie.
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  COOKIE,
  issueNonce,
  pinnedHere,
  pinProof,
  sessionCookie,
  sessionWallet,
  verifyConsent,
} from "./session";
import { consentMessage } from "./terms";

vi.mock("server-only", () => ({}));

beforeEach(() => vi.stubEnv("SESSION_SECRET", "s".repeat(32)));
afterEach(() => vi.unstubAllEnvs());

function account() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const x = createPublicKey(privateKey).export({ format: "jwk" }).x as string;
  return { wallet: bs58.encode(Buffer.from(x, "base64url")), key: privateKey };
}

const signed = (a: ReturnType<typeof account>, n: { nonce: string; expires: string }, wallet = a.wallet) =>
  sign(null, Buffer.from(consentMessage(wallet, n.nonce, n.expires)), a.key);

test("a signed nonce verifies with its expiry, and never after it expires", () => {
  const a = account();
  const now = Date.now();
  const n = issueNonce(now);
  expect(verifyConsent(a.wallet, n.nonce, signed(a, n), now)?.toISOString()).toBe(n.expires);

  const late = issueNonce(now);
  expect(verifyConsent(a.wallet, late.nonce, signed(a, late), now + 5 * 60_000)).toBeNull();
});

test("another wallet's signature, a tampered nonce and another secret all fail", () => {
  const [a, b] = [account(), account()];
  const n = issueNonce();
  expect(verifyConsent(b.wallet, n.nonce, signed(a, n, b.wallet))).toBeNull();
  const forged = `${Date.now() + 60_000}${n.nonce.slice(13)}`;
  expect(verifyConsent(a.wallet, forged, signed(a, { ...n, nonce: forged }))).toBeNull();
  vi.stubEnv("SESSION_SECRET", "t".repeat(32));
  expect(verifyConsent(a.wallet, n.nonce, signed(a, n))).toBeNull();
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  expect(verifyConsent(a.wallet, n.nonce, signed(a, n))).not.toBeNull();
});

test("the session cookie names its wallet until it expires and cannot be edited", () => {
  const now = Date.now();
  const cookie = sessionCookie("Wallet111", now);
  expect(cookie).toMatch(/; HttpOnly; SameSite=Strict$/);
  const pair = cookie.split(";")[0] as string;
  const req = (c: string) => new Request("https://x.test/", { headers: { cookie: `a=1; ${c}` } });
  expect(sessionWallet(req(pair), now)).toBe("Wallet111");
  expect(sessionWallet(req(pair), now + 12 * 60 * 60_000)).toBe(null);
  expect(sessionWallet(req(pair.replace("Wallet111", "Wallet222")), now)).toBe(null);
  expect(sessionWallet(req(`${COOKIE}=nope`), now)).toBe(null);
  expect(sessionWallet(new Request("https://x.test/"), now)).toBe(null);
});

test("without SESSION_SECRET nothing is issued", () => {
  vi.stubEnv("SESSION_SECRET", "");
  expect(() => issueNonce()).toThrow(/SESSION_SECRET/);
});

test("a pin proof holds only for the exact uri and image it was issued for (worker-core WR-06)", () => {
  const [uri, cid] = [`https://ipfs.io/ipfs/${"b".repeat(59)}`, "c".repeat(59)];
  const proof = pinProof(uri, cid);
  expect(pinnedHere(proof, uri, cid)).toBe(true);
  expect(pinnedHere(proof, `${uri}x`, cid)).toBe(false);
  expect(pinnedHere(proof, uri, "d".repeat(59))).toBe(false);
  expect(pinnedHere(undefined, uri, cid)).toBe(false);
  expect(pinnedHere(sessionCookie("w").split(";")[0]?.split("=")[1], uri, cid)).toBe(false);
});
