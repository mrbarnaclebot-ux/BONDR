"use client";
import { LoaderCircle, RefreshCw, Wallet } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { type ButtonState, buttonState } from "@/lib/trade-button";
import { type Trade, useTrade } from "@/lib/use-trade";
import { useCoinLive } from "./coin-live";
import { TradeAmount } from "./trade-amount";
import { TradeQuote } from "./trade-quote";
import { TradeCallouts } from "./trade-result";
import { Button } from "./ui-button";
import { Seg } from "./ui-seg";
import { useWallet, type WalletApi } from "./wallet";

const SIDES = ["Buy", "Sell"] as const;
const ICONS = { wallet: Wallet, refresh: RefreshCw, loader: LoaderCircle };

const FRAME =
  "rounded-lg border border-line-strong bg-[radial-gradient(100%_50%_at_50%_0%,color-mix(in_oklch,var(--leaf)_10%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] p-4 shadow-elev-2 md:p-6";

type Props = {
  /** "sheet": the dialog draws the frame and padding, chips are 44px, and the sheet reports visibility itself. */
  placement?: "column" | "sheet";
  /** The h2 id, so the sheet's dialog can name itself by it. */
  labelId?: string;
};

/** The button's state for the live panel, wallet and coin venue (UI-SPEC Submit button states). */
function useButton(t: Trade, w: WalletApi): ButtonState {
  const venue = useCoinLive()?.coin?.venue;
  const browser = typeof window !== "undefined";
  return buttonState({
    wallet: w.status,
    consented: w.consented,
    mobile: browser && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
    url: browser ? location.href : "https://bondr.invalid/",
    coinComplete: venue === "complete",
    side: t.side,
    symbol: t.symbol,
    units: t.units,
    balance: t.balance,
    quote: t.quote?.side === t.side ? t.quote : null,
    loading: t.loading,
    quoteError: t.quoteError,
    paused: t.paused,
    phase: t.phase,
  });
}

function Submit({ s, run }: { s: ButtonState; run(): void }) {
  const Icon = s.icon && ICONS[s.icon];
  const icon = Icon && (
    <Icon
      className={cn(s.icon === "loader" && "motion-safe:animate-spin")}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );
  const cls = "w-full";
  if (s.action === "link") {
    const external = s.href === "https://phantom.com/download";
    return (
      <Button asChild variant={s.variant} size="lg" className={cls}>
        <a href={s.href} {...(external && { target: "_blank", rel: "noopener" })}>
          {s.label}
          {external && <span className="sr-only"> (opens in a new tab)</span>}
        </a>
      </Button>
    );
  }
  // Only a submit-ready button is type submit, so Enter in the amount field never connects or refreshes.
  // preventDefault: a refresh press re-renders this button as type submit before the click's default action
  // runs, which would submit the form and start a trade.
  return (
    <Button
      type={s.action === "submit" ? "submit" : "button"}
      variant={s.variant}
      size="lg"
      className={cls}
      disabled={s.disabled}
      aria-disabled={s.ariaDisabled || undefined}
      onClick={
        s.action === "submit"
          ? undefined
          : (e) => {
              e.preventDefault();
              run();
            }
      }
    >
      {icon}
      {s.label}
    </Button>
  );
}

/** UI-SPEC Trade panel items 1-7: side, amount, quote list with slippage and fees, result, button, fine print. */
export function TradePanel({ placement = "column", labelId }: Props) {
  const t = useTrade();
  const w = useWallet();
  const s = useButton(t, w);
  const own = useId();
  const h = labelId ?? own;
  const sheet = placement === "sheet";
  const size = sheet ? "sheet" : undefined;
  const run = () => {
    if (s.action === "connect") void w.connect();
    else if (s.action === "consent") w.forgetConsent();
    else if (s.action === "refresh") t.resume();
    else if (s.action === "submit") t.submit();
  };
  return (
    <section
      ref={sheet ? undefined : t.panelRef}
      aria-labelledby={h}
      className={cn("grid gap-4", !sheet && FRAME)}
    >
      <h2 id={h} className="sr-only">
        Trade {t.symbol}
      </h2>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (s.action === "submit") run();
        }}
      >
        {/* In flight every input is locked; the button stays focusable (aria-disabled) outside it. */}
        <fieldset disabled={t.phase !== "idle"} className="m-0 grid min-w-0 gap-4 border-0 p-0">
          {/* In the sheet the side seg stops short of the close button in the top right corner. */}
          <div className={cn("grid", sheet && "pr-12")}>
            <Seg
              label="Trade side"
              options={SIDES}
              value={t.side === "buy" ? "Buy" : "Sell"}
              onChange={(v) => t.setSide(v === "Buy" ? "buy" : "sell")}
              tone={t.side === "sell" ? "danger" : "mint"}
            />
          </div>
          <TradeAmount size={size} />
          {s.hint && <p className="-mt-2 text-xs text-muted-foreground">{s.hint}</p>}
          <TradeQuote size={size} />
        </fieldset>
        <TradeCallouts />
        <Submit s={s} run={run} />
      </form>
      <p className="text-xs text-muted-foreground">One Phantom signature. Quote refreshes every 2 seconds.</p>
      {/* UI-SPEC Accessibility: the one polite region for the quote, the pause and the in-flight steps. */}
      <p aria-live="polite" className="sr-only">
        {t.announce}
      </p>
    </section>
  );
}
