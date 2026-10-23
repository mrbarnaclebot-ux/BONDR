"use client";

// The token page trade feed (UI-SPEC Trades, D-16, D-18): the 50 newest trades, Load more by keyset back to
// the launch transaction, whose two rows prove the dev's exit. Live inserts arrive with the stream (03-07).
import type { Exit, Net, TradeRow } from "@bondr/core/api";
import { Fragment, useEffect, useState } from "react";
import { compact, relTime, short, sol, tradeSol } from "@/lib/format";
import { TxLink } from "./tx-link";
import { Button } from "./ui-button";

type Props = {
  initial: TradeRow[];
  more: boolean;
  mint: string;
  symbol: string;
  net: Net;
  solIn: string;
  exit: Exit;
};

const SIDE = { buy: ["Buy", "text-leaf"], sell: ["Sell", "text-destructive"] } as const;
const TH = "py-2 font-semibold tracking-[0.05em] uppercase";
const TD = "border-t border-line py-2";
const TRADER = "max-md:hidden";

function Row({ t, net, now }: { t: TradeRow; net: Net; now: number }) {
  const [label, tone] = t.launch ? ["Launch", "text-mint"] : SIDE[t.side === "sell" ? "sell" : "buy"];
  return (
    <tr>
      <td className={`${TD} num`}>
        <time dateTime={t.at} title={new Date(t.at).toLocaleString()} suppressHydrationWarning>
          {relTime(t.at, now)}
        </time>
      </td>
      <td className={`${TD} font-semibold tracking-[0.05em] uppercase ${tone}`}>{label}</td>
      <td className={`${TD} num text-right`}>
        {t.sol === null ? <span className="text-muted-foreground">burned</span> : tradeSol(t.sol)}
      </td>
      <td className={`${TD} num text-right`}>{compact(t.tokenAmount)}</td>
      <td className={`${TD} num pl-4 text-muted-foreground ${TRADER}`}>{short(t.trader)}</td>
      <td className={`${TD} text-right`}>
        <TxLink signature={t.signature} net={net} label={`Transaction ${short(t.signature)}`} />
      </td>
    </tr>
  );
}

/** Appends the next older page; `more` turns false once the launch rows are in. */
function useOlder(mint: string, initial: TradeRow[], initialMore: boolean) {
  const [rows, setRows] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function load() {
    const last = rows.at(-1);
    if (!last) return;
    setState("loading");
    try {
      const res = await fetch(`/api/coin/${mint}/trades?before=${last.slot}.${last.seq}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { trades: TradeRow[]; more: boolean };
      setRows((r) => [...r, ...page.trades]);
      setMore(page.more);
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return { rows, more, state, load };
}

type TableProps = { rows: TradeRow[]; symbol: string; net: Net; solIn: string; exit: Exit };

function FeedTable({ rows, symbol, net, solIn, exit }: TableProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">{`Trades for ${symbol}, newest first`}</caption>
      <thead className="text-left text-muted-foreground">
        <tr>
          <th scope="col" className={TH}>
            Time
          </th>
          <th scope="col" className={TH}>
            Side
          </th>
          <th scope="col" className={`${TH} text-right`}>
            SOL
          </th>
          <th scope="col" className={`${TH} text-right`}>
            {symbol}
          </th>
          <th scope="col" className={`${TH} pl-4 ${TRADER}`}>
            Trader
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Tx
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => (
          <Fragment key={`${t.signature}:${t.ix}`}>
            {t.launch && !rows[i - 1]?.launch && (
              <tr>
                <td
                  colSpan={6}
                  className="border-t border-dashed border-line-strong py-2 text-muted-foreground"
                >
                  {`Launch transaction: ${sol(solIn)} SOL dev buy, then insta ${exit}.`}
                </td>
              </tr>
            )}
            <Row t={t} net={net} now={now} />
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function TradeFeed({ initial, more: initialMore, mint, ...table }: Props) {
  const { rows, more, state, load } = useOlder(mint, initial, initialMore);
  return (
    <section
      aria-labelledby="trades-h"
      className="min-w-0 rounded-lg border border-line bg-[linear-gradient(180deg,var(--surface-2),color-mix(in_oklch,var(--surface)_60%,transparent))] p-4 shadow-elev-1 md:p-8"
    >
      <h2 id="trades-h" className="display mb-4 text-[28px] leading-none">
        Trades
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No trades yet. New trades show up here as they land.
        </p>
      ) : (
        <FeedTable rows={rows} {...table} />
      )}
      {rows.length > 0 && !more && (
        <p className="mt-4 text-xs text-muted-foreground">That is every trade since launch.</p>
      )}
      {more && (
        <>
          <Button
            className="mt-4 w-full"
            disabled={state === "loading"}
            aria-busy={state === "loading"}
            onClick={load}
          >
            {state === "loading" ? "Loading…" : "Load 50 older trades"}
          </Button>
          {state === "error" && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Could not load older trades. Try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
