"use client";

// UI-SPEC Bond and burn, on curve (TOKEN-03): the burn budget against the cost to finish the curve, the open
// 24h fee window and the four-step fee flow. Every number comes from the coin row (D-23); the web does no
// price math. The window uses the worker's own formula (windowOf, windowEnd) and FEE_WINDOW_MS.
import type { CoinFees } from "@bondr/core/api";
import { windowEnd, windowOf } from "@bondr/core/fees";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { feeSol, ratio1000, ratioPct, utcStamp, whole, windowLeft } from "@/lib/format";
import { ReadyBar } from "./ready-bar";

const MUTED = "text-muted-foreground";
const Num = ({ children }: { children: ReactNode }) => (
  <span className="num text-foreground">{children}</span>
);

function BudgetProse({ f, r, symbol }: { f: CoinFees; r: number | null; symbol: string }) {
  if (BigInt(f.budget) === 0n) return "No creator fees yet. Each trade's creator fee adds to this budget.";
  const last =
    r !== null && r >= 1050
      ? "The budget is past 105%. The worker is buying the rest of the curve and burning it now."
      : "At 105% of the cost, the worker buys the rest of the curve with the full budget and burns the tokens in the same transaction.";
  return (
    <>
      <Num>{whole(f.budget)}</Num> of {f.cost === null ? <span>–</span> : <Num>{whole(f.cost)}</Num>} BONDR.
      {` The budget is 90% of ${symbol}'s creator fees, collected or not. ${last}`}
    </>
  );
}

function BudgetGauge({ f, symbol }: { f: CoinFees; symbol: string }) {
  const r = ratio1000(f.budget, f.cost);
  const ratio = ratioPct(f.budget, f.cost);
  const zero = BigInt(f.budget) === 0n;
  const label =
    r === null
      ? "Burn budget not measured yet."
      : `Burn budget is ${ratio.slice(0, -1)} percent of the cost to complete the curve. Forced bond fires at 105 percent.`;
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-2 text-sm">
        <h3>
          <span className="font-semibold">Burn budget ready</span>{" "}
          <span className={cn("text-xs", MUTED)}>budget vs cost to finish the curve</span>
        </h3>
        <span className={cn("num", r === null || r === 0 ? MUTED : "text-leaf")}>{ratio}</span>
      </div>
      <div className="mt-1 mb-3">
        <span className={cn("num text-[28px] leading-none", (zero || f.budgetSol === null) && MUTED)}>
          {zero ? "0" : f.budgetSol === null ? "–" : feeSol(f.budgetSol)}
        </span>
        <span
          className={cn("num text-sm", MUTED)}
        >{` / ${f.costSol === null ? "–" : feeSol(f.costSol)} SOL`}</span>
      </div>
      <ReadyBar ratio={r === null ? null : r / 10} size="lg" label={label} />
      <p className={cn("mt-3 text-xs", MUTED)}>
        <BudgetProse f={f} r={r} symbol={symbol} />
      </p>
    </div>
  );
}

/**
 * The open window and its close, from the device clock. The next tick lands where the minutes left change,
 * and a passed close rolls to the next window on its own (UI-SPEC Window).
 */
function useWindow(launchedAt: number, windowMs: number) {
  const [now, setNow] = useState(() => Date.now());
  const [local, setLocal] = useState(false);
  const index = windowOf(launchedAt, now, windowMs);
  const end = windowEnd(launchedAt, index, windowMs);
  useEffect(() => {
    setLocal(true);
    const left = end - Date.now();
    const id = setTimeout(() => setNow(Date.now()), (((left % 60_000) + 60_000) % 60_000) + 50);
    return () => clearTimeout(id);
  }, [now, end]);
  return { n: index + 1, left: end - now, end, local };
}

/** "24h", or the real length when FEE_WINDOW_MS is shortened for local e2e ("10m"). */
const span = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`);

type WindowProps = { launchedAt: number; windowMs: number; symbol: string };

function WindowBlock({ launchedAt, windowMs, symbol }: WindowProps) {
  const { n, left, end, local } = useWindow(launchedAt, windowMs);
  const at = local
    ? new Date(end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `${utcStamp(new Date(end).toISOString()).slice(11)} UTC`;
  return (
    <div className="mt-8 grid gap-1 rounded-[var(--radius)] border border-line bg-[radial-gradient(circle_at_left,color-mix(in_oklch,var(--forest)_35%,transparent),transparent_70%),color-mix(in_oklch,var(--ink)_40%,var(--surface))] p-4 @min-[600px]:grid-cols-[auto_1fr] @min-[600px]:items-center @min-[600px]:gap-6 @min-[600px]:p-6">
      <div>
        <p className={cn("text-xs font-semibold tracking-[0.09em] uppercase", MUTED)}>
          {`Window ${n} closes in`}
        </p>
        <p
          aria-hidden="true"
          className="num text-[28px] leading-none tracking-[-0.03em]"
          suppressHydrationWarning
        >
          {windowLeft(left)}
        </p>
        <p className="sr-only">{`Window ${n} closes at ${at}`}</p>
      </div>
      <p className={cn("max-w-[60ch] text-sm", MUTED)}>
        {`If ${symbol} has not bonded when this ${span(windowMs)} window closes, 90% of its burn budget goes to the BONDR buyback and is burned, and 10% goes to treasury. Fees then start filling a fresh budget.`}
      </p>
    </div>
  );
}

const STEPS = [
  ["Collect", "Creator fees from every trade"],
  ["Split 90/10", "90% burn budget, 10% treasury"],
  ["Force bond", "Budget at 105% of cost buys and burns"],
  ["Or sweep", "Window ends: 90% to the BONDR buyback burn"],
] as const;

/** Force bond from 100%, else Split once there is a budget, else Collect. */
const currentStep = (f: CoinFees) => {
  const r = ratio1000(f.budget, f.cost);
  return r !== null && r >= 1000 ? 2 : BigInt(f.budget) > 0n ? 1 : 0;
};

function FeeFlow({ f, symbol }: { f: CoinFees; symbol: string }) {
  const at = currentStep(f);
  return (
    <ol
      aria-label={`How ${symbol}'s creator fees move`}
      className="mt-8 grid grid-cols-2 gap-x-4 gap-y-4 @min-[600px]:grid-cols-4"
    >
      {STEPS.map(([title, text], i) => (
        <li key={title} aria-current={i === at ? "step" : undefined} className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-4 flex-none rounded-full border-2",
                i === at
                  ? "border-leaf bg-leaf shadow-[0_0_0_6px_color-mix(in_oklch,var(--leaf)_18%,transparent),0_0_20px_var(--leaf)]"
                  : "border-mint bg-ink",
              )}
            />
            {i < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="hidden h-1 flex-1 rounded-full bg-linear-to-r from-forest to-surface-3 @min-[600px]:block"
              />
            )}
          </div>
          <p className="text-sm font-semibold">{title}</p>
          <p className={cn("text-xs", MUTED)}>{text}</p>
        </li>
      ))}
    </ol>
  );
}

type Props = {
  fees: CoinFees;
  launchedAt: string | null; // null before the indexer has the coin's row
  windowMs: number;
  symbol: string;
  children: ReactNode; // the Curve filled gauge
};

/** The on-curve body of Bond and burn: gauges side by side from a 600px container, then window and flow. */
export function BondBudget({ fees, launchedAt, windowMs, symbol, children }: Props) {
  return (
    <>
      <div className="grid gap-8 @min-[600px]:grid-cols-2">
        <div className="min-w-0">{children}</div>
        <BudgetGauge f={fees} symbol={symbol} />
      </div>
      {launchedAt && <WindowBlock launchedAt={Date.parse(launchedAt)} windowMs={windowMs} symbol={symbol} />}
      <FeeFlow f={fees} symbol={symbol} />
    </>
  );
}
