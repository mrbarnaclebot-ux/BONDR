"use client";
import type { Status } from "@bondr/core/api";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 10_000;

export type LiveStatus = { status: Status | null; error: boolean; refresh(): void };

/**
 * Live fees, minimum and pause state, polled while the page is open so a pause shows and clears without a
 * reload (UI-SPEC Paused state). A failed poll keeps the last good value and sets `error`.
 */
export function useStatus(): LiveStatus {
  const [live, setLive] = useState<Omit<LiveStatus, "refresh">>({ status: null, error: false });
  const reload = useRef(() => {});
  useEffect(() => {
    let mounted = true;
    const load = () =>
      fetch("/api/status", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Status>) : Promise.reject(r.status)))
        .then(
          (status) => mounted && setLive({ status, error: false }),
          () => mounted && setLive((prev) => ({ ...prev, error: true })),
        );
    reload.current = () => void load();
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  // A refusal that says "paused" (step 4) asks for the pause now instead of at the next 10 s poll.
  const refresh = useCallback(() => reload.current(), []);
  return { ...live, refresh };
}
