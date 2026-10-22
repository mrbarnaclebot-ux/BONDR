import type { LaunchView, Net } from "@bondr/core/api";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CaRow } from "@/components/ca-row";
import { CoinIdentity } from "@/components/coin-identity";
import { ProofStamp } from "@/components/proof-stamp";
import { compact, short, sol } from "@/lib/format";
import { launchByMint } from "@/lib/launches";

export const dynamic = "force-dynamic";

// Base58, 32-44 characters: anything else cannot be a mint, so it never reaches the query (T-02-15-01).
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// A landed coin with its facts never changes, so it is kept an hour; a miss or a coin still waiting on facts
// for a minute. Repeat views and crawlers then do not wake Neon (500 CU-h budget).
// ponytail: per-process map cleared at 1000 entries; move to a shared cache if web runs more than one instance.
const HOUR = 3_600_000;
const MINUTE = 60_000;
const seen = new Map<string, { at: number; ttl: number; v: LaunchView | null }>();

async function read(mint: string): Promise<LaunchView | null> {
  const hit = seen.get(mint);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  const v = await launchByMint(mint);
  if (seen.size >= 1000) seen.clear();
  seen.set(mint, { at: Date.now(), ttl: v?.facts ? HOUR : MINUTE, v });
  return v;
}

// Metadata and the page share one lookup per request.
const landed = cache(async (mint: string) => (MINT.test(mint) ? read(mint) : null));

type Props = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await landed((await params).mint);
  return { title: v ? `${v.name} (${v.symbol}) on BONDR` : "No BONDR coin here" };
}

/** UI-SPEC token page proof sentence; the token count is left out until the facts are written. */
function sentence(v: LaunchView): string {
  const tokens = v.facts?.tokens ? ` (${compact(v.facts.tokens)} ${v.symbol})` : "";
  const fate = v.exit === "burn" ? "burned" : "sold back";
  return `Deployer ${short(v.wallet)} chose insta ${v.exit}: the ${sol(v.solIn)} SOL dev buy${tokens} was ${fate} in the launch transaction.`;
}

/** The bare token page: only a landed BONDR launch renders, everything else is a 404 (T-02-15-04). */
export default async function CoinPage({ params }: Props) {
  const v = await landed((await params).mint);
  if (!v) notFound();
  const net: Net = process.env.SOLANA_NET === "mainnet" ? "mainnet" : "devnet";
  return (
    <div className="overflow-x-clip">
      <div className="mx-auto grid w-full max-w-[1440px] gap-4 px-(--gutter) pb-12">
        <CoinIdentity v={v}>
          {v.signature && (
            <ProofStamp signature={v.signature} net={net}>
              {sentence(v)}
            </ProofStamp>
          )}
        </CoinIdentity>
        <CaRow mint={v.mint} />
        <p className="text-[13px] text-muted-foreground">
          Chart, trading and the public fee ledger for {v.symbol} arrive in a later BONDR update.
        </p>
      </div>
    </div>
  );
}
