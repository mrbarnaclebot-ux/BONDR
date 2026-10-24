// One trade from prepare to a final state: prepare, one Phantom signature within signBy, submit, then poll the
// worker's in-memory row (mirrors launch-run.ts). Bytes in and out only: atob and btoa, no Solana library (D-15).
import type { ApiError, TradeErrorCode, TradePrepareResult, TradeSide, TradeView } from "@bondr/core/api";
import type { WalletApi } from "@/components/wallet";

const POLL_MS = 1000;
// A row still prepared this long after polling began was never sent, and its blockhash is dead.
const PREPARED_MS = 150_000;

export type Code = TradeErrorCode | "rejected" | "switched";
export type RunPhase = "signing" | "confirming";

export class Stop extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super(code);
    this.code = code;
  }
}

async function call<T>(url: string, body: object): Promise<T> {
  const init = { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const res = await fetch(url, { method: "POST", ...init }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (res?.ok && out) return out;
  throw new Stop(out?.error ?? "worker_unavailable");
}

// Pitfall 3: past signBy the blockhash is dead, so a late signature is refused here.
async function signWithin(wallet: WalletApi, prep: TradePrepareResult): Promise<string> {
  const tx = Uint8Array.from(atob(prep.tx), (c) => c.charCodeAt(0));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Stop("expired")), prep.signBy * 1000);
  });
  const signing = wallet.signTransaction(tx).catch(() => Promise.reject(new Stop("rejected")));
  try {
    return btoa(String.fromCharCode(...(await Promise.race([signing, expiry]))));
  } finally {
    clearTimeout(timer);
  }
}

// D-16: once posted, a lost answer is settled by polling, never by a fresh signature. A repeat of the same
// wire is a read at the worker, so a row still "prepared" gets the same wire again.
const submit = (tradeId: string, signed: string) =>
  call<TradeView>("/api/trade/submit", { tradeId, signed }).catch((e: Stop) =>
    e.code === "worker_unavailable" ? null : Promise.reject(e),
  );

async function getView(id: string): Promise<TradeView | "not_found" | null> {
  const res = await fetch(`/api/trade/${id}`, { cache: "no-store" }).catch(() => null);
  if (res?.status === 404) return "not_found";
  return res?.ok ? ((await res.json().catch(() => null)) as TradeView | null) : null;
}

async function poll(id: string, signed: string, sig?: string): Promise<TradeView> {
  const start = Date.now();
  for (;;) {
    const v = await getView(id);
    // The worker lost its memory (a restart): with a signature the trade may still land, so it is unknown (T8).
    if (v === "not_found") {
      if (sig) return { state: "unknown", signature: sig };
      throw new Stop("not_found");
    }
    if (v?.state === "landed" || v?.state === "failed" || v?.state === "unknown") return v;
    if (v?.state === "prepared" && Date.now() - start > PREPARED_MS) throw new Stop("expired");
    if (v?.state === "prepared") await submit(id, signed).catch(() => null);
    sig = v?.signature ?? sig;
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

export type RunInput = {
  wallet: WalletApi;
  mint: string;
  side: TradeSide;
  /** Base units: lamports for a buy, coin units for a sell. */
  amount: string;
  slippageBps: number;
  onPhase(p: RunPhase): void;
};

/** Runs one trade; resolves with the final row (landed, failed or unknown), throws Stop before anything is sent. */
export async function runTrade(r: RunInput): Promise<TradeView> {
  if (!r.wallet.address) throw new Stop("switched");
  let switched = false;
  const off = r.wallet.onAccountChange(() => {
    switched = true;
  });
  try {
    // No wallet in the body: the consent session names it (T2).
    const body = { side: r.side, mint: r.mint, amount: r.amount, slippageBps: r.slippageBps };
    const prep = await call<TradePrepareResult>("/api/trade/prepare", body);
    r.onPhase("signing");
    const signed = await signWithin(r.wallet, prep);
    if (switched) throw new Stop("switched");
    r.onPhase("confirming");
    const out = await submit(prep.tradeId, signed);
    if (out && out.state !== "prepared" && out.state !== "signed" && out.state !== "sent") return out;
    return await poll(prep.tradeId, signed, out?.signature);
  } finally {
    off();
  }
}
