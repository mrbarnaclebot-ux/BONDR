// The only RPC entry point. The Helius URLs carry the key, so it is built here and never logged;
// every error leaving this file goes through redact().
import { Connection } from "@solana/web3.js";
import type { Net } from "./keys.ts";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function redact(text: string): string {
  const key = process.env.helius_api_key;
  const out = key ? text.replaceAll(key, "<redacted>") : text;
  return out.replace(/api-key=[^&\s"']*/gi, "api-key=<redacted>");
}

// The one place the key is read (D-02); callers that put it in a URL never log that URL.
export function heliusKey(): string {
  if (!process.env.helius_api_key) throw new Error("helius_api_key missing in .env");
  return process.env.helius_api_key;
}

// One Helius key serves devnet and mainnet (D-12); the fork is the local Surfpool.
function rpcUrl(net: Net): string {
  if (net === "fork") return process.env.SPIKE_FORK_URL || "http://127.0.0.1:18899";
  if (net === "mainnet") return `https://mainnet.helius-rpc.com/?api-key=${heliusKey()}`;
  return `https://devnet.helius-rpc.com/?api-key=${heliusKey()}`;
}

// Same rules as rpcUrl. Mainnet is reachable only once the worker passed its double flag (env.ts launchNet).
export function wsUrl(net: Net): string {
  if (net === "fork") return process.env.SPIKE_FORK_WS_URL || "ws://127.0.0.1:18900";
  if (net === "mainnet") return `wss://mainnet.helius-rpc.com/?api-key=${heliusKey()}`;
  return `wss://devnet.helius-rpc.com/?api-key=${heliusKey()}`;
}

// A local tunnel to a real mainnet RPC passes the host and genesis checks; only Surfpool answers its own
// cheatcode namespace. surfnet_getLocalSignatures is read-only (surfpool v1.6.1, surfnet_cheatcodes.rs).
async function isSurfpool(url: string): Promise<boolean> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "surfnet_getLocalSignatures", params: [1] });
  const headers = { "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body }).catch(() => undefined);
  const json = (await res?.json().catch(() => undefined)) as { result?: unknown } | undefined;
  return json?.result !== undefined;
}

// Devnet must report the devnet genesis. Mainnet genesis means the fork when the host is local (it must also be
// Surfpool) and real mainnet only from a remote host: a local host claiming mainnet is a fork or a tunnel (D-03).
// opts.fetch lets the worker time every RPC call (06-08 rpc-stats).
export async function connect(net: Net, opts: { fetch?: typeof fetch } = {}): Promise<Connection> {
  const url = rpcUrl(net);
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  if (net === "fork" && !local) throw new Error(redact(`fork RPC must be 127.0.0.1 or localhost: ${url}`));
  if (net === "mainnet" && local) throw new Error(redact(`mainnet RPC must not be a local host: ${url}`));
  const conn = new Connection(url, { commitment: "confirmed", fetch: opts.fetch });
  const genesis = await conn.getGenesisHash().catch((e: unknown) => {
    throw new Error(redact(`${net} RPC unreachable: ${String(e)}`));
  });
  const ok =
    net === "devnet" ? genesis === DEVNET_GENESIS : local === (net === "fork") && genesis === MAINNET_GENESIS;
  if (!ok) throw new Error(`${net} RPC reported unexpected genesis ${genesis}`);
  if (net === "fork" && !(await isSurfpool(url))) throw new Error("fork RPC does not answer as Surfpool");
  return conn;
}
