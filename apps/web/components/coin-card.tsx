"use client";

import type { CoinRow } from "@bondr/core/api";
import Link from "next/link";
import type { ReactNode, SyntheticEvent } from "react";
import { cn } from "@/lib/cn";
import { flashClass, type Side } from "@/lib/flash";
import { age, curvePct, mcapSol, signedPct } from "@/lib/format";
import { imageUrl } from "@/lib/pinata";
import { BondGlyph } from "./bond-glyph";
import { useHomeLive } from "./home-live";
import { Tag } from "./tag";

type Flash = { side: Side; n: number } | undefined;
/** The trade side's tint; keyed by the trade counter so it replays on every trade (D-15). */
const lit = (f: Flash) => ({ key: f?.n, fl: f && flashClass(f.side) });

type Variant = "grid" | "trending";
type Props = { coin: CoinRow; variant?: Variant; rank?: number; chip?: ReactNode };

// A failed gateway load leaves the surface-2 block, not a broken image glyph.
const hide = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.hidden = true;
};

const CHIP =
  "absolute z-[1] inline-flex min-h-6 items-center rounded-full border border-line bg-ink/85 px-2 text-xs";

const IMG = {
  loading: "lazy",
  decoding: "async",
  draggable: false,
  className: "size-full object-cover",
} as const;

/** Art head: the blurred bleed and the avatar from the same gateway URL (the browser fetches it once). */
function Art({ cid, variant }: { cid: string | null; variant: Variant }) {
  const src = imageUrl(cid);
  // Not draggable: a press on the art would start a native image drag inside the Trending scroller.
  const img = src && <img src={src} alt="" {...IMG} onError={hide} />;
  const grid = variant === "grid";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex-none overflow-hidden",
        grid ? "h-[104px] max-[560px]:h-auto max-[560px]:w-[108px]" : "h-[150px]",
      )}
    >
      <div className="absolute -inset-[30%] scale-115 opacity-75 blur-[28px] saturate-130 transition-transform duration-900 ease-(--ease-out) group-hover:scale-130 group-hover:rotate-4">
        {img}
      </div>
      <div
        className={cn(
          "absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,var(--surface-2))]",
          grid && "max-[560px]:bg-[linear-gradient(90deg,transparent_40%,var(--surface-2))]",
        )}
      />
      <div
        className={cn(
          "absolute z-[1] overflow-hidden bg-surface-2 shadow-[0_0_0_1px_color-mix(in_oklch,var(--foreground)_18%,transparent),0_14px_30px_-10px_var(--ink)] transition-transform duration-[560ms] ease-(--ease-spring) group-hover:-translate-y-1 group-hover:-rotate-4",
          grid
            ? "bottom-3 left-3 size-14 rounded-[14px] max-[560px]:top-1/2 max-[560px]:left-1/2 max-[560px]:-translate-1/2"
            : "bottom-4 left-4 size-[72px] rounded-[18px]",
        )}
      >
        {img}
      </div>
    </div>
  );
}

function Change({ f, flash }: { f: number | null; flash: Flash }) {
  const tone =
    f === null || signedPct(f) === "0.0%"
      ? "text-muted-foreground"
      : f > 0
        ? "text-leaf"
        : "text-destructive";
  const { key, fl } = lit(flash);
  return (
    <span
      key={key}
      data-field="change"
      className={cn(
        "num inline-flex min-h-6 items-center rounded-full bg-[color-mix(in_oklch,currentColor_12%,transparent)] px-2 text-sm",
        tone,
        fl,
      )}
    >
      {f === null ? "–" : signedPct(f)}
    </span>
  );
}

function Bond({ coin, flash }: { coin: CoinRow; flash: Flash }) {
  const bonded = coin.venue !== "curve" || coin.progress >= 1;
  const pct = curvePct(coin.progress);
  const { key, fl } = lit(flash);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
      <BondGlyph
        p={coin.progress}
        w={160}
        h={18}
        label={bonded ? "Bonded" : `Curve ${pct.slice(0, -1)} percent filled`}
      />
      {bonded ? (
        <span aria-hidden="true">
          <Tag tone="leaf">Bonded</Tag>
        </span>
      ) : (
        <span aria-hidden="true" className="text-xs whitespace-nowrap">
          <span className="text-muted-foreground">curve</span>{" "}
          <span key={key} data-field="curve" className={cn("num rounded-sm", fl)}>
            {pct}
          </span>
        </span>
      )}
    </div>
  );
}

const Age = ({ at }: { at: string }) => (
  <time dateTime={at} suppressHydrationWarning>
    {age(at)}
  </time>
);

/** The grid's age chip, the trending rank chip and the trending volume chip, over the art. */
function Chips({
  coin,
  grid,
  rank,
  chip,
}: {
  coin: CoinRow;
  grid: boolean;
  rank?: number;
  chip?: ReactNode;
}) {
  return (
    <>
      {grid && (
        <span
          className={cn(
            CHIP,
            "top-3 right-3 max-[560px]:top-auto max-[560px]:right-auto max-[560px]:bottom-2 max-[560px]:left-2",
          )}
        >
          <Age at={coin.launchedAt} />
        </span>
      )}
      {rank !== undefined && (
        <span className={cn(CHIP, "top-3 left-3 px-2 py-0 font-display text-[15px] font-extrabold")}>
          #{rank}
        </span>
      )}
      {chip && <span className={cn(CHIP, "top-3 right-3")}>{chip}</span>}
    </>
  );
}

/**
 * One coin as a single link (UI-SPEC Coin card, LIST-04): art, name and symbol, market cap in SOL with the 1h
 * change, bond progress. Grid cards carry the age chip and turn horizontal below 560px; trending cards take a
 * rank and a volume chip. data-field marks the numbers a live trade flashes; on the home page the flash and the
 * new-launch glow come from HomeLiveProvider.
 */
export function CoinCard({ coin, variant = "grid", rank, chip }: Props) {
  const live = useHomeLive();
  const flash = live?.flash[coin.mint];
  const { key, fl } = lit(flash);
  const grid = variant === "grid";
  return (
    <Link
      href={`/coin/${coin.mint}`}
      draggable={false}
      className={cn(
        "group relative flex flex-1 snap-start flex-col overflow-hidden rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),var(--surface)_60%)] text-foreground no-underline shadow-elev-1 select-none [transition:translate_560ms_var(--ease-spring),box-shadow_400ms_var(--ease-out)] hover:-translate-y-1.5 hover:text-foreground hover:shadow-[var(--elev-2),0_0_0_1px_color-mix(in_oklch,var(--leaf)_35%,transparent)]",
        grid && "max-[560px]:flex-row",
        grid && live?.fresh.has(coin.mint) && "animate-launch",
      )}
    >
      <Art cid={coin.imageCid} variant={variant} />
      <div className={cn("grid min-w-0 flex-1 gap-2 px-4 pt-1 pb-4", grid && "max-[560px]:py-2")}>
        <div className="flex min-w-0 items-baseline gap-2">
          <b className="display truncate text-[20px] leading-none">{coin.name}</b>
          <span className="text-xs font-semibold tracking-[0.06em] text-muted-foreground">{coin.symbol}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span>
            <span key={key} data-field="mcap" className={cn("num rounded-sm text-lg", fl)}>
              {mcapSol(coin.mcapSol)} SOL
            </span>
            {!grid && (
              <span className="block text-xs text-muted-foreground">
                <Age at={coin.launchedAt} /> old
              </span>
            )}
          </span>
          <Change f={coin.change1h} flash={flash} />
        </div>
        <Bond coin={coin} flash={flash} />
      </div>
      <Chips coin={coin} grid={grid} rank={rank} chip={chip} />
    </Link>
  );
}
