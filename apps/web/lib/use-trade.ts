"use client";

// The trade panel's one state object (UI-SPEC useTrade): every placement (column panel, later the sheet and the
// sticky bar) reads the same side, amount, slippage and quote, so switching placement never loses the input.
import type { TradeBalance, TradeErrorCode, TradeQuote, TradeSide } from "@bondr/core/api";
import { parseSol } from "@bondr/core/rules";
import {
  createContext,
  createElement,
  type ReactNode,
  type RefCallback,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWallet } from "@/components/wallet";
import { useRouteQuote } from "./use-route-quote";

// Typing waits for the debounce; presets, side and slippage changes quote at once (UI-SPEC Quote refresh).
const DEBOUNCE_MS = 400;
const REFRESH_MS = 2_000;
const IDLE_MS = 60_000;
const DEFAULT_BPS = 100;

/** The stored slippage if it is a whole bps in the 0.1% to 50% range the worker accepts, else the 1% default. */
function storedSlippage(): number {
  try {
    const n = Number(localStorage.getItem("bondr:slippage"));
    return Number.isInteger(n) && n >= 10 && n <= 5_000 ? n : DEFAULT_BPS;
  } catch {
    return DEFAULT_BPS; // storage blocked
  }
}

/** UI-SPEC Slippage: 1% by default and remembered; blocked storage keeps a choice for this page only. */
function useSlippage(): [number, (bps: number) => void] {
  const [bps, setBps] = useState(DEFAULT_BPS);
  // Read after mount: the server render has no storage, and the first client render must match it.
  useEffect(() => setBps(storedSlippage()), []);
  const set = useCallback((n: number) => {
    setBps(n);
    try {
      localStorage.setItem("bondr:slippage", String(n));
    } catch {
      // storage blocked
    }
  }, []);
  return [bps, set];
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
  /** The 2 s refresh stopped after 60 s without input (D-12). */
  paused: boolean;
  /** Quotes once and restarts the refresh. */
  resume(): void;
  /** Refetches the balances; the trade result calls it (D-16). */
  refreshBalance(): void;
  /** The column panel registers here; the refresh runs only while it is in the viewport. */
  panelRef: RefCallback<HTMLElement>;
  /** A sheet sets its open state here, so an open sheet keeps the refresh running. */
  setVisible(open: boolean): void;
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

/** document.visibilityState as state: the refresh stops in a background tab. */
function useTabVisible(): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const on = () => setShown(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return shown;
}

/** The panel is visible when the column panel intersects the viewport or a sheet says it is open. */
function usePanelVisible() {
  const [inView, setInView] = useState(false);
  const [open, setVisible] = useState(false);
  const panelRef = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      setInView(false);
    };
  }, []);
  return { visible: inView || open, panelRef, setVisible };
}

/**
 * D-12: a tick every 2 s while `run` holds; after 60 s without panel input it pauses instead. `input(ms)`
 * records input, sets the next quote's delay and lifts the pause.
 */
function useQuoteLoop(run: boolean) {
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const lastInput = useRef(0);
  const delay = useRef(DEBOUNCE_MS);
  useEffect(() => {
    if (!run || paused) return;
    const timer = setInterval(() => {
      if (Date.now() - lastInput.current >= IDLE_MS) setPaused(true);
      else setTick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [run, paused]);
  const input = (ms: number) => {
    delay.current = ms;
    lastInput.current = Date.now();
    setPaused(false);
  };
  const resume = () => {
    input(0);
    setTick((n) => n + 1);
  };
  return { tick, delay, paused, input, resume };
}

/**
 * D-16: the session wallet's balances, fetched when a consented wallet connects, when the tab comes back and on
 * refreshBalance. Never on a timer. A refetch keeps the shown value until the new one lands.
 */
function useBalance(mint: string) {
  const w = useWallet();
  const address = w.status === "connected" && w.consented ? w.address : null;
  const [balance, setBalance] = useState<BalanceState>("unknown");
  const reload = useRef(() => {});
  useEffect(() => {
    setBalance(address ? "loading" : "unknown");
    if (!address) return;
    let seq = 0;
    const load = () => {
      const id = ++seq;
      fetch("/api/trade/balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<TradeBalance>) : Promise.reject(r.status)))
        .then(
          (b) => id === seq && setBalance(b),
          () => id === seq && setBalance("failed"),
        );
    };
    const onShow = () => document.visibilityState === "visible" && load();
    reload.current = load;
    load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      seq = -1; // a late answer for the old wallet is dropped
      reload.current = () => {};
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [address, mint]);
  return { balance, refreshBalance: useCallback(() => reload.current(), []) };
}

type ProviderProps = { mint: string; symbol: string; children: ReactNode };

export function TradeProvider({ mint, symbol, children }: ProviderProps) {
  const [side, setSideState] = useState<TradeSide>("buy");
  const [amount, setAmountState] = useState("");
  const [slippageBps, setSlippage] = useSlippage();
  const units = toUnits(side, amount);
  // 04-10 drives the phase once the panel runs trades.
  const phase: TradePhase = "idle";
  const panel = usePanelVisible();
  const tab = useTabVisible();
  const loop = useQuoteLoop(units !== null && phase === "idle" && tab && panel.visible);
  const q = useRouteQuote(side, mint, units, slippageBps, loop.tick, loop.delay);
  const value: Trade = {
    mint,
    symbol,
    side,
    amount,
    units,
    slippageBps,
    ...q,
    phase,
    ...useBalance(mint),
    paused: loop.paused,
    resume: loop.resume,
    panelRef: panel.panelRef,
    setVisible: panel.setVisible,
    setSide(next) {
      loop.input(0);
      setSideState(next);
      // Switching side clears the amount: a SOL figure is meaningless as a coin amount.
      if (next !== side) setAmountState("");
    },
    setAmount(text) {
      loop.input(DEBOUNCE_MS);
      setAmountState(text);
    },
    pickAmount(text) {
      loop.input(0);
      setAmountState(text);
    },
    setSlippageBps(bps) {
      loop.input(0);
      setSlippage(bps);
    },
  };
  return createElement(Ctx.Provider, { value }, children);
}
