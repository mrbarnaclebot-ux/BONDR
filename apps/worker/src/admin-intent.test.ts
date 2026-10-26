import { createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import bs58 from "bs58";
import { expect, test } from "vitest";
import { consentMessage } from "../../web/lib/terms.ts";
import {
  INTENT_KEEP_MS,
  INTENT_MAX,
  INTENT_TTL_MS,
  intentMessage,
  putIntent,
  take,
  updateIntent,
  viewIntent,
} from "./admin-intent.ts";
import { Fail } from "./http.ts";

function account() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const x = createPublicKey(privateKey).export({ format: "jwk" }).x as string;
  return { wallet: bs58.encode(Buffer.from(x, "base64url")), key: privateKey };
}
const admin = account();
const signText = (text: string, key: KeyObject = admin.key) =>
  new Uint8Array(sign(null, Buffer.from(text), key));

const SITE = "https://trybondr.fun";
const fields = (mint: string | null = "Mint1111") => ({
  action: "finalize_split" as const,
  mint,
  to: ["Treasury", "Deployer 7xKX..."],
  data: null,
  site: SITE,
  wallet: admin.wallet,
});
const where = { site: SITE, wallet: admin.wallet };

// The contract error a refused take answers with, or "ok".
function outcome(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof Fail) return `${e.body.error} ${e.status}`;
    throw e;
  }
}

test("the message names the site, the owner, the action, the coin, the intent, the destinations and the expiry", () => {
  const a = intentMessage({
    ...{ action: "finalize_split", coin: "MintA", id: "abc", to: ["Treasury", "Buyback"], expiresAt: 0 },
    ...where,
  });
  const lines = a.split("\n");
  // WR-B-03: the SIWS-style domain line and URI, as the web's admin sign-in has them.
  expect(lines.slice(0, 2)).toEqual([
    "trybondr.fun wants you to sign in with your Solana account:",
    admin.wallet,
  ]);
  expect(lines).toContain(`URI: ${SITE}`);
  for (const part of [
    "Action: finalize_split",
    "Coin: MintA",
    "Intent: abc",
    "Treasury, Buyback",
    "Expiration Time: 1970-01-01T00:00:00.000Z",
  ])
    expect(a).toContain(part);
  const b = intentMessage({
    ...{ action: "finalize_split", coin: "MintB", id: "abc", to: ["Treasury", "Buyback"], expiresAt: 0 },
    ...where,
  });
  expect(b).not.toBe(a);
  expect(
    intentMessage({ ...{ action: "burn_buyback", coin: null, id: "x", to: [], expiresAt: 0 }, ...where }),
  ).toContain("Coin: platform\nIntent: x\nDestinations: burn only");
});

test("put stores the worker's own text with a 2 minute expiry", () => {
  const e = putIntent(fields(), 1_000);
  expect(e.id).toMatch(/^[0-9a-f]{32}$/);
  expect(e.expiresAt).toBe(1_000 + INTENT_TTL_MS);
  expect(e.message).toBe(
    intentMessage({
      action: e.action,
      coin: "Mint1111",
      id: e.id,
      to: fields().to,
      expiresAt: e.expiresAt,
      ...where,
    }),
  );
  expect(e.state).toBe("simulated");
  expect(e.used).toBe(false);
});

test("the admin's signature over the stored text takes the intent once", () => {
  const e = putIntent(fields(), 0);
  const sig = signText(e.message);
  expect(take(e.id, sig, admin.wallet, 1).used).toBe(true);
  expect(outcome(() => take(e.id, sig, admin.wallet, 2))).toBe("intent_used 409");
});

test("another key's signature is refused and does not burn the intent", () => {
  const e = putIntent(fields(), 0);
  expect(outcome(() => take(e.id, signText(e.message, account().key), admin.wallet, 1))).toBe(
    "bad_intent_signature 403",
  );
  expect(outcome(() => take(e.id, signText(e.message), admin.wallet, 2))).toBe("ok");
});

test("a signature over text that differs by one character is refused", () => {
  const e = putIntent(fields(), 0);
  const tampered = e.message.replace("Coin: Mint1111", "Coin: Mint1112");
  expect(tampered).not.toBe(e.message);
  expect(outcome(() => take(e.id, signText(tampered), admin.wallet, 1))).toBe("bad_intent_signature 403");
});

test("an expired or unknown intent answers intent_expired", () => {
  const e = putIntent(fields(), 0);
  expect(outcome(() => take(e.id, signText(e.message), admin.wallet, e.expiresAt))).toBe(
    "intent_expired 410",
  );
  expect(outcome(() => take("f".repeat(32), signText(e.message), admin.wallet, 1))).toBe(
    "intent_expired 410",
  );
});

test("a consent or admin sign-in signature is never an intent (domain separation)", () => {
  const e = putIntent(fields(), 0);
  const consent = consentMessage(admin.wallet, "n", "2026-01-01T00:00:00.000Z");
  // The web's adminMessage (apps/web/lib/session.ts, server-only so not importable here), same site, nonce and
  // expiry: only the statement line tells them apart.
  const signIn = [
    "trybondr.fun wants you to sign in with your Solana account:",
    admin.wallet,
    "",
    "BONDR admin sign-in. Signing this message is not a transaction and costs nothing.",
    "",
    `URI: ${SITE}`,
    `Nonce: ${e.id}`,
    `Expiration Time: ${new Date(e.expiresAt).toISOString()}`,
  ].join("\n");
  for (const text of [consent, signIn])
    expect(outcome(() => take(e.id, signText(text), admin.wallet, 1))).toBe("bad_intent_signature 403");
});

test("an executed intent stays viewable for 10 minutes, an unused one is swept after 2", () => {
  const e = putIntent(fields(), 0);
  expect(viewIntent(e.id, 1)).toBeNull(); // nothing to poll before execute
  take(e.id, signText(e.message), admin.wallet, 1_000);
  updateIntent(e.id, { state: "landed", sigs: ["s1"], landed: 1, total: 1 }, 1_000);
  expect(viewIntent(e.id, 1_000 + INTENT_KEEP_MS - 1)).toEqual({
    id: e.id,
    state: "landed",
    sigs: ["s1"],
    landed: 1,
    total: 1,
  });
  expect(viewIntent(e.id, 1_000 + INTENT_KEEP_MS)).toBeNull();

  const old = putIntent(fields(), 5_000_000);
  putIntent(fields(), 5_000_000 + INTENT_TTL_MS);
  expect(outcome(() => take(old.id, signText(old.message), admin.wallet, 5_000_000))).toBe(
    "intent_expired 410",
  );
});

// Each case starts far after the last one, so the sweep empties the module store first.
const zero = new Uint8Array(64);
const state = (id: string, t: number) => outcome(() => take(id, zero, admin.wallet, t));
const fill = (n: number, t: number) => Array.from({ length: n }, () => putIntent(fields(), t));

test("a store full of live unused intents answers 429 rate_limited and evicts nothing (IN-W-04)", () => {
  const t = 9_000_000;
  const all = fill(INTENT_MAX, t);
  expect(outcome(() => putIntent(fields(), t))).toBe("rate_limited 429");
  for (const e of [all[0], all.at(-1)]) expect(state(e?.id as string, t)).toBe("bad_intent_signature 403");
});

test("a full store evicts the oldest executed intent, and live unused ones survive", () => {
  const t = 20_000_000;
  const [oldest, done, ...rest] = fill(INTENT_MAX, t);
  take(done?.id as string, signText(done?.message as string), admin.wallet, t);
  const added = putIntent(fields(), t);
  expect(state(done?.id as string, t)).toBe("intent_expired 410");
  for (const e of [oldest, rest.at(-1), added])
    expect(state(e?.id as string, t)).toBe("bad_intent_signature 403");
});

test("expired intents are swept before an executed one is evicted", () => {
  const t = 40_000_000;
  const [done] = fill(1, t);
  take(done?.id as string, signText(done?.message as string), admin.wallet, t);
  fill(INTENT_MAX - 2, t);
  const [late] = fill(1, t + 1);
  putIntent(fields(), t + INTENT_TTL_MS); // the INTENT_MAX - 2 from t have expired
  expect(state(done?.id as string, t + INTENT_TTL_MS)).toBe("intent_used 409");
  expect(state(late?.id as string, t + INTENT_TTL_MS)).toBe("bad_intent_signature 403");
});
