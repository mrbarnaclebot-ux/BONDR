"use client";
// The console's Postgres-backed state (D-21): the overview from the page render, reloaded only by the Refresh
// click (refresh) or after an action settles (reload). Never on a timer, so Neon can suspend with the tab open.
// The selected coin and the open simulation dialog live here too, not in admin-console.tsx.
import type { AdminTxAction } from "@bondr/core/api-admin";
import { useCallback, useRef, useState } from "react";
import type { AdminOverview } from "./admin-data";
import { firstStuck, wItems } from "./admin-state";

export type Console = {
  overview: AdminOverview;
  loading: boolean;
  failed: boolean;
  refresh(): Promise<void>;
  reload(): Promise<void>;
  selected: string | null;
  select(mint: string | null): void;
  sim: Sim | null;
  openSim(action: AdminTxAction, mint: string | null): void;
  /** `sent`: something may have been sent, so the DB panels reload once. */
  closeSim(sent: boolean): void;
};

/** The dialog's action; mint is null only for burn_buyback (a platform action). */
export type Sim = { action: AdminTxAction; mint: string | null };

// UI-SPEC default selection: the first stuck coin on open (and after a load that drops the pick), else none. Stuck does not depend on the clock, so
// the server render and the client agree.
const opening = (o: AdminOverview, windowMs: number): string | null =>
  firstStuck(wItems(o.rows, o.worker?.coins ?? [], o.loadedAt, windowMs));

export function useConsole(initial: AdminOverview, onUnauthorized: () => void, windowMs: number): Console {
  const [overview, setOverview] = useState(initial);
  const [selected, select] = useState(() => opening(initial, windowMs));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const ended = useRef(onUnauthorized);
  ended.current = onUnauthorized;
  // `dim` marks a user Refresh: the button and DB panels show it. A reload after an action stays quiet.
  const load = useCallback(
    async (dim: boolean) => {
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
      if (!body) return;
      setOverview(body);
      // Keep the owner's pick while its coin is still listed; otherwise fall back to the first stuck coin.
      select((s) => (s && body.rows.some((row) => row.mint === s) ? s : opening(body, windowMs)));
    },
    [windowMs],
  );
  const refresh = useCallback(() => load(true), [load]);
  const reload = useCallback(() => load(false), [load]);
  const [sim, setSim] = useState<Sim | null>(null);
  const openSim = useCallback((action: AdminTxAction, mint: string | null) => setSim({ action, mint }), []);
  const closeSim = useCallback(
    (sent: boolean) => {
      setSim(null);
      if (sent) void reload();
    },
    [reload],
  );
  return { overview, loading, failed, refresh, reload, selected, select, sim, openSim, closeSim };
}
