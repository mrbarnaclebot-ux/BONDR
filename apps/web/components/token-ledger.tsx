"use client";

// UI-SPEC Fee ledger panel (TOKEN-04): every landed fee movement of the coin, newest first, each with its
// Solscan transaction, paged 20 at a time back to the launch row. Rows come only from the server's landed
// public read (lib/ledger.ts); loaded rows are never removed.
import type { Exit, LedgerRow, Net } from "@bondr/core/api";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { age, explorer, short } from "@/lib/format";
import { type Copy, launchCopy, ledgerCopy } from "@/lib/ledger-copy";
import { Tag } from "./tag";
import { LoadMore, useClock } from "./token-trades";
import { TxLink } from "./tx-link";

export type LedgerFirst = { rows: LedgerRow[]; more: boolean; next: string | null };
export type LaunchEntry = { signature: string; at: string; exit: Exit; solIn: string; tokens?: string };

type Props = {
  mint: string;
  symbol: string;
  w: string | null;
  net: Net;
  initial: LedgerFirst | null; // null: the first page read failed
  launch: LaunchEntry | null; // null until the launch has a signature
};

const COPY = {
  more: "Load 20 older entries",
  end: "That is every fee movement since launch.",
  error: "Could not load older entries. Try again.",
};
const EMPTY =
  "No fee movements yet. Creator fees build up in pump and are collected at the end of each 24h window, or sooner if they can force the bond.";

/** Appends the next older page by the server's cursor; `more` turns false once the oldest row is in. */
function useOlder(mint: string, initial: LedgerFirst) {
  const [page, setPage] = useState(initial);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function load() {
    if (!page.next) return;
    setState("loading");
    try {
      const res = await fetch(`/api/coin/${mint}/ledger?before=${page.next}`);
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as LedgerFirst;
      setPage((p) => {
        const seen = new Set(p.rows.map((r) => r.id));
        return { ...next, rows: [...p.rows, ...next.rows.filter((r) => !seen.has(r.id))] };
      });
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return { ...page, state, load };
}

type Clock = { now: number; local: boolean };
type ItemProps = { c: Copy; at: string; signature: string; net: Net; clock: Clock };

/** One entry: time and tag stacked left with the amount cell right below 600px, one row of four from 600px. */
function LedgerItem({ c, at, signature, net, clock }: ItemProps) {
  const fresh = clock.now - Date.parse(at) < 60_000;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-line py-3 @min-[600px]:grid-cols-[80px_136px_minmax(0,1fr)_auto] @min-[600px]:items-baseline">
      <time
        dateTime={at}
        title={clock.local ? new Date(at).toLocaleString() : undefined}
        className="num text-xs text-muted-foreground"
        suppressHydrationWarning
      >
        {fresh ? "now" : `${age(at, clock.now)} ago`}
      </time>
      <span className="row-start-2 @min-[600px]:row-start-1">
        <Tag tone={c.tone}>{c.tag}</Tag>
      </span>
      <p className="col-span-2 row-start-3 text-sm @min-[600px]:col-span-1 @min-[600px]:row-start-1">
        {c.text}
      </p>
      <div className="col-start-2 row-span-2 row-start-1 grid justify-items-end text-right @min-[600px]:col-start-4 @min-[600px]:row-span-1">
        {c.value && <span className="num text-xs text-foreground">{c.value}</span>}
        <TxLink signature={signature} net={net}>
          <span className="sr-only">Transaction </span>
          {short(signature)}
        </TxLink>
      </div>
    </li>
  );
}

function Head({ symbol, w, net }: Pick<Props, "symbol" | "w" | "net">) {
  return (
    <div className="mb-4 grid gap-1">
      <h2 id="ledger-h" className="display text-[28px] leading-none">
        Fee ledger
      </h2>
      <p className="text-xs text-muted-foreground">
        {`Every movement of ${symbol}'s fees, with its transaction.`}
        {w && (
          <>
            {" Fee wallet "}
            <a href={explorer("account", w, net)} target="_blank" rel="noopener" className="num text-mint">
              {short(w)}
              <span className="sr-only"> (opens Solscan)</span>
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function Entries({ mint, symbol, net, initial, launch }: Omit<Props, "w"> & { initial: LedgerFirst }) {
  const { rows, more, state, load } = useOlder(mint, initial);
  const clock = useClock(60_000);
  const last = !more && launch;
  return (
    <>
      {rows.length === 0 && <p className="mb-2 text-sm text-muted-foreground">{EMPTY}</p>}
      <ol aria-label="Fee movements, newest first">
        {rows.map((r) => (
          <LedgerItem
            key={r.id}
            c={ledgerCopy(r, symbol)}
            at={r.landedAt}
            signature={r.signature}
            net={net}
            clock={clock}
          />
        ))}
        {last && (
          <LedgerItem
            c={launchCopy({ ...launch, symbol })}
            at={launch.at}
            signature={launch.signature}
            net={net}
            clock={clock}
          />
        )}
      </ol>
      <LoadMore shown={!!last} more={more} state={state} load={load} copy={COPY} />
    </>
  );
}

export function FeeLedger({ initial, ...p }: Props) {
  return (
    <section
      aria-labelledby="ledger-h"
      className="@container min-w-0 rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-4 shadow-elev-1 md:p-8 min-[1100px]:p-6"
    >
      <Head symbol={p.symbol} w={p.w} net={p.net} />
      {initial ? (
        <Entries {...p} initial={initial} />
      ) : (
        <p role="alert" className="flex items-center gap-2 text-sm">
          <CircleAlert aria-hidden className="size-4 flex-none text-destructive" />
          Could not load the fee ledger. Reload the page to try again.
        </p>
      )}
    </section>
  );
}
