// The site card for every page without its own (UI-SPEC Share card).
import { siteCard } from "@/lib/og";

export const runtime = "nodejs";
export const alt = "BONDR: built to bond";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return siteCard();
}
