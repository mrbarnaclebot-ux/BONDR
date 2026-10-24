"use client";

// The trade panel's one state object (UI-SPEC useTrade): every placement (column panel, later the sheet and the
// sticky bar) reads the same side, amount, slippage and quote, so switching placement never loses the input.
import type { ApiError, TradeErrorCode, TradeQuote, TradeSide } from "@bondr/core/api";
import { parseSol } from "@bondr/core/rules";
import {
  createContext,
  createElement,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const DEBOUNCE_MS = 400;

export type TradePhase = "idle" | "preparing" | "signing" | "confirming";

type Trade = {
  mint: string;
  symbol: string;
  side: TradeSide;
  amount: string;
  /** The amount in base units (lamports for a buy, 6-decimal coin units for a sell); null when empty or invalid. */
  units: bigint | null;
  slippageBps: number;
  quote: TradeQuote | null;
  loading: boolean;
  quoteError: TradeErrorCode | "failed" | null;
  phase: TradePhase;
  setSide(side: TradeSide): void;
  setAmount(text: string): void;
  setSlippageBps(bps: number): void;
};

const Ctx = createContext<Trade | null>(null);

export function useTrade(): Trade {
  const t = useContext(Ctx);
  if (!t) throw new Error("useTrade outside TradeProvider");
  return t;
}

/** A positive amount in base units, or null: buys are SOL (9 decimals), sells the coin (6 decimals, pump). */
export function toUnits(side: TradeSide, text: string): bigint | null {
  let n: bigint | null = null;
  if (side === "buy") {
    const r = parseSol(text);
    n = r.ok ? r.value : null;
  } else {
    const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
    if (m?.[1]) n = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  }
  return n && n > 0n ? n : null;
}

type QuoteState = Pick<Trade, "quote" | "loading" | "quoteError">;

/** The debounced quote. The previous quote stays while the next loads (the panel dims it); stale requests abort. */
function useRouteQuote(
  side: TradeSide,
  mint: string,
  units: bigint | null,
  slippageBps: number,
  delay: RefObject<number>,
) {
  const [s, setS] = useState<QuoteState>({ quote: null, loading: false, quoteError: null });
  useEffect(() => {
    if (units === null) {
      setS({ quote: null, loading: false, quoteError: null });
      return;
    }
    setS((p) => ({ ...p, loading: true }));
    const abort = new AbortController();
    const timer = setTimeout(() => {
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
    }, delay.current);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [side, mint, units, slippageBps, delay]);
  return s;
}

export function TradeProvider({
  mint,
  symbol,
  children,
}: {
  mint: string;
  symbol: string;
  children: ReactNode;
}) {
  const [side, setSideState] = useState<TradeSide>("buy");
  const [amount, setAmountState] = useState("");
  const [slippageBps, setSlippageState] = useState(100);
  // Typing waits for the debounce; side and slippage changes quote at once (UI-SPEC Quote refresh).
  const delay = useRef(DEBOUNCE_MS);
  const units = toUnits(side, amount);
  const q = useRouteQuote(side, mint, units, slippageBps, delay);
  const value: Trade = {
    mint,
    symbol,
    side,
    amount,
    units,
    slippageBps,
    ...q,
    // 04-10 drives the phase once the panel runs trades.
    phase: "idle",
    setSide(next) {
      delay.current = 0;
      setSideState(next);
      // Switching side clears the amount: a SOL figure is meaningless as a coin amount.
      if (next !== side) setAmountState("");
    },
    setAmount(text) {
      delay.current = DEBOUNCE_MS;
      setAmountState(text);
    },
    setSlippageBps(bps) {
      delay.current = 0;
      setSlippageState(bps);
    },
  };
  return createElement(Ctx.Provider, { value }, children);
}
