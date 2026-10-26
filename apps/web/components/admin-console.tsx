"use client";
// The owner console shell (D-06, D-10, D-11, UI-SPEC Top bar and Layout): the session line with a minute
// countdown, Refresh, Sign out, and the panel grid in the mockup order. Layout and mounts only: state lives in
// use-console.ts. Any 401 from a panel swaps the console for the sign-in card.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AdminOverview } from "@/lib/admin-data";
import { type Console, useConsole } from "@/lib/use-console";
import { useHealth } from "@/lib/use-health";
import { AuditLog } from "./admin-audit";
import { Evacuate } from "./admin-evacuate";
import { AdminHealth } from "./admin-health";
import { AdminInspect } from "./admin-inspect";
import { AdminModeration } from "./admin-moderation";
import { type AdminSessionView, AdminSignIn, type SignInNotice } from "./admin-signin";
import { SimDialog } from "./admin-sim";
import { KillSwitches } from "./admin-switches";
import { AdminTimeline } from "./admin-timeline";
import { Refresh, TopBar } from "./admin-topbar";
import { AdminWallets } from "./admin-wallets";
import { WTable } from "./admin-wtable";
import { Callout } from "./callout";

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
  // A session end unmounts the money flows: the dialog is dropped (never reopened as a fresh simulation, WR-B-01)
  // and the notice says when a send was out, so the owner checks the audit log before running it again.
  const conRef = useRef<Console | null>(null);
  const onUnauthorized = useCallback(() => {
    const lost = conRef.current?.endSim();
    setGate((g) => (lost ? "lost" : (g ?? "ended")));
  }, []);
  const con = useConsole(initial, onUnauthorized, windowMs);
  conRef.current = con;
  const reopen = (s: AdminSessionView) => {
    resume(s);
    void con.reload();
  };
  if (gate) return <AdminSignIn configured notice={gate} onSignedIn={reopen} />;
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
        <div className="grid gap-8 [&>*]:min-w-0">
          <AdminInspect overview={overview} />
          <AdminModeration overview={overview} onChanged={con.reload} />
        </div>
      </div>
      <AuditLog key={overview.loadedAt} overview={overview} busy={loading} />
      <Evacuate
        overview={overview}
        evacuate={poll.health?.evacuate}
        onChanged={con.reload}
        onSending={con.sending}
      />
      {con.sim && (
        <SimDialog {...con.sim} overview={overview} onClose={con.closeSim} onSending={con.sending} />
      )}
    </>
  );
}
