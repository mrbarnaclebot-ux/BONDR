"use client";
// The console's Postgres-backed state (D-21): the overview from the page render, reloaded only by the Refresh
// click (refresh) or after an action settles (reload). Never on a timer, so Neon can suspend with the tab open.
// Later plans add the selected coin (06-16) and the dialog state (06-18) here, not in admin-console.tsx.
import { useCallback, useRef, useState } from "react";
import type { AdminOverview } from "./admin-data";

export type Console = {
  overview: AdminOverview;
  loading: boolean;
  failed: boolean;
  refresh(): Promise<void>;
  reload(): Promise<void>;
};

export function useConsole(initial: AdminOverview, onUnauthorized: () => void): Console {
  const [overview, setOverview] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const ended = useRef(onUnauthorized);
  ended.current = onUnauthorized;
  // `dim` marks a user Refresh: the button and DB panels show it. A reload after an action stays quiet.
  const load = useCallback(async (dim: boolean) => {
    if (dim) setLoading(true);
    const r = await fetch("/api/admin/overview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    }).catch(() => null);
    const body = r?.ok ? ((await r.json().catch(() => null)) as AdminOverview | null) : null;
    setLoading(false);
    if (r?.status === 401) return ended.current();
    // On failure the panels keep their previous content and the console shows one error line.
    setFailed(!body);
    if (body) setOverview(body);
  }, []);
  const refresh = useCallback(() => load(true), [load]);
  const reload = useCallback(() => load(false), [load]);
  return { overview, loading, failed, refresh, reload };
}
