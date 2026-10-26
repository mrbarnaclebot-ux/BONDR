// The consent proof: nonce expiry (single use is a Postgres row, covered by consent.e2e), the Ed25519 check and the session cookie.
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ADMIN_COOKIE,
  adminCookie,
  adminMessage,
  adminOrigin,
  adminSession,
  adminSignOutCookie,
  adminWalletEnv,
  COOKIE,
  issueNonce,
  pinnedHere,
  pinProof,
  sessionCookie,
  sessionWallet,
  verifyAdmin,
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

const cookieValue = (header: string) => header.split(";")[0]?.slice(header.indexOf("=") + 1) as string;

test("ADMIN_WALLET counts only as a trimmed 32-byte base58 key (D-08 fails closed)", () => {
  const a = account();
  vi.stubEnv("ADMIN_WALLET", "");
  expect(adminWalletEnv()).toBeNull();
  vi.stubEnv("ADMIN_WALLET", "not-a-key");
  expect(adminWalletEnv()).toBeNull();
  vi.stubEnv("ADMIN_WALLET", "1".repeat(40)); // valid alphabet and length, decodes to 40 zero bytes
  expect(adminWalletEnv()).toBeNull();
  vi.stubEnv("ADMIN_WALLET", ` ${a.wallet} `);
  expect(adminWalletEnv()).toBe(a.wallet);
  delete process.env.ADMIN_WALLET;
  expect(adminWalletEnv()).toBeNull();
});

test("an admin sign-in verifies only over the admin message of a live nonce (D-09)", () => {
  const a = account();
  const now = Date.now();
  const n = issueNonce(now);
  const site = "https://bondr.example";
  const text = adminMessage(site)(a.wallet, n.nonce, n.expires);
  expect(text.split("\n")[0]).toBe("bondr.example wants you to sign in with your Solana account:");
  const admin = sign(null, Buffer.from(text), a.key);
  expect(verifyAdmin(site, a.wallet, n.nonce, admin, now)?.toISOString()).toBe(n.expires);
  expect(verifyAdmin("https://evil.example", a.wallet, n.nonce, admin, now)).toBeNull(); // another domain
  expect(verifyAdmin(site, a.wallet, n.nonce, signed(a, n), now)).toBeNull(); // a consent signature
  expect(verifyAdmin(site, a.wallet, n.nonce, admin, now + 5 * 60_000)).toBeNull();
});

test("the admin origin is SITE_URL's, and only a request from it gets one (WR-B-03)", () => {
  const req = (origin: string) => new Request("http://x/api/admin/session", { headers: { origin } });
  vi.stubEnv("SITE_URL", "");
  expect(adminOrigin(req("https://bondr.example"))).toBeNull();
  vi.stubEnv("SITE_URL", "https://bondr.example/");
  expect(adminOrigin(req("https://bondr.example"))).toBe("https://bondr.example");
  expect(adminOrigin(req("https://evil.example"))).toBeNull();
});

test("the admin cookie holds 30 minutes for the configured admin only (D-10)", () => {
  const [a, b] = [account(), account()];
  const now = Date.now();
  const { header, exp } = adminCookie(a.wallet, now);
  expect(exp).toBe(now + 30 * 60_000);
  for (const part of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=1800"])
    expect(header).toContain(part);
  const pair = `x=1; ${ADMIN_COOKIE}=${cookieValue(header)}`;
  expect(adminSession(pair, a.wallet, now)).toEqual({ wallet: a.wallet, exp });
  expect(adminSession(pair, a.wallet, exp)).toBeNull();
  expect(adminSession(pair, b.wallet, now)).toBeNull();
  expect(adminSession(pair, null, now)).toBeNull();
  expect(adminSession(null, a.wallet, now)).toBeNull();
  // A minute before issue the expiry is 31 minutes ahead, past the cap.
  expect(adminSession(pair, a.wallet, now - 60_000)).toBeNull();
  expect(adminSignOutCookie()).toContain("Max-Age=0");
});

test("a public session value under bondr_admin is refused (Pitfall 1)", () => {
  const a = account();
  const now = Date.now();
  const pub = cookieValue(sessionCookie(a.wallet, now));
  expect(adminSession(`${ADMIN_COOKIE}=${pub}`, a.wallet, now)).toBeNull();
  expect(
    adminSession(`${COOKIE}=${cookieValue(adminCookie(a.wallet, now).header)}`, a.wallet, now),
  ).toBeNull();
});
