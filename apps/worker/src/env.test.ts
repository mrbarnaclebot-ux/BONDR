// The admin env names (D-08, A2): an unset or invalid ADMIN_WALLET closes the door instead of failing boot;
// ADMIN_EVACUATE refuses anything but simulate or on.
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect, test } from "vitest";
import { buyback, evacuateAllowed, loadEnv, ops, treasury } from "./env.ts";

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

const TREASURY = Keypair.generate().publicKey.toBase58();
const main = (extra: Record<string, string | undefined> = {}) =>
  load({ SOLANA_NET: "mainnet", ALLOW_MAINNET: "1", TREASURY_PUBKEY: TREASURY, ...extra });

test("mainnet needs ALLOW_MAINNET=1; fork and unknown nets still refuse (D-01)", () => {
  expect(() => main({ ALLOW_MAINNET: undefined })).toThrow("ALLOW_MAINNET");
  expect(() => main({ ALLOW_MAINNET: "true" })).toThrow("ALLOW_MAINNET");
  expect(() => load({ SOLANA_NET: "fork", ALLOW_MAINNET: "1" })).toThrow(
    "SOLANA_NET must be devnet or mainnet",
  );
  expect(() => load({ SOLANA_NET: undefined })).toThrow("SOLANA_NET");
});

test("mainnet with both flags takes TREASURY_PUBKEY as an external treasury (D-10)", () => {
  const e = main({ TREASURY_PUBKEY: ` ${TREASURY} ` });
  expect(e.net).toBe("mainnet");
  expect(e.treasury.toBase58()).toBe(TREASURY);
  expect(e.treasuryExternal).toBe(true);
});

test("mainnet refuses a missing, malformed, off-curve or derivable TREASURY_PUBKEY without echoing it", () => {
  const seed = Buffer.from(base.MASTER_SEED, "base64");
  const pda = PublicKey.findProgramAddressSync([Buffer.from("t")], SystemProgram.programId)[0].toBase58();
  const bad = [
    "",
    "not-base58-0OIl",
    `${TREASURY}x`,
    pda,
    ops(seed, "mainnet").publicKey.toBase58(),
    buyback(seed, "mainnet", "local").publicKey.toBase58(),
    treasury(seed, "mainnet").publicKey.toBase58(),
  ];
  for (const v of bad) {
    let msg = "";
    try {
      main({ TREASURY_PUBKEY: v });
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toContain("TREASURY_PUBKEY");
    if (v) expect(msg).not.toContain(v);
  }
  expect(() => main({ TREASURY_PUBKEY: undefined })).toThrow("TREASURY_PUBKEY");
});

test("devnet ignores TREASURY_PUBKEY and keeps the derived treasury", () => {
  const e = load({ TREASURY_PUBKEY: TREASURY });
  expect(e.treasury.toBase58()).toBe(
    treasury(Buffer.from(base.MASTER_SEED, "base64"), "devnet").publicKey.toBase58(),
  );
  expect(e.treasuryExternal).toBe(false);
});

test("EVACUATE on: devnet, or mainnet with the external treasury; nothing else (D-37)", () => {
  expect(evacuateAllowed("devnet", false)).toBe(true);
  expect(evacuateAllowed("mainnet", true)).toBe(true);
  expect(evacuateAllowed("mainnet", false)).toBe(false);
  expect(evacuateAllowed("fork", true)).toBe(false);
  expect(main({ ADMIN_EVACUATE: "on" }).adminEvacuate).toBe("on");
  expect(main().adminEvacuate).toBe("simulate");
});

test("VANITY_LANE takes production and refuses anything else (D-11)", () => {
  expect(load({ VANITY_LANE: "production" }).lane).toBe("production");
  expect(() => load({ VANITY_LANE: "prod" })).toThrow("VANITY_LANE");
});

test("BONDR_QUOTE_MINT unset is genesis mode on mainnet (null) and refused on devnet (D-29)", () => {
  expect(main({ BONDR_QUOTE_MINT: undefined }).quoteMint).toBeNull();
  expect(main({ BONDR_QUOTE_MINT: " " }).quoteMint).toBeNull();
  expect(() => load({ BONDR_QUOTE_MINT: undefined })).toThrow("BONDR_QUOTE_MINT");
  expect(() => main({ BONDR_QUOTE_MINT: "bad" })).toThrow("BONDR_QUOTE_MINT");
  expect(main().quoteMint?.toBase58()).toBe(base.BONDR_QUOTE_MINT);
});
