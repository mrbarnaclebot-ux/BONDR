import { cn } from "@/lib/cn";

export const STEP_NAMES = ["Coin", "Dev buy and exit", "Review", "Sign", "Live"] as const;

// The bond chain: a connector (::before) runs from each node (::after) to the next, and fills once done.
const ITEM =
  "relative pt-8 text-xs text-muted-foreground transition-colors duration-(--dur) " +
  "before:absolute before:top-2.5 before:left-2.5 before:-right-2.5 before:h-1 before:rounded before:bg-surface-3 before:transition-[background] before:duration-600 before:ease-out last:before:hidden " +
  "after:absolute after:top-0.5 after:left-0 after:size-5 after:rounded-full after:border-2 after:border-line-strong after:bg-ink " +
  "after:[transition:background-color_500ms_var(--ease-spring),border-color_var(--dur),box-shadow_500ms_var(--ease-out),transform_500ms_var(--ease-spring)]";
const DONE =
  "text-foreground before:bg-[linear-gradient(90deg,var(--forest),var(--leaf))] after:border-mint after:bg-forest";
const CURRENT =
  "text-foreground after:scale-115 after:border-leaf after:bg-leaf after:shadow-[0_0_0_6px_color-mix(in_oklch,var(--leaf)_18%,transparent),0_0_22px_var(--leaf)]";

/** Not clickable: the panel buttons move between steps. Below 640px only the current label shows. */
export function LaunchStepper({ step }: { step: number }) {
  return (
    <ol className="my-8 grid grid-cols-5">
      {STEP_NAMES.map((name, i) => {
        const n = i + 1;
        const current = n === step;
        return (
          <li
            key={name}
            aria-current={current ? "step" : undefined}
            className={cn(ITEM, n < step && DONE, current && CURRENT)}
          >
            <span className="num block">{String(n).padStart(2, "0")} </span>
            <span className={cn("font-semibold", current ? "block whitespace-nowrap" : "max-sm:sr-only")}>
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
