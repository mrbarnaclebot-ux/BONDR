// The console panel shell (UI-SPEC Shape: radius lg, line border, the mockup gradient, elev 1), shared so every
// panel has one h2 and the same Refresh dim. `busy` marks a DB-backed panel while the overview reloads.
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const PANEL =
  "min-w-0 rounded-lg border border-line bg-[linear-gradient(180deg,color-mix(in_oklch,var(--surface-2)_85%,transparent),color-mix(in_oklch,var(--surface)_92%,transparent))] p-4 shadow-elev-1 transition-opacity duration-(--dur) md:p-6";

type PanelProps = {
  id: string;
  title: string;
  note?: ReactNode;
  busy?: boolean;
  className?: string;
  focusTitle?: boolean; // the h2 takes programmatic focus (the Timeline on a coin pick)
  children: ReactNode;
};

export function Panel({ id, title, note, busy, className, focusTitle, children }: PanelProps) {
  return (
    <section
      aria-labelledby={id}
      aria-busy={busy || undefined}
      className={cn(PANEL, busy && "opacity-60", className)}
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id={id} tabIndex={focusTitle ? -1 : undefined} className="display text-[28px] leading-none">
          {title}
        </h2>
        {note && <small className="text-xs text-muted-foreground">{note}</small>}
      </div>
      {children}
    </section>
  );
}

export const TONE = {
  plain: "text-foreground",
  ok: "text-leaf",
  warn: "text-warn",
  danger: "text-destructive",
  muted: "text-muted-foreground",
} as const;
