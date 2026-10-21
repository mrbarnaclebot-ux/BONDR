import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { launchByMint } from "@/lib/launches";

export const dynamic = "force-dynamic";

// Base58, 32-44 characters: anything else cannot be a mint, so it never reaches the query (T-02-15-01).
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Metadata and the page share one read per request.
const landed = cache(async (mint: string) => (MINT.test(mint) ? launchByMint(mint) : null));

type Props = { params: Promise<{ mint: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = await landed((await params).mint);
  return { title: v ? `${v.name} (${v.symbol}) on BONDR` : "No BONDR coin here" };
}

/** The bare token page: only a landed BONDR launch renders, everything else is a 404 (T-02-15-04). */
export default async function CoinPage({ params }: Props) {
  const v = await landed((await params).mint);
  if (!v) notFound();
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10">
      <h1 className="display text-[28px] md:text-[44px]">{v.name}</h1>
    </div>
  );
}
