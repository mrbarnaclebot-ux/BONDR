"use client";
// The trade panel's quote fetch (UI-SPEC Quote refresh), split from use-trade.ts to keep both files short.
import type { ApiError, TradeErrorCode, TradeQuote, TradeQuoteRequest, TradeSide } from "@bondr/core/api";
import { type RefObject, useEffect, useRef, useState } from "react";

type QuoteState = {
  quote: TradeQuote | null;
  loading: boolean;
  quoteError: TradeErrorCode | "failed" | null;
};

/** One quote request: the quote, the worker's error code, or "failed" for a network or parse error. */
async function fetchQuote(
  req: TradeQuoteRequest,
  signal: AbortSignal,
): Promise<TradeQuote | TradeErrorCode | "failed"> {
  const r = await fetch("/api/trade/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  }).catch(() => null);
  const body = (await r?.json().catch(() => null)) as TradeQuote | ApiError | null;
  if (r?.ok && body && "amountOut" in body) return body;
  return body && "error" in body ? (body.error as TradeErrorCode) : "failed";
}

/**
 * The debounced quote. The previous quote stays while the next loads (the panel dims it) and through a failed
 * refresh; stale requests abort.
 * A `tick` change is the 2 s refresh: it quotes at once and replaces values in place, with no dim.
 */
export function useRouteQuote(
  side: TradeSide,
  mint: string,
  units: bigint | null,
  slippageBps: number,
  tick: number,
  delay: RefObject<number>,
) {
  const [s, setS] = useState<QuoteState>({ quote: null, loading: false, quoteError: null });
  const lastTick = useRef(tick);
  useEffect(() => {
    const refresh = tick !== lastTick.current;
    lastTick.current = tick;
    if (units === null) {
      setS({ quote: null, loading: false, quoteError: null });
      return;
    }
    if (!refresh) setS((p) => ({ ...p, loading: true }));
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        void fetchQuote({ side, mint, amount: String(units), slippageBps }, abort.signal).then((a) => {
          // C-WR-04: an aborted request (a newer input, or unmount) never writes, even mid-json.
          if (abort.signal.aborted) return;
          if (typeof a === "object") setS({ quote: a, loading: false, quoteError: null });
          // A failed refresh keeps the shown quote, so one blip never unmounts its callouts (C-WR-03).
          else setS((p) => ({ quote: refresh ? p.quote : null, loading: false, quoteError: a }));
        });
      },
      refresh ? 0 : delay.current,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [side, mint, units, slippageBps, tick, delay]);
  return s;
}
