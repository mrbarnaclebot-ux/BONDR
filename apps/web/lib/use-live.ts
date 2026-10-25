"use client";
import type { LiveEvent } from "@bondr/core/api";
import { useEffect, useRef, useState } from "react";

type Data<T extends LiveEvent["type"]> = Extract<LiveEvent, { type: T }>["data"];

export type LiveHandlers = {
  mint?: string;
  /** The hub id the page was rendered at; the first connect replays what landed after it. */
  last?: string | null;
  onTrade?(d: Data<"trade">): void;
  onLaunch?(d: Data<"launch">): void;
  onBond?(d: Data<"bond">): void;
  onHolders?(d: Data<"holders">): void;
  onFee?(d: Data<"fee">): void;
  onResync?(): void;
};

/** null until the stream first opens, so the page never claims "Live" before it is. */
export type LiveState = "live" | "reconnecting" | null;

const EVENTS = {
  trade: "onTrade",
  launch: "onLaunch",
  bond: "onBond",
  holders: "onHolders",
  fee: "onFee",
  resync: "onResync",
} as const;

// Slow enough that a tab at the per-IP cap stays well under the 30 connects a minute limit.
const REOPEN_MS = 15_000;

function listen(es: EventSource, ref: { current: LiveHandlers }) {
  for (const [type, key] of Object.entries(EVENTS)) {
    es.addEventListener(type, (e) => {
      let data: unknown;
      try {
        data = JSON.parse((e as MessageEvent<string>).data);
      } catch {
        return; // a malformed frame is dropped, never rendered (T-03-09-01)
      }
      (ref.current[key] as ((d: unknown) => void) | undefined)?.(data);
    });
  }
}

/**
 * One EventSource on /api/live (D-04: no polling). EventSource reconnects on its own and sends Last-Event-ID,
 * so the server replays or sends `resync`. Handlers are read through a ref, so re-renders never reopen it.
 * A refused connect (429 at the per-IP cap) closes the EventSource for good, so that one is reopened on a timer.
 */
export function useLive(handlers: LiveHandlers): LiveState {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const [state, setState] = useState<LiveState>(null);
  const { mint } = handlers;
  useEffect(() => {
    let es: EventSource;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reopened = false;
    const open = () => {
      const q = new URLSearchParams(mint ? { mint } : {});
      if (ref.current.last && !reopened) q.set("last", ref.current.last);
      es = new EventSource(`/api/live${q.size ? `?${q}` : ""}`);
      es.onopen = () => {
        setState("live");
        if (reopened) ref.current.onResync?.(); // a new EventSource has no Last-Event-ID, so no replay
        reopened = false;
      };
      es.onerror = () => {
        setState("reconnecting");
        if (es.readyState !== EventSource.CLOSED) return;
        reopened = true;
        timer = setTimeout(open, REOPEN_MS);
      };
      listen(es, ref);
    };
    open();
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [mint]);
  return state;
}
