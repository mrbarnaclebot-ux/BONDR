"use client";
import { useId } from "react";
import { useTrade } from "@/lib/use-trade";
import { TradeAmount } from "./trade-amount";
import { TradeQuote } from "./trade-quote";
import { Seg } from "./ui-seg";

const SIDES = ["Buy", "Sell"] as const;

/** UI-SPEC Trade panel items 1-4 and 7: side, amount, quote list with slippage and fees, fine print. */
export function TradePanel() {
  const t = useTrade();
  const h = useId();
  return (
    <section
      aria-labelledby={h}
      className="grid gap-4 rounded-lg border border-line-strong bg-[radial-gradient(100%_50%_at_50%_0%,color-mix(in_oklch,var(--leaf)_10%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] p-4 shadow-elev-2 md:p-6"
    >
      <h2 id={h} className="sr-only">
        Trade {t.symbol}
      </h2>
      <Seg
        label="Trade side"
        options={SIDES}
        value={t.side === "buy" ? "Buy" : "Sell"}
        onChange={(v) => t.setSide(v === "Buy" ? "buy" : "sell")}
        tone={t.side === "sell" ? "danger" : "mint"}
      />
      <TradeAmount />
      <TradeQuote />
      <p className="text-xs text-muted-foreground">One Phantom signature. Quote refreshes every 2 seconds.</p>
    </section>
  );
}
