"use client";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { sol } from "@/lib/format";
import { devnetCap, RESERVE } from "@/lib/trade-button";
import { type Trade, toUnits, useTrade } from "@/lib/use-trade";
import { FieldError, Input, Label } from "./ui-field";

const BUY_PRESETS = ["0.1", "0.5", "1"];
const SELL_PERCENTS = [25n, 50n, 75n, 100n];

export type Chip = { label: string; name?: string; value: string; disabled?: boolean };

/** A group of aria-pressed chips (amount presets, slippage). A chip with no value is never pressed. */
export function Chips(props: {
  legend: string;
  items: Chip[];
  pressed: string;
  onPick(value: string): void;
  size?: "sheet";
  wrap?: boolean; // the admin filters: auto-width chips that wrap
}) {
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-1 gap-2 border-0 p-0", props.wrap && "flex-wrap")}>
      <legend className="sr-only">{props.legend}</legend>
      {props.items.map((c) => (
        <button
          key={c.label}
          type="button"
          aria-label={c.name}
          aria-pressed={!!c.value && c.value === props.pressed}
          disabled={c.disabled}
          onClick={() => props.onPick(c.value)}
          className={cn(
            "num flex-1 cursor-pointer rounded-md border border-line text-xs transition-colors duration-(--dur) hover:border-mint hover:text-mint disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-current aria-pressed:border-mint aria-pressed:text-mint",
            props.wrap
              ? "min-h-11 flex-none px-3 md:min-h-8"
              : props.size === "sheet"
                ? "min-h-11"
                : "min-h-10",
          )}
        >
          {c.label}
        </button>
      ))}
    </fieldset>
  );
}

/** Coin base units (6 decimals, pump) as exact text: "17234567", "0.5". */
const coinText = (n: bigint) => {
  const s = n.toString().padStart(7, "0");
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${s.slice(0, -6)}.${frac}` : s.slice(0, -6);
};

const tokensShown = (base: string) => (Number(base) / 1e6).toLocaleString("en", { maximumFractionDigits: 6 });

/** D-14 presets: SOL amounts plus Max on a buy, percentages of the exact coin balance on a sell. */
function presets(t: Trade, cap: bigint | null): Chip[] {
  const b = typeof t.balance === "object" ? t.balance : null;
  if (t.side === "sell") {
    const tokens = b ? BigInt(b.tokens) : null;
    return SELL_PERCENTS.map((p) => ({
      label: `${p}%`,
      value: tokens === null ? "" : coinText((tokens * p) / 100n),
      disabled: tokens === null,
    }));
  }
  const over = (v: string) => cap !== null && (toUnits("buy", v) ?? 0n) > cap;
  const fixed = BUY_PRESETS.map((v) => ({ label: v, name: `${v} SOL`, value: v, disabled: over(v) }));
  const max = b ? BigInt(b.sol) - RESERVE : null;
  const maxText = max === null ? "" : max > 0n ? sol(max) : "0";
  const name = "Max, balance minus 0.01 SOL";
  return [...fixed, { label: "Max", name, value: maxText, disabled: max === null || over(maxText) }];
}

function hintText(t: Trade): string | null {
  if (t.balance === "unknown") return null;
  if (t.balance === "loading") return "Balance …";
  if (t.balance === "failed") return "Balance unavailable";
  if (t.side === "buy") return `Balance ${(Number(t.balance.sol) / 1e9).toFixed(4)} SOL`;
  return `Balance ${tokensShown(t.balance.tokens)} ${t.symbol}`;
}

function errorText(t: Trade, cap: bigint | null): string | undefined {
  const text = t.amount.trim();
  // Zero is not an error, just no amount ("Enter an amount" on the button).
  if (text && t.units === null && Number(text) !== 0) {
    return t.side === "buy"
      ? "Enter an amount in SOL, like 0.5."
      : `Enter an amount of ${t.symbol}, like 1,000.`;
  }
  if (cap !== null && t.units !== null && t.units > cap) {
    return `On devnet, buys stay under ${sol(cap, 4)} SOL so the curves stay open.`;
  }
  return undefined;
}

/** The label row: "You pay" or "You sell" left, the balance hint right. */
function LabelRow({ id, buy, hint }: { id: string; buy: boolean; hint: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Label htmlFor={id}>{buy ? "You pay" : "You sell"}</Label>
      {hint && (
        <span id={`${id}-hint`} className="num text-xs text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

/** UI-SPEC Amount field: label row with the balance hint, the input with its unit, the D-14 presets. */
export function TradeAmount({ size }: { size?: "sheet" }) {
  const t = useTrade();
  const id = useId();
  const buy = t.side === "buy";
  // Devnet only (04-03 Note): the worker's cap from the last buy quote, so neither curve completes.
  const cap = devnetCap(t.side, t.quote);
  const hint = hintText(t);
  const error = errorText(t, cap);
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="grid gap-2">
      <LabelRow id={id} buy={buy} hint={hint} />
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className={cn("num min-h-14 text-xl", buy ? "pr-16" : "pr-28")}
          value={t.amount}
          onChange={(e) => t.setAmount(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          {buy ? "SOL" : t.symbol}
        </span>
      </div>
      <Chips
        legend="Amount presets"
        items={presets(t, cap)}
        pressed={t.amount.trim()}
        onPick={t.pickAmount}
        size={size}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
