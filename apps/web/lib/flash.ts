// UI-SPEC Motion: a live value flashes by the trade side (D-15), not the sign of the change; a new feed row
// rises with the same tint. Under prefers-reduced-motion the class is never added, checked here rather than
// left to the global 1 ms CSS override. Literal class names, so Tailwind sees them in the source.
const CLASS = {
  value: { buy: "animate-flash-up", sell: "animate-flash-down" },
  row: { buy: "animate-row-up", sell: "animate-row-down" },
} as const;

export type Side = "buy" | "sell";

export function flashClass(side: Side, kind: keyof typeof CLASS = "value"): string {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "";
  return CLASS[kind][side];
}
