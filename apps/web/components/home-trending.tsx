"use client";

import type { CoinRow } from "@bondr/core/api";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { age, mcapSol } from "@/lib/format";
import type { TrendMode } from "@/lib/live-list";
import { CoinCard } from "./coin-card";
import { useHome } from "./home-live";

const CAPTION: Record<TrendMode, string> = {
  "1h": "Ranked by volume in the last hour. Drag, swipe or use the arrows.",
  "24h": "Ranked by volume in the last 24 hours. Drag, swipe or use the arrows.",
  latest: "No trades in the last 24 hours, so these are the latest launches.",
};

/** Volume chip in the two volume modes; the coin's age when the list is just the latest launches. */
function chip(c: CoinRow, mode: TrendMode) {
  if (mode === "1h") return `${mcapSol(c.vol1h)} SOL 1h`;
  if (mode === "24h") return `${mcapSol(c.vol24h)} SOL 24h`;
  return (
    <time dateTime={c.launchedAt} suppressHydrationWarning>
      {age(c.launchedAt)}
    </time>
  );
}

/**
 * The drag's pointer handlers on `el`. Snap is off while dragging, and a drag over 4px captures the pointer (so
 * leaving the region does not stop it) and swallows the click that ends it, so the card under it does not open.
 * Capture waits for the 4px, since a captured pointer's click lands on the region, not the card.
 */
function dragHandlers(el: HTMLElement) {
  let start: { x: number; left: number } | null = null;
  let moved = 0;
  const down = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    start = { x: e.clientX, left: el.scrollLeft };
    moved = 0;
  };
  const move = (e: PointerEvent) => {
    if (!start) return;
    moved = Math.max(moved, Math.abs(e.clientX - start.x));
    if (moved <= 4) return;
    if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    el.style.scrollSnapType = "none";
    el.scrollLeft = start.left - (e.clientX - start.x);
  };
  // pointercancel too: a native drag or a lost pointer ends the drag instead of leaving it stuck.
  const up = (e: PointerEvent) => {
    start = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.style.scrollSnapType = "";
  };
  const click = (e: MouseEvent) => {
    if (moved > 4) {
      e.preventDefault();
      e.stopPropagation();
    }
    moved = 0;
  };
  return { down, move, up, click };
}

/** Mouse drag scrolls the region; touch and wheel scroll natively. */
function useDrag(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { down, move, up, click } = dragHandlers(el);
    const on = [
      ["pointerdown", down],
      ["pointermove", move],
      ["pointerup", up],
      ["pointercancel", up],
      ["pointerleave", up],
    ] as const;
    for (const [k, f] of on) el.addEventListener(k, f);
    el.addEventListener("click", click, true);
    return () => {
      for (const [k, f] of on) el.removeEventListener(k, f);
      el.removeEventListener("click", click, true);
    };
  }, [ref]);
}

const ARROW =
  "grid size-11 place-items-center rounded-full border border-line-strong bg-surface-2 text-foreground shadow-elev-1 transition-[translate,scale,border-color,opacity] duration-[420ms] ease-(--ease-spring) hover:scale-108 hover:border-mint aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:hover:scale-100 aria-disabled:hover:border-line-strong";

/** Whether the scroller is at its start and end (8px tolerance); `edges` re-reads them on scroll. */
function useEdges(ref: RefObject<HTMLElement | null>) {
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  // Booleans, so a render with unchanged edges sets nothing and the effect below settles.
  function edges() {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft < 8);
    setAtEnd(el.scrollLeft + el.clientWidth > el.scrollWidth - 8);
  }
  useEffect(() => {
    edges();
    window.addEventListener("resize", edges);
    return () => window.removeEventListener("resize", edges);
  });
  return { atStart, atEnd, edges };
}

type ArrowsProps = { scroller: RefObject<HTMLElement | null>; atStart: boolean; atEnd: boolean };

/** 760px and up: two card widths plus the gaps per click; aria-disabled (still focusable) at each edge. */
function Arrows({ scroller, atStart, atEnd }: ArrowsProps) {
  function scroll(dir: 1 | -1) {
    const el = scroller.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card || (dir < 0 ? atStart : atEnd)) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * (card.offsetWidth * 2 + 32), behavior: reduce ? "auto" : "smooth" });
  }
  const arrow = (dir: 1 | -1, off: boolean) => (
    <button
      type="button"
      aria-label={`Scroll trending ${dir < 0 ? "left" : "right"}`}
      aria-disabled={off}
      onClick={() => scroll(dir)}
      className={ARROW}
    >
      {dir < 0 ? (
        <ChevronLeft className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <ChevronRight className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
  return (
    <div className="hidden gap-2 min-[760px]:flex">
      {arrow(-1, atStart)}
      {arrow(1, atEnd)}
    </div>
  );
}

const SCROLLER =
  "-mx-(--gutter) grid cursor-grab auto-cols-[80%] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain scroll-px-(--gutter) px-(--gutter) pt-2 pb-6 [scrollbar-width:none] snap-x snap-mandatory active:cursor-grabbing min-[760px]:auto-cols-[288px] [&::-webkit-scrollbar]:hidden";

/** Trending (LIST-01, D-13), live from HomeLiveProvider; hidden while no coin exists. */
export function HomeTrending() {
  const { trend } = useHome();
  return trend?.coins.length ? <Scroller {...trend} /> : null;
}

/** Up to 10 cards in a side-scroller; the caption and chips follow the mode. */
function Scroller({ mode, coins }: { mode: TrendMode; coins: CoinRow[] }) {
  const { hold } = useHome();
  const ref = useRef<HTMLElement>(null);
  const { atStart, atEnd, edges } = useEdges(ref);
  useDrag(ref);
  return (
    <section aria-labelledby="trending-h" className="mx-auto w-full max-w-[1440px] px-(--gutter) pt-16">
      <div className="reveal mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 id="trending-h" className="display text-[clamp(2.5rem,6vw,4.5rem)]">
            Trending
          </h2>
          <p className="mt-1 text-xs text-muted-foreground md:text-sm">{CAPTION[mode]}</p>
        </div>
        <Arrows scroller={ref} atStart={atStart} atEnd={atEnd} />
      </div>
      <section
        {...hold}
        ref={ref}
        aria-label="Trending coins"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: UI-SPEC, the region takes focus so arrow keys scroll it
        tabIndex={0}
        onScroll={edges}
        className={SCROLLER}
      >
        {coins.map((c, i) => (
          <CoinCard
            key={c.mint}
            coin={c}
            variant="trending"
            rank={mode === "latest" ? undefined : i + 1}
            chip={chip(c, mode)}
          />
        ))}
      </section>
    </section>
  );
}
