"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

// UI-SPEC Shape: a 0-120% pill track; the cost mark sits at 100/120 and the forced-bond trigger at 105/120.
const COST = (100 / 120) * 100;
const TRIGGER = (105 / 120) * 100;

type Props = {
  ratio: number | null; // percent; null draws an empty track
  size: "lg" | "md" | "sm";
  label: string;
};

/**
 * The burn budget track (token page "lg" with the 100% and 105% labels, home rail "md" and "sm"). The width
 * transition is added after the first render and never under reduced motion, so a page load draws the bar
 * at its value (UI-SPEC Motion).
 */
export function ReadyBar({ ratio, size, label }: Props) {
  const [motion, setMotion] = useState(false);
  useEffect(() => setMotion(!matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  const fill = ratio === null ? 0 : (Math.min(Math.max(ratio, 0), 120) / 120) * 100;
  return (
    <div>
      {size === "lg" && (
        <div aria-hidden="true" className="relative mb-1 h-4 text-xs text-muted-foreground">
          <span className="absolute -translate-x-full pr-1" style={{ left: `${COST}%` }}>
            100%
          </span>
          <span className="absolute pl-1 text-foreground" style={{ left: `${TRIGGER}%` }}>
            105%
          </span>
        </div>
      )}
      <div
        role="img"
        aria-label={label}
        className={cn(
          "relative rounded-full bg-surface-3 shadow-[inset_0_1px_3px_var(--ink)]",
          size === "sm" ? "h-2" : "h-4",
        )}
      >
        {/* No fill element at 0, so an empty track has no glow dot. */}
        {fill > 0 && (
          <div
            className={cn(
              "h-full rounded-full bg-linear-to-r from-forest to-leaf shadow-[0_0_18px_-2px_color-mix(in_oklch,var(--leaf)_60%,transparent)]",
              motion && "transition-[width] duration-900 ease-(--ease-spring)",
            )}
            style={{ width: `${fill}%` }}
          />
        )}
        <span
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-line-strong"
          style={{ left: `${COST}%` }}
        />
        <span
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: `${TRIGGER}%` }}
        />
      </div>
    </div>
  );
}
