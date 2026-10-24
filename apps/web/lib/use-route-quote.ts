"use client";
// The trade panel's quote fetch (UI-SPEC Quote refresh), split from use-trade.ts to keep both files short.
import type { ApiError, TradeErrorCode, TradeQuote, TradeSide } from "@bondr/core/api";
import { type RefObject, useEffect, useRef, useState } from "react";

type QuoteState = {
  quote: TradeQuote | null;
  loading: boolean;
  quoteError: TradeErrorCode | "failed" | null;
};

/**
 * The debounced quote. The previous quote stays while the next loads (the panel dims it); stale requests abort.
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
        fetch("/api/trade/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ side, mint, amount: String(units), slippageBps }),
          signal: abort.signal,
        })
          .then(async (r) => {
            const body = (await r.json().catch(() => null)) as TradeQuote | ApiError | null;
            if (r.ok && body && "amountOut" in body) setS({ quote: body, loading: false, quoteError: null });
            else {
              const code = body && "error" in body ? (body.error as TradeErrorCode) : "failed";
              setS({ quote: null, loading: false, quoteError: code });
            }
          })
          .catch(() => abort.signal.aborted || setS({ quote: null, loading: false, quoteError: "failed" }));
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
