import type { CSSProperties } from "react";

/**
 * Segmented control (UI-SPEC Seg): a group of native aria-pressed buttons over a pill track. The mint indicator
 * slides by CSS alone: equal-width buttons, so its offset is the pressed index times its own width.
 */
export function Seg<T extends string>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange(v: T): void;
}) {
  const { options, value } = props;
  const style = { "--i": options.indexOf(value), "--n": options.length } as CSSProperties;
  return (
    // A fieldset is a native role="group"; aria-label names it without a visible legend.
    <fieldset
      aria-label={props.label}
      style={style}
      className="relative m-0 inline-grid min-w-0 auto-cols-fr grid-flow-col rounded-full border border-line bg-surface/80 p-1 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--shade)_70%,transparent)]"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%_-_8px)/var(--n))] translate-x-[calc(var(--i)*100%)] rounded-full bg-[linear-gradient(180deg,color-mix(in_oklch,var(--mint),var(--foreground)_18%),var(--mint))] shadow-[var(--hi)] transition-[translate] duration-[520ms] ease-(--ease-spring)"
      />
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => props.onChange(o)}
          className="relative min-h-11 cursor-pointer rounded-full px-4 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-ink md:min-h-9"
        >
          {o}
        </button>
      ))}
    </fieldset>
  );
}
