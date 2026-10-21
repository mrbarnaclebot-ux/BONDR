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

/** The full contract address with Copy (UI-SPEC CA row). */
export function CaRow({ mint }: { mint: string }) {
  const [shown, setShown] = useState<"idle" | "copied" | "manual">("idle");
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (shown === "idle") return;
    const timer = setTimeout(() => setShown("idle"), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  const copy = () =>
    navigator.clipboard.writeText(mint).then(
      () => setShown("copied"),
      () => {
        selectText(text.current);
        setShown("manual");
      },
    );
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const label = { idle: "Copy address", copied: "Copied", manual: `Press ${mac ? "Cmd" : "Ctrl"}+C` }[shown];
  return (
    <div className="flex max-w-[640px] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface/85 py-2 pr-2 pl-4">
      <span className="basis-full text-xs tracking-[0.08em] text-muted-foreground uppercase">
        Contract address
      </span>
      <span ref={text} className="num min-w-0 flex-1 text-[13px] [overflow-wrap:anywhere]">
        {mint}
      </span>
      <Button
        type="button"
        onClick={copy}
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
