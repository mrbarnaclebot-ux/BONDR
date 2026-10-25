// Real devnet reads and trades for the E2E_DEVNET specs: the public devnet RPC (as fixtures.ts blockTime, so the
// runner needs no Helius key; a 429 waits and retries), token balances by owner and mint, and devnet-trades runs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const WORKER = "http://127.0.0.1:8080";
export const RUN_BUDGET_LAMPORTS = 0.05e9;

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(DEVNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429 && i < 5) {
      await new Promise((done) => setTimeout(done, 2000));
      continue;
    }
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.result === undefined) throw new Error(`${method}: ${body.error?.message ?? res.status}`);
    return body.result;
  }
}

const CONFIRMED = { commitment: "confirmed" };
export const lamports = async (a: string) =>
  (await rpc<{ value: number }>("getBalance", [a, CONFIRMED])).value;
export const supply = async (mint: string) =>
  BigInt((await rpc<{ value: { amount: string } }>("getTokenSupply", [mint, CONFIRMED])).value.amount);
export const sol = (l: number) => (l / 1e9).toFixed(6);

type Parsed = { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } };
/** An owner's balance of `mint` across its token accounts; none is 0. */
export async function tokens(owner: string, mint: string): Promise<bigint> {
  const opts = { encoding: "jsonParsed", ...CONFIRMED };
  const r = await rpc<{ value: Parsed[] }>("getTokenAccountsByOwner", [owner, { mint }, opts]);
  return r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

/** One devnet-trades run (its own budget and ops floor checks); returns the landed signatures. */
export function trade(mint: string, ...args: string[]): string[] {
  const argv = ["--env-file=.env", "scripts/devnet-trades.ts", "--mint", mint, ...args, "--json"];
  const out = execFileSync("node", [...argv, "--expect-indexed", "30"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, VANITY_THREADS: "0" },
  });
  return out
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => (JSON.parse(l) as { sig: string }).sig);
}
