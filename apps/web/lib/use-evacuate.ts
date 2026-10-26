"use client";
// EVACUATE's run (ADMIN-11, D-12, D-35): the exact phrase arms and starts the simulation on its own, editing away
// discards it, the intent expires on the client clock, then one Phantom signature over the worker's own intent
// text, execute, and the intent poll with progress. Same money path as the simulation dialog (admin-run.ts).
import type { AdminIntentView, AdminSimResult } from "@bondr/core/api-admin";
import { useCallback, useEffect, useRef, useState } from "react";
import { rejected, useWallet } from "@/components/wallet";
import { phraseMatches } from "./admin-copy-evac";
import { adminErrorCopy, sentFailedCopy } from "./admin-copy-sim";
import { executeAdmin, pollIntent, simulateAdmin } from "./admin-run";
import type { Note } from "./use-sim";

export type EvacPhase =
  | "disarmed"
  | "simulating"
  | "again"
  | "nothing"
  | "ready"
  | "signing"
  | "evacuating"
  | "done"
  | "lost";
export type EvacState = {
  phase: EvacPhase;
  sim: AdminSimResult | null;
  note: Note | null;
  view: AdminIntentView | null;
};

const E0: EvacState = { phase: "disarmed", sim: null, note: null, view: null };
const error = (text: string): Note => ({ variant: "error", text });
const copy = (code: string, detail?: string) => adminErrorCopy(code, "evacuate", "", detail);
const again = (sim: AdminSimResult | null, note: Note): EvacState => ({ ...E0, phase: "again", sim, note });

// The worker gives an intent only when ADMIN_EVACUATE is on, on devnet, and some batch passed (06-22).
function verdict(sim: AdminSimResult): EvacState {
  if (!sim.destinations.ok) return again(sim, error(copy("simulation_failed", "destination_refused")));
  if (sim.nothing || sim.totals?.wallets === 0) return { ...E0, phase: "nothing", sim };
  if (!sim.ok) return again(sim, error(copy("simulation_failed", sim.error)));
  return { ...E0, phase: "ready", sim };
}

// Settled: unknown may still land, so it is lost contact and never resent; failed or refused can be simulated
// again to move what is left (the switches are already paused).
function settled(sim: AdminSimResult, v: AdminIntentView): EvacState {
  if (v.state === "unknown") return { ...E0, phase: "lost", sim, view: v };
  if (v.state === "landed") return { ...E0, phase: "done", view: v };
  return again(sim, error(sentFailedCopy(v.code, v.landed, v.total)));
}

type SetS = (f: EvacState | ((p: EvacState) => EvacState)) => void;

/** `canSend` is false on a simulate-only deploy (D-37); `onChanged` reloads the console once anything may have moved. */
export function useEvacuate(
  onUnauthorized: () => void,
  onChanged: () => void,
  onSending: (on: boolean) => void,
) {
  const [typed, setTyped] = useState("");
  const [s, setS] = useState<EvacState>(E0);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const fresh = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    return ctrl.current.signal;
  }, []);
  const simulate = useCallback(async () => {
    const signal = fresh();
    setS({ ...E0, phase: "simulating" });
    const r = await simulateAdmin("evacuate", null, signal);
    if (signal.aborted) return;
    if (r.ok) setS(verdict(r.body));
    else if (r.status === 401) onUnauthorized();
    else setS(again(null, error(copy(r.code))));
  }, [fresh, onUnauthorized]);
  const type = (v: string) => {
    setTyped(v);
    if (phraseMatches(v)) return void simulate();
    ctrl.current?.abort();
    setS(E0);
  };
  useExpiry(s, setS);
  const send = useSend(s, setS, { fresh, onUnauthorized, onChanged, onSending, clear: () => setTyped("") });
  return { typed, type, s, simulate: () => void simulate(), send: () => void send() };
}

// The client clock passing Expires ends the ready phase; the worker refuses a late intent anyway.
function useExpiry(s: EvacState, setS: SetS) {
  const exp = s.phase === "ready" ? s.sim?.intent?.expiresAt : undefined;
  useEffect(() => {
    if (exp === undefined) return;
    const note: Note = { variant: "warn", text: copy("intent_expired") };
    const expire = (p: EvacState) => (p.phase === "ready" ? again(p.sim, note) : p);
    const t = setTimeout(() => setS(expire), Math.max(0, exp - Date.now()));
    return () => clearTimeout(t);
  }, [exp, setS]);
}

type SendDeps = {
  fresh(): AbortSignal;
  onUnauthorized(): void;
  onChanged(): void;
  onSending(on: boolean): void;
  clear(): void;
};

// A refused execute sent nothing; not_applicable means this deploy cannot run EVACUATE (simulate_only or
// devnet_only), so the intent is dropped and the button turns simulate-only. A lost answer is polled.
function useSend(s: EvacState, setS: SetS, d: SendDeps) {
  const wallet = useWallet();
  return async () => {
    const { sim } = s;
    const intent = sim?.intent;
    if (s.phase !== "ready" || !sim || !intent) return;
    const signal = d.fresh();
    const at = (phase: EvacPhase, note: Note | null = null) => setS({ ...E0, phase, sim, note });
    at("signing");
    // D-12: the worker's text byte for byte; the browser never builds or edits what the owner signs.
    const sig = await wallet
      .signMessage(new TextEncoder().encode(intent.message))
      .catch((e: unknown) => (rejected(e) ? "phantom_rejected" : "phantom_failed"));
    if (signal.aborted) return;
    if (typeof sig === "string") return at("ready", error(copy(sig)));
    at("evacuating");
    d.onSending(true);
    const r = await executeAdmin(intent.id, sig, signal);
    if (signal.aborted) return;
    // Every early exit below sent nothing; a 401 here is the web refusing before it forwards.
    if (!(r.ok || r.code === "worker_unavailable")) d.onSending(false);
    if (!r.ok && r.status === 401) return d.onUnauthorized();
    if (!r.ok && r.code === "bad_intent_signature") return at("ready", error(copy(r.code)));
    if (!r.ok && r.code === "not_applicable")
      return setS({ ...E0, phase: "ready", sim: { ...sim, intent: undefined } });
    if (!r.ok && r.code !== "worker_unavailable")
      return setS(
        again(sim, { variant: r.code === "intent_expired" ? "warn" : "error", text: copy(r.code) }),
      );
    const v = await pollIntent(intent.id, signal, (view) => setS((p) => ({ ...p, view })));
    if (signal.aborted) return;
    d.onChanged();
    if (!v.ok) return d.onUnauthorized(); // pollIntent stops early only on a 401
    d.onSending(false);
    if (v.body.state === "landed") d.clear();
    setS(settled(sim, v.body));
  };
}
