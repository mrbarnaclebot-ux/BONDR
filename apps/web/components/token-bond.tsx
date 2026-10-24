"use client";
import type { CoinRow, Net } from "@bondr/core/api";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { flashClass } from "@/lib/flash";
import { age, curvePct, mcapSol, short, thousands } from "@/lib/format";
import { BondGlyph } from "./bond-glyph";
import { useCoinLive } from "./coin-live";
import { Tag } from "./tag";
import { TxLink } from "./tx-link";

// Curve progress only (D-10); the rest of the mockup's panel arrives with Phase 5.
export type BondCoin = Pick<
  CoinRow,
  "venue" | "progress" | "realQuoteReserves" | "bondrAtBond" | "bondSol" | "bondSig" | "bondedAt"
>;

const Num = ({ children }: { children: ReactNode }) => (
  <span className="num text-foreground">{children}</span>
);
const bondr = (base: string) => thousands(Math.floor(Number(base) / 1e6));

function CurveProse({ c }: { c: BondCoin }) {
  if (c.bondrAtBond === null) return null;
  return (
    <>
      <Num>{bondr(c.realQuoteReserves)}</Num> of <Num>{bondr(c.bondrAtBond)}</Num> BONDR in the curve.
      {c.bondSol !== null && (
        <>
          {" "}
          Bonds at about <Num>{mcapSol(c.bondSol)}</Num> SOL.
        </>
      )}
    </>
  );
}

function Prose({ c, symbol, net }: { c: BondCoin; symbol: string; net: Net }) {
  if (c.venue === "curve") return <CurveProse c={c} />;
  if (c.venue === "complete")
    return `The curve is complete. ${symbol} moves to PumpSwap automatically, usually within a minute.`;
  return (
    <>
      {`Bonded ${age(c.bondedAt ?? new Date().toISOString())} ago. ${symbol} now trades on PumpSwap.`}
      {c.bondSig && (
        <>
          {" "}
          <TxLink signature={c.bondSig} net={net}>{`Bond tx ${short(c.bondSig)}`}</TxLink>
        </>
      )}
    </>
  );
}

const CURVE_START: BondCoin = {
  venue: "curve",
  progress: 0,
  realQuoteReserves: "0",
  bondrAtBond: null,
  bondSol: null,
  bondSig: null,
  bondedAt: null,
};

/**
 * UI-SPEC Bond and burn: on curve, complete and waiting, or bonded, live from CoinLiveProvider (a bond event
 * switches the state). The coin is null before it is indexed.
 */
export function BondPanel({ symbol, net }: { symbol: string; net: Net }) {
  const live = useCoinLive();
  const c = live?.coin ?? CURVE_START;
  const flash = live?.flash;
  const pct = curvePct(c.venue === "curve" ? c.progress : 1);
  return (
    <section
      aria-labelledby="bond-h"
      className="rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-4 shadow-elev-1 md:p-8"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="bond-h" className="display text-[28px] leading-none">
          Bond and burn
        </h2>
        <span className="text-xs text-muted-foreground">Read from the pump curve on-chain.</span>
      </div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="font-semibold">Curve filled</span>
        {c.venue === "curve" && <span className="text-xs text-muted-foreground">bonds at 100%</span>}
      </div>
      <div className="flex items-center gap-3">
        <span
          key={flash?.n}
          className={cn("num rounded-sm text-[28px] leading-none", flash && flashClass(flash.side))}
        >
          {pct}
        </span>
        {c.venue === "pool" && <Tag tone="leaf">Bonded</Tag>}
      </div>
      <div className="mt-3 mb-2 max-w-[560px]">
        <BondGlyph
          p={c.venue === "curve" ? c.progress : 1}
          w={560}
          h={52}
          ring={c.venue === "pool"}
          label={c.venue === "pool" ? "Bonded" : `Curve ${pct.slice(0, -1)} percent filled`}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        <Prose c={c} symbol={symbol} net={net} />
      </p>
    </section>
  );
}
