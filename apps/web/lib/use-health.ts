"use client";
// The console's only timer (D-22): POST /api/admin/health, which reads worker memory and never Postgres, every
// 10 s while the tab is visible. Each poll is scheduled 10 s after the previous answer, so polls never overlap;
// hiding the tab clears the pending one and showing it polls at once (RESEARCH Code Example 7).
import type { AdminHealth } from "@bondr/core/api-admin";
import { useEffect, useRef, useState } from "react";

const EVERY_MS = 10_000;

export type HealthPoll = { health: AdminHealth | null; failedAt: number | null; lastOk: number | null };

export function useHealth(onUnauthorized: () => void): HealthPoll {
  const [poll, setPoll] = useState<HealthPoll>({ health: null, failedAt: null, lastOk: null });
  const ended = useRef(onUnauthorized);
  ended.current = onUnauthorized;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (stop || busy || document.visibilityState !== "visible") return;
      busy = true;
      const r = await fetch("/api/admin/health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
      }).catch(() => null);
      const body = r?.ok ? ((await r.json().catch(() => null)) as AdminHealth | null) : null;
      busy = false;
      if (stop) return;
      if (r?.status === 401) return ended.current();
      // A failure keeps the last good payload so the panel can say when the worker last answered.
      setPoll((p) =>
        body ? { health: body, failedAt: null, lastOk: Date.now() } : { ...p, failedAt: Date.now() },
      );
      clearTimeout(timer);
      timer = setTimeout(tick, EVERY_MS);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return poll;
}
