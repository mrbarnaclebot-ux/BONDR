"use client";
import { Check } from "lucide-react";
import { impactBand, impactPct, sol, thousands } from "@/lib/format";
import type { Code } from "@/lib/trade-run";
import { type RunResult, useTrade } from "@/lib/use-trade";
import { Callout } from "./callout";
import { useCoinLive } from "./coin-live";
import { TxLink } from "./tx-link";

// UI-SPEC Results: any code without its own copy falls back to this, so no failure is silent.
const FALLBACK = "Could not build your trade. Nothing was sent. Try again.";

type Copy = { variant: "info" | "warn" | "error"; text: string };
const error = (text: string): Copy => ({ variant: "error", text });

/** The pause copy names the coin while its own curve waits for PumpSwap (`coin` set), else BONDR. */
const migrating = (coin: string | null) =>
  coin
    ? `Trading pauses for a few seconds while ${coin} moves to PumpSwap.`
    : "Trading pauses for a few seconds while BONDR moves to PumpSwap.";

/**
 * D-17: the fixed copy for each failure code; raw worker or RPC text never reaches the page (T9). Consent
 * required has none: use-trade already sent the trader back to "Accept terms to trade".
 */
function failure(code: Code, mover: string | null): Copy | null {
  switch (code) {
    case "slippage":
      return error("Price moved more than your slippage. Try again or raise slippage.");
    case "insufficient_balance":
      return error("Not enough SOL for this trade and fees.");
    case "paused":
      return { variant: "warn", text: migrating(mover) };
    case "rejected":
      return { variant: "info", text: "Signature declined." };
    case "expired":
      return error("Transaction expired. Try again.");
    case "rate_limited":
      return error("Too many trades from this wallet. Wait a minute, then try again.");
    case "switched":
      return error("Phantom switched accounts. Nothing was sent. Try again.");
    case "message_changed":
      return error(
        "The signed transaction did not match the one BONDR built, so nothing was sent. Try again.",
      );
    case "onchain":
      return error("Your trade failed on-chain. Only the network fee left your wallet. Try again.");
    case "consent_required":
      return null;
    default:
      return error(FALLBACK);
  }
}

/** Amounts come from the confirmed transaction; without them the line names the coin only (D-17). */
function landedText(r: Extract<RunResult, { kind: "landed" }>, symbol: string): string {
  if (r.side === "buy")
    return r.amountOut
      ? `Bought ${thousands(BigInt(r.amountOut) / 1_000_000n)} ${symbol}.`
      : `Bought ${symbol}.`;
  return r.amountOut ? `Sold for ${sol(r.amountOut, 4)} SOL.` : `Sold ${symbol}.`;
}

function Landed({ r }: { r: Extract<RunResult, { kind: "landed" }> }) {
  const { symbol, net } = useTrade();
  return (
    <div
      role="status"
      className="grid animate-rise grid-cols-[20px_1fr] gap-2 rounded-md border border-line bg-surface p-4 text-sm motion-reduce:animate-none"
    >
      <Check className="mt-0.5 size-[18px] text-leaf" strokeWidth={1.5} aria-hidden="true" />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{landedText(r, symbol)}</span>
        <TxLink signature={r.signature} net={net}>
          View on Solscan
        </TxLink>
      </div>
    </div>
  );
}

/**
 * The impact callout for the shown quote (D-13). The live percentage sits under aria-live="off", so a 2 s
 * refresh that moves it never re-announces the callout (C-WR-03); the callout itself mounts once per band.
 */
function Impact({ impact }: { impact: number }) {
  const band = impactBand(impact);
  const p = <span aria-live="off">{impactPct(impact)}</span>;
  if (band === "warn")
    return (
      <Callout variant="warn" title="High price impact.">
        This trade moves the price {p}. A smaller amount fills closer to the current price.
      </Callout>
    );
  if (band === "error")
    return (
      <Callout variant="error" title="Very high price impact.">
        This trade moves the price {p}, so you receive far less than the current price suggests. Check the
        amounts before you continue.
      </Callout>
    );
  return null;
}

/**
 * UI-SPEC callout slot above the button: at most one of, in order, the trade result, the migration pause, the
 * price impact and the failed quote. Each clears on its own when its condition ends.
 */
export function TradeCallouts() {
  const t = useTrade();
  const coinComplete = useCoinLive()?.coin?.venue === "complete";
  const mover = coinComplete ? t.symbol : null;
  const r = t.result;
  if (r?.kind === "landed") return <Landed r={r} />;
  if (r?.kind === "unknown")
    return (
      <Callout variant="warn">
        Your trade was sent but is not confirmed yet. Check Solscan before you trade again.{" "}
        <TxLink signature={r.signature} net={t.net}>
          View on Solscan
        </TxLink>
      </Callout>
    );
  const copy = r && failure(r.code, mover);
  if (copy) return <Callout variant={copy.variant}>{copy.text}</Callout>;
  if (coinComplete || t.quoteError === "paused") return <Callout variant="warn">{migrating(mover)}</Callout>;
  const q = t.quote?.side === t.side ? t.quote : null;
  if (q && impactBand(q.impact)) return <Impact impact={q.impact} />;
  if (t.quoteError) return <Callout variant="warn">Could not get a quote. Trying again.</Callout>;
  return null;
}
