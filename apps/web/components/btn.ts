// Button classes from the UI-SPEC variants (mockup tokens.css .btn).
// ponytail: plain class strings for the header and consent dialog; 02-07 ports the shadcn Button, then swap.
const BASE =
  "relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap no-underline " +
  "[transition:translate_420ms_var(--ease-spring),scale_80ms,background-color_var(--dur),border-color_var(--dur),color_var(--dur),box-shadow_300ms_var(--ease-out)] " +
  "hover:-translate-y-px active:translate-y-px active:scale-99 [&_svg]:size-4 [&_svg]:flex-none " +
  "disabled:cursor-not-allowed disabled:translate-y-0 disabled:scale-100 disabled:border-dashed disabled:border-line-strong disabled:bg-none disabled:bg-transparent disabled:text-[color-mix(in_oklch,var(--foreground)_50%,var(--background))] disabled:shadow-none";

const VARIANT = {
  quiet: "border-line-strong bg-surface/60 text-foreground hover:border-mint hover:text-foreground",
  solid:
    "border-transparent bg-forest text-foreground shadow-[var(--hi)] hover:bg-[color-mix(in_oklch,var(--forest),var(--leaf)_25%)] hover:text-foreground",
  primary:
    "border-transparent bg-[linear-gradient(180deg,color-mix(in_oklch,var(--leaf),var(--foreground)_12%),var(--leaf))] text-ink shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_45%,transparent),0_6px_20px_-8px_color-mix(in_oklch,var(--leaf)_70%,transparent)] hover:text-ink",
};

const SIZE = { md: "min-h-11 px-4 text-sm", lg: "min-h-13 px-6 text-base" };

export const btn = (variant: keyof typeof VARIANT, size: keyof typeof SIZE = "md") =>
  `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
