"use client";
import type { Exit, Quote, Status } from "@bondr/core/api";
import { checkDevBuy, parseSol } from "@bondr/core/rules";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { compact, sol } from "@/lib/format";
import type { Live, StepProps } from "./launch-flow";
import { Button } from "./ui-button";
import { FieldError, Input, Label } from "./ui-field";
import { useWallet } from "./wallet";

const DEBOUNCE_MS = 400;
// D-17: the presets are 1, 2, 4 and 8 times the live minimum, so they scale with the network.
const PRESETS = [1n, 2n, 4n, 8n];
export const EXIT_NAME: Record<Exit, string> = { sell: "Insta sell", burn: "Insta burn" };

export type Buy = { ok: true; lamports: bigint } | { ok: false; code: "nan" | "below_min" };
export type QuoteState = { quote: Quote | null; loading: boolean };

export const minOf = (s: Status | null): bigint | null => (s?.minLamports ? BigInt(s.minLamports) : null);

/** An empty field counts as below the minimum, so it gets the minimum copy rather than "not a number". */
export function checkBuy(raw: string, min: bigint | null): Buy {
  if (!raw.trim()) return { ok: false, code: "below_min" };
  const r = parseSol(raw);
  if (!r.ok) return { ok: false, code: "nan" };
  return checkDevBuy(r.value, min ?? 1n).ok
    ? { ok: true, lamports: r.value }
    : { ok: false, code: "below_min" };
}

/** Dev buy plus the create, network and Sender tip estimates: what the wallet must hold for the launch. */
export const needed = (lamports: bigint, s: Status | null): bigint =>
  lamports +
  BigInt(s?.createCostEstimate ?? 0) +
  BigInt(s?.networkFeeEstimate ?? 0) +
  BigInt(s?.senderTipEstimate ?? 0);

function buyError(live: Live): string | null {
  const min = minOf(live.status);
  const m = min === null ? "…" : sol(min);
  if (!live.buy.ok)
    return live.buy.code === "nan"
      ? "Enter an amount in SOL, like 0.5."
      : `Minimum dev buy is ${m} SOL. Enter ${m} or more.`;
  const balance = live.quote.quote?.balance;
  const need = needed(live.buy.lamports, live.status);
  if (balance === undefined || BigInt(balance) >= need) return null;
  return `Your wallet has ${sol(balance, 4)} SOL. This launch needs about ${sol(need, 4, true)} SOL including fees. Lower the dev buy or add SOL.`;
}

/** Debounced live quote. The wallet rides along only after consent (PLAT-02), and only then is a balance known. */
export function useQuote(solIn: bigint | null): QuoteState {
  const { address, consented } = useWallet();
  const wallet = consented ? address : null;
  const [state, setState] = useState<QuoteState>({ quote: null, loading: false });
  useEffect(() => {
    setState({ quote: null, loading: solIn !== null });
    if (solIn === null) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wallet ? { solIn: String(solIn), wallet } : { solIn: String(solIn) }),
        signal: abort.signal,
      })
        .then((r) => (r.ok ? (r.json() as Promise<Quote>) : Promise.reject(r.status)))
        .then(
          (quote) => setState({ quote, loading: false }),
          () => abort.signal.aborted || setState({ quote: null, loading: false }),
        );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [solIn, wallet]);
  return state;
}

// UI-SPEC surface 2: genesis is insta burn only, so burn is preselected and sell can never stay chosen.
function useBurnOnly({ state, dispatch, live }: StepProps) {
  useEffect(() => {
    if (live.genesis && state.exit !== "burn") dispatch({ type: "exit", exit: "burn" });
  }, [live.genesis, state.exit, dispatch]);
}

export function LaunchBuy({ state, dispatch, live }: StepProps) {
  const [blurred, setBlurred] = useState(false);
  const error = buyError(live);
  // A chosen exit shows the error early, but genesis preselects burn, so there it waits for input or blur.
  const chosen = state.exit !== null && !live.genesis;
  const shown = error && (state.devBuy !== "" || blurred || chosen) ? error : undefined;
  const label = !state.exit ? "Choose an exit to continue" : error ? "Fix the dev buy" : "Review launch";
  useBurnOnly({ state, dispatch, live });
  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (state.exit && !error) dispatch({ type: "go", step: 3 });
      }}
    >
      <BuyField
        live={live}
        value={state.devBuy}
        error={shown}
        onValue={(value) => dispatch({ type: "devBuy", value })}
        onBlur={() => setBlurred(true)}
      />
      <ExitChoice exit={state.exit} live={live} onExit={(exit) => dispatch({ type: "exit", exit })} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button type="button" onClick={() => dispatch({ type: "go", step: 1 })}>
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!state.exit || !!error}
          className="max-sm:flex-1"
        >
          {label}
        </Button>
      </div>
    </form>
  );
}

type BuyFieldProps = {
  live: Live;
  value: string;
  error?: string;
  onValue(value: string): void;
  onBlur(): void;
};

function BuyField({ live, value, error, onValue, onBlur }: BuyFieldProps) {
  const min = minOf(live.status);
  return (
    <div className="grid gap-2">
      <Label htmlFor="buy">Dev buy</Label>
      <div className="relative max-w-80">
        <Input
          id="buy"
          inputMode="decimal"
          autoComplete="off"
          placeholder={min === null ? undefined : sol(min)}
          className="num min-h-14 pr-15 text-lg"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "buy-hint buy-error" : "buy-hint"}
        />
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-bold text-muted-foreground">
          SOL
        </span>
      </div>
      {min !== null && <Presets min={min} onValue={onValue} />}
      <p id="buy-hint" className="text-xs text-muted-foreground">
        Minimum {min === null ? "…" : sol(min)} SOL.{" "}
        {live.genesis
          ? "In the same transaction your SOL buys the new BONDR token, and the tokens are burned."
          : "In the same transaction your SOL buys BONDR, which buys your coin."}
        {live.quote.loading && " About … tokens."}
        {live.quote.quote && (
          <>
            {" "}
            About <span className="num text-foreground">{compact(live.quote.quote.tokensOut)}</span> tokens.
          </>
        )}
      </p>
      <FieldError id="buy-error" message={error} />
    </div>
  );
}

function Presets({ min, onValue }: { min: bigint; onValue(value: string): void }) {
  return (
    <fieldset className="m-0 flex max-w-80 gap-1.5 border-0 p-0">
      <legend className="sr-only">Presets</legend>
      {PRESETS.map((k) => (
        <button
          key={String(k)}
          type="button"
          className="num min-h-11 flex-1 cursor-pointer rounded-md border border-line text-xs transition-colors duration-(--dur) hover:border-leaf hover:text-leaf md:min-h-10"
          onClick={() => onValue(sol(min * k))}
        >
          {sol(min * k)}
        </button>
      ))}
    </fieldset>
  );
}

function ExitChoice({ exit, live, onExit }: { exit: Exit | null; live: Live; onExit(exit: Exit): void }) {
  const q = live.quote.quote;
  const tokens = q ? compact(q.tokensOut) : "…";
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-semibold">
        What happens to your dev buy <span className="font-normal text-muted-foreground">required</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {live.genesis ? (
          <ExitCard value="sell" checked={false} lock="Not for genesis">
            The genesis launch is insta burn only, so the dev buy never stays with anyone.
          </ExitCard>
        ) : (
          <ExitCard value="sell" checked={exit === "sell"} onPick={onExit}>
            Sold back in the same transaction. You get your SOL back, minus fees and price impact.
            <Extra>
              You get back about <span className="text-leaf">{q ? sol(q.solBackEstimate, 3) : "…"} SOL</span>
            </Extra>
          </ExitCard>
        )}
        <ExitCard value="burn" checked={exit === "burn"} onPick={onExit}>
          Burned in the same transaction. Supply shrinks for every holder; you get nothing back.
          <Extra>You get back 0 SOL, burn about {tokens} tokens</Extra>
        </ExitCard>
      </div>
      <ExitCard value="lock" checked={false} lock="Coming later">
        Lock the dev buy for 1 hour to 12 months. Waiting on a Token-2022 test.
      </ExitCard>
      <p className="text-xs text-muted-foreground">
        BONDR only co-signs your launch if this exit is inside the transaction you sign.
      </p>
    </fieldset>
  );
}

const Extra = ({ children }: { children: ReactNode }) => (
  <span className="num mt-2 block text-sm text-foreground">{children}</span>
);

const CARD =
  "grid grid-cols-[22px_1fr] gap-x-2 gap-y-1 rounded-md border border-line-strong bg-[color-mix(in_oklch,var(--ink)_30%,var(--surface))] p-4 " +
  "[transition:border-color_var(--dur),background_var(--dur),box-shadow_400ms_var(--ease-out),translate_500ms_var(--ease-spring)] " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";
const LIVE_CARD =
  "cursor-pointer hover:-translate-y-0.5 hover:border-leaf has-checked:border-leaf has-checked:shadow-glow " +
  "has-checked:bg-[radial-gradient(100%_120%_at_0%_0%,color-mix(in_oklch,var(--leaf)_20%,transparent),transparent_70%),var(--surface)]";

type ExitCardProps = {
  value: Exit | "lock";
  checked: boolean;
  /** The pill of a card shown but not choosable: Streamflow ("lock") for now, Insta sell in genesis. */
  lock?: string;
  onPick?(exit: Exit): void;
  children: ReactNode;
};

/** Native radio in a label card; a card with `lock` is shown but cannot be chosen. */
function ExitCard({ value, checked, lock, onPick, children }: ExitCardProps) {
  return (
    <label className={cn(CARD, lock ? "cursor-not-allowed border-dashed" : LIVE_CARD)}>
      <input
        type="radio"
        name="exit"
        value={value}
        checked={checked}
        disabled={!!lock}
        onChange={() => !lock && value !== "lock" && onPick?.(value)}
        className="row-span-2 mt-0.5 size-[18px] accent-leaf"
      />
      <b className={cn("flex items-center gap-2 text-base font-semibold", lock && "text-muted-foreground")}>
        {value === "lock" ? "Streamflow lock" : EXIT_NAME[value]}
        {lock && (
          <span className="rounded-full border border-line-strong px-2 py-1 text-xs font-semibold tracking-[0.05em] text-foreground uppercase">
            {lock}
          </span>
        )}
      </b>
      <span className="col-start-2 text-sm text-muted-foreground">{children}</span>
    </label>
  );
}
