import type { LaunchView, Links, Venue } from "@bondr/core/api";
import type { ReactNode } from "react";
import { age } from "@/lib/format";
import { imageUrl } from "@/lib/pinata";
import { VenueTag } from "./coin-live";
import { CopyChip } from "./copy-chip";

// The coin image is the gateway the on-chain URI uses (pinata.ts imageUrl). A CSS background, not
// next/image: a failed load (ipfs.io answers 429 under load) leaves the surface block instead of a broken
// image glyph, and each browser fetches it, not one server IP for every visitor.
// ponytail: unoptimized; route through next/image once a dedicated gateway is set (Phase 3 lists).

// Links were normalized to https at pin time (rules.ts); anything else is dropped here, not rendered.
type MetaLink = { href: string; text: string; label?: string };

function linkList(symbol: string, links: Links): MetaLink[] {
  const out: MetaLink[] = [];
  if (links.x) out.push({ href: links.x, text: "X", label: `${symbol} on X` });
  if (links.telegram) out.push({ href: links.telegram, text: "Telegram" });
  if (links.website && URL.canParse(links.website))
    out.push({ href: links.website, text: new URL(links.website).host });
  return out.filter((l) => l.href.startsWith("https://"));
}

function Meta({ v, venue }: { v: LaunchView; venue: Venue }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
      <CopyChip mint={v.mint} />
      <VenueTag venue={venue} />
      <time dateTime={v.createdAt}>{age(v.createdAt)} old</time>
      {linkList(v.symbol, v.links).map((l) => (
        <a
          key={l.text}
          href={l.href}
          aria-label={l.label}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-7 min-w-6 items-center justify-center"
        >
          {l.text}
        </a>
      ))}
    </div>
  );
}

type Props = { v: LaunchView; venue?: Venue; stats?: ReactNode; children: ReactNode };

/**
 * Token page identity bar: avatar bleed, name, symbol, meta row with the venue tag ("curve" until the coin is
 * indexed) and the stats row; `children` is the proof on the right.
 */
export function CoinIdentity({ v, venue = "curve", stats, children }: Props) {
  const src = imageUrl(v.imageCid);
  const bg = src ? { backgroundImage: `url("${src}")` } : undefined;
  return (
    <div className="relative isolate grid items-center gap-6 pt-8 pb-6 md:pt-12 md:pb-8 min-[1100px]:grid-cols-[minmax(0,1fr)_auto]">
      {src && (
        <div
          aria-hidden="true"
          style={bg}
          className="pointer-events-none absolute -top-[30%] -left-[6%] -z-10 h-[150%] w-[90%] animate-drift bg-cover bg-center opacity-42 blur-[70px] saturate-140 sm:w-[46%]"
        />
      )}
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden="true"
          style={bg}
          className="size-[52px] flex-none rounded-[18px] bg-surface-2 shadow-[0_0_0_1px_color-mix(in_oklch,var(--foreground)_18%,transparent),0_18px_40px_-12px_var(--ink)] bg-cover bg-center md:size-16"
        />
        <div className="min-w-0">
          <h1 className="display text-[28px] [overflow-wrap:anywhere] md:text-[44px]">
            {v.name} <span className="text-[0.6em] text-muted-foreground">{v.symbol}</span>
          </h1>
          <Meta v={v} venue={venue} />
          {stats}
        </div>
      </div>
      {children}
    </div>
  );
}
