import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

// UI-SPEC Tag: mint for the curve states, leaf for "Bonded" and burns, warn for cautions, plain (no fill) for
// neutral ledger rows. `live` adds the pulsing dot.
const tagVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold tracking-[0.05em] whitespace-nowrap uppercase",
  {
    variants: {
      tone: {
        mint: "border-mint/40 bg-mint-wash text-mint",
        leaf: "border-leaf/45 bg-leaf-wash text-leaf",
        warn: "border-warn/45 bg-warn-wash text-warn",
        plain: "border-line-strong text-foreground",
      },
    },
    defaultVariants: { tone: "mint" },
  },
);

type TagProps = VariantProps<typeof tagVariants> & { live?: boolean; children: ReactNode };

export function Tag({ tone, live, children }: TagProps) {
  return (
    <span className={tagVariants({ tone })}>
      {live && <span aria-hidden="true" className="size-[7px] animate-live rounded-full bg-current" />}
      {children}
    </span>
  );
}
