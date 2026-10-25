// Wallet proof for consent and the launch routes (CR-01, web WR-02). Phantom signs the consent message once;
// web verifies it and sets a short session cookie bound to that wallet. The nonce and the cookie are both
// HMAC-sealed with SESSION_SECRET, so web keeps no session table.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { signatureOk } from "@bondr/core/sig";
import bs58 from "bs58";
import { BASE58_KEY } from "./guard";
import { consentMessage } from "./terms";

export const COOKIE = "bondr_session";
const SESSION_MS = 12 * 60 * 60_000;
const NONCE_MS = 5 * 60_000;

function mac(value: string): string {
  const secret = process.env.SESSION_SECRET;
  // Fails closed: without the secret no nonce or session is issued or accepted.
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not set (32+ characters)");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

const seal = (value: string): string => `${value}.${mac(value)}`;

function sameMac(given: string, value: string): boolean {
  const [a, b] = [Buffer.from(given), Buffer.from(mac(value))];
  return a.length === b.length && timingSafeEqual(a, b);
}

function unseal(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const value = token.slice(0, dot);
  return sameMac(token.slice(dot + 1), value) ? value : null;
}

// A JSON array, so no uri and image pair can read as another, and no session value can pass for a proof.
const pinned = (uri: string, imageCid: string): string => JSON.stringify(["pin", uri, imageCid]);

/** Returned by the pin route: proof that BONDR pinned this metadata JSON and image (worker-core WR-06). */
export const pinProof = (uri: string, imageCid: string): string => mac(pinned(uri, imageCid));

/** Prepare accepts only a uri and image the pin route built, so no hand-pinned JSON reaches the chain. */
export const pinnedHere = (proof: unknown, uri: unknown, imageCid: unknown): boolean =>
  typeof proof === "string" &&
  typeof uri === "string" &&
  typeof imageCid === "string" &&
  sameMac(proof, pinned(uri, imageCid));

/** A fresh consent nonce. Stateless: its expiry is inside the sealed value. */
export function issueNonce(now = Date.now()): { nonce: string; expires: string } {
  const exp = now + NONCE_MS;
  return { nonce: seal(`${exp}-${randomBytes(12).toString("hex")}`), expires: new Date(exp).toISOString() };
}

/**
 * The nonce's expiry when signature is the wallet's signature over the consent message of a live nonce, else
 * null. Single use is the caller's job: it spends the nonce in Postgres, so a restart cannot forget it.
 */
export const verifyConsent = (wallet: string, nonce: string, signature: Uint8Array, now = Date.now()) =>
  verifySigned(consentMessage, wallet, nonce, signature, now);

type MessageOf = (wallet: string, nonce: string, expires: string) => string;

function verifySigned(text: MessageOf, wallet: string, nonce: string, signature: Uint8Array, now: number) {
  const exp = Number(unseal(nonce)?.split("-")[0]);
  if (!(exp > now)) return null;
  const message = new TextEncoder().encode(text(wallet, nonce, new Date(exp).toISOString()));
  return signatureOk(message, signature, wallet) ? new Date(exp) : null;
}

/** Set-Cookie for a session bound to wallet. Secure only in production, where web is served over https. */
export function sessionCookie(wallet: string, now = Date.now()): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const value = seal(`${wallet}-${now + SESSION_MS}`);
  return `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secure}`;
}

/** The wallet this browser proved at consent, or null when it has no live session. */
export function sessionWallet(req: Request, now = Date.now()): string | null {
  const pair = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`));
  const [wallet, exp] = unseal(pair?.slice(COOKIE.length + 1) ?? "")?.split("-") ?? [];
  return wallet && Number(exp) > now ? wallet : null;
}

export const ADMIN_COOKIE = "bondr_admin";
const ADMIN_MS = 30 * 60_000;

/** The owner's address from ADMIN_WALLET, or null when unset or not a 32-byte key: admin then stays closed (D-08). */
export function adminWalletEnv(): string | null {
  const key = process.env.ADMIN_WALLET?.trim() ?? "";
  return BASE58_KEY.test(key) && bs58.decode(key).length === 32 ? key : null;
}

// The first line separates it from the consent message, so a consent signature never signs anyone in (D-09).
export const adminMessage: MessageOf = (wallet, nonce, expires) =>
  [
    "BONDR admin sign-in",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Expires: ${expires}`,
    "",
    "Signing this message is not a transaction and costs nothing.",
  ].join("\n");

/** Like verifyConsent, over the admin message. The nonce is spent in consent_nonces by the caller. */
export const verifyAdmin = (wallet: string, nonce: string, signature: Uint8Array, now = Date.now()) =>
  verifySigned(adminMessage, wallet, nonce, signature, now);

/** Set-Cookie for 30 minutes, never renewed (D-10). */
export function adminCookie(wallet: string, now = Date.now()): { header: string; exp: number } {
  const exp = now + ADMIN_MS;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  // The tag keeps the owner's 12-hour public session value, sealed with the same secret, from passing here.
  const value = seal(`admin-${wallet}-${exp}`);
  return {
    header: `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${ADMIN_MS / 1000}; HttpOnly; SameSite=Strict${secure}`,
    exp,
  };
}

export const adminSignOutCookie = (): string =>
  `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;

/** The admin session in a Cookie header, or null unless it is live, tagged and names the configured admin. */
export function adminSession(cookie: string | null, admin: string | null, now = Date.now()) {
  const raw = cookie
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  const [tag, wallet, exp] = unseal(raw ?? "")?.split("-") ?? [];
  const e = Number(exp);
  const live = e > now && e - now <= ADMIN_MS;
  return tag === "admin" && admin && wallet === admin && live ? { wallet, exp: e } : null;
}

/** The browser reopens the consent dialog on this code, which signs in again. */
export const consentRequired = (): Response =>
  Response.json({ error: "consent_required" }, { status: 403, headers: { "cache-control": "no-store" } });
