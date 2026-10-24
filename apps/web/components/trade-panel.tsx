"use client";
import type { HopVenue, TradeQuote, TradeSide } from "@bondr/core/api";
import { Fragment, type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { sol, thousands } from "@/lib/format";
import { useTrade } from "@/lib/use-trade";
import { Input, Label } from "./ui-field";
import { Seg } from "./ui-seg";

const SIDES = ["Buy", "Sell"] as const;
const VENUE: Record<HopVenue, string> = { curve: "curve", pool: "PumpSwap" };
const NONE = "–";

/** Fee SOL with 4 decimals, "<0.0001" below that (UI-SPEC Fees breakdown). */
const feeSol = (l: string) => (BigInt(l) > 0n && BigInt(l) < 100_000n ? "<0.0001" : sol(l, 4));
const impactPct = (f: number) => (f < 0.0001 ? "<0.01%" : `${(f * 100).toFixed(2)}%`);

/** A buy receives the coin (integer, thousands), a sell receives SOL (4 decimals). */
const outText = (side: TradeSide, base: string, symbol: string) =>
  side === "buy" ? `${thousands(BigInt(base) / 1_000_000n)} ${symbol}` : `${sol(base, 4)} SOL`;

function Route({ q, symbol }: { q: TradeQuote; symbol: string }) {
  const buy = ["SOL", `BONDR ${VENUE[q.route.bondr]}`, `${symbol} ${VENUE[q.route.coin]}`];
  const steps = q.side === "buy" ? buy : buy.reverse();
  return steps.map((s, i) => (
    <Fragment key={s}>
      {i > 0 && (
        <>
          <span aria-hidden="true" className="h-px w-4 bg-muted-foreground" />
          <span className="sr-only"> to </span>
        </>
      )}
      <span>{s}</span>
    </Fragment>
  ));
}

function Row({ label, big, children }: { label: string; big?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn("num flex flex-wrap items-center justify-end gap-2 text-right", big && "text-[15px]")}
      >
        {children}
      </dd>
    </div>
  );
}

/** Every value is the worker's quote; the web holds no rate. "–" until a quote for this side exists. */
function QuoteRows() {
  const t = useTrade();
  const q = t.quote?.side === t.side ? t.quote : null;
  return (
    <div
      className={cn("grid gap-2 text-xs transition-opacity duration-(--dur)", t.loading && q && "opacity-60")}
    >
      <dl aria-busy={t.loading || undefined} className="grid gap-2">
        <Row label="You receive about" big>
          {q ? outText(q.side, q.amountOut, t.symbol) : NONE}
        </Row>
        <Row label="Route">{q ? <Route q={q} symbol={t.symbol} /> : NONE}</Row>
        <Row label="Price impact">{q ? impactPct(q.impact) : NONE}</Row>
        <Row label="Minimum received">{q ? outText(q.side, q.minAmountOut, t.symbol) : NONE}</Row>
      </dl>
      <p className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-dashed border-line-strong pt-2">
        <span>
          <span className="text-[13px] font-semibold">Fees</span>{" "}
          <span className="num">{q ? `${feeSol(q.fees.totalSol)} SOL` : NONE}</span>
        </span>
        <span className="text-muted-foreground">no BONDR platform fee</span>
      </p>
    </div>
  );
}

function AmountField() {
  const t = useTrade();
  const id = useId();
  const unit = t.side === "buy" ? "SOL" : t.symbol;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t.side === "buy" ? "You pay" : "You sell"}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className={cn("num min-h-14 text-xl", t.side === "buy" ? "pr-16" : "pr-28")}
          value={t.amount}
          onChange={(e) => t.setAmount(e.target.value)}
        />
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}

/** UI-SPEC Trade panel items 1-4 and 7: side, amount, quote rows with the fees line, fine print. */
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
      />
      <AmountField />
      <QuoteRows />
      <p className="text-xs text-muted-foreground">One Phantom signature. Quote refreshes every 2 seconds.</p>
    </section>
  );
}
