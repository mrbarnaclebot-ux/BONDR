import type { PauseReason, Status } from "@bondr/core/api";
import { Pause } from "lucide-react";
import type { Metadata } from "next";
import { Callout } from "@/components/callout";
import { HomeHero } from "@/components/home-hero";
import { heroCounts } from "@/lib/coins";
import { workerGet } from "@/lib/worker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BONDR: built to bond",
  description: "Every coin on BONDR launches with one job: reach its bond.",
};

const PAUSED: Record<PauseReason, string> = {
  awaiting_migration:
    "BONDR's own curve is complete and moving to PumpSwap. Launches resume automatically once the pool is live.",
  kill_switch: "The BONDR owner has paused new launches. Browsing is unaffected.",
};

/** Launch status read once per render, never polled (UI-SPEC Paused banner); a failed read shows no banner. */
async function pauseReason(): Promise<PauseReason | null> {
  const { status, body } = await workerGet<Status>("/status");
  return status === 200 && "paused" in body ? (body.paused ?? null) : null;
}

/** Home: paused banner, hero with the D-09 counts, and All coins. No closest-to-bond rail (D-08), no USD (D-01). */
export default async function Home() {
  const [counts, paused] = await Promise.all([heroCounts().catch(() => null), pauseReason()]);
  return (
    <div className="overflow-x-clip">
      {paused && (
        <div className="mx-auto w-full max-w-[1440px] px-(--gutter) pt-4">
          <Callout variant="warn" icon={Pause} title="Launches paused.">
            {PAUSED[paused]}
          </Callout>
        </div>
      )}
      <HomeHero counts={counts} paused={paused !== null} />
      <section
        id="all-coins"
        aria-labelledby="all-coins-h"
        className="mx-auto w-full max-w-[1440px] scroll-mt-20 px-(--gutter) pt-16"
      >
        <div className="reveal mb-6">
          <h2 id="all-coins-h" className="display text-[clamp(2.5rem,6vw,4.5rem)]">
            All coins
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Only coins launched on BONDR.</p>
        </div>
      </section>
    </div>
  );
}
