import type { PauseReason, Status } from "@bondr/core/api";
import { Pause } from "lucide-react";
import type { Metadata } from "next";
import { Callout } from "@/components/callout";
import { HomeCoins } from "@/components/home-coins";
import { HomeHero } from "@/components/home-hero";
import { HomeLiveProvider } from "@/components/home-live";
import { HomeTrending } from "@/components/home-trending";
import { feeWindowMs, heroCounts, listCoins, nextToBond, parseQ, parseSort, trending } from "@/lib/coins";
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
  contract_check:
    "A weekly safety check found that pump.fun changed something BONDR depends on, so new launches are paused while the owner reviews it. Trading is not affected.",
};

/** Launch status read once per render, never polled (UI-SPEC Paused banner); a failed read shows no banner. */
async function pauseReason(): Promise<PauseReason | null> {
  const { status, body } = await workerGet<Status>("/status");
  return status === 200 && "paused" in body ? (body.paused ?? null) : null;
}

type Props = { searchParams: Promise<{ sort?: string | string[]; q?: string | string[] }> };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Home: paused banner, hero with the D-09 and D-24 counts and the Next to bond rail (hidden when empty or the read
 * failed), Trending (hidden with no coins), and All coins, all live through one HomeLiveProvider stream (LIST-04).
 * No USD (D-01).
 */
export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const sort = parseSort(one(params.sort)) ?? "top";
  const q = parseQ(one(params.q)) ?? "";
  const [counts, paused, list, trend, next] = await Promise.all([
    heroCounts().catch(() => null),
    pauseReason(),
    listCoins({ sort, page: 0, q }).catch(() => null),
    trending().catch(() => null),
    nextToBond().catch(() => []),
  ]);
  // The server's clock, so the rail's countdowns hydrate with the same text; the 60 s tick moves it on.
  const rail = { at: Date.now(), coins: next };
  return (
    <HomeLiveProvider list={list} sort={sort} q={q} trend={trend} counts={counts} rail={rail}>
      <div className="overflow-x-clip">
        {paused && (
          <div className="mx-auto w-full max-w-[1440px] px-(--gutter) pt-4">
            <Callout variant="warn" icon={Pause} title="Launches paused.">
              {PAUSED[paused]}
            </Callout>
          </div>
        )}
        <HomeHero paused={paused !== null} windowMs={feeWindowMs()} />
        <HomeTrending />
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
          <HomeCoins />
        </section>
      </div>
    </HomeLiveProvider>
  );
}
