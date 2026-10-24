"use client";
import type { TradeSide } from "@bondr/core/api";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { flashClass } from "@/lib/flash";
import { mcapSol } from "@/lib/format";
import { useTrade } from "@/lib/use-trade";
import { useCoinLive } from "./coin-live";
import { TradePanel } from "./trade-panel";
import { Button } from "./ui-button";

// UI-SPEC Mobile sticky bar and trade sheet: a bottom sheet, full width below 768px and a centered
// min(560px, 100%) from 768px; the page around it hides both from 1100px, where the column panel shows.
const DIALOG =
  "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[calc(100dvh-24px)] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[24px] border-t border-line-strong text-foreground animate-sheet " +
  "bg-[radial-gradient(90%_50%_at_50%_0%,color-mix(in_oklch,var(--leaf)_12%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] " +
  "shadow-[var(--elev-2),0_0_0_1px_color-mix(in_oklch,var(--leaf)_18%,transparent)] backdrop:bg-ink/60 backdrop:backdrop-blur-[4px] " +
  "md:mx-auto md:w-[min(560px,100%)]";

const WIDE = "(min-width: 1100px)";

/** The sticky Buy / Sell bar and the sheet that hosts the trade panel; both share useTrade with the column. */
export function TradeSheet() {
  const t = useTrade();
  const { setSide, setVisible } = t;
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const labelId = useId();
  // An in-flight trade keeps the sheet open, so its result is never lost from view (T-04-08-01).
  const busy = t.phase !== "idle";

  useEffect(() => {
    const d = dialog.current;
    if (!open || !d) return;
    if (!d.open) d.showModal();
    d.querySelector("input")?.focus();
    setVisible(true);
    return () => {
      d.close();
      setVisible(false);
      opener.current?.focus();
    };
  }, [open, setVisible]);

  // Crossing up to the wide layout closes the sheet; the column panel shows the same state.
  useEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => mq.matches && setOpen(false);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const show = (side: TradeSide, el: HTMLElement) => {
    opener.current = el;
    setSide(side);
    setOpen(true);
  };
  const close = () => !busy && setOpen(false);

  return (
    <>
      <Bar symbol={t.symbol} onOpen={show} />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click is the backdrop; Escape (onCancel) is its keyboard twin */}
      <dialog
        ref={dialog}
        aria-labelledby={labelId}
        className={DIALOG}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        // A close the cancel event could not stop (a repeated Escape) keeps the state in step.
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {open && <SheetBody busy={busy} labelId={labelId} onClose={close} />}
      </dialog>
    </>
  );
}

type BodyProps = { busy: boolean; labelId: string; onClose(): void };

/** The handle, the close button (aria-disabled while a trade is in flight) and the panel; mounted only while open. */
function SheetBody({ busy, labelId, onClose }: BodyProps) {
  return (
    <div className="relative grid gap-4 px-4 pt-2 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-[4px] bg-line-strong" />
      <button
        type="button"
        aria-label="Close trade panel"
        aria-disabled={busy || undefined}
        onClick={onClose}
        className="absolute top-2 right-2 grid size-11 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-(--dur) hover:text-foreground aria-disabled:cursor-not-allowed"
      >
        <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <TradePanel placement="sheet" labelId={labelId} />
    </div>
  );
}

type BarProps = { symbol: string; onOpen(side: TradeSide, el: HTMLElement): void };

/** The Quick trade bar: the live Mcap (flashing by the trade side, D-15) and the Buy and Sell openers. */
function Bar({ symbol, onOpen }: BarProps) {
  const live = useCoinLive();
  const c = live?.coin ?? null;
  const flash = live?.flash;
  return (
    <section
      aria-label="Quick trade"
      data-trade-bar
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-line-strong bg-background/85 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur-[14px]"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">Mcap</p>
        <p
          key={flash?.n}
          className={cn(
            "num truncate rounded-sm text-[15px]",
            !c && "text-muted-foreground",
            flash && flashClass(flash.side),
          )}
        >
          {c ? `${mcapSol(c.mcapSol)} SOL` : "–"}
        </p>
      </div>
      <Button
        variant="primary"
        aria-label={`Buy ${symbol}`}
        aria-haspopup="dialog"
        className="min-w-22"
        onClick={(e) => onOpen("buy", e.currentTarget)}
      >
        Buy
      </Button>
      <Button
        variant="quiet"
        aria-label={`Sell ${symbol}`}
        aria-haspopup="dialog"
        className="min-w-22"
        onClick={(e) => onOpen("sell", e.currentTarget)}
      >
        Sell
      </Button>
    </section>
  );
}
