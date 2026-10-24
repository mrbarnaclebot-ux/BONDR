"use client";

// The trade panel's one state object (UI-SPEC useTrade): every placement (column panel, later the sheet and the
// sticky bar) reads the same side, amount, slippage and quote, so switching placement never loses the input.
import type { Net, TradeErrorCode, TradeQuote, TradeSide } from "@bondr/core/api";
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
import { currentQuote } from "./trade-button";
import { useAnnounce } from "./use-announce";
import { type BalanceState, useBalance } from "./use-balance";
import { useRouteQuote } from "./use-route-quote";
import { type RunResult, type TradePhase, useRun } from "./use-run";

export type { BalanceState };

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

export type { RunResult, TradePhase } from "./use-run";

export type Trade = {
  mint: string;
  symbol: string;
  net: Net;
  side: TradeSide;
  amount: string;
  /** The amount in base units (lamports for a buy, 6-decimal coin units for a sell); null when empty or invalid. */
  units: bigint | null;
  slippageBps: number;
  quote: TradeQuote | null;
  loading: boolean;
  quoteError: TradeErrorCode | "failed" | null;
  phase: TradePhase;
  result: RunResult | null;
  /** Runs a trade for the current input: prepare, one signature, submit, poll (no-op while one is in flight). */
  submit(): void;
  clearResult(): void;
  balance: BalanceState;
  /** The panel's polite live region text: a user's quote once, "Quote paused." and the in-flight steps. */
  announce: string;
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
export function toUnits(side: TradeSide, raw: string): bigint | null {
  // Thousands separators, as the sell hint "like 1,000" shows, and a bare ".5" (C-WR-08).
  const text = raw.trim().replace(/,/g, "").replace(/^\./, "0.");
  let n: bigint | null = null;
  if (side === "buy") {
    const r = parseSol(text);
    n = r.ok ? r.value : null;
  } else {
    const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
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
      const since = Date.now() - lastInput.current;
      if (since >= IDLE_MS) setPaused(true);
      else if (since >= DEBOUNCE_MS) setTick((n) => n + 1); // never cut a typing debounce short (C-IN-04)
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

type Setters = Pick<Trade, "setSide" | "setAmount" | "pickAmount" | "setSlippageBps">;
type Raw = { side(s: TradeSide): void; amount(text: string): void; bps(n: number): void };

/** The panel's input setters: each records input (the next quote's delay, the idle clock) before it sets. */
function setters(side: TradeSide, input: (ms: number) => void, set: Raw): Setters {
  return {
    setSide(next) {
      input(0);
      set.side(next);
      // Switching side clears the amount: a SOL figure is meaningless as a coin amount.
      if (next !== side) set.amount("");
    },
    setAmount(text) {
      input(DEBOUNCE_MS);
      set.amount(text);
    },
    pickAmount(text) {
      input(0);
      set.amount(text);
    },
    setSlippageBps(bps) {
      input(0);
      set.bps(bps);
    },
  };
}

type ProviderProps = { mint: string; symbol: string; net: Net; children: ReactNode };

export function TradeProvider({ mint, symbol, net, children }: ProviderProps) {
  const [side, setSideState] = useState<TradeSide>("buy");
  const [amount, setAmountState] = useState("");
  const [slippageBps, setSlippage] = useSlippage();
  const units = toUnits(side, amount);
  const bal = useBalance(mint);
  const run = useRun({ mint, side, units, slippageBps }, bal.refreshBalance, () => setAmountState(""));
  const panel = usePanelVisible();
  const tab = useTabVisible();
  const loop = useQuoteLoop(units !== null && run.phase === "idle" && tab && panel.visible);
  const q = useRouteQuote(side, mint, units, slippageBps, loop.tick, loop.delay);
  const announce = useAnnounce({ ...q, paused: loop.paused, phase: run.phase }, symbol);
  // Any panel input ends the shown result (UI-SPEC Results).
  const input = (ms: number) => {
    loop.input(ms);
    run.clearResult();
  };
  const set = { side: setSideState, amount: setAmountState, bps: setSlippage };
  const value: Trade = {
    ...{ mint, symbol, net, side, amount, units, slippageBps },
    ...q,
    ...run,
    ...bal,
    announce,
    paused: loop.paused,
    resume: loop.resume,
    // C-CR-01: Enter or a click on a stale render never trades on a quote for another amount.
    submit() {
      if (currentQuote(q.quote, side, units, q.loading)) run.submit();
    },
    panelRef: panel.panelRef,
    setVisible: panel.setVisible,
    ...setters(side, input, set),
  };
  return createElement(Ctx.Provider, { value }, children);
}
