import type { Net } from "@bondr/core/api";
import type { ReactNode } from "react";
import { short } from "@/lib/format";
import { TxLink } from "./tx-link";

const STAMP =
  "grid max-w-[460px] grid-cols-[auto_1fr] items-center gap-x-4 rounded-lg border border-leaf/60 py-4 pr-6 pl-4 " +
  "outline-1 outline-offset-4 outline-leaf/22 shadow-[0_18px_50px_-24px_var(--leaf)] " +
  "bg-[radial-gradient(120%_140%_at_0%_50%,color-mix(in_oklch,var(--leaf)_16%,transparent),transparent_60%),color-mix(in_oklch,var(--surface)_85%,transparent)]";

/** The launch supply proof: step 5 and the token page (02-15). `children` is the exit sentence. */
export function ProofStamp({
  signature,
  net,
  children,
}: {
  signature: string;
  net: Net;
  children: ReactNode;
}) {
  return (
    <aside aria-label="Launch supply proof" className={STAMP}>
      <span
        aria-hidden="true"
        className="row-span-3 border-r border-leaf/40 pr-2 font-display text-[72px] leading-[0.8] font-black text-leaf"
      >
        0
      </span>
      <span className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
        Proof, checked on-chain
      </span>
      <strong className="font-semibold">Dev holds 0 launch supply</strong>
      <p className="text-xs text-muted-foreground">
        {children} <TxLink signature={signature} net={net}>{`Launch tx ${short(signature)}`}</TxLink>
      </p>
    </aside>
  );
}
