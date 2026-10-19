"use client";
import type { Exit, PauseReason, Status } from "@bondr/core/api";
import { type ComponentType, type Dispatch, type ReactNode, useEffect, useReducer, useRef } from "react";
import { useStatus } from "@/lib/use-status";
import { Callout } from "./callout";
import { type Buy, checkBuy, LaunchBuy, minOf, type QuoteState, useQuote } from "./launch-buy";
import { LaunchCoin } from "./launch-coin";
import { LaunchReceipt } from "./launch-receipt";
import { LaunchReview } from "./launch-review";
import { LaunchStepper, STEP_NAMES } from "./launch-stepper";

export type Step = 1 | 2 | 3 | 4 | 5;
export type Fields = { name: string; symbol: string; description: string } & Record<LinkKey, string>;
export type LinkKey = "x" | "telegram" | "website";
export type Picked = { file: File; url: string; width: number; height: number };
export type Launch = {
  step: Step;
  fields: Fields;
  image: Picked | null;
  devBuy: string;
  exit: Exit | null;
  launchId: string | null;
  cid: string | null;
};
export type Action =
  | { type: "go"; step: Step }
  | { type: "field"; key: keyof Fields; value: string }
  | { type: "image"; image: Picked | null }
  | { type: "devBuy"; value: string }
  | { type: "exit"; exit: Exit }
  | { type: "prepared"; launchId: string; cid: string };
/** Live worker values every step and the receipt read: status (polled), the dev buy check and its quote. */
export type Live = { status: Status | null; statusError: boolean; buy: Buy; quote: QuoteState };
export type StepProps = { state: Launch; dispatch: Dispatch<Action>; live: Live };

const EMPTY = { name: "", symbol: "", description: "", x: "", telegram: "", website: "" };
const INITIAL: Launch = {
  step: 1,
  fields: EMPTY,
  image: null,
  devBuy: "",
  exit: null,
  launchId: null,
  cid: null,
};

function reduce(state: Launch, action: Action): Launch {
  switch (action.type) {
    case "go":
      return { ...state, step: action.step };
    case "field":
      return { ...state, fields: { ...state.fields, [action.key]: action.value } };
    case "image":
      return { ...state, image: action.image };
    case "devBuy":
      return { ...state, devBuy: action.value };
    case "exit":
      return { ...state, exit: action.exit };
    case "prepared":
      return { ...state, launchId: action.launchId, cid: action.cid };
  }
}

// Step bodies arrive per plan: 4 and 5 in 02-13.
const BODIES: Partial<Record<Step, ComponentType<StepProps>>> = {
  1: LaunchCoin,
  2: LaunchBuy,
  3: LaunchReview,
};

const PAUSED: Record<PauseReason, string> = {
  kill_switch:
    "The BONDR owner has paused new launches. You can fill this in now; the Launch button unlocks automatically when launches resume.",
  awaiting_migration:
    "BONDR's own curve is complete and migrating to PumpSwap. You can fill this in now; the Launch button unlocks automatically when the pool is live.",
};

function useLive(devBuy: string): Live {
  const { status, error } = useStatus();
  const buy = checkBuy(devBuy, minOf(status));
  const quote = useQuote(buy.ok ? buy.lamports : null);
  return { status, statusError: error, buy, quote };
}

/** `children` is the server-rendered title and lede, so they stay out of the client bundle. */
export function LaunchFlow({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const live = useLive(state.devBuy);
  const paused = live.status?.paused;
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(state.step);
  useEffect(() => {
    if (shown.current === state.step) return; // never steal focus on first load
    shown.current = state.step;
    heading.current?.focus();
  }, [state.step]);
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
        <section
          key={state.step}
          aria-labelledby="step-heading"
          className="animate-rise rounded-lg border border-line bg-[linear-gradient(180deg,color-mix(in_oklch,var(--surface-2)_92%,transparent),color-mix(in_oklch,var(--surface)_96%,transparent))] p-4 shadow-elev-1 sm:p-8"
        >
          <h2 id="step-heading" ref={heading} tabIndex={-1} className="sr-only">
            Step {state.step} of 5: {STEP_NAMES[state.step - 1]}
          </h2>
          {Body && <Body state={state} dispatch={dispatch} live={live} />}
        </section>
      </div>
      <LaunchReceipt state={state} live={live} />
    </div>
  );
}
