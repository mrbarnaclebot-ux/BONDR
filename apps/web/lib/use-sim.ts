"use client";
// The simulation dialog's run (ADMIN-01, ADMIN-04, D-12): simulate on open, expire with the intent, then one
// Phantom signature over the worker's own intent text, execute, and the intent poll. Closing the dialog or the
// session ending aborts everything, and a signature that arrives after that is never sent.
import type { AdminIntentView, AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";
import { useCallback, useEffect, useRef, useState } from "react";
import { rejected, useWallet } from "@/components/wallet";
import { adminErrorCopy } from "./admin-copy-sim";
import { executeAdmin, pollIntent, simulateAdmin } from "./admin-run";

export type Note = { variant: "warn" | "error"; text: string };
/** again: "Simulate again" is the way on. refused: the destination check failed, so there is no send button. */
export type Phase = "simulating" | "again" | "refused" | "ready" | "signing" | "sending" | "done";
export type SimState = {
  phase: Phase;
  sim: AdminSimResult | null;
  note: Note | null;
  view: AdminIntentView | null;
};

const S0: SimState = { phase: "simulating", sim: null, note: null, view: null };
const warn = (text: string): Note => ({ variant: "warn", text });
const error = (text: string): Note => ({ variant: "error", text });

type Copy = (code: string, detail?: string) => string;

// Only a sendable simulation carries an intent (06-13); every other verdict names why nothing can be sent.
function verdict(sim: AdminSimResult, copy: Copy): SimState {
  if (!sim.destinations.ok) return { ...S0, phase: "refused", sim };
  if (sim.nothing) return { ...S0, phase: "again", sim, note: warn(copy("nothing_to_send")) };
  if (!sim.ok) return { ...S0, phase: "again", sim, note: error(copy("simulation_failed", sim.error)) };
  if (!sim.intent) return { ...S0, phase: "again", sim, note: error(copy("worker_unavailable")) };
  return { ...S0, phase: "ready", sim };
}

/** The dialog's state; `sent` turns true once anything may have been sent, so closing reloads the DB panels. */
export function useSim(
  action: AdminTxAction,
  mint: string | null,
  symbol: string,
  onUnauthorized: () => void,
) {
  const wallet = useWallet();
  const [s, setS] = useState<SimState>(S0);
  const sent = useRef(false);
  const ctrl = useRef(new AbortController());
  const copy = useCallback<Copy>(
    (code, detail) => adminErrorCopy(code, action, symbol, detail),
    [action, symbol],
  );
  const simulate = useCallback(async () => {
    const signal = ctrl.current.signal;
    setS(S0);
    const r = await simulateAdmin(action, mint, signal);
    if (signal.aborted) return;
    if (r.ok) setS(verdict(r.body, copy));
    else if (r.status === 401) onUnauthorized();
    else setS({ ...S0, phase: "again", note: error(copy(r.code)) });
  }, [action, mint, copy, onUnauthorized]);
  // A fresh controller per mount, so dev StrictMode's second mount simulates again instead of staying aborted.
  useEffect(() => {
    ctrl.current = new AbortController();
    void simulate();
    return () => ctrl.current.abort();
  }, [simulate]);
  useExpiry(s, setS, copy);
  const send = useSend(s, setS, { wallet, ctrl, sent, copy, onUnauthorized });
  return { s, simulate: () => void simulate(), send: () => void send(), sent };
}

type SetS = (f: SimState | ((p: SimState) => SimState)) => void;

// The client clock passing Expires ends the ready phase; the worker refuses a late intent anyway.
function useExpiry(s: SimState, setS: SetS, copy: Copy) {
  const exp = s.phase === "ready" ? s.sim?.intent?.expiresAt : undefined;
  useEffect(() => {
    if (exp === undefined) return;
    const expire = (p: SimState) =>
      p.phase === "ready" ? { ...p, phase: "again" as const, note: warn(copy("intent_expired")) } : p;
    const t = setTimeout(() => setS(expire), Math.max(0, exp - Date.now()));
    return () => clearTimeout(t);
  }, [exp, setS, copy]);
}

type SendDeps = {
  wallet: ReturnType<typeof useWallet>;
  ctrl: { current: AbortController };
  sent: { current: boolean };
  copy: Copy;
  onUnauthorized(): void;
};

// A refused execute sent nothing. A bad signature leaves the intent usable, so the send button stays. A lost
// answer may have been taken, so it is polled and reported unknown at worst, never "nothing was sent".
function useSend(s: SimState, setS: SetS, d: SendDeps) {
  return async () => {
    const { sim } = s;
    const intent = sim?.intent;
    if (s.phase !== "ready" || !sim || !intent) return;
    const signal = d.ctrl.current.signal;
    setS({ ...S0, phase: "signing", sim });
    // D-12: the worker's text byte for byte; the browser never builds or edits what the owner signs.
    const sig = await d.wallet
      .signMessage(new TextEncoder().encode(intent.message))
      .catch((e: unknown) => (rejected(e) ? "phantom_rejected" : "phantom_failed"));
    if (signal.aborted) return;
    if (typeof sig === "string") return setS({ ...S0, phase: "ready", sim, note: error(d.copy(sig)) });
    setS({ ...S0, phase: "sending", sim });
    const r = await executeAdmin(intent.id, sig, signal);
    if (signal.aborted) return;
    if (!r.ok && r.status === 401) return d.onUnauthorized();
    if (!r.ok && r.code === "bad_intent_signature")
      return setS({ ...S0, phase: "ready", sim, note: error(d.copy(r.code)) });
    if (!r.ok && r.code !== "worker_unavailable") {
      const note = r.code === "intent_expired" ? warn(d.copy(r.code)) : error(d.copy(r.code));
      return setS({ ...S0, phase: "again", sim, note });
    }
    d.sent.current = true;
    const v = await pollIntent(intent.id, signal);
    if (signal.aborted) return;
    if (!v.ok) return d.onUnauthorized(); // pollIntent stops early only on a 401
    setS({ ...S0, phase: "done", sim, view: v.body });
  };
}
