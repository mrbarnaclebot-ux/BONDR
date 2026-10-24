// The only RPC entry point. The devnet URL carries the Helius key, so it is built here and never logged;
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

function heliusKey(): string {
  if (!process.env.helius_api_key) throw new Error("helius_api_key missing in .env");
  return process.env.helius_api_key;
}

function rpcUrl(net: Net): string {
  if (net === "fork") return process.env.SPIKE_FORK_URL || "http://127.0.0.1:18899";
  return `https://devnet.helius-rpc.com/?api-key=${heliusKey()}`;
}

// Same rules as rpcUrl; Net has no mainnet member, so mainnet cannot be asked for.
export function wsUrl(net: Net): string {
  if (net === "fork") return process.env.SPIKE_FORK_WS_URL || "ws://127.0.0.1:18900";
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

// Devnet must report the devnet genesis. A fork may report mainnet genesis only because its host is local;
// anything else could be a real mainnet endpoint, so it throws before any send. The fork must also be Surfpool.
export async function connect(net: Net): Promise<Connection> {
  const url = rpcUrl(net);
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  if (net === "fork" && !local) throw new Error(redact(`fork RPC must be 127.0.0.1 or localhost: ${url}`));
  const conn = new Connection(url, "confirmed");
  const genesis = await conn.getGenesisHash().catch((e: unknown) => {
    throw new Error(redact(`${net} RPC unreachable: ${String(e)}`));
  });
  const ok = net === "devnet" ? genesis === DEVNET_GENESIS : local && genesis === MAINNET_GENESIS;
  if (!ok) throw new Error(`${net} RPC reported unexpected genesis ${genesis}`);
  if (net === "fork" && !(await isSurfpool(url))) throw new Error("fork RPC does not answer as Surfpool");
  return conn;
}
