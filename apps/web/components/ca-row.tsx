"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./ui-button";

const SHOW_MS = 1600;

// Clipboard writes fail without permission or focus; the fallback selects the text for a manual copy.
function selectText(el: HTMLElement | null) {
  const selection = window.getSelection();
  if (!el || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

export type CopyShown = "idle" | "copied" | "manual";

export const manualHint = (): string =>
  `Press ${typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Cmd" : "Ctrl"}+C`;

/** Copies `text`; on failure selects `fallback` for a manual copy. The shown state resets after SHOW_MS. */
export function useCopy(text: string) {
  const [shown, setShown] = useState<CopyShown>("idle");
  useEffect(() => {
    if (shown === "idle") return;
    const timer = setTimeout(() => setShown("idle"), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  const copy = (fallback: HTMLElement | null) =>
    navigator.clipboard.writeText(text).then(
      () => setShown("copied"),
      () => {
        selectText(fallback);
        setShown("manual");
      },
    );
  return { shown, copy };
}

/** The full contract address with Copy (UI-SPEC CA row). */
export function CaRow({ mint }: { mint: string }) {
  const { shown, copy } = useCopy(mint);
  const text = useRef<HTMLSpanElement>(null);
  const label = { idle: "Copy address", copied: "Copied", manual: manualHint() }[shown];
  return (
    <div className="flex max-w-[640px] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface/85 py-2 pr-2 pl-4">
      <span className="basis-full text-xs tracking-[0.08em] text-muted-foreground uppercase">
        Contract address
      </span>
      <span ref={text} id="ca-address" className="num min-w-0 flex-1 text-[13px] [overflow-wrap:anywhere]">
        {mint}
      </span>
      <Button
        type="button"
        onClick={() => copy(text.current)}
        className={cn("md:min-h-10", shown === "copied" && "border-leaf/60 text-leaf hover:text-leaf")}
      >
        {shown === "copied" ? (
          <Check strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Copy strokeWidth={1.5} aria-hidden="true" />
        )}
        {label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {shown === "copied" ? "Contract address copied" : ""}
      </span>
    </div>
  );
}
