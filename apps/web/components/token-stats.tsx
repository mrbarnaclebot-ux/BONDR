import type { CoinLive } from "@bondr/core/api";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { mcapSol, signedPct, thousands } from "@/lib/format";

const MUTED = "text-muted-foreground";

/** Leaf above zero, destructive below; "0.0%" is muted, so color never stands in for the sign. */
const changeTone = (f: number) =>
  signedPct(f) === "0.0%" ? MUTED : f > 0 ? "text-leaf" : "text-destructive";

function Stat({ label, tone, children }: { label: string; tone?: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("num text-lg", tone)}>{children}</dd>
    </div>
  );
}

const NOT_COUNTED = (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">not counted yet</span>
  </>
);

/** The identity bar stats row (UI-SPEC Identity bar); `c` is null until the indexer has the coin's row. */
export function TokenStats({ c }: { c: CoinLive | null }) {
  const change = c?.change1h ?? null;
  return (
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
      <Stat label="Mcap" tone={c ? undefined : MUTED}>
        {c ? `${mcapSol(c.mcapSol)} SOL` : "–"}
      </Stat>
      <Stat label="1h" tone={change === null ? MUTED : changeTone(change)}>
        {change === null ? "–" : signedPct(change)}
      </Stat>
      <Stat label="1h volume" tone={c ? undefined : MUTED}>
        {c ? `${mcapSol(c.vol1h)} SOL` : "–"}
      </Stat>
      <Stat label="Holders" tone={c?.holders == null ? MUTED : undefined}>
        {c?.holders == null ? NOT_COUNTED : thousands(c.holders)}
      </Stat>
    </dl>
  );
}
