import type { LaunchView, Net } from "@bondr/core/api";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaRow } from "@/components/ca-row";
import { CoinIdentity } from "@/components/coin-identity";
import { CoinLiveProvider } from "@/components/coin-live";
import { ProofStamp } from "@/components/proof-stamp";
import { BondPanel } from "@/components/token-bond";
import { McapChart } from "@/components/token-chart";
import { TokenStats } from "@/components/token-stats";
import { TradeFeed } from "@/components/token-trades";
import { coinByMint } from "@/lib/coins";
import { chartInterval, compact, short, sol } from "@/lib/format";
import { landedCoin } from "@/lib/launches";
import { tradesPage } from "@/lib/trades";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await landedCoin((await params).mint);
  if (!v) return { title: "No BONDR coin here" };
  const fate = v.exit === "burn" ? "burned" : "sold back";
  return {
    title: `${v.name} (${v.symbol}) on BONDR`,
    description: `Dev holds 0 launch supply. The ${sol(v.solIn)} SOL dev buy was ${fate} in the launch transaction.`,
    twitter: { card: "summary_large_image" },
  };
}

// The first feed page and the coin row are kept 10 s, so a burst of views of one coin (a shared link) is one
// Neon read each; Load more and the live stream bring anything newer or older.
// ponytail: per-process map cleared at 1000 entries; move to a shared cache if web runs more than one instance.
const TTL = 10_000;

function kept<T>(read: (mint: string) => Promise<T>) {
  const seen = new Map<string, { at: number; v: T }>();
  return async (mint: string): Promise<T> => {
    const hit = seen.get(mint);
    if (hit && Date.now() - hit.at < TTL) return hit.v;
    const v = await read(mint);
    if (seen.size >= 1000) seen.clear();
    seen.set(mint, { at: Date.now(), v });
    return v;
  };
}

const firstPage = kept((mint) => tradesPage(mint));
const coinRow = kept(coinByMint);

/** UI-SPEC token page proof sentence; the token count is left out until the facts are written. */
function sentence(v: LaunchView): string {
  const tokens = v.facts?.tokens ? ` (${compact(v.facts.tokens)} ${v.symbol})` : "";
  const fate = v.exit === "burn" ? "burned" : "sold back";
  return `Deployer ${short(v.wallet)} chose insta ${v.exit}: the ${sol(v.solIn)} SOL dev buy${tokens} was ${fate} in the launch transaction.`;
}

/** The bare token page: only a landed BONDR launch renders, everything else is a 404 (T-02-15-04). */
export default async function CoinPage({ params }: Props) {
  const v = await landedCoin((await params).mint);
  if (!v) notFound();
  const net: Net = process.env.SOLANA_NET === "mainnet" ? "mainnet" : "devnet";
  const [feed, coin] = await Promise.all([firstPage(v.mint), coinRow(v.mint)]);
  return (
    // One provider, so one EventSource serves the venue tag, stats, bond panel and feed (D-18).
    <CoinLiveProvider mint={v.mint} initial={coin}>
      <div className="overflow-x-clip">
        <div className="mx-auto grid w-full max-w-[1440px] gap-4 px-(--gutter) pb-12">
          <CoinIdentity v={v} venue={coin?.venue} stats={<TokenStats />}>
            {v.signature && (
              <ProofStamp signature={v.signature} net={net}>
                {sentence(v)}
              </ProofStamp>
            )}
          </CoinIdentity>
          <CaRow mint={v.mint} />
          <McapChart
            mint={v.mint}
            symbol={v.symbol}
            initial={chartInterval(coin?.launchedAt ?? v.createdAt)}
            launchMcap={coin?.launchMcapSol ?? null}
          />
          {/* One column puts Bond and burn above Trades; at 1100px Trades take the wide column and Bond and burn
            the 380px right column, sticky under the header (UI-SPEC Token page layout). */}
          <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_380px] min-[1100px]:gap-8">
            <div className="min-[1100px]:sticky min-[1100px]:top-22 min-[1100px]:col-start-2 min-[1100px]:row-start-1 min-[1100px]:self-start">
              <BondPanel symbol={v.symbol} net={net} />
            </div>
            <TradeFeed
              initial={feed.trades}
              more={feed.more}
              mint={v.mint}
              symbol={v.symbol}
              net={net}
              solIn={v.solIn}
              exit={v.exit}
            />
          </div>
          <p className="text-[13px] text-muted-foreground">
            Trading and the public fee ledger for {v.symbol} arrive in a later BONDR update.
          </p>
        </div>
      </div>
    </CoinLiveProvider>
  );
}
