// Wallet proof for consent and the launch routes (CR-01, web WR-02). Phantom signs the consent message once;
// web verifies it and sets a short session cookie bound to that wallet. The nonce and the cookie are both
// HMAC-sealed with SESSION_SECRET, so web keeps no session table.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { signatureOk } from "@bondr/core/sig";
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
export function verifyConsent(
  wallet: string,
  nonce: string,
  signature: Uint8Array,
  now = Date.now(),
): Date | null {
  const exp = Number(unseal(nonce)?.split("-")[0]);
  if (!(exp > now)) return null;
  const message = new TextEncoder().encode(consentMessage(wallet, nonce, new Date(exp).toISOString()));
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

/** The browser reopens the consent dialog on this code, which signs in again. */
export const consentRequired = (): Response =>
  Response.json({ error: "consent_required" }, { status: 403, headers: { "cache-control": "no-store" } });
