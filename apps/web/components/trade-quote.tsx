"use client";
import type { HopFee, HopVenue, TradeQuote as Quote, TradeSide } from "@bondr/core/api";
import { Fragment, type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { pct, sol, thousands } from "@/lib/format";
import { useTrade } from "@/lib/use-trade";
import { Chips } from "./trade-amount";
import { FieldError, Input } from "./ui-field";

const VENUE: Record<HopVenue, string> = { curve: "curve", pool: "PumpSwap" };
const NONE = "–";
const SLIPPAGE = [
  { label: "0.5%", value: "50" },
  { label: "1%", value: "100" },
  { label: "3%", value: "300" },
];
const CUSTOM = "custom";
// Custom slippage above this shows the worst-fill hint (UI-SPEC Custom slippage).
const HIGH_BPS = 500;

/** Fee SOL with 4 decimals, "<0.0001" below that (UI-SPEC Fees breakdown). */
const feeSol = (l: string) => (BigInt(l) > 0n && BigInt(l) < 100_000n ? "<0.0001" : sol(l, 4));
const impactPct = (f: number) => (f < 0.0001 ? "<0.01%" : `${(f * 100).toFixed(2)}%`);
// Under 5% foreground, 5% up to 15% warn, over 15% destructive (D-13).
const impactTone = (f: number) => (f > 0.15 ? "text-destructive" : f >= 0.05 ? "text-warn" : undefined);

/** A buy receives the coin (integer, thousands), a sell receives SOL (4 decimals). */
const outText = (side: TradeSide, base: string, symbol: string) =>
  side === "buy" ? `${thousands(BigInt(base) / 1_000_000n)} ${symbol}` : `${sol(base, 4)} SOL`;

function Route({ q, symbol }: { q: Quote; symbol: string }) {
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

function Row({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("num flex flex-wrap items-center justify-end gap-2 text-right", className)}>
        {children}
      </dd>
    </div>
  );
}

/** The quote's masked rates for one hop as sub-rows; a zero rate has no row (04-03 Note). */
function subRows(h: HopFee, symbol: string): string[] {
  return [
    h.creatorBps && `Creator ${pct(h.creatorBps, true)}, to the ${symbol} fee wallet`,
    h.lpBps && `LP ${pct(h.lpBps, true)}`,
    h.protocolBps && `Pump protocol ${pct(h.protocolBps, true)}`,
  ].filter((s): s is string => !!s);
}

function FeeRow({
  title,
  value,
  subs = [],
  className,
}: {
  title: string;
  value: string;
  subs?: string[];
  className?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
      <dt>{title}</dt>
      <dd className={cn("num text-right", className)}>{value}</dd>
      {subs.map((s) => (
        <dd key={s} className="col-span-2 pl-3 text-muted-foreground">
          {s}
        </dd>
      ))}
    </div>
  );
}

const hopPct = (h: HopFee) => pct(h.protocolBps + h.creatorBps + h.lpBps, true);

/** UI-SPEC Fees breakdown: every rate and value from the quote, none from the web app. */
function Fees({ q, symbol }: { q: Quote | null; symbol: string }) {
  const coin = q?.fees.coinHop;
  const bondr = q?.fees.bondrHop;
  const pair = q?.side === "sell" ? "BONDR to SOL" : "SOL to BONDR";
  return (
    <details className="group border-t border-dashed border-line-strong">
      <summary className="flex cursor-pointer list-none flex-wrap justify-between gap-x-3 gap-y-1 py-2 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-[13px] font-semibold">Fees</span>{" "}
          <span className="num">{q ? `${feeSol(q.fees.totalSol)} SOL` : NONE}</span>
        </span>
        <span className="flex gap-2 text-muted-foreground">
          no BONDR platform fee
          <span aria-hidden="true" className="num group-open:hidden">
            +
          </span>
          <span aria-hidden="true" className="num hidden group-open:inline">
            {"−"}
          </span>
        </span>
      </summary>
      {q && coin && bondr && (
        <dl className="grid gap-2 pt-1">
          <FeeRow
            title={
              coin.venue === "curve"
                ? `Fees on the ${symbol} curve, ${hopPct(coin)}`
                : `Fees on ${symbol} PumpSwap, ${hopPct(coin)}`
            }
            value={`${feeSol(coin.sol)} SOL`}
            subs={subRows(coin, symbol)}
          />
          <FeeRow
            title={`${pair} on ${bondr.venue === "curve" ? "the BONDR curve" : "BONDR PumpSwap"}, ${hopPct(bondr)}`}
            value={`${feeSol(bondr.sol)} SOL`}
            subs={subRows(bondr, symbol)}
          />
          <FeeRow title="BONDR platform fee" value={q.fees.platformFee} className="text-leaf" />
          <FeeRow
            title="Network fee"
            value={`up to ${sol(q.fees.networkMax, 4, true)} SOL`}
            className="text-muted-foreground"
          />
        </dl>
      )}
    </details>
  );
}

/** The custom slippage row: 0.1% to 50%; an invalid value shows the error and keeps the last valid one. */
function CustomSlippage() {
  const t = useTrade();
  const id = useId();
  const [text, setText] = useState(String(t.slippageBps / 100));
  const n = Number(text);
  const valid = text.trim() !== "" && n >= 0.1 && n <= 50;
  const error = valid ? undefined : "Enter a slippage from 0.1% to 50%.";
  const onChange = (v: string) => {
    setText(v);
    const bps = Math.round(Number(v) * 100);
    if (v.trim() !== "" && bps >= 10 && bps <= 5_000) t.setSlippageBps(bps);
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="font-semibold">
          Custom slippage
        </label>
        <div className="relative w-[120px]">
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            className="num min-h-10 py-2 pr-8 text-xs"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
            %
          </span>
        </div>
      </div>
      <FieldError id={`${id}-error`} message={error} />
      {t.slippageBps > HIGH_BPS && (
        <p className="text-warn">
          High slippage. This trade can fill up to {t.slippageBps / 100}% below the quote.
        </p>
      )}
    </div>
  );
}

/** UI-SPEC Quote list, slippage and fees. "–" until a quote for this side exists. */
export function TradeQuote() {
  const t = useTrade();
  const q = t.quote?.side === t.side ? t.quote : null;
  const preset = SLIPPAGE.some((s) => s.value === String(t.slippageBps));
  // A stored custom value opens the row by itself; a preset pick closes it.
  const [open, setOpen] = useState(false);
  const custom = open || !preset;
  const pick = (v: string) => {
    setOpen(v === CUSTOM);
    if (v !== CUSTOM) t.setSlippageBps(Number(v));
  };
  return (
    <div
      className={cn("grid gap-2 text-xs transition-opacity duration-(--dur)", t.loading && q && "opacity-60")}
    >
      <dl aria-busy={t.loading || undefined} className="grid gap-2">
        <Row label="You receive about" className="text-[15px]">
          {q ? outText(q.side, q.amountOut, t.symbol) : NONE}
        </Row>
        <Row label="Route">{q ? <Route q={q} symbol={t.symbol} /> : NONE}</Row>
        <Row label="Price impact" className={q ? impactTone(q.impact) : undefined}>
          {q ? impactPct(q.impact) : NONE}
        </Row>
        <Row label="Slippage" className="min-w-0 flex-1">
          <Chips
            legend="Slippage"
            items={[...SLIPPAGE, { label: "Custom", value: CUSTOM }]}
            pressed={custom ? CUSTOM : String(t.slippageBps)}
            onPick={pick}
          />
        </Row>
        <Row label="Minimum received">{q ? outText(q.side, q.minAmountOut, t.symbol) : NONE}</Row>
      </dl>
      {custom && <CustomSlippage />}
      <Fees q={q} symbol={t.symbol} />
    </div>
  );
}
