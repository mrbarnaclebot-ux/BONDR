import type { Net } from "@bondr/core/api";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { explorer } from "@/lib/format";

/** Solscan link to a transaction; devnet links carry the cluster param (UI-SPEC Tx link). */
export function TxLink({ signature, net, children }: { signature: string; net: Net; children: ReactNode }) {
  return (
    <a
      href={explorer("tx", signature, net)}
      target="_blank"
      rel="noopener"
      className="num group inline-flex min-h-6 items-center gap-1 text-xs"
    >
      {children}
      <ArrowUpRight
        className="size-[11px] transition-transform duration-(--dur) group-hover:translate-x-px group-hover:-translate-y-px"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="sr-only">(opens Solscan)</span>
    </a>
  );
}
