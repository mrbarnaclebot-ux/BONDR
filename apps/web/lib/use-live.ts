"use client";
import type { LiveEvent } from "@bondr/core/api";
import { useEffect, useRef, useState } from "react";

type Data<T extends LiveEvent["type"]> = Extract<LiveEvent, { type: T }>["data"];

export type LiveHandlers = {
  mint?: string;
  onTrade?(d: Data<"trade">): void;
  onLaunch?(d: Data<"launch">): void;
  onBond?(d: Data<"bond">): void;
  onHolders?(d: Data<"holders">): void;
  onResync?(): void;
};

/** null until the stream first opens, so the page never claims "Live" before it is. */
export type LiveState = "live" | "reconnecting" | null;

const EVENTS = {
  trade: "onTrade",
  launch: "onLaunch",
  bond: "onBond",
  holders: "onHolders",
  resync: "onResync",
} as const;

/**
 * One EventSource on /api/live (D-04: no polling). EventSource reconnects on its own and sends Last-Event-ID,
 * so the server replays or sends `resync`. Handlers are read through a ref, so re-renders never reopen it.
 * ponytail: a refused connect (429) closes the EventSource for good and the page stays "Reconnecting" until a
 * reload; reopen on a timer if that shows up in practice.
 */
export function useLive(handlers: LiveHandlers): LiveState {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const [state, setState] = useState<LiveState>(null);
  const { mint } = handlers;
  useEffect(() => {
    const es = new EventSource(mint ? `/api/live?mint=${encodeURIComponent(mint)}` : "/api/live");
    es.onopen = () => setState("live");
    es.onerror = () => setState("reconnecting");
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
    return () => es.close();
  }, [mint]);
  return state;
}
