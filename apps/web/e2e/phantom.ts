// A fake Phantom for Playwright. It registers through the Wallet Standard window events, the same way the
// extension does (event names confirmed in @wallet-standard/app 1.1.1 lib/esm/wallets.js).
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { Page } from "@playwright/test";
import bs58 from "bs58";

export type TestAccount = { address: string; publicKey: number[] };

/** A fresh Ed25519 key pair; only the public half leaves this function until 02-13 wires signing. */
export function newTestAccount(): TestAccount {
  const { publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return { address: bs58.encode(raw), publicKey: [...raw] };
}

/**
 * playwright.config.ts deliberately keeps the root .env out of the runner (02-02), so specs that check the
 * database read it here. Never copy these values into process.env: the dev server inherits that.
 */
export function rootEnv(): { DATABASE_URL?: string; MASTER_SEED_FILE?: string } {
  const file = fileURLToPath(new URL("../../../.env", import.meta.url));
  const all = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return { DATABASE_URL: all.DATABASE_URL, MASTER_SEED_FILE: all.MASTER_SEED_FILE };
}

/** Marks the address as consented in localStorage, so wallet-only specs skip the consent dialog. */
export async function preConsent(page: Page, address: string): Promise<void> {
  await page.addInitScript((a) => localStorage.setItem(`bondr:consent:${a}`, "1"), address);
}

export async function injectPhantom(page: Page, account: TestAccount): Promise<void> {
  await page.addInitScript(fakePhantom, account);
  await page.addInitScript(registerFake);
}

/** Switches the fake to another account and fires standard:events change, as Phantom does. */
export async function emitChange(page: Page, account: TestAccount): Promise<void> {
  await page.evaluate((a) => (window as unknown as FakeWindow).__fakePhantom.emit(a), account);
}

type FakeWindow = Window & { __fakePhantom: { wallet: unknown; emit(a: TestAccount): void } };

// Init scripts run in the page, so both functions below are self-contained: no imports or outer variables.
function fakePhantom(init: TestAccount): void {
  const chains = ["solana:devnet"];
  const toAccount = (a: TestAccount) => ({
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
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signTransaction: async () => {
          throw new Error("fake Phantom signing is not wired (02-13)");
        },
      },
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

// Both halves of the protocol, so the fake registers whether it loads before or after the app.
function registerFake(): void {
  type Api = { register(w: unknown): void };
  const register = (api: Api) => api.register((window as unknown as FakeWindow).__fakePhantom.wallet);
  window.addEventListener("wallet-standard:app-ready", (e) =>
    register((e as unknown as { detail: Api }).detail),
  );
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}
