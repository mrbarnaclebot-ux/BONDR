"use client";
import type { Exit, LaunchView, PauseReason, Status } from "@bondr/core/api";
import { type ComponentType, type Dispatch, type ReactNode, useEffect, useReducer, useRef } from "react";
import { sol } from "@/lib/format";
import { getView } from "@/lib/launch-run";
import { useStatus } from "@/lib/use-status";
import { Callout } from "./callout";
import { type Buy, checkBuy, LaunchBuy, minOf, type QuoteState, useQuote } from "./launch-buy";
import { LaunchCoin } from "./launch-coin";
import { LaunchLive } from "./launch-live";
import { LaunchReceipt } from "./launch-receipt";
import { LaunchReview } from "./launch-review";
import { LaunchSign, NOT_FOUND, stored } from "./launch-sign";
import { LaunchStepper, STEP_NAMES } from "./launch-stepper";

export type Step = 1 | 2 | 3 | 4 | 5;
export type Fields = { name: string; symbol: string; description: string } & Record<LinkKey, string>;
export type LinkKey = "x" | "telegram" | "website";
export type Picked = { file: File; url: string; width: number; height: number };
/** `proof` is the pin route's HMAC over uri and imageCid; prepare refuses metadata it did not pin. */
export type Pinned = { uri: string; cid: string; imageCid: string; proof: string };
export type Launch = {
  step: Step;
  fields: Fields;
  image: Picked | null;
  devBuy: string;
  exit: Exit | null;
  /** The pinned metadata; cleared when a field or the image changes, so Try again re-pins only then. */
  pin: Pinned | null;
  launchId: string | null;
  mint: string | null;
  /** The server's launch row once step 4 is restored or step 5 is reached. */
  view: LaunchView | null;
  notice: string | null;
  /** Element id that takes focus on the next step change instead of the step heading. */
  focus: string | null;
};
export type Action =
  | { type: "go"; step: Step; focus?: string }
  | { type: "field"; key: keyof Fields; value: string }
  | { type: "image"; image: Picked | null }
  | { type: "devBuy"; value: string }
  | { type: "exit"; exit: Exit }
  | { type: "pinned"; pin: Pinned }
  | { type: "prepared"; launchId: string; mint: string }
  | { type: "restore"; view: LaunchView }
  | { type: "live"; view: LaunchView }
  | { type: "reset"; notice?: string };
/** Live worker values every step and the receipt read: status (polled), the dev buy check and its quote. */
export type Live = {
  status: Status | null;
  statusError: boolean;
  refresh(): void;
  buy: Buy;
  quote: QuoteState;
};
export type StepProps = { state: Launch; dispatch: Dispatch<Action>; live: Live };

const EMPTY = { name: "", symbol: "", description: "", x: "", telegram: "", website: "" };
const INITIAL: Launch = {
  step: 1,
  fields: EMPTY,
  image: null,
  devBuy: "",
  exit: null,
  pin: null,
  launchId: null,
  mint: null,
  view: null,
  notice: null,
  focus: null,
};

// After a reload the form is gone, so the launch row refills what the receipt shows.
const withView = (s: Launch, v: LaunchView): Launch => ({
  ...s,
  view: v,
  launchId: v.id,
  mint: v.mint,
  ...(!s.fields.name && {
    fields: { ...EMPTY, name: v.name, symbol: v.symbol },
    exit: v.exit,
    devBuy: sol(v.solIn),
  }),
});

function reduce(state: Launch, action: Action): Launch {
  switch (action.type) {
    case "go":
      return { ...state, step: action.step, focus: action.focus ?? null, notice: null };
    case "field":
      return { ...state, fields: { ...state.fields, [action.key]: action.value }, pin: null };
    case "image":
      return { ...state, image: action.image, pin: null };
    case "devBuy":
      return { ...state, devBuy: action.value };
    case "exit":
      return { ...state, exit: action.exit };
    case "pinned":
      return { ...state, pin: action.pin };
    case "prepared":
      return { ...state, launchId: action.launchId, mint: action.mint };
    case "restore":
      return { ...withView(state, action.view), step: 4 };
    case "live":
      return { ...withView(state, action.view), step: 5, focus: "live-heading" };
    case "reset":
      return { ...INITIAL, notice: action.notice ?? null };
  }
}

const BODIES: Record<Step, ComponentType<StepProps>> = {
  1: LaunchCoin,
  2: LaunchBuy,
  3: LaunchReview,
  4: LaunchSign,
  5: LaunchLive,
};

const PAUSED: Record<PauseReason, string> = {
  kill_switch:
    "The BONDR owner has paused new launches. You can fill this in now; the Launch button unlocks automatically when launches resume.",
  awaiting_migration:
    "BONDR's own curve is complete and migrating to PumpSwap. You can fill this in now; the Launch button unlocks automatically when the pool is live.",
};

function useLive(devBuy: string): Live {
  const { status, error, refresh } = useStatus();
  const buy = checkBuy(devBuy, minOf(status));
  const quote = useQuote(buy.ok ? buy.lamports : null);
  return { status, statusError: error, refresh, buy, quote };
}

/** A launch posted before a reload: step 4 keeps polling it, step 5 shows it; it is never signed again. */
function useRestore(dispatch: Dispatch<Action>) {
  useEffect(() => {
    const id = stored.get();
    if (!id) return;
    void getView(id).then((v) => {
      if (v === "not_found") {
        stored.set(null);
        dispatch({ type: "reset", notice: NOT_FOUND });
      } else if (v?.state === "landed") dispatch({ type: "live", view: v });
      else if (v && v.state !== "failed" && v.state !== "prepared") dispatch({ type: "restore", view: v });
      else if (v) stored.set(null);
    });
  }, [dispatch]);
}

function useStepFocus(step: Step, focus: string | null) {
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return; // never steal focus on first load
    shown.current = step;
    (focus ? document.getElementById(focus) : heading.current)?.focus();
  }, [step, focus]);
  return heading;
}

/** `children` is the server-rendered title and lede, so they stay out of the client bundle. */
export function LaunchFlow({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const live = useLive(state.devBuy);
  const paused = live.status?.paused;
  const heading = useStepFocus(state.step, state.focus);
  useRestore(dispatch);
  const Body = BODIES[state.step];
  return (
    <div className="mx-auto grid w-full max-w-[1440px] items-start gap-12 px-(--gutter) pt-12 min-[1080px]:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        {children}
        <LaunchStepper step={state.step} />
        {/* Always mounted, so the pause is announced when it starts, not only when the page loads. */}
        <div aria-live="polite">
          {paused && (
            <Callout variant="warn" title="Launches are paused." className="mb-6">
              {PAUSED[paused]}
            </Callout>
          )}
        </div>
        {state.notice && (
          <Callout variant="error" className="mb-6">
            {state.notice}
          </Callout>
        )}
        <section
          key={state.step}
          aria-labelledby="step-heading"
          className="animate-rise rounded-lg border border-line bg-[linear-gradient(180deg,color-mix(in_oklch,var(--surface-2)_92%,transparent),color-mix(in_oklch,var(--surface)_96%,transparent))] p-4 shadow-elev-1 sm:p-8"
        >
          <h2 id="step-heading" ref={heading} tabIndex={-1} className="sr-only">
            Step {state.step} of 5: {STEP_NAMES[state.step - 1]}
          </h2>
          <Body state={state} dispatch={dispatch} live={live} />
        </section>
      </div>
      <LaunchReceipt state={state} live={live} />
    </div>
  );
}
