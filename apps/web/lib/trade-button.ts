// The UI-SPEC submit button state table, pure so the unit test can load it: the first matching row wins, and an
// in-flight phase keeps the variant of the row it started from.
import type { TradeQuote, TradeSide } from "@bondr/core/api";
import type { WalletStatus } from "@/components/wallet";
import { sol, thousands } from "./format";
import type { BalanceState } from "./use-balance";
import type { TradePhase } from "./use-trade";

// D-14: a buy keeps 0.01 SOL back for fees and a first-buy token account rent.
const RESERVE = 10_000_000n;
// D-13: above this impact the button asks for "anyway".
const HIGH_IMPACT = 0.15;

export type ButtonInput = {
  wallet: WalletStatus;
  consented: boolean | null;
  mobile: boolean;
  /** This page's URL, for Phantom's browse deep link. */
  url: string;
  /** The coin's live venue is complete: it waits for PumpSwap. */
  coinComplete: boolean;
  side: TradeSide;
  symbol: string;
  units: bigint | null;
  balance: BalanceState;
  /** The last quote; only a current one (currentQuote) arms the button. */
  quote: TradeQuote | null;
  loading: boolean;
  quoteError: string | null;
  paused: boolean;
  phase: TradePhase;
};

export type ButtonState = {
  label: string;
  variant: "primary" | "danger" | "quiet";
  disabled: boolean;
  ariaDisabled: boolean;
  action: "connect" | "consent" | "refresh" | "submit" | "link" | null;
  href?: string;
  icon?: "wallet" | "refresh" | "loader";
  /** The not-enough hint under the chips. */
  hint?: string;
};

const IN_FLIGHT: Record<Exclude<TradePhase, "idle">, string> = {
  preparing: "Preparing trade…",
  signing: "Waiting for Phantom…",
  confirming: "Confirming…",
};

const base = { variant: "primary", disabled: false, ariaDisabled: false, action: null } as const;
const off = (label: string, hint?: string): ButtonState => ({ ...base, label, disabled: true, hint });

/** Buy SOL with at least 2 decimals: "1.00", "0.125". */
function solLabel(units: bigint): string {
  const [whole, frac = ""] = sol(units).split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** Coin units with thousands and at most 6 decimals, trailing zeros trimmed: "1,234", "0.5". */
function tokenLabel(units: bigint): string {
  const frac = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const whole = thousands(units / 1_000_000n);
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * C-CR-01: only a quote for exactly this side and amount, and not being replaced, may arm a trade. A quote for an
 * older amount would skip the D-13 "anyway" press for a bigger trade.
 */
export const currentQuote = (
  q: TradeQuote | null,
  side: TradeSide,
  units: bigint | null,
  loading: boolean,
) => (!loading && q?.side === side && units !== null && q.amountIn === String(units) ? q : null);

/** 04-03 Note: devnet's buy cap (BONDR's and the coin's curve, the smaller), from the last buy quote; else null. */
export const devnetCap = (side: TradeSide, q: TradeQuote | null) =>
  side === "buy" && q?.side === "buy" && q.maxSolIn ? BigInt(q.maxSolIn) : null;

function walletRow(i: ButtonInput): ButtonState | null {
  if (i.wallet === "loading" || (i.wallet === "connected" && i.consented === null))
    return off("Checking wallet…");
  if (i.wallet === "missing" && !i.mobile)
    return { ...base, label: "Get Phantom", action: "link", href: "https://phantom.com/download" };
  if (i.wallet === "missing") {
    const ref = encodeURIComponent(new URL(i.url).origin);
    const href = `https://phantom.com/ul/browse/${encodeURIComponent(i.url)}?ref=${ref}`;
    return { ...base, label: "Open BONDR in Phantom", action: "link", href };
  }
  if (i.wallet === "idle")
    return { ...base, label: "Connect Phantom to trade", action: "connect", icon: "wallet" };
  if (i.wallet === "connecting") return off("Opening Phantom…");
  if (!i.consented) return { ...base, label: "Accept terms to trade", action: "consent" };
  return null;
}

function balanceRow(i: ButtonInput, units: bigint): ButtonState | null {
  if (typeof i.balance !== "object") return null; // unknown, loading or failed: no check
  const { sol: lamports, tokens } = i.balance;
  if (i.side === "buy" && units > BigInt(lamports) - RESERVE)
    return off("Not enough SOL", `Your wallet has ${sol(lamports, 4)} SOL. Keep about 0.01 SOL for fees.`);
  if (i.side === "sell" && units > BigInt(tokens))
    return off(`Not enough ${i.symbol}`, `Your wallet has ${tokenLabel(BigInt(tokens))} ${i.symbol}.`);
  return null;
}

function idleState(i: ButtonInput): ButtonState {
  const w = walletRow(i);
  if (w) return w;
  if (i.coinComplete || i.quoteError === "paused") return off("Trading paused");
  if (i.units === null) return off("Enter an amount");
  // Over the devnet cap the field shows its error and the worker would refuse (C-WR-02).
  const cap = devnetCap(i.side, i.quote);
  if (cap !== null && i.units > cap) return off("Enter an amount");
  const b = balanceRow(i, i.units);
  if (b) return b;
  const q = currentQuote(i.quote, i.side, i.units, i.loading);
  if (!q && i.quoteError && !i.loading) return off("No quote yet");
  if (!q) return off("Getting quote…");
  if (i.paused)
    return {
      ...base,
      label: "Quote paused, tap to refresh",
      variant: "quiet",
      action: "refresh",
      icon: "refresh",
    };
  const verb = i.side === "buy" ? "Buy" : "Sell";
  if (q.impact > HIGH_IMPACT)
    return {
      ...base,
      label: `${verb} anyway, ${(q.impact * 100).toFixed(2)}% price impact`,
      variant: "danger",
      action: "submit",
    };
  if (i.side === "buy")
    return { ...base, label: `Buy ${i.symbol} with ${solLabel(i.units)} SOL`, action: "submit" };
  return { ...base, label: `Sell ${tokenLabel(i.units)} ${i.symbol}`, variant: "danger", action: "submit" };
}

export function buttonState(i: ButtonInput): ButtonState {
  const idle = idleState({ ...i, phase: "idle" });
  if (i.phase === "idle") return idle;
  // In flight: the label names the step; aria-disabled (not disabled) keeps focus on the button (D-13).
  return { ...base, variant: idle.variant, label: IN_FLIGHT[i.phase], ariaDisabled: true, icon: "loader" };
}
