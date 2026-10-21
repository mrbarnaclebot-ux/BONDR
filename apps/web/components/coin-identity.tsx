import type { LaunchView, Links } from "@bondr/core/api";
import type { ReactNode } from "react";
import { age } from "@/lib/format";
import { CopyChip } from "./copy-chip";

// The owner's Pinata gateway when set, else ipfs.io, the on-chain URI's host. A CSS background, not
// next/image: a failed load (ipfs.io answers 429 under load) leaves the surface block instead of a broken
// image glyph, and each browser fetches it, not one server IP for every visitor.
// ponytail: unoptimized; route through next/image once a dedicated gateway is set (Phase 3 lists).
function imageUrl(cid: string | null): string | null {
  if (!cid || !/^[A-Za-z0-9]+$/.test(cid)) return null;
  const host = process.env.PINATA_GATEWAY?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return `https://${host || "ipfs.io"}/ipfs/${cid}`;
}

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

function Meta({ v }: { v: LaunchView }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
      <CopyChip mint={v.mint} />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/40 bg-mint-wash px-2 py-1 text-xs font-semibold tracking-[0.05em] text-mint uppercase">
        <span aria-hidden="true" className="size-[7px] animate-live rounded-full bg-current" />
        On curve
      </span>
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

/** Token page identity bar: avatar bleed, name, symbol and meta row; `children` is the proof on the right. */
export function CoinIdentity({ v, children }: { v: LaunchView; children: ReactNode }) {
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
          <Meta v={v} />
        </div>
      </div>
      {children}
    </div>
  );
}
