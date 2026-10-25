"use client";

// UI-SPEC Fee ledger panel (TOKEN-04): every landed fee movement of the coin, newest first, each with its
// Solscan transaction, paged 20 at a time back to the launch row. Rows come only from the server's landed
// public read (lib/ledger.ts); loaded rows are never removed.
import type { CoinFees, Exit, LedgerRow, Net } from "@bondr/core/api";
import { SUPPLY } from "@bondr/core/price";
import { CircleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { age, burnedPct, compact, explorer, feeSol, short, whole } from "@/lib/format";
import { type Copy, launchCopy, ledgerCopy } from "@/lib/ledger-copy";
import { useCoinLive } from "./coin-live";
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
        className="num col-start-1 row-start-1 text-xs text-muted-foreground"
        suppressHydrationWarning
      >
        {fresh ? "now" : `${age(at, clock.now)} ago`}
      </time>
      <span className="col-start-1 row-start-2 @min-[600px]:col-start-2 @min-[600px]:row-start-1">
        <Tag tone={c.tone}>{c.tag}</Tag>
      </span>
      <p className="col-span-2 col-start-1 row-start-3 text-sm @min-[600px]:col-span-1 @min-[600px]:col-start-3 @min-[600px]:row-start-1">
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

const MUTED = "text-muted-foreground";

function Total(p: { label: string; tone?: string; sub: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", p.wide && "col-span-2 @min-[600px]:col-span-1")}>
      <dt className={cn("text-xs font-semibold tracking-[0.09em] uppercase", MUTED)}>{p.label}</dt>
      <dd className={cn("num text-base", p.tone)}>{p.children}</dd>
      <dd className={cn("text-xs", MUTED)}>{p.sub}</dd>
    </div>
  );
}

/** "0 SOL" muted at zero, "–" muted while the BONDR price is unknown. */
const solTotal = (lamports: string | null, base: string) =>
  BigInt(base) === 0n
    ? { tone: MUTED, text: "0 SOL" }
    : lamports === null
      ? { tone: MUTED, text: "–" }
      : { tone: undefined, text: `${feeSol(lamports)} SOL` };

/** UI-SPEC Totals block, pre-bond column: the three buckets account for every collected BONDR. */
function Totals({ f, symbol }: { f: CoinFees; symbol: string }) {
  const burned = BigInt(f.burnedSupply) > 0n;
  const [budget, buyback, treasury] = [
    solTotal(f.budgetSol, f.budget),
    solTotal(f.toBuybackSol, f.toBuyback),
    solTotal(f.toTreasurySol, f.toTreasury),
  ];
  return (
    <dl className="mb-4 grid grid-cols-2 gap-4 border-b border-dashed border-line-strong pb-4 @min-[600px]:grid-cols-3 @min-[880px]:grid-cols-5">
      <Total
        label="Supply burned"
        tone={burned ? "text-leaf" : MUTED}
        sub={burned ? `${compact(f.burnedSupply)} ${symbol} burned` : "Nothing burned yet"}
      >
        {burnedPct(f.burnedSupply, SUPPLY)}
      </Total>
      <Total label="In burn budget" tone={budget.tone} sub={`${whole(f.budget)} BONDR, this window`}>
        {budget.text}
      </Total>
      <Total label="To buyback" tone={buyback.tone} sub={`${whole(f.toBuyback)} BONDR swept for the burn`}>
        {buyback.text}
      </Total>
      <Total label="To treasury" tone={treasury.tone} sub={`${whole(f.toTreasury)} BONDR, the 10% share`}>
        {treasury.text}
      </Total>
      <Total label="Deployer share" tone={MUTED} sub="80% of fees once finalized" wide>
        After bond
      </Total>
    </dl>
  );
}

export function FeeLedger({ initial, ...p }: Props) {
  const coin = useCoinLive()?.coin;
  return (
    <section
      aria-labelledby="ledger-h"
      className="@container min-w-0 rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-4 shadow-elev-1 md:p-8 min-[1100px]:p-6"
    >
      <Head symbol={p.symbol} w={p.w} net={p.net} />
      {/* Bonded totals arrive with 05-10; a coin with no indexed row has no totals yet. */}
      {coin?.fees && coin.venue !== "pool" && <Totals f={coin.fees} symbol={p.symbol} />}
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
