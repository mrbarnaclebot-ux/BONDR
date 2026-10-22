// A fake Phantom for Playwright. It registers through the Wallet Standard window events, the same way the
// extension does (event names confirmed in @wallet-standard/app 1.1.1 lib/esm/wallets.js).
import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  randomInt,
  sign,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { type APIRequestContext, type Page, test } from "@playwright/test";
import bs58 from "bs58";
import { consentMessage } from "../lib/terms.ts";

/** `key` stays in Node: the page only ever sees the address and the public key. */
export type TestAccount = { address: string; publicKey: number[]; key: KeyObject };
type PageAccount = Omit<TestAccount, "key">;

// A 32-byte Ed25519 seed becomes a private key through this fixed PKCS8 header (RFC 8410).
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export function accountFromSeed(seed: Buffer): TestAccount {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
  const raw = Buffer.from(createPublicKey(key).export({ format: "jwk" }).x as string, "base64url");
  return { address: bs58.encode(raw), publicKey: [...raw], key };
}

export const newTestAccount = (): TestAccount => accountFromSeed(randomBytes(32));

/** The worker's sim dev, derive(seed, "sim", "devnet", "dev") in core/keys.ts, without a Solana import. */
export function simDevAccount(): TestAccount {
  const file = rootEnv().MASTER_SEED_FILE;
  if (!file) throw new Error("needs MASTER_SEED_FILE in the root .env");
  return accountFromSeed(createHmac("sha256", readFileSync(file)).update("sim:devnet:dev").digest());
}

/** Signs slot 0 of a v0 wire over its message bytes, as Phantom does; the count is one shortvec byte. */
export function signWire(b64: string, key: KeyObject): string {
  const wire = Buffer.from(b64, "base64");
  const message = wire.subarray(1 + 64 * (wire[0] as number));
  sign(null, message, key).copy(wire, 1);
  return wire.toString("base64");
}

/**
 * playwright.config.ts deliberately keeps the root .env out of the runner (02-02), so specs that check the
 * database read it here. Never copy these values into process.env: the dev server inherits that.
 */
export function rootEnv(): {
  DATABASE_URL?: string;
  MASTER_SEED_FILE?: string;
  SESSION_SECRET?: string;
  WORKER_URL?: string;
  WORKER_TOKEN?: string;
} {
  const file = fileURLToPath(new URL("../../../.env", import.meta.url));
  const all = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const { DATABASE_URL, MASTER_SEED_FILE, SESSION_SECRET, WORKER_URL, WORKER_TOKEN } = all;
  return { DATABASE_URL, MASTER_SEED_FILE, SESSION_SECRET, WORKER_URL, WORKER_TOKEN };
}

/**
 * Answers the browser's session read with this address, so the consent dialog stays shut. The server still
 * has no session: fit only for specs whose pin, prepare and submit are stubbed. Others use signIn.
 */
export async function preConsent(page: Page, address: string): Promise<void> {
  await page.route("**/api/consent", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ json: { wallet: address, nonce: "n", expires: new Date().toISOString() } })
      : r.fallback(),
  );
}

/**
 * The real consent through the API: a nonce, the account's signature over the consent message, then the
 * POST. The session cookie lands in `request`'s cookie jar (page.request shares the page's). Writes a
 * wallets row the spec must delete. Its own client IP keeps the consent rate limit per call.
 */
export async function signIn(request: APIRequestContext, account: TestAccount) {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
  const headers = { origin: new URL(test.info().project.use.baseURL as string).origin, "x-real-ip": ip };
  const { nonce, expires } = await (await request.get("/api/consent", { headers })).json();
  const message = Buffer.from(consentMessage(account.address, nonce, expires));
  const signature = sign(null, message, account.key).toString("base64");
  return request.post("/api/consent", { headers, data: { wallet: account.address, nonce, signature } });
}

const pageAccount = ({ address, publicKey }: TestAccount): PageAccount => ({ address, publicKey });

/**
 * `reject` makes signTransaction and signMessage refuse with code 4001, as Phantom does on Cancel.
 * `messages` collects every message the page asked the account to sign, across reloads.
 */
export async function injectPhantom(page: Page, account: TestAccount, o: { reject?: boolean } = {}) {
  const messages: string[] = [];
  await page.exposeFunction("bondrSign", (b64: string) => signWire(b64, account.key));
  await page.exposeFunction("bondrSignMessage", (b64: string) => {
    const message = Buffer.from(b64, "base64");
    messages.push(message.toString("utf8"));
    return sign(null, message, account.key).toString("base64");
  });
  await page.addInitScript(fakePhantom, pageAccount(account));
  await page.addInitScript(fakeSign, !!o.reject);
  await page.addInitScript(registerFake);
  return { messages };
}

/** Switches the fake to another account and fires standard:events change, as Phantom does. */
export async function emitChange(page: Page, account: TestAccount): Promise<void> {
  await page.evaluate((a) => (window as unknown as FakeWindow).__fakePhantom.emit(a), pageAccount(account));
}

type FakeWindow = Window & {
  __fakePhantom: { wallet: unknown; emit(a: PageAccount): void };
  bondrSign(b64: string): Promise<string>;
  bondrSignMessage(b64: string): Promise<string>;
};

// Init scripts run in the page, so the functions below are self-contained: no imports or outer variables.
function fakePhantom(init: PageAccount): void {
  const chains = ["solana:devnet"];
  const toAccount = (a: PageAccount) => ({
    ...a,
    publicKey: new Uint8Array(a.publicKey),
    chains,
    features: [],
  });
  const listeners = new Set<(p: unknown) => void>();
  let current = toAccount(init);
  const wallet = {
    version: "1.0.0",
    name: "Phantom",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains,
    accounts: [] as unknown[],
    features: {
      "standard:connect": {
        version: "1.0.0",
        // Silent connect succeeds only while already connected, like an untrusted first visit.
        connect: async (input?: { silent?: boolean }) => {
          if (!input?.silent || wallet.accounts.length) wallet.accounts = [current];
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          wallet.accounts = [];
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (_event: string, cb: (p: unknown) => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      },
      // Replaced by fakeSign, a separate init script that keeps this function short.
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: [0] },
    },
  };
  (window as unknown as FakeWindow).__fakePhantom = {
    wallet,
    emit(a) {
      current = toAccount(a);
      wallet.accounts = [current];
      for (const cb of listeners) cb({ accounts: wallet.accounts });
    },
  };
}

// Bytes cross to Node as base64, where the account's key signs (exposeFunction in injectPhantom). Phantom's
// signMessage returns the raw 64-byte Ed25519 signature over the message bytes, as this does.
function fakeSign(reject: boolean): void {
  const w = window as unknown as FakeWindow;
  const features = (w.__fakePhantom.wallet as { features: Record<string, object> }).features;
  features["solana:signTransaction"] = {
    version: "1.0.0",
    supportedTransactionVersions: [0],
    signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
      if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      const out = [];
      for (const { transaction } of inputs) {
        const signed = await w.bondrSign(btoa(String.fromCharCode(...transaction)));
        out.push({ signedTransaction: Uint8Array.from(atob(signed), (c) => c.charCodeAt(0)) });
      }
      return out;
    },
  };
  features["solana:signMessage"] = {
    version: "1.0.0",
    signMessage: async (...inputs: { message: Uint8Array }[]) => {
      if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      const out = [];
      for (const { message } of inputs) {
        const sig = await w.bondrSignMessage(btoa(String.fromCharCode(...message)));
        out.push({ signedMessage: message, signature: Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)) });
      }
      return out;
    },
  };
}

// Both halves of the protocol, so the fake registers whether it loads before or after the app.
function registerFake(): void {
  type Api = { register(w: unknown): void };
  const register = (api: Api) => api.register((window as unknown as FakeWindow).__fakePhantom.wallet);
  window.addEventListener("wallet-standard:app-ready", (e) =>
    register((e as unknown as { detail: Api }).detail),
  );
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}
