"use client";

// UI-SPEC Bond and burn, bonded on PumpSwap (TOKEN-03, FEE-05): the bond moment, the bond burn and the fee shares.
// Every number comes from the coin row (D-23). A held finalize is plain "Pending review" with no reason: the
// reason never leaves the server, and it is an ops matter, not a holder alarm (D-18).
import type { CoinFees, Net } from "@bondr/core/api";
import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { age, compact, feeSol, short, whole } from "@/lib/format";
import { Tag } from "./tag";
import { TxLink } from "./tx-link";

const MUTED = "text-muted-foreground";
const Num = ({ children }: { children: ReactNode }) => (
  <span className="num text-foreground">{children}</span>
);

/** The orb's radiating rings are not rendered under reduced motion (UI-SPEC Motion, checked in JS). */
function useMotion() {
  const [motion, setMotion] = useState(false);
  useEffect(() => setMotion(!matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return motion;
}

function Art({ image }: { image: string | null }) {
  const motion = useMotion();
  return (
    <div
      aria-hidden="true"
      className="relative grid min-h-[200px] items-center overflow-hidden rounded-[var(--radius)]"
    >
      <Image
        src="/art/hero-bond-960.jpg"
        alt=""
        fill
        sizes="(min-width: 1100px) 330px, 100vw"
        className="object-cover object-[62%_50%]"
      />
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,transparent_35%,color-mix(in_oklch,var(--ink)_70%,transparent))]" />
      <div className="relative ml-[9%] grid size-[84px] place-items-center">
        {motion &&
          ["0s", "0.9s", "1.8s"].map((delay) => (
            <i
              key={delay}
              style={{ animationDelay: delay }}
              className="absolute size-[84px] animate-orb rounded-lg border-[1.5px] border-leaf opacity-0"
            />
          ))}
        <span
          style={image ? { backgroundImage: `url("${image}")` } : undefined}
          className="relative size-[84px] rounded-lg bg-surface bg-cover bg-center shadow-[0_0_0_2px_var(--leaf),0_0_40px_color-mix(in_oklch,var(--leaf)_70%,transparent)]"
        />
      </div>
    </div>
  );
}

function momentBody(f: CoinFees, symbol: string): string {
  if (f.bondKind === "forced")
    return `${symbol}'s burn budget bought the last of its curve and burned it. It now trades on PumpSwap.`;
  if (f.bondKind === "fallback")
    return `Traders completed ${symbol}'s curve. Its burn budget then bought ${symbol} on PumpSwap and burned it.`;
  return `Traders completed ${symbol}'s curve. It now trades on PumpSwap.`;
}

type Bonded = { bondedAt: string | null; bondSig: string | null; image: string | null };
type Part = { f: CoinFees; symbol: string; net: Net };

// The bond itself is not a fee movement, so its transaction is linked here rather than in the ledger.
function Moment({ f, symbol, net, bondedAt, bondSig, image }: Part & Bonded) {
  return (
    <div className="mb-8 grid gap-4 rounded-[var(--radius)] border border-leaf/35 bg-[radial-gradient(circle_at_left,color-mix(in_oklch,var(--leaf)_22%,transparent),transparent_70%),color-mix(in_oklch,var(--ink)_40%,var(--surface))] p-6 @min-[600px]:grid-cols-2 @min-[600px]:items-center @min-[600px]:gap-8">
      <Art image={image} />
      <div>
        {bondedAt && (
          <p
            className="text-xs font-semibold tracking-[0.09em] text-leaf uppercase"
            suppressHydrationWarning
          >{`Bonded ${age(bondedAt)} ago`}</p>
        )}
        <h3 className="display text-[44px] leading-[0.95]">
          {f.bondKind === "forced" ? "Forced by its own fees." : "Bonded by its traders."}
        </h3>
        <p className={cn("mt-2 text-sm", MUTED)}>
          {momentBody(f, symbol)}
          {bondSig && (
            <>
              {" "}
              <TxLink signature={bondSig} net={net}>{`Bond tx ${short(bondSig)}`}</TxLink>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

type GaugeProps = { head: string; tag?: ReactNode; big: ReactNode; children: ReactNode };

function Gauge({ head, tag, big, children }: GaugeProps) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-sm">
        <h3 className="font-semibold">{head}</h3>
        {tag}
      </div>
      <div className="mt-1 mb-3">{big}</div>
      <p className={cn("text-xs", MUTED)}>{children}</p>
    </div>
  );
}

const Big = ({ muted, children }: { muted?: boolean; children: ReactNode }) => (
  <span className={cn("num text-[28px] leading-none", muted && MUTED)}>{children}</span>
);

function BondBurn({ f, symbol, net }: Part) {
  if (f.bondKind && f.bondBurnSig) {
    const spent = (
      <>
        <Num>{whole(f.bondSpent)}</Num> BONDR (<Num>{feeSol(f.bondSpentSol)}</Num> SOL)
      </>
    );
    return (
      <Gauge
        head={f.bondKind === "forced" ? "Forced-bond buy" : "Fallback buy"}
        tag={<Tag tone="leaf">Bought and burned</Tag>}
        big={<Big>{`${compact(f.bondBurned)} ${symbol}`}</Big>}
      >
        {f.bondKind === "forced" ? (
          <>{spent} bought the rest of the curve and burned it in one transaction.</>
        ) : (
          <>
            Traders completed the curve first, so {spent} of burn budget bought {symbol} on PumpSwap and
            burned it in one transaction.
          </>
        )}{" "}
        <TxLink signature={f.bondBurnSig} net={net}>{`Burn tx ${short(f.bondBurnSig)}`}</TxLink>
      </Gauge>
    );
  }
  if (f.finalize === "none" && BigInt(f.budget) > 0n)
    return (
      <Gauge head="Bond burn" tag={<Tag tone="mint">Pending</Tag>} big={<Big muted>–</Big>}>
        {`The burn budget buys ${symbol} on PumpSwap and burns it right after the bond, usually within a minute.`}
      </Gauge>
    );
  return (
    <Gauge head="Bond burn" big={<Big muted>None</Big>}>
      {`The burn budget was empty when ${symbol} bonded, so there was nothing to burn.`}
    </Gauge>
  );
}

const Word = ({ children }: { children: string }) => (
  <span className={cn("text-sm", MUTED)}>{` ${children}`}</span>
);

/** "{d} deployer / {t} treasury"; muted while the shares are not set. */
function Split({ d, t, muted }: { d: string; t: string; muted?: boolean }) {
  return (
    <Big muted={muted}>
      {d}
      <Word>deployer</Word>
      {` / ${t}`}
      <Word>treasury</Word>
    </Big>
  );
}

function FeeShares({ f, net }: Omit<Part, "symbol">) {
  if (f.finalize === "done") {
    const d = f.deployerBps;
    return (
      <Gauge
        head="Fee shares, permanent"
        tag={<Tag tone="mint">Finalized</Tag>}
        big={d === null ? <Big muted>–</Big> : <Split d={String(d / 100)} t={String((10_000 - d) / 100)} />}
      >
        Set once with update_fee_shares_v2 and locked by pump. Distribution is permissionless.
        {f.finalizeSig && (
          <>
            {" "}
            <TxLink signature={f.finalizeSig} net={net}>{`Finalize tx ${short(f.finalizeSig)}`}</TxLink>
          </>
        )}
      </Gauge>
    );
  }
  const held = f.finalize === "held";
  return (
    <Gauge
      head="Fee shares"
      tag={held ? <Tag tone="plain">Pending review</Tag> : <Tag tone="mint">Pending</Tag>}
      big={<Split d="80" t="20" muted />}
    >
      {held
        ? "Pending review. BONDR checks the deployer wallet before it sets the fee shares, and this coin is waiting for a manual check. Fees keep accruing and are shared once it is done."
        : "Set once after the bond burn: BONDR sweeps pending fees, checks the deployer, then sets the shares with one update_fee_shares_v2. This runs on its own, usually within a few minutes."}
    </Gauge>
  );
}

/** The bonded body of Bond and burn: the moment, then the two gauges side by side from a 600px container. */
export function BondAfter(p: Part & Bonded) {
  const { f, symbol, net } = p;
  return (
    <>
      <Moment {...p} />
      <div className="grid gap-8 @min-[600px]:grid-cols-2">
        <BondBurn f={f} symbol={symbol} net={net} />
        <FeeShares f={f} net={net} />
      </div>
    </>
  );
}
