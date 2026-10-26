// The admin env names (D-08, A2): an unset or invalid ADMIN_WALLET closes the door instead of failing boot;
// ADMIN_EVACUATE refuses anything but simulate or on.
import { Keypair } from "@solana/web3.js";
import { expect, test } from "vitest";
import { loadEnv } from "./env.ts";

const ADMIN = Keypair.generate().publicKey.toBase58();
const base = {
  SOLANA_NET: "devnet",
  WORKER_TOKEN: "t".repeat(32),
  VANITY_LANE: "local",
  BONDR_QUOTE_MINT: Keypair.generate().publicKey.toBase58(),
  MASTER_SEED: Buffer.alloc(32, 7).toString("base64"),
};
const load = (extra: Record<string, string | undefined> = {}) => loadEnv({ ...base, ...extra });

test("ADMIN_WALLET unset, empty or invalid gives null; a valid key comes back trimmed", () => {
  expect(load().adminWallet).toBeNull();
  expect(load({ ADMIN_WALLET: "" }).adminWallet).toBeNull();
  expect(load({ ADMIN_WALLET: "bad" }).adminWallet).toBeNull();
  expect(load({ ADMIN_WALLET: `  ${ADMIN} ` }).adminWallet).toBe(ADMIN);
});

test("ADMIN_EVACUATE defaults to simulate, takes on, and refuses anything else", () => {
  expect(load().adminEvacuate).toBe("simulate");
  expect(load({ ADMIN_EVACUATE: "on" }).adminEvacuate).toBe("on");
  expect(() => load({ ADMIN_EVACUATE: "yes" })).toThrow("ADMIN_EVACUATE");
});

test("SENTRY_READ_TOKEN unset gives null", () => {
  expect(load().sentryReadToken).toBeNull();
  expect(load({ SENTRY_READ_TOKEN: " tok " }).sentryReadToken).toBe("tok");
});

test("SITE_URL gives its origin; unset or not a URL gives null (WR-B-03)", () => {
  expect(load({ SITE_URL: " https://trybondr.fun/admin " }).siteUrl).toBe("https://trybondr.fun");
  expect(load().siteUrl).toBeNull();
  expect(load({ SITE_URL: "trybondr.fun" }).siteUrl).toBeNull();
});
