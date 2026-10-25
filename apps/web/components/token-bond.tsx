"use client";
import type { CoinFees, CoinRow, Net } from "@bondr/core/api";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { flashClass, type Side } from "@/lib/flash";
import { curvePct, mcapSol, utcStamp, whole } from "@/lib/format";
import { BondAfter } from "./bond-after";
import { BondBudget } from "./bond-budget";
import { BondGlyph } from "./bond-glyph";
import { useCoinLive } from "./coin-live";

// The shell (UI-SPEC Bond and burn): head note per venue and the Curve filled gauge; on curve BondBudget adds
// the burn budget, window and fee flow; once bonded BondAfter replaces the gauge with the moment and the burn.
export type BondCoin = Pick<
  CoinRow,
  "venue" | "progress" | "realQuoteReserves" | "bondrAtBond" | "bondSol" | "bondSig" | "bondedAt"
> & { fees?: CoinFees };

const Num = ({ children }: { children: ReactNode }) => (
  <span className="num text-foreground">{children}</span>
);

function CurveProse({ c }: { c: BondCoin }) {
  if (c.bondrAtBond === null) return null;
  return (
    <>
      <Num>{whole(c.realQuoteReserves)}</Num> of <Num>{whole(c.bondrAtBond)}</Num> BONDR in the curve.
      {c.bondSol !== null && (
        <>
          {" "}
          Bonds at about <Num>{mcapSol(c.bondSol)}</Num> SOL.
        </>
      )}
    </>
  );
}

function Prose({ c, symbol }: { c: BondCoin; symbol: string }) {
  if (c.venue === "curve") return <CurveProse c={c} />;
  return `The curve is complete. ${symbol} moves to PumpSwap automatically, usually within a minute.`;
}

type Flash = { side: Side; n: number } | null;

/** "Curve filled", the big percentage (flashing on a trade) and the Bonded tag once on PumpSwap. */
function Gauge({ c, pct, flash }: { c: BondCoin; pct: string; flash: Flash }) {
  return (
    <>
      <div className="flex justify-between gap-2 text-sm">
        <h3 className="font-semibold">Curve filled</h3>
        {c.venue === "curve" && <span className="text-xs text-muted-foreground">bonds at 100%</span>}
      </div>
      <div className="flex items-center gap-3">
        <span
          key={flash?.n}
          className={cn("num rounded-sm text-[28px] leading-none", flash && flashClass(flash.side))}
        >
          {pct}
        </span>
      </div>
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

// An unindexed coin: nothing collected, cost not measured yet.
const NO_FEES: CoinFees = {
  w: null,
  budget: "0",
  budgetSol: null,
  cost: null,
  costSol: null,
  toBuyback: "0",
  toBuybackSol: "0",
  toTreasury: "0",
  toTreasurySol: "0",
  bondSpent: "0",
  bondSpentSol: "0",
  bondBurned: "0",
  burnedSupply: "0",
  bondKind: null,
  bondBurnSig: null,
  deployerEarned: "0",
  deployerEarnedSol: "0",
  finalize: "none",
  deployerBps: null,
  finalizeSig: null,
};

/** UI-SPEC Head note, per venue; the bond time is UTC. */
function headNote(c: BondCoin): ReactNode {
  if (c.venue === "curve")
    return "Pre-bond, creator fees can only force the bond or be swept to the BONDR buyback.";
  if (c.venue === "complete") return "The curve is complete.";
  const at = c.bondedAt && <span className="num">{` ${utcStamp(c.bondedAt)} UTC`}</span>;
  const by = c.fees?.bondKind === "forced" ? ", forced by its own fees." : " by its traders.";
  return (
    <>
      Bonded{at}
      {by}
    </>
  );
}

type PanelProps = {
  symbol: string;
  net: Net;
  launchedAt: string | null;
  windowMs: number;
  image: string | null; // the coin image for the bond moment's orb
};

/**
 * UI-SPEC Bond and burn: on curve, complete and waiting, or bonded, live from CoinLiveProvider (a bond event
 * switches the state). The coin is null before it is indexed. A size container, so the inner layout follows
 * the panel's width in the 380px column and full width alike.
 */
export function BondPanel({ symbol, net, launchedAt, windowMs, image }: PanelProps) {
  const live = useCoinLive();
  const c: BondCoin = live?.coin ?? CURVE_START;
  const pct = curvePct(c.venue === "curve" ? c.progress : 1);
  const curve = (
    <>
      <Gauge c={c} pct={pct} flash={live?.flash ?? null} />
      <div className="mt-3 mb-2 max-w-[560px]">
        <BondGlyph
          p={c.venue === "curve" ? c.progress : 1}
          w={560}
          h={52}
          label={`Curve ${pct.slice(0, -1)} percent filled`}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        <Prose c={c} symbol={symbol} />
      </p>
    </>
  );
  return (
    <section
      aria-labelledby="bond-h"
      className="@container min-w-0 rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-4 shadow-elev-1 md:p-8 min-[1100px]:p-6"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="bond-h" className="display text-[28px] leading-none">
          Bond and burn
        </h2>
        <span className="text-xs text-muted-foreground">{headNote(c)}</span>
      </div>
      {c.venue === "curve" ? (
        <BondBudget fees={c.fees ?? NO_FEES} launchedAt={launchedAt} windowMs={windowMs} symbol={symbol}>
          {curve}
        </BondBudget>
      ) : c.venue === "pool" ? (
        <BondAfter
          f={c.fees ?? NO_FEES}
          symbol={symbol}
          net={net}
          bondedAt={c.bondedAt}
          bondSig={c.bondSig}
          image={image}
        />
      ) : (
        curve
      )}
    </section>
  );
}
