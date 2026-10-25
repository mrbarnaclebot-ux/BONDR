"use client";
import { SUPPLY } from "@bondr/core/price";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { flashClass } from "@/lib/flash";
import { burnedPct, mcapSol, signedPct, thousands } from "@/lib/format";
import { useCoinLive } from "./coin-live";

const MUTED = "text-muted-foreground";

/** Leaf above zero, destructive below; "0.0%" is muted, so color never stands in for the sign. */
const changeTone = (f: number) =>
  signedPct(f) === "0.0%" ? MUTED : f > 0 ? "text-leaf" : "text-destructive";

type Flash = { side: "buy" | "sell"; n: number } | null | undefined;

/** `flash` remounts the value per trade (its key), so the tint replays on every trade, not only the first. */
function Stat(p: { label: string; tone?: string; flash?: Flash; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">{p.label}</dt>
      <dd
        key={p.flash?.n}
        className={cn("num rounded-sm text-lg", p.tone, p.flash && flashClass(p.flash.side))}
      >
        {p.children}
      </dd>
    </div>
  );
}

const NOT_COUNTED = (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">not counted yet</span>
  </>
);

/**
 * The identity bar stats row (UI-SPEC Identity bar), live from CoinLiveProvider; the coin is null until the
 * indexer has its row. Mcap and 1h flash by the trade side (D-15); volume, holders and Supply burned just update.
 */
export function TokenStats() {
  const live = useCoinLive();
  const c = live?.coin ?? null;
  const change = c?.change1h ?? null;
  const fees = c?.fees;
  const burned = !!fees && BigInt(fees.burnedSupply) > 0n;
  return (
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
      <Stat label="Mcap" tone={c ? undefined : MUTED} flash={live?.flash}>
        {c ? `${mcapSol(c.mcapSol)} SOL` : "–"}
      </Stat>
      <Stat label="1h" tone={change === null ? MUTED : changeTone(change)} flash={live?.flash}>
        {change === null ? "–" : signedPct(change)}
      </Stat>
      <Stat label="1h volume" tone={c ? undefined : MUTED}>
        {c ? `${mcapSol(c.vol1h)} SOL` : "–"}
      </Stat>
      <Stat label="Holders" tone={c?.holders == null ? MUTED : undefined}>
        {c?.holders == null ? NOT_COUNTED : thousands(c.holders)}
      </Stat>
      <Stat label="Supply burned" tone={burned ? "text-leaf" : MUTED}>
        {fees ? burnedPct(fees.burnedSupply, SUPPLY) : "–"}
      </Stat>
    </dl>
  );
}
