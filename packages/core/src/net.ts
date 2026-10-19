// The only RPC entry point. The devnet URL carries the Helius key, so it is built here and never logged;
// every error leaving this file goes through redact().
import { Connection } from "@solana/web3.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function redact(text: string): string {
  const key = process.env.helius_api_key;
  const out = key ? text.replaceAll(key, "<redacted>") : text;
  return out.replace(/api-key=[^&\s"']*/gi, "api-key=<redacted>");
}

function rpcUrl(net: "devnet" | "fork"): string {
  if (net === "fork") return process.env.SPIKE_FORK_URL || "http://127.0.0.1:18899";
  if (!process.env.helius_api_key) throw new Error("helius_api_key missing in .env");
  return `https://devnet.helius-rpc.com/?api-key=${process.env.helius_api_key}`;
}

// Devnet must report the devnet genesis. A fork may report mainnet genesis only because its host is local;
// anything else could be a real mainnet endpoint, so it throws before any send.
export async function connect(net: "devnet" | "fork"): Promise<Connection> {
  const url = rpcUrl(net);
  const local = LOCAL_HOSTS.has(new URL(url).hostname);
  if (net === "fork" && !local) throw new Error(redact(`fork RPC must be 127.0.0.1 or localhost: ${url}`));
  const conn = new Connection(url, "confirmed");
  const genesis = await conn.getGenesisHash().catch((e: unknown) => {
    throw new Error(redact(`${net} RPC unreachable: ${String(e)}`));
  });
  const ok = net === "devnet" ? genesis === DEVNET_GENESIS : local && genesis === MAINNET_GENESIS;
  if (!ok) throw new Error(`${net} RPC reported unexpected genesis ${genesis}`);
  return conn;
}
