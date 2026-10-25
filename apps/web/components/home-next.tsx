"use client";

// UI-SPEC Next to bond rail (Phase 3 D-08, D-24): the coins closest to forcing their bond, from the server render.
// Live trades and fee events move a coin's bar at once; the order, the countdowns and removals wait for the
// HomeLiveProvider tick, which holds while the pointer or focus is inside (the `hold` spread). No reads here.
import type { CoinRow } from "@bondr/core/api";
import { windowEnd, windowOf } from "@bondr/core/fees";
import Link from "next/link";
import type { SyntheticEvent } from "react";
import { cn } from "@/lib/cn";
import { ratio1000, ratioPct, windowLeft } from "@/lib/format";
import { imageUrl } from "@/lib/pinata";
import { useHome } from "./home-live";
import { ReadyBar } from "./ready-bar";

const MUTED = "text-muted-foreground";
const PANEL =
  "w-[min(100%,560px)] rounded-lg border border-line p-6 shadow-elev-2 backdrop-blur-[10px] " +
  "bg-[linear-gradient(180deg,color-mix(in_oklch,var(--surface-2)_78%,transparent),color-mix(in_oklch,var(--surface)_88%,transparent))] " +
  "min-[1080px]:w-[min(100%,460px)] min-[1080px]:justify-self-end";
const ROW =
  "grid min-h-11 grid-cols-[28px_64px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-3 text-sm text-foreground no-underline hover:text-foreground " +
  "max-[560px]:grid-cols-[28px_56px_minmax(0,1fr)_auto] motion-safe:transition-transform motion-safe:duration-400 " +
  "motion-safe:ease-(--ease-spring) motion-safe:hover:translate-x-1";

// A failed gateway load leaves the surface-2 block (Phase 3 card image rule).
const hide = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.hidden = true;
};

function Ava({ cid, className }: { cid: string | null; className: string }) {
  const src = imageUrl(cid);
  return (
    <span aria-hidden="true" className={cn("flex-none overflow-hidden bg-surface-2", className)}>
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={hide}
        />
      )}
    </span>
  );
}

/** The figures one coin shows: the floored ratio (the token page's), the bar value and the sweep countdown. */
function view(c: CoinRow, at: number, windowMs: number) {
  const f = c.fees;
  const pct = f ? ratioPct(f.budget, f.cost) : "–";
  const r = f ? ratio1000(f.budget, f.cost) : null;
  const launched = Date.parse(c.launchedAt);
  const left = windowLeft(windowEnd(launched, windowOf(launched, at, windowMs), windowMs) - at);
  const label = `Burn budget ${pct.slice(0, -1)} percent ready; forced bond at 105 percent`;
  return { pct, ratio: r === null ? null : r / 10, left, label };
}

function Top({ c, at, windowMs }: { c: CoinRow; at: number; windowMs: number }) {
  const v = view(c, at, windowMs);
  return (
    <Link
      href={`/coin/${c.mint}`}
      aria-label={`${c.name}, ${c.symbol}, sweep in ${v.left}, ${v.pct} ready`}
      className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 py-4 text-foreground no-underline hover:text-foreground"
    >
      <Ava cid={c.imageCid} className="row-span-2 size-14 rounded-[14px]" />
      <b className="display self-end truncate text-[28px] leading-none">{c.name}</b>
      <span className={cn("self-start truncate text-xs", MUTED)}>{`${c.symbol}, sweep in ${v.left}`}</span>
      <div className="col-span-2 mt-1.5">
        <ReadyBar ratio={v.ratio} size="md" label={v.label} />
      </div>
      <div className={cn("col-span-2 flex justify-between gap-2 text-xs", MUTED)}>
        <span>
          <span className="num text-leaf">{v.pct}</span> ready
        </span>
        <span>Forced bond fires at 105%</span>
      </div>
    </Link>
  );
}

function Row({ c, at, windowMs }: { c: CoinRow; at: number; windowMs: number }) {
  const v = view(c, at, windowMs);
  return (
    <Link
      href={`/coin/${c.mint}`}
      aria-label={`${c.name}, ${c.symbol}, sweep in ${v.left}, ${v.pct} ready`}
      className={ROW}
    >
      <Ava cid={c.imageCid} className="size-7 rounded-lg" />
      <b className="truncate font-semibold">{c.symbol}</b>
      <ReadyBar ratio={v.ratio} size="sm" label={v.label} />
      <span className="num text-xs text-leaf">{v.pct}</span>
    </Link>
  );
}

/** The rail in the hero (hidden when no unbonded coin has a budget or the read failed). */
export function NextToBond({ windowMs }: { windowMs: number }) {
  const { rail, hold } = useHome();
  const [top, ...rest] = rail.coins;
  if (!top) return null;
  return (
    <section {...hold} aria-labelledby="next-h" className={PANEL}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="next-h" className={cn("text-xs font-semibold tracking-[0.09em] uppercase", MUTED)}>
          Next to bond
        </h2>
        <span className={cn("text-xs", MUTED)}>
          Burn budget vs cost to finish the curve. Marks at 100% and 105%.
        </span>
      </div>
      <Top c={top} at={rail.at} windowMs={windowMs} />
      {rest.map((c) => (
        <Row key={c.mint} c={c} at={rail.at} windowMs={windowMs} />
      ))}
    </section>
  );
}
