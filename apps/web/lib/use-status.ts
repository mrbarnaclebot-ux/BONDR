"use client";
import type { Status } from "@bondr/core/api";
import { useEffect, useState } from "react";

const POLL_MS = 10_000;

export type LiveStatus = { status: Status | null; error: boolean };

/**
 * Live fees, minimum and pause state, polled while the page is open so a pause shows and clears without a
 * reload (UI-SPEC Paused state). A failed poll keeps the last good value and sets `error`.
 */
export function useStatus(): LiveStatus {
  const [live, setLive] = useState<LiveStatus>({ status: null, error: false });
  useEffect(() => {
    let mounted = true;
    const load = () =>
      fetch("/api/status", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Status>) : Promise.reject(r.status)))
        .then(
          (status) => mounted && setLive({ status, error: false }),
          () => mounted && setLive((prev) => ({ ...prev, error: true })),
        );
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  return live;
}
