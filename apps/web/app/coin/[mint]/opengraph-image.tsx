// TOKEN-06: /coin/{mint}/opengraph-image/card. generateImageMetadata, not a static alt, so the alt names the coin.
import { landedCoin } from "@/lib/launches";
import { coinCard, siteCard } from "@/lib/og";
import { fetchCardImage } from "@/lib/pinata";

export const runtime = "nodejs";
// Rendered per request: Next would otherwise keep the first render of a mint, freezing the site card of a mint
// fetched before it landed. The immutable header lets X, Telegram and any CDN keep a coin card instead.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SITE_ALT = "BONDR: built to bond";
// A coin's card never changes once its image embedded, so it is cached for a year, set here so dev serves what
// production does.
const IMMUTABLE = { "cache-control": "public, immutable, no-transform, max-age=31536000" };
// An unknown mint may land or be indexed soon, so its site card must not be frozen in X or Telegram for a year.
const SHORT = { "cache-control": "public, max-age=300" };

export async function generateImageMetadata({ params }: { params: Promise<{ mint: string }> }) {
  const v = await landedCoin((await params).mint);
  const alt = v ? `${v.name} (${v.symbol}) on BONDR. Dev holds 0 launch supply.` : SITE_ALT;
  return [{ id: "card", alt, size, contentType }];
}

export default async function Image({ params }: { params: Promise<{ mint: string }> }) {
  const v = await landedCoin((await params).mint);
  if (!v) return siteCard(SHORT);
  const img = await fetchCardImage(v.imageCid);
  // A letter fallback for a coin that has an image (gateway hiccup, timeout) must stay retryable, not frozen.
  return coinCard(v, img, img || !v.imageCid ? IMMUTABLE : SHORT);
}
