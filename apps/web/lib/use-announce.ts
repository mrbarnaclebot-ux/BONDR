"use client";
// The trade panel's one polite live region text (UI-SPEC Accessibility Contract), split from use-trade.ts.
import type { TradeQuote } from "@bondr/core/api";
import { useEffect, useRef, useState } from "react";
import { impactPct, outText } from "./format";
import type { TradePhase } from "./use-trade";

const STEPS: Record<TradePhase, string | null> = {
  idle: null,
  preparing: "Preparing trade",
  signing: "Waiting for Phantom",
  confirming: "Confirming",
};

type Announced = { quote: TradeQuote | null; loading: boolean; paused: boolean; phase: TradePhase };

/** UI-SPEC live region: a quote that ends a user's loading (never the silent 2 s refresh), the pause, each step. */
export function useAnnounce(a: Announced, symbol: string): string {
  const [text, setText] = useState("");
  const waiting = useRef(false);
  const { quote: q, loading, paused, phase } = a;
  useEffect(() => {
    if (waiting.current && !loading && q)
      setText(
        `You receive about ${outText(q.side, q.amountOut, symbol)}. Price impact ${impactPct(q.impact)}.`,
      );
    waiting.current = loading;
  }, [loading, q, symbol]);
  useEffect(() => {
    if (paused) setText("Quote paused.");
  }, [paused]);
  useEffect(() => {
    const step = STEPS[phase];
    if (step) setText(step);
  }, [phase]);
  return text;
}
