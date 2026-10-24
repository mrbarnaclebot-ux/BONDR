"use client";
// The trade panel's run state (UI-SPEC useTrade), split from use-trade.ts to keep both files short.
import type { TradeSide } from "@bondr/core/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/wallet";
import { type Code, runTrade, type Settled, Stop } from "./trade-run";

export type TradePhase = "idle" | "preparing" | "signing" | "confirming";

/** A finished trade, shown in the callout slot until the next panel input or a side change (C-WR-01). */
export type RunResult =
  | { kind: "landed"; side: TradeSide; amountOut?: string; signature: string }
  | { kind: "unknown"; signature: string }
  | { kind: "failed"; code: Code; signature?: string };

function toResult(side: TradeSide, v: Settled): RunResult {
  if (v.state === "landed") return { kind: "landed", side, amountOut: v.amountOut, signature: v.signature };
  if (v.state === "failed") return { kind: "failed", code: v.code ?? "onchain", signature: v.signature };
  return { kind: "unknown", signature: v.signature }; // never observed failing (C-WR-05)
}

type RunArgs = { mint: string; side: TradeSide; units: bigint | null; slippageBps: number };

/** The in-flight phase and the last result; a done run refetches the balances and reports landed to `onLanded`. */
export function useRun(a: RunArgs, refreshBalance: () => void, onLanded: () => void) {
  const wallet = useWallet();
  const [phase, setPhase] = useState<TradePhase>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const busy = useRef(false);
  const live = useRef(wallet.address);
  live.current = wallet.address;
  // C-CR-02: leaving the page aborts the run's requests and its poll.
  const ctrl = useRef<AbortController>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const settle = (v: Settled) => {
    setResult(toResult(a.side, v));
    if (v.state !== "landed") return;
    onLanded();
    // One bounded second read: the worker's balance RPC can lag the confirmation (C-WR-09, D-16).
    setTimeout(refreshBalance, 2_000);
  };
  const fail = (e: unknown) => {
    const code = e instanceof Stop ? e.code : "worker_unavailable";
    // The server has no session for this wallet: back to "Accept terms to trade" and the consent dialog.
    if (code === "consent_required") wallet.forgetConsent();
    else setResult({ kind: "failed", code });
  };
  const submit = async () => {
    if (busy.current || a.units === null) return;
    busy.current = true;
    setResult(null);
    setPhase("preparing");
    ctrl.current = new AbortController();
    const more = { amount: String(a.units), wallet, onPhase: setPhase, address: () => live.current };
    await runTrade({ ...a, ...more, signal: ctrl.current.signal }).then(settle, fail);
    busy.current = false;
    setPhase("idle");
    refreshBalance();
  };
  // Stable: the provider's input handlers call it on every input.
  const clearResult = useCallback(() => setResult(null), []);
  return { phase, result, submit: () => void submit(), clearResult };
}
