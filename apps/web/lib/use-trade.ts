"use client";

// The trade panel's one state object (UI-SPEC useTrade): every placement (column panel, later the sheet and the
// sticky bar) reads the same side, amount, slippage and quote, so switching placement never loses the input.
import type { ApiError, TradeBalance, TradeErrorCode, TradeQuote, TradeSide } from "@bondr/core/api";
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
const SLIPPAGE_KEY = "bondr:slippage";
const DEFAULT_BPS = 100;

/** The stored slippage if it is a whole bps in the 0.1% to 50% range the worker accepts, else the 1% default. */
function storedSlippage(): number {
  try {
    const n = Number(localStorage.getItem(SLIPPAGE_KEY));
    return Number.isInteger(n) && n >= 10 && n <= 5_000 ? n : DEFAULT_BPS;
  } catch {
    return DEFAULT_BPS; // storage blocked
  }
}

export type TradePhase = "idle" | "preparing" | "signing" | "confirming";

/** The wallet's balances (D-16): unknown without a consented wallet. */
export type BalanceState = TradeBalance | "unknown" | "loading" | "failed";

export type Trade = {
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
  balance: BalanceState;
  setSide(side: TradeSide): void;
  setAmount(text: string): void;
  /** A preset chip: quotes at once, no debounce. */
  pickAmount(text: string): void;
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
  const [slippageBps, setSlippageState] = useState(DEFAULT_BPS);
  // Read after mount: the server render has no storage, and the first client render must match it.
  useEffect(() => setSlippageState(storedSlippage()), []);
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
    balance: "unknown",
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
    pickAmount(text) {
      delay.current = 0;
      setAmountState(text);
    },
    setSlippageBps(bps) {
      delay.current = 0;
      setSlippageState(bps);
      try {
        localStorage.setItem(SLIPPAGE_KEY, String(bps));
      } catch {
        // storage blocked: the choice lasts for this page only
      }
    },
  };
  return createElement(Ctx.Provider, { value }, children);
}
