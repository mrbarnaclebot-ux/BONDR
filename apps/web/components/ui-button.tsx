import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// Hand-ported from shadcn 4.21.2 button (the CLI is not run, D-21). Variants and sizes are the UI-SPEC's.
export const buttonVariants = cva(
  "relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap no-underline " +
    "[transition:translate_420ms_var(--ease-spring),scale_80ms,background-color_var(--dur),border-color_var(--dur),color_var(--dur),box-shadow_300ms_var(--ease-out)] " +
    "hover:-translate-y-px active:translate-y-px active:scale-99 [&_svg]:size-4 [&_svg]:flex-none " +
    "disabled:cursor-not-allowed disabled:translate-y-0 disabled:scale-100 disabled:border-dashed disabled:border-line-strong disabled:bg-none disabled:bg-transparent disabled:text-[color-mix(in_oklch,var(--foreground)_50%,var(--background))] disabled:shadow-none",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[linear-gradient(180deg,color-mix(in_oklch,var(--leaf),var(--foreground)_12%),var(--leaf))] text-ink shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_45%,transparent),0_6px_20px_-8px_color-mix(in_oklch,var(--leaf)_70%,transparent)] hover:text-ink hover:shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_45%,transparent),0_12px_32px_-8px_color-mix(in_oklch,var(--leaf)_75%,transparent)]",
        quiet: "border-line-strong bg-surface/60 text-foreground hover:border-mint hover:text-foreground",
        solid:
          "border-transparent bg-forest text-foreground shadow-[var(--hi)] hover:bg-[color-mix(in_oklch,var(--forest),var(--leaf)_25%)] hover:text-foreground",
        danger:
          "border-transparent bg-destructive text-ink shadow-[0_8px_28px_-8px_color-mix(in_oklch,var(--destructive)_70%,transparent)] hover:text-ink",
      },
      size: { default: "min-h-11 px-4 text-sm", lg: "min-h-13 px-6 text-base" },
    },
    defaultVariants: { variant: "quiet", size: "default" },
  },
);

type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
