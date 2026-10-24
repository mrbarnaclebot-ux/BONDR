"use client";
import { Check } from "lucide-react";
import { sol, thousands } from "@/lib/format";
import { type RunResult, useTrade } from "@/lib/use-trade";
import { Callout } from "./callout";
import { TxLink } from "./tx-link";

// UI-SPEC Results: an unknown code falls back to this, so no failure is silent. 04-11 maps each code.
const FALLBACK = "Could not build your trade. Nothing was sent. Try again.";

/** Amounts come from the confirmed transaction; without them the line names the coin only (D-17). */
function landedText(r: Extract<RunResult, { kind: "landed" }>, symbol: string): string {
  if (r.side === "buy")
    return r.amountOut
      ? `Bought ${thousands(BigInt(r.amountOut) / 1_000_000n)} ${symbol}.`
      : `Bought ${symbol}.`;
  return r.amountOut ? `Sold for ${sol(r.amountOut, 4)} SOL.` : `Sold ${symbol}.`;
}

/** The callout slot's trade result: the success line, the sent-but-unknown warning, or the failure copy. */
export function TradeResult() {
  const { result: r, symbol, net } = useTrade();
  if (!r) return null;
  if (r.kind === "landed")
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
  if (r.kind === "unknown")
    return (
      <Callout variant="warn">
        Your trade was sent but is not confirmed yet. Check Solscan before you trade again.{" "}
        <TxLink signature={r.signature} net={net}>
          View on Solscan
        </TxLink>
      </Callout>
    );
  return <Callout variant="error">{FALLBACK}</Callout>;
}
