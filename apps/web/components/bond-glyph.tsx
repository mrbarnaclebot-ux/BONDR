import { useId } from "react";
import { cn } from "@/lib/cn";

type Props = { p: number; w: number; h: number; label: string; ring?: boolean };

type NodeProps = { ax: number; bx: number; cy: number; r: number; t: number; ring: boolean };

/** Node A, node B (filled once bonded, pulsing from 90 percent) and the ring that leaves node B. */
function Nodes({ ax, bx, cy, r, t, ring }: NodeProps) {
  const bonded = t >= 1;
  return (
    <>
      {ring && (
        <circle
          cx={bx}
          cy={cy}
          r={r}
          strokeWidth={1.5}
          className="origin-center fill-none stroke-leaf opacity-0 [transform-box:fill-box] motion-safe:animate-ring"
        />
      )}
      <circle
        cx={ax}
        cy={cy}
        r={r}
        className="fill-leaf drop-shadow-[0_0_6px_color-mix(in_oklch,var(--leaf)_60%,transparent)]"
      />
      <circle
        cx={bx}
        cy={cy}
        r={r * 0.92}
        strokeWidth={Math.max(1.4, r * 0.22)}
        className={cn(
          bonded ? "fill-leaf stroke-leaf" : "fill-ink stroke-mint",
          t >= 0.9 && !bonded && "motion-safe:animate-near",
        )}
      />
    </>
  );
}

/**
 * Two nodes joined by the curve fill, ported from the mockup's bondGlyph(): node B moves closer as the curve
 * fills, pulses from 90 percent, and is filled once bonded. `p` runs 0..1; `ring` (default at 1) radiates
 * from node B, off while a complete curve waits for PumpSwap. Each SVG defines its own gradient id, so
 * many glyphs on one page never share or lose one. Motion is motion-safe only (UI-SPEC Motion).
 */
export function BondGlyph({ p, w, h, label, ring = p >= 1 }: Props) {
  const id = `bond${useId().replace(/[^\w-]/g, "")}`;
  const t = Math.max(0, Math.min(p, 1));
  const [r, cy] = [h * 0.3, h / 2];
  const half = (w / 2 - r - 2) * (1 - 0.32 * t);
  const [ax, bx] = [w / 2 - half, w / 2 + half];
  const sw = r * 0.85;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full overflow-visible"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: "var(--forest)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--leaf)" }} />
          <stop offset="1" style={{ stopColor: "var(--mint)" }} />
        </linearGradient>
      </defs>
      <line
        x1={ax}
        x2={bx}
        y1={cy}
        y2={cy}
        strokeWidth={sw}
        strokeLinecap="round"
        className="stroke-surface-3"
      />
      {t > 0 && (
        <rect
          x={ax}
          y={cy - sw / 2}
          width={Math.max(sw, (bx - ax) * t)}
          height={sw}
          rx={sw / 2}
          fill={`url(#${id})`}
          className="origin-left drop-shadow-[0_0_4px_color-mix(in_oklch,var(--leaf)_45%,transparent)] [transform-box:fill-box] motion-safe:animate-bond-draw"
        />
      )}
      <Nodes ax={ax} bx={bx} cy={cy} r={r} t={t} ring={ring} />
    </svg>
  );
}
