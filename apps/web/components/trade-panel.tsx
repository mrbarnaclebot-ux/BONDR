"use client";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { useTrade } from "@/lib/use-trade";
import { TradeAmount } from "./trade-amount";
import { TradeQuote } from "./trade-quote";
import { Seg } from "./ui-seg";

const SIDES = ["Buy", "Sell"] as const;

const FRAME =
  "rounded-lg border border-line-strong bg-[radial-gradient(100%_50%_at_50%_0%,color-mix(in_oklch,var(--leaf)_10%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] p-4 shadow-elev-2 md:p-6";

type Props = {
  /** "sheet": the dialog draws the frame and padding, chips are 44px, and the sheet reports visibility itself. */
  placement?: "column" | "sheet";
  /** The h2 id, so the sheet's dialog can name itself by it. */
  labelId?: string;
};

/** UI-SPEC Trade panel items 1-4 and 7: side, amount, quote list with slippage and fees, fine print. */
export function TradePanel({ placement = "column", labelId }: Props) {
  const t = useTrade();
  const own = useId();
  const h = labelId ?? own;
  const sheet = placement === "sheet";
  const size = sheet ? "sheet" : undefined;
  return (
    <section
      ref={sheet ? undefined : t.panelRef}
      aria-labelledby={h}
      className={cn("grid gap-4", !sheet && FRAME)}
    >
      <h2 id={h} className="sr-only">
        Trade {t.symbol}
      </h2>
      {/* In the sheet the side seg stops short of the close button in the top right corner. */}
      <div className={cn("grid", sheet && "pr-12")}>
        <Seg
          label="Trade side"
          options={SIDES}
          value={t.side === "buy" ? "Buy" : "Sell"}
          onChange={(v) => t.setSide(v === "Buy" ? "buy" : "sell")}
          tone={t.side === "sell" ? "danger" : "mint"}
        />
      </div>
      <TradeAmount size={size} />
      <TradeQuote size={size} />
      <p className="text-xs text-muted-foreground">One Phantom signature. Quote refreshes every 2 seconds.</p>
    </section>
  );
}
