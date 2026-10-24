// One trade from prepare to a final state: prepare, one Phantom signature within signBy, submit, then poll the
// worker's in-memory row (mirrors launch-run.ts). Bytes in and out only: atob, btoa and bs58, no Solana library
// (D-15).
import type { ApiError, TradeErrorCode, TradePrepareResult, TradeSide, TradeView } from "@bondr/core/api";
import bs58 from "bs58";
import type { WalletApi } from "@/components/wallet";

const POLL_MS = 1000;
// The poll's deadline. The worker keeps a row 2 minutes (D-07); a row still prepared this late was never sent
// and its blockhash is dead, and any other row this late is reported unknown, never failed (C-CR-02).
const DEADLINE_MS = 150_000;

export type Code = TradeErrorCode | "rejected" | "switched";
export type RunPhase = "signing" | "confirming";

export class Stop extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super(code);
    this.code = code;
  }
}

async function call<T>(url: string, body: object, signal: AbortSignal): Promise<T> {
  const init = { body: JSON.stringify(body), headers: { "content-type": "application/json" }, signal };
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

// Answers to a posted wire that prove the worker never sent it. Any other error leaves the outcome open, so the
// row decides and the panel never says "Nothing was sent" for a trade that may land (C-WR-05).
const REFUSED = new Set<Code>([
  "slippage",
  "insufficient_balance",
  "paused",
  "expired",
  "rate_limited",
  "message_changed",
  "consent_required",
]);

// D-16: once posted, a lost answer is settled by polling, never by a fresh signature. A repeat of the same
// wire is a read at the worker, so a row still "prepared" gets the same wire again.
const submit = (tradeId: string, signed: string, signal: AbortSignal) =>
  call<TradeView>("/api/trade/submit", { tradeId, signed }, signal).catch((e: Stop) =>
    REFUSED.has(e.code) ? Promise.reject(e) : null,
  );

/** The trader's slot 0 signature is the transaction id, so Solscan can find the trade even with no answer. */
const txId = (signed: string) =>
  bs58.encode(Uint8Array.from(atob(signed), (c) => c.charCodeAt(0)).subarray(1, 65));

async function getView(id: string, signal: AbortSignal): Promise<TradeView | "not_found" | null> {
  const res = await fetch(`/api/trade/${id}`, { cache: "no-store", signal }).catch(() => null);
  if (res?.status === 404) return "not_found";
  return res?.ok ? ((await res.json().catch(() => null)) as TradeView | null) : null;
}

async function poll(id: string, signed: string, signal: AbortSignal, sig: string): Promise<TradeView> {
  const start = Date.now();
  while (!signal.aborted) {
    const v = await getView(id, signal);
    // The worker lost its memory (a restart): the posted trade may still land, so it is unknown (T8).
    if (v === "not_found") return { state: "unknown", signature: sig };
    if (v?.state === "landed" || v?.state === "failed" || v?.state === "unknown") return v;
    sig = v?.signature ?? sig;
    const late = Date.now() - start > DEADLINE_MS;
    if (late && v?.state === "prepared") throw new Stop("expired");
    if (late) return { state: "unknown", signature: sig };
    if (v?.state === "prepared") await submit(id, signed, signal).catch(() => null);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
  throw new Stop("worker_unavailable"); // aborted: the panel is gone and nobody reads this
}

export type RunInput = {
  wallet: WalletApi;
  mint: string;
  side: TradeSide;
  /** Base units: lamports for a buy, coin units for a sell. */
  amount: string;
  slippageBps: number;
  onPhase(p: RunPhase): void;
  /** Aborted when the panel unmounts: every request and the poll stop. */
  signal: AbortSignal;
};

/** A final row of a posted trade; the signature is always known from slot 0. */
export type Settled = TradeView & { signature: string };

/** Runs one trade; resolves with the final row (landed, failed or unknown), throws Stop before anything is sent. */
export async function runTrade(r: RunInput): Promise<Settled> {
  if (!r.wallet.address) throw new Stop("switched");
  let switched = false;
  const off = r.wallet.onAccountChange(() => {
    switched = true;
  });
  try {
    // No wallet in the body: the consent session names it (T2).
    const body = { side: r.side, mint: r.mint, amount: r.amount, slippageBps: r.slippageBps };
    const prep = await call<TradePrepareResult>("/api/trade/prepare", body, r.signal);
    r.onPhase("signing");
    const signed = await signWithin(r.wallet, prep);
    if (switched) throw new Stop("switched");
    r.onPhase("confirming");
    const sig = txId(signed);
    const out = await submit(prep.tradeId, signed, r.signal);
    const final = out && out.state !== "prepared" && out.state !== "signed" && out.state !== "sent";
    const v = final ? out : await poll(prep.tradeId, signed, r.signal, out?.signature ?? sig);
    return { ...v, signature: v.signature ?? sig };
  } finally {
    off();
  }
}
