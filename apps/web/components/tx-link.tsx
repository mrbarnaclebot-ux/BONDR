import type { Net } from "@bondr/core/api";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { explorer } from "@/lib/format";

/**
 * Solscan link to a transaction; devnet links carry the cluster param (UI-SPEC Tx link). With `label` the
 * link is icon-only (the trade feed): the label is read out, and the target is 24px square.
 */
export function TxLink({
  signature,
  net,
  children,
  label,
}: {
  signature: string;
  net: Net;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <a
      href={explorer("tx", signature, net)}
      target="_blank"
      rel="noopener"
      className={cn(
        "num group inline-flex min-h-6 items-center gap-1 text-xs",
        label && "min-w-6 justify-center",
      )}
    >
      {label ? <span className="sr-only">{label}</span> : children}
      <ArrowUpRight
        className="size-[11px] transition-transform duration-(--dur) group-hover:translate-x-px group-hover:-translate-y-px"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="sr-only">{" (opens Solscan)"}</span>
    </a>
  );
}
