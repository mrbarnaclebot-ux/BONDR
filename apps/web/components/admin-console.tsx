"use client";
// The owner console shell (D-06, D-10, D-11, UI-SPEC Top bar and Layout): the session line with a minute
// countdown, Refresh, Sign out, and the panel grid in the mockup order. Layout and mounts only: state lives in
// use-console.ts. Any 401 from a panel swaps the console for the sign-in card.
import { RefreshCw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { clock } from "@/lib/admin-copy-health";
import type { AdminOverview } from "@/lib/admin-data";
import { type Console, useConsole } from "@/lib/use-console";
import { useHealth } from "@/lib/use-health";
import { AuditLog } from "./admin-audit";
import { AdminHealth } from "./admin-health";
import { type AdminSessionView, AdminSignIn, type SignInNotice } from "./admin-signin";
import { SimDialog } from "./admin-sim";
import { KillSwitches } from "./admin-switches";
import { AdminTimeline } from "./admin-timeline";
import { TopBar } from "./admin-topbar";
import { AdminWallets } from "./admin-wallets";
import { WTable } from "./admin-wtable";
import { Callout } from "./callout";
import { Button } from "./ui-button";

export type ConsoleProps = AdminSessionView & { initial: AdminOverview; windowMs: number };

type Admin = AdminSessionView & { onUnauthorized(): void };
const AdminContext = createContext<Admin | null>(null);

/** The signed-in wallet, the cookie's expiry and onUnauthorized, for every panel inside the console. */
export function useAdmin(): Admin {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin needs AdminConsole");
  return admin;
}

export function AdminConsole({ wallet, exp, initial, windowMs }: ConsoleProps) {
  const [session, setSession] = useState<AdminSessionView>({ wallet, exp });
  const [gate, setGate] = useState<SignInNotice | null>(null);
  const resume = useCallback((s: AdminSessionView) => {
    setSession(s);
    setGate(null);
  }, []);
  const onUnauthorized = useCallback(() => setGate("ended"), []);
  const con = useConsole(initial, onUnauthorized, windowMs);
  if (gate) return <AdminSignIn configured notice={gate} onSignedIn={resume} />;
  return (
    <AdminContext value={{ ...session, onUnauthorized }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-8 pb-16 [&>*]:min-w-0">
        <div className="grid gap-4">
          <TopBar
            session={session}
            onRenew={resume}
            onEnd={onUnauthorized}
            onSignedOut={() => setGate("signedout")}
          >
            <Refresh con={con} />
          </TopBar>
          {con.failed && <Callout variant="error">Could not refresh. Try again.</Callout>}
        </div>
        <Grid con={con} onUnauthorized={onUnauthorized} windowMs={windowMs} />
      </div>
    </AdminContext>
  );
}

// Only a user pick moves focus to the Timeline h2, after it renders the new title; the default selection on open
// or after a load never does.
function usePick(select: (mint: string) => void) {
  const [picks, setPicks] = useState(0);
  useEffect(() => {
    const h = picks ? document.getElementById("timeline-h") : null;
    h?.focus({ preventScroll: true });
    h?.scrollIntoView({ block: "start" });
  }, [picks]);
  return useCallback(
    (mint: string) => {
      select(mint);
      setPicks((n) => n + 1);
    },
    [select],
  );
}

// UI-SPEC Layout, DOM order equals visual order. Mounted only while signed in, so the health poll stops with the
// session. Later plans fill the commented slots.
function Grid({ con, onUnauthorized, windowMs }: { con: Console; onUnauthorized(): void; windowMs: number }) {
  const poll = useHealth(onUnauthorized);
  const { overview, loading } = con;
  const pick = usePick(con.select);
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 min-[68.75rem]:grid-cols-[1.1fr_1fr_1.2fr] [&>*]:min-w-0">
        <AdminWallets overview={overview} busy={loading} onTx={con.openSim} />
        <KillSwitches poll={poll} onChanged={con.reload} />
        <AdminHealth
          poll={poll}
          overview={overview}
          busy={loading}
          className="md:col-span-2 min-[68.75rem]:col-span-1"
          onSelect={pick}
        />
      </div>
      <WTable
        overview={overview}
        busy={loading}
        windowMs={windowMs}
        selected={con.selected}
        onSelect={pick}
      />
      <div className="grid gap-8 min-[68.75rem]:grid-cols-[1.3fr_1fr] min-[68.75rem]:items-start [&>*]:min-w-0">
        <AdminTimeline
          overview={overview}
          selected={con.selected}
          windowMs={windowMs}
          onChanged={con.reload}
          onTx={(action) => con.openSim(action, con.selected)}
        />
        {/* 06-19, 06-20: a "grid gap-8" stack of <AdminInspect /> and <AdminModeration /> */}
      </div>
      <AuditLog key={overview.loadedAt} overview={overview} busy={loading} />
      {/* 06-23: <Evacuate /> */}
      {con.sim && <SimDialog {...con.sim} overview={overview} onClose={con.closeSim} />}
    </>
  );
}

// UI-SPEC Refresh control: the one way a user reloads the Postgres panels. "Loaded" is local time, so it renders
// after mount (the server's time zone would differ).
function Refresh({ con }: { con: Console }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const at = con.overview.loadedAt;
  return (
    <div className="grid gap-1 md:flex md:items-center md:gap-3">
      <Button
        className="w-full md:min-h-9 md:w-auto"
        disabled={con.loading}
        aria-busy={con.loading}
        onClick={() => void con.refresh()}
      >
        <RefreshCw strokeWidth={1.5} aria-hidden="true" />
        {con.loading ? "Refreshing…" : "Refresh"}
      </Button>
      <span className="text-xs text-muted-foreground">
        {!mounted ? "\u00a0" : at > 0 ? `Loaded ${clock(at, false)}` : "Not loaded"}
      </span>
    </div>
  );
}
