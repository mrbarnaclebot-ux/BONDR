"use client";
import { LoaderCircle, RefreshCw, Wallet } from "lucide-react";
import { type FormEvent, type Ref, useId, useRef } from "react";
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
    quote: t.quote,
    loading: t.loading,
    quoteError: t.quoteError,
    paused: t.paused,
    phase: t.phase,
  });
}

/** The Get Phantom and Open BONDR in Phantom states: a link styled as the button. */
function PhantomLink({ s }: { s: ButtonState }) {
  const external = s.href === "https://phantom.com/download";
  return (
    <Button asChild variant={s.variant} size="lg" className="w-full">
      <a href={s.href} {...(external && { target: "_blank", rel: "noopener" })}>
        {s.label}
        {external && <span className="sr-only"> (opens in a new tab)</span>}
      </a>
    </Button>
  );
}

function Submit({ s, run, ref }: { s: ButtonState; run(): void; ref: Ref<HTMLButtonElement> }) {
  if (s.action === "link") return <PhantomLink s={s} />;
  const Icon = s.icon && ICONS[s.icon];
  // Only a submit-ready button is type submit, so Enter in the amount field never connects or refreshes.
  // preventDefault: a refresh press re-renders this button as type submit before the click's default action
  // runs, which would submit the form and start a trade. Never native disabled, so it keeps focus through a
  // trade and after a landed one clears the amount (C-WR-07); data-off draws the disabled look.
  return (
    <Button
      ref={ref}
      type={s.action === "submit" ? "submit" : "button"}
      variant={s.variant}
      size="lg"
      className="w-full"
      aria-disabled={s.disabled || s.ariaDisabled || undefined}
      data-off={s.disabled || undefined}
      onClick={
        s.action === "submit"
          ? undefined
          : (e) => {
              e.preventDefault();
              run();
            }
      }
    >
      {Icon && (
        <Icon
          className={cn(s.icon === "loader" && "motion-safe:animate-spin")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      )}
      {s.label}
    </Button>
  );
}

/** Items 1-3 and the not-enough hint; in flight the fieldset locks them, the button stays focusable outside. */
function PanelInputs({ t, hint, sheet }: { t: Trade; hint?: string; sheet: boolean }) {
  const size = sheet ? "sheet" : undefined;
  return (
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
      {hint && <p className="-mt-2 text-xs text-muted-foreground">{hint}</p>}
      <TradeQuote size={size} />
    </fieldset>
  );
}

/** Item 7, the fine print, and the panel's one polite live region (UI-SPEC Accessibility). */
function PanelFooter({ announce }: { announce: string }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">One Phantom signature. Quote refreshes every 2 seconds.</p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </>
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
  const go = useRef<HTMLButtonElement>(null);
  const run = () => {
    if (s.action === "connect") void w.connect();
    else if (s.action === "consent") w.forgetConsent();
    else if (s.action === "refresh") t.resume();
    else if (s.action === "submit") t.submit();
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Enter in the amount field: focus moves to the button before the fieldset locks (C-WR-07).
    go.current?.focus();
    if (s.action === "submit") run();
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
      <form noValidate className="grid gap-4" onSubmit={onSubmit}>
        <PanelInputs t={t} hint={s.hint} sheet={sheet} />
        <TradeCallouts />
        <Submit s={s} run={run} ref={go} />
      </form>
      <PanelFooter announce={t.announce} />
    </section>
  );
}
