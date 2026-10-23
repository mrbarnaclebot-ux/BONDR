"use client";
import { Check, Copy } from "lucide-react";
import { short } from "@/lib/format";
import { manualHint, useCopy } from "./ca-row";

/**
 * The token page's short mint chip (UI-SPEC meta row). The chip only shows 8 characters, so a failed write
 * selects the full address in the CA row below it for a manual copy.
 */
export function CopyChip({ mint }: { mint: string }) {
  const { shown, copy } = useCopy(mint);
  return (
    <>
      <button
        type="button"
        aria-label="Copy contract address"
        onClick={() => copy(document.getElementById("ca-address"))}
        className="num inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted-foreground transition-colors duration-(--dur) hover:border-line-strong hover:text-foreground md:min-h-8 data-[shown=copied]:border-leaf/60 data-[shown=copied]:text-leaf"
        data-shown={shown}
      >
        {shown === "manual" ? manualHint() : short(mint)}
        {shown === "copied" ? (
          <Check className="size-3" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Copy className="size-3" strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {shown === "copied" ? "Contract address copied" : ""}
      </span>
    </>
  );
}
